import crypto from 'crypto';
import { AlertOutboxTransaction, DeliveryChannel } from './alert-outbox';

export const MANAGED_SYSTEM_SERVICES = [
  'gateway',
  'auth',
  'user',
  'file',
  'metrics',
  'metrics-query',
  'metrics-alerts',
  'metrics-compat',
  'metrics-lifecycle',
  'logs',
  'subscription',
  'subscription-billing',
  'micro-app',
  'trails-durable-content',
  'trails-durable-media',
  'trails-durable-workspace',
  'trails-durable-trips',
  'trails-durable-site',
  'trails-durable-site-public',
  'trails-durable-sales',
  'trails-durable-field-plans',
  'trails-durable-shooting',
  'video',
] as const;
export type ManagedSystemService = typeof MANAGED_SYSTEM_SERVICES[number];
export type RegistryMissingRule = { ruleId: string; serviceName: ManagedSystemService; forSeconds: number; deployGraceSeconds: number; severity: 'critical' | 'warning' | 'info'; enabled: boolean; channels: DeliveryChannel[]; emailRecipients: string[]; notifyOnRecovery: boolean };
type Incident = { ruleId: string; generation: number; status: 'absent' | 'active' | 'resolved'; absentSince?: Date | null; openedAt?: Date | null; resolvedAt?: Date | null };
type Row = { get(): Record<string, unknown>; update(values: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown> };
type TransactionRunner = { transaction<T>(operation: (transaction: AlertOutboxTransaction) => Promise<T>): Promise<T> };
type ModelPort = { findAll(options?: Record<string, unknown>): Promise<Row[]>; findOne(options: Record<string, unknown>): Promise<Row | null>; create(values: Record<string, unknown>, options?: Record<string, unknown>): Promise<Row>; destroy(options: Record<string, unknown>): Promise<number> };
type RegistryStar = {
  registry?: { services?: { list?: () => unknown | Promise<unknown> } } | null;
  call?: (name: string, params?: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>;
  logger?: { warn(message: string, error?: unknown): void } | null;
};
type NotificationOutbox = { createNotificationEventInTransaction(transaction: AlertOutboxTransaction, input: { tenantId?: string; alertId: string; eventKey: string; payload: Record<string, unknown>; channels: Array<{ channel: DeliveryChannel; target: unknown }> }): Promise<boolean> };
type IncidentTransition = { rule: RegistryMissingRule; registered: boolean; now: Date };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const jsonArray = (value: unknown): string[] => {
  if (typeof value !== 'string') return [];
  try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
};
export const normalizeEmailRecipients = (value: unknown): string[] => Array.from(new Set((Array.isArray(value) ? value : []).map(item => String(item).trim().toLowerCase()).filter(item => EMAIL.test(item)))).sort();
export const isManagedSystemService = (value: unknown): value is ManagedSystemService => MANAGED_SYSTEM_SERVICES.includes(String(value).trim() as ManagedSystemService);
export const normalizeRegistryMissingRule = (value: Record<string, unknown>): RegistryMissingRule => {
  if (!isManagedSystemService(value.serviceName)) throw new Error('serviceName must be a managed Darwin system service');
  const forSeconds = Number(value.forSeconds);
  const deployGraceSeconds = Number(value.deployGraceSeconds);
  if (!Number.isInteger(forSeconds) || forSeconds < 60 || forSeconds > 86400) throw new Error('forSeconds must be an integer between 60 and 86400');
  if (!Number.isInteger(deployGraceSeconds) || deployGraceSeconds < 0 || deployGraceSeconds > 86400) throw new Error('deployGraceSeconds must be an integer between 0 and 86400');
  const channels = Array.from(new Set((Array.isArray(value.channels) ? value.channels : []).map(String).filter((channel): channel is DeliveryChannel => channel === 'InApp' || channel === 'Email')));
  const emailRecipients = normalizeEmailRecipients(value.emailRecipients);
  if (channels.includes('Email') && emailRecipients.length === 0) throw new Error('Email rules require at least one valid email recipient');
  return { ruleId: String(value.ruleId || `registry-missing-${crypto.randomUUID()}`), serviceName: value.serviceName, forSeconds, deployGraceSeconds, severity: value.severity === 'critical' || value.severity === 'info' ? value.severity : 'warning', enabled: value.enabled !== false, channels, emailRecipients, notifyOnRecovery: value.notifyOnRecovery !== false };
};

export class RegistryMissingAlertRepository {
  constructor(private readonly sequelize: TransactionRunner, private readonly rules: ModelPort, private readonly incidents: ModelPort) {}
  async listRules(): Promise<RegistryMissingRule[]> { const rows = await this.rules.findAll({ order: [['serviceName', 'ASC']] }); return rows.map(row => { const value = row.get(); return normalizeRegistryMissingRule({ ruleId: value.ruleId, serviceName: value.serviceName, forSeconds: value.forSeconds, deployGraceSeconds: value.deployGraceSeconds, severity: value.severity, enabled: value.enabled, channels: jsonArray(value.channelsJson), emailRecipients: jsonArray(value.emailRecipientsJson), notifyOnRecovery: value.notifyOnRecovery }); }); }
  async getRule(ruleId: string): Promise<RegistryMissingRule | null> { const row = await this.rules.findOne({ where: { ruleId } }); if (!row) return null; const value = row.get(); return normalizeRegistryMissingRule({ ruleId: value.ruleId, serviceName: value.serviceName, forSeconds: value.forSeconds, deployGraceSeconds: value.deployGraceSeconds, severity: value.severity, enabled: value.enabled, channels: jsonArray(value.channelsJson), emailRecipients: jsonArray(value.emailRecipientsJson), notifyOnRecovery: value.notifyOnRecovery }); }
  async saveRule(rule: RegistryMissingRule): Promise<void> { await this.sequelize.transaction(async transaction => { const row = await this.rules.findOne({ where: { ruleId: rule.ruleId }, transaction, lock: transaction.LOCK.UPDATE }); const values = { serviceName: rule.serviceName, forSeconds: rule.forSeconds, deployGraceSeconds: rule.deployGraceSeconds, severity: rule.severity, enabled: rule.enabled, channelsJson: JSON.stringify(rule.channels), emailRecipientsJson: JSON.stringify(rule.emailRecipients), notifyOnRecovery: rule.notifyOnRecovery }; if (row) await row.update(values, { transaction }); else await this.rules.create({ ruleId: rule.ruleId, ...values }, { transaction }); }); }
  async deleteRule(ruleId: string): Promise<boolean> { return this.sequelize.transaction(async transaction => (await this.rules.destroy({ where: { ruleId }, transaction })) === 1); }
  async loadIncident(ruleId: string): Promise<Incident | null> { const row = await this.incidents.findOne({ where: { ruleId } }); return row ? row.get() as Incident : null; }
  async transitionIncidentAndQueueNotification(input: IncidentTransition, outbox: NotificationOutbox): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.sequelize.transaction(async transaction => {
          const row = await this.incidents.findOne({ where: { ruleId: input.rule.ruleId }, transaction, lock: transaction.LOCK.UPDATE });
          const incident = row ? row.get() as Incident : null;
          const next = nextIncidentTransition(incident, input);
          if (!next) return;
          if (row) await row.update(next.incident, { transaction });
          else await this.incidents.create(next.incident, { transaction });
          if (next.notification) await outbox.createNotificationEventInTransaction(transaction, next.notification);
        });
        return;
      } catch (error) {
        if (attempt === 0 && isUniqueConflict(error)) continue;
        throw error;
      }
    }
  }
}

let repositoryPromise: Promise<RegistryMissingAlertRepository> | null = null;
export const getRegistryMissingAlertRepository = (): Promise<RegistryMissingAlertRepository> => {
  if (!repositoryPromise) repositoryPromise = (async () => {
    const [{ default: mainConnection }, { DataBaseTableNames }] = await Promise.all([
      import('../../../db/mysql/connections/main'),
      import('../../../typings'),
    ]);
    return new RegistryMissingAlertRepository(
      await mainConnection.getConnection(),
      await mainConnection.getModel(DataBaseTableNames.RegistryMissingAlertRule),
      await mainConnection.getModel(DataBaseTableNames.RegistryMissingAlertIncident),
    );
  })();
  return repositoryPromise;
};

const serviceNamesFromGatewaySnapshot = async (star: RegistryStar): Promise<Set<string> | null> => {
  if (typeof star.call !== 'function') return null;
  try {
    const response = await star.call(
      'gateway.registry.snapshot',
      {},
      { meta: { internal: true, system: 'metrics-alerts-registry-evaluator' } },
    ) as any;
    const candidates = [
      response?.data?.content?.services,
      response?.content?.services,
      response?.data?.data?.content?.services,
    ];
    const services = candidates.find(Array.isArray);
    if (!services) throw new Error('Gateway registry snapshot returned an invalid service list');
    return new Set(services.map(String).filter(Boolean));
  } catch (error) {
    star.logger?.warn('[RegistryMissing] gateway registry snapshot unavailable; local registry fallback used', error);
    return null;
  }
};

const registryServiceNames = async (star: RegistryStar): Promise<Set<string> | null> => {
  // Gateway is the routing authority seen by users. Its snapshot avoids false
  // positives when the alerts process briefly holds a stale Kafka registry view.
  const gatewayServices = await serviceNamesFromGatewaySnapshot(star);
  if (gatewayServices) return gatewayServices;
  try {
    const list = await star.registry?.services?.list?.();
    if (!Array.isArray(list)) return null;
    return new Set(list.map(item => typeof item === 'string' ? item : String((item as { name?: unknown }).name || '')).filter(Boolean));
  } catch (error) { star.logger?.warn('[RegistryMissing] registry read failed; evaluation skipped', error); return null; }
};
export const evaluateRegistryMissingRules = async (repository: RegistryMissingAlertRepository, outbox: NotificationOutbox, star: RegistryStar, now = new Date()): Promise<void> => {
  const registered = await registryServiceNames(star);
  if (!registered) return;
  for (const rule of await repository.listRules()) {
    if (!rule.enabled) continue;
    await repository.transitionIncidentAndQueueNotification({ rule, registered: registered.has(rule.serviceName), now }, outbox);
  }
};
const nextIncidentTransition = (incident: Incident | null, input: IncidentTransition): { incident: Incident; notification?: { tenantId: string; alertId: string; eventKey: string; payload: Record<string, unknown>; channels: Array<{ channel: DeliveryChannel; target: unknown }> } } | null => {
  const { rule, registered, now } = input;
  if (registered) {
    if (incident?.status === 'active') {
      const payload = { ruleId: rule.ruleId, service: rule.serviceName, serviceId: `system:${rule.serviceName}`, level: rule.severity, status: 'resolved', message: `服务“${rule.serviceName}”已重新注册，服务连接已恢复。`, time: now.toISOString() };
      return { incident: { ...incident, status: 'resolved', resolvedAt: now }, notification: rule.notifyOnRecovery ? { tenantId: 'system', alertId: `registry-missing-${rule.ruleId}-${incident.generation}`, eventKey: `recovered:${incident.generation}`, payload, channels: registryChannels(rule) } : undefined };
    }
    return incident?.status === 'absent' ? { incident: { ...incident, status: 'resolved', resolvedAt: now } } : null;
  }
  const absentSince = incident?.status === 'resolved' || !incident?.absentSince ? now : new Date(incident.absentSince);
  const generation = incident?.status === 'resolved' ? incident.generation + 1 : incident?.generation || 1;
  if (now.getTime() < absentSince.getTime() + (rule.forSeconds + rule.deployGraceSeconds) * 1000) return { incident: { ruleId: rule.ruleId, generation, status: 'absent', absentSince, openedAt: null, resolvedAt: null } };
  if (incident?.status === 'active') return null;
  const payload = { ruleId: rule.ruleId, service: rule.serviceName, serviceId: `system:${rule.serviceName}`, level: rule.severity, status: 'active', message: `服务“${rule.serviceName}”未注册或连接已断开，请检查服务进程和 Kafka 服务发现。`, time: now.toISOString() };
  return { incident: { ruleId: rule.ruleId, generation, status: 'active', absentSince, openedAt: now, resolvedAt: null }, notification: { tenantId: 'system', alertId: `registry-missing-${rule.ruleId}-${generation}`, eventKey: `opened:${generation}`, payload, channels: registryChannels(rule) } };
};
const isUniqueConflict = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: unknown; original?: { code?: unknown }; parent?: { code?: unknown } };
  return candidate.name === 'SequelizeUniqueConstraintError' || candidate.original?.code === 'ER_DUP_ENTRY' || candidate.parent?.code === 'ER_DUP_ENTRY';
};
const registryChannels = (rule: RegistryMissingRule): Array<{ channel: DeliveryChannel; target: unknown }> => {
  const targets: Array<{ channel: DeliveryChannel; target: unknown }> = [];
  for (const channel of rule.channels) {
    if (channel === 'Email') rule.emailRecipients.forEach(target => targets.push({ channel, target }));
    if (channel === 'InApp') targets.push({ channel, target: 'in-app' });
  }
  return targets;
};
