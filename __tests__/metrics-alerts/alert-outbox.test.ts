jest.mock('db/mysql/connections/main', () => ({ default: {} }), { virtual: true });

import { Sequelize } from 'sequelize';
import { AlertOutboxRepository, normalizeDeliveryTarget } from '../../src/apps/starlight/metrics-alerts/alert-outbox';

type Row = Record<string, unknown>;
const row = (value: Row) => ({
  get: () => value,
  async update(values: Row) { Object.assign(value, values); },
});

const matches = (value: Row, where: Record<string, unknown>) =>
  Object.entries(where).every(([key, expected]) => value[key] === expected);

const createModel = (rows: Row[]) => ({
  async findAll(options: Record<string, unknown>) {
    const where = options.where as Record<string, unknown> | undefined;
    return rows.filter(value => !where || matches(value, where)).map(row);
  },
  async findOne(options: Record<string, unknown>) {
    const value = rows.find(candidate => matches(candidate, options.where as Record<string, unknown>));
    return value ? row(value) : null;
  },
  async create(value: Row) { rows.push(value); return row(value); },
  async update(values: Row, options: Record<string, unknown>) {
    const target = rows.find(candidate => matches(candidate, options.where as Record<string, unknown>));
    if (!target) return [0] as [number, ...unknown[]];
    Object.assign(target, values);
    return [1] as [number, ...unknown[]];
  },
});

describe('alert outbox repository', () => {
  it('creates one event and one InApp delivery for an idempotency key', async () => {
    const instanceRows: Row[] = [];
    const eventRows: Row[] = [];
    const deliveryRows: Row[] = [];
    const sequelize = { transaction: async <T>(callback: (transaction: { LOCK: { UPDATE: string } }) => Promise<T>) => callback({ LOCK: { UPDATE: 'UPDATE' } }) } as unknown as Sequelize;
    const repository = new AlertOutboxRepository(sequelize, {
      instances: createModel(instanceRows),
      events: createModel(eventRows),
      deliveries: createModel(deliveryRows),
    });
    const input = { tenantId: 'tenant-a', alertId: 'alert-a', eventKey: 'rule-a:1', payload: { message: 'CPU high' }, channels: [{ channel: 'InApp' as const, target: 'in-app' }] };

    await expect(repository.createNotificationEvent(input)).resolves.toBe(true);
    await expect(repository.createNotificationEvent(input)).resolves.toBe(false);

    expect(eventRows).toHaveLength(1);
    expect(deliveryRows).toHaveLength(1);
    expect(deliveryRows[0]).toMatchObject({ channel: 'InApp', status: 'pending', tenantId: 'tenant-a' });
  });

  it('keeps only valid external targets and defines InApp tenant targeting', () => {
    expect(normalizeDeliveryTarget('InApp', 'in-app')).toEqual({ audience: 'tenant', userId: null });
    expect(normalizeDeliveryTarget('Email', '')).toBeNull();
    expect(normalizeDeliveryTarget('Webhook', 'not-a-url')).toBeNull();
    expect(normalizeDeliveryTarget('Email', 'ops@example.test')).toEqual({ address: 'ops@example.test' });
  });
});
