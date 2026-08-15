import crypto from 'crypto';
import { Op, ModelCtor, Sequelize } from 'sequelize';
import mainConnection from 'db/mysql/connections/main';
import { DataBaseTableNames } from 'typings';
import { AlertEventTable } from 'db/mysql/models/alertEvent';
import { AlertInstanceTable } from 'db/mysql/models/alertInstance';
import { AlertNotificationDeliveryTable } from 'db/mysql/models/alertNotificationDelivery';

export type DeliveryChannel = 'InApp' | 'Email' | 'Webhook';
export type DeliveryStatus = 'pending' | 'processing' | 'delivered' | 'retrying' | 'failed';
export type AlertInstanceStatus = 'active' | 'resolved' | 'suppressed' | 'pending';
export type AlertOutboxTransaction = { LOCK: { UPDATE: string } };

export type DurableAlertInstance = { tenantId: string; alertId: string; ruleId: string; status: AlertInstanceStatus; payload: Record<string, unknown>; lastNotificationAt?: number };
export type PendingAlertDelivery = { deliveryId: string; tenantId: string; eventId: string; alertId: string; channel: DeliveryChannel; target: Record<string, unknown>; payload: Record<string, unknown>; attempts: number; leaseToken: string };
export type DurableNotification = { id: string; alertId: string; ruleId: string; type: string; channel: DeliveryChannel; status: DeliveryStatus; target: string; content: string; sentAt: string; serviceId: string; service: string; metric: string; value: number; threshold: number; operator: string; mobileTitle: string; mobileBody: string; updatedAt: number };

type StoredRow = { get: () => Record<string, unknown> };
type StoredInstanceRow = StoredRow & { update: (values: Record<string, unknown>, options: Record<string, unknown>) => Promise<unknown> };
type ModelPort<Row extends StoredRow = StoredRow> = {
  findAll(options: Record<string, unknown>): Promise<Row[]>;
  findOne(options: Record<string, unknown>): Promise<Row | null>;
  create(values: Record<string, unknown>, options: Record<string, unknown>): Promise<Row>;
  update(values: Record<string, unknown>, options: Record<string, unknown>): Promise<[number, ...unknown[]]>;
};
type AlertModels = { instances: ModelPort<StoredInstanceRow>; events: ModelPort; deliveries: ModelPort };

const createSequelizeAlertModels = (models: {
  instances: ModelCtor<AlertInstanceTable>;
  events: ModelCtor<AlertEventTable>;
  deliveries: ModelCtor<AlertNotificationDeliveryTable>;
}): AlertModels => ({
  instances: models.instances,
  events: models.events,
  deliveries: models.deliveries,
});

const DEFAULT_TENANT_ID = 'default';
const MAX_DELIVERY_ATTEMPTS = 5;
const DELIVERY_LEASE_MS = 30_000;
const retryDelayMs = (attempts: number) => Math.min(15 * 60_000, 1_000 * 2 ** Math.max(0, attempts - 1));
const stableId = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const isUniqueConflict = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: unknown; original?: { code?: unknown }; parent?: { code?: unknown } };
  return candidate.name === 'SequelizeUniqueConstraintError' || candidate.original?.code === 'ER_DUP_ENTRY' || candidate.parent?.code === 'ER_DUP_ENTRY';
};

const parseJson = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
};

export const normalizeDeliveryTarget = (channel: DeliveryChannel, rawTarget: unknown): Record<string, unknown> | null => {
  if (channel === 'InApp') return { audience: 'tenant', userId: typeof rawTarget === 'object' && rawTarget ? (rawTarget as { userId?: string }).userId || null : null };
  if (typeof rawTarget !== 'string' || !rawTarget.trim()) return null;
  if (channel === 'Email' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawTarget)) return { address: rawTarget };
  if (channel === 'Webhook') {
    try { const url = new URL(rawTarget); return url.protocol === 'https:' || url.protocol === 'http:' ? { url: url.toString() } : null; } catch { return null; }
  }
  return null;
};

export class AlertOutboxRepository {
  constructor(private readonly sequelize: Sequelize, private readonly models: AlertModels) {}

  async loadInstances(limit = 200): Promise<DurableAlertInstance[]> {
    const rows = await this.models.instances.findAll({ order: [['updatedAt', 'DESC']], limit });
    return rows.map(row => {
      const value = row.get();
      const payload = parseJson(value.payloadJson);
      return { tenantId: String(value.tenantId), alertId: String(value.alertId), ruleId: String(value.ruleId), status: value.status as AlertInstanceStatus, payload, lastNotificationAt: value.lastNotificationAt instanceof Date ? value.lastNotificationAt.getTime() : undefined };
    });
  }

  async loadInstance(alertId: string, tenantId = DEFAULT_TENANT_ID): Promise<DurableAlertInstance | null> {
    const row = await this.models.instances.findOne({ where: { tenantId, alertId } });
    if (!row) return null;
    const value = row.get();
    return { tenantId, alertId, ruleId: String(value.ruleId), status: value.status as AlertInstanceStatus, payload: parseJson(value.payloadJson), lastNotificationAt: value.lastNotificationAt instanceof Date ? value.lastNotificationAt.getTime() : undefined };
  }

  async saveInstance(instance: DurableAlertInstance): Promise<void> {
    await this.sequelize.transaction(async transaction => {
      const existing = await this.models.instances.findOne({ where: { tenantId: instance.tenantId, alertId: instance.alertId }, transaction, lock: transaction.LOCK.UPDATE });
      const values = { ruleId: instance.ruleId, status: instance.status, payloadJson: JSON.stringify(instance.payload), lastNotificationAt: instance.lastNotificationAt ? new Date(instance.lastNotificationAt) : null };
      if (existing) await this.models.instances.update(values, { where: { tenantId: instance.tenantId, alertId: instance.alertId }, transaction });
      else await this.models.instances.create({ tenantId: instance.tenantId, alertId: instance.alertId, ...values }, { transaction });
    });
  }

  async saveInstanceAndCreateNotificationEvent(input: DurableAlertInstance & { eventKey?: string; channels?: Array<{ channel: DeliveryChannel; target: unknown }> }): Promise<boolean> {
    return this.sequelize.transaction(async transaction => {
      const existing = await this.models.instances.findOne({ where: { tenantId: input.tenantId, alertId: input.alertId }, transaction, lock: transaction.LOCK.UPDATE });
      const instanceValues = { ruleId: input.ruleId, status: input.status, payloadJson: JSON.stringify(input.payload), lastNotificationAt: input.lastNotificationAt ? new Date(input.lastNotificationAt) : null };
      if (existing) await existing.update(instanceValues, { transaction });
      else await this.models.instances.create({ tenantId: input.tenantId, alertId: input.alertId, ...instanceValues }, { transaction });
      if (!input.eventKey || !input.channels) return true;
      const event = await this.models.events.findOne({ where: { tenantId: input.tenantId, alertId: input.alertId, eventKey: input.eventKey }, transaction, lock: transaction.LOCK.UPDATE });
      if (event) return false;
      const eventId = `alert-event-${stableId(`${input.tenantId}:${input.alertId}:${input.eventKey}`).slice(0, 40)}`;
      await this.models.events.create({ eventId, tenantId: input.tenantId, alertId: input.alertId, eventKey: input.eventKey, eventType: 'notification-requested', payloadJson: JSON.stringify(input.payload) }, { transaction });
      for (const candidate of input.channels) {
        const target = normalizeDeliveryTarget(candidate.channel, candidate.target);
        if (!target) continue;
        const targetKey = stableId(JSON.stringify(target));
        await this.models.deliveries.create({ deliveryId: `alert-delivery-${stableId(`${eventId}:${candidate.channel}:${targetKey}`).slice(0, 40)}`, tenantId: input.tenantId, eventId, alertId: input.alertId, channel: candidate.channel, targetKey, status: 'pending', targetJson: JSON.stringify(target), payloadJson: JSON.stringify(input.payload), attempts: 0, nextAttemptAt: new Date() }, { transaction });
      }
      return true;
    });
  }

  async createNotificationEventInTransaction(transaction: AlertOutboxTransaction, input: { tenantId?: string; alertId: string; eventKey: string; payload: Record<string, unknown>; channels: Array<{ channel: DeliveryChannel; target: unknown }> }): Promise<boolean> {
    const tenantId = input.tenantId || DEFAULT_TENANT_ID;
    const existing = await this.models.events.findOne({ where: { tenantId, alertId: input.alertId, eventKey: input.eventKey }, transaction, lock: transaction.LOCK.UPDATE });
    if (existing) return false;
    const eventId = `alert-event-${stableId(`${tenantId}:${input.alertId}:${input.eventKey}`).slice(0, 40)}`;
    try {
      await this.models.events.create({ eventId, tenantId, alertId: input.alertId, eventKey: input.eventKey, eventType: 'notification-requested', payloadJson: JSON.stringify(input.payload) }, { transaction });
    } catch (error) {
      if (isUniqueConflict(error)) return false;
      throw error;
    }
    for (const candidate of input.channels) {
      const target = normalizeDeliveryTarget(candidate.channel, candidate.target);
      if (!target) continue;
      const targetKey = stableId(JSON.stringify(target));
      const deliveryId = `alert-delivery-${stableId(`${eventId}:${candidate.channel}:${targetKey}`).slice(0, 40)}`;
      try {
        await this.models.deliveries.create({ deliveryId, tenantId, eventId, alertId: input.alertId, channel: candidate.channel, targetKey, status: 'pending', targetJson: JSON.stringify(target), payloadJson: JSON.stringify(input.payload), attempts: 0, nextAttemptAt: new Date() }, { transaction });
      } catch (error) {
        if (!isUniqueConflict(error)) throw error;
      }
    }
    return true;
  }

  async createNotificationEvent(input: { tenantId?: string; alertId: string; eventKey: string; payload: Record<string, unknown>; channels: Array<{ channel: DeliveryChannel; target: unknown }> }): Promise<boolean> {
    const tenantId = input.tenantId || DEFAULT_TENANT_ID;
    return this.sequelize.transaction(transaction => this.createNotificationEventInTransaction(transaction, { ...input, tenantId }));
  }

  async listNotifications(limit = 50): Promise<DurableNotification[]> {
    const rows = await this.models.deliveries.findAll({ order: [['updatedAt', 'DESC']], limit });
    return rows.map(row => {
      const delivery = row.get();
      const payload = parseJson(delivery.payloadJson);
      return {
        id: String(delivery.deliveryId), alertId: String(delivery.alertId), ruleId: String(payload.ruleId || ''), type: String(payload.level || 'warning'), channel: delivery.channel as DeliveryChannel, status: delivery.status as DeliveryStatus, target: delivery.channel === 'InApp' ? 'in-app' : JSON.stringify(parseJson(delivery.targetJson)), content: String(payload.message || ''), sentAt: delivery.createdAt instanceof Date ? delivery.createdAt.toISOString() : new Date().toISOString(), serviceId: String(payload.serviceId || ''), service: String(payload.service || ''), metric: String(payload.metric || ''), value: Number(payload.value || 0), threshold: Number(payload.threshold || 0), operator: String(payload.operator || ''), mobileTitle: String(payload.mobileTitle || ''), mobileBody: String(payload.mobileBody || ''), updatedAt: delivery.updatedAt instanceof Date ? delivery.updatedAt.getTime() : Date.now(),
      };
    });
  }

  async claimPendingDeliveries(workerId: string, limit: number): Promise<PendingAlertDelivery[]> {
    const now = new Date();
    await this.models.deliveries.update(
      { status: 'retrying', leaseToken: null, leaseExpiresAt: null, nextAttemptAt: now, lastError: 'Delivery lease expired before completion' },
      { where: { status: 'processing', leaseExpiresAt: { [Op.lte]: now } } },
    );
    const candidates = await this.models.deliveries.findAll({ where: { status: { [Op.in]: ['pending', 'retrying'] }, nextAttemptAt: { [Op.lte]: now } }, order: [['nextAttemptAt', 'ASC']], limit });
    const claimed: PendingAlertDelivery[] = [];
    for (const row of candidates) {
      const value = row.get();
      const token = `${workerId}:${crypto.randomUUID()}`;
      const [updated] = await this.models.deliveries.update({ status: 'processing', leaseToken: token, leaseExpiresAt: new Date(Date.now() + DELIVERY_LEASE_MS), lastError: null }, { where: { deliveryId: value.deliveryId, status: { [Op.in]: ['pending', 'retrying'] }, nextAttemptAt: { [Op.lte]: now } } });
      if (updated !== 1) continue;
      claimed.push({ deliveryId: String(value.deliveryId), tenantId: String(value.tenantId), eventId: String(value.eventId), alertId: String(value.alertId), channel: value.channel as DeliveryChannel, target: parseJson(value.targetJson), payload: parseJson(value.payloadJson), attempts: Number(value.attempts), leaseToken: token });
    }
    return claimed;
  }

  async completeDelivery(delivery: PendingAlertDelivery): Promise<void> {
    await this.models.deliveries.update({ status: 'delivered', deliveredAt: new Date(), leaseToken: null, leaseExpiresAt: null, lastError: null }, { where: { deliveryId: delivery.deliveryId, status: 'processing', leaseToken: delivery.leaseToken } });
  }

  async requeueDelivery(deliveryId: string): Promise<boolean> {
    const [updated] = await this.models.deliveries.update(
      { status: 'pending', attempts: 0, nextAttemptAt: new Date(), leaseToken: null, leaseExpiresAt: null, lastError: null },
      { where: { deliveryId, status: { [Op.in]: ['delivered', 'retrying', 'failed'] } } },
    );
    return updated === 1;
  }

  async failDelivery(delivery: PendingAlertDelivery, error: unknown): Promise<void> {
    const attempts = delivery.attempts + 1;
    const failed = attempts >= MAX_DELIVERY_ATTEMPTS;
    await this.models.deliveries.update({ status: failed ? 'failed' : 'retrying', attempts, nextAttemptAt: new Date(Date.now() + retryDelayMs(attempts)), leaseToken: null, leaseExpiresAt: null, lastError: error instanceof Error ? error.message.slice(0, 4096) : String(error).slice(0, 4096) }, { where: { deliveryId: delivery.deliveryId, status: 'processing', leaseToken: delivery.leaseToken } });
  }
}

let repositoryPromise: Promise<AlertOutboxRepository> | null = null;
export const getAlertOutboxRepository = (): Promise<AlertOutboxRepository> => {
  if (!repositoryPromise) repositoryPromise = (async () => {
    const connection = await mainConnection.getConnection();
    const instances = await mainConnection.getModel<AlertInstanceTable>(DataBaseTableNames.AlertInstance);
    const events = await mainConnection.getModel<AlertEventTable>(DataBaseTableNames.AlertEvent);
    const deliveries = await mainConnection.getModel<AlertNotificationDeliveryTable>(DataBaseTableNames.AlertNotificationDelivery);
    return new AlertOutboxRepository(connection, createSequelizeAlertModels({ instances, events, deliveries }));
  })();
  return repositoryPromise;
};

export const resetAlertOutboxRepositoryForTests = () => { repositoryPromise = null; };
