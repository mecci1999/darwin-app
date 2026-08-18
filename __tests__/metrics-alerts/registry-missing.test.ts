jest.mock('db/mysql/connections/main', () => ({ default: {} }), { virtual: true });
jest.mock('typings', () => ({ HttpResponseCode: { Success: 0, ServiceActionFaild: 500, NoPermissionError: 30003, ParamsError: 10001, BAD_REQUEST: 40000 } }), { virtual: true });
jest.mock('db/mysql/apis/user', () => ({ queryAllUsers: jest.fn(async () => []) }), { virtual: true });

import { evaluateRegistryMissingRules, normalizeRegistryMissingRule, RegistryMissingAlertRepository } from '../../src/apps/starlight/metrics-alerts/registry-missing';
import { isSystemAdministrator } from '../../src/apps/starlight/metrics/actions/alerts';

type Stored = Record<string, unknown>;
const row = (value: Stored) => ({ get: () => value, async update(values: Stored) { Object.assign(value, values); } });
const model = (rows: Stored[]) => ({
  async findAll() { return rows.map(row); },
  async findOne(options: { where: Stored }) { const candidate = rows.find(value => Object.entries(options.where).every(([key, expected]) => value[key] === expected)); return candidate ? row(candidate) : null; },
  async create(value: Stored) { rows.push(value); return row(value); },
  async destroy(options: { where: Stored }) { const index = rows.findIndex(value => Object.entries(options.where).every(([key, expected]) => value[key] === expected)); if (index < 0) return 0; rows.splice(index, 1); return 1; },
});
const repository = (rules: Stored[], incidents: Stored[]) => {
  let transactionTail: Promise<void> = Promise.resolve();
  return new RegistryMissingAlertRepository({
    transaction: async <T>(operation: (transaction: { LOCK: { UPDATE: string } }) => Promise<T>) => {
      const previous = transactionTail;
      let release: () => void = () => undefined;
      transactionTail = new Promise<void>(resolve => { release = resolve; });
      await previous;
      const ruleSnapshot = rules.map(value => ({ ...value }));
      const incidentSnapshot = incidents.map(value => ({ ...value }));
      try {
        return await operation({ LOCK: { UPDATE: 'UPDATE' } });
      } catch (error) {
        rules.splice(0, rules.length, ...ruleSnapshot);
        incidents.splice(0, incidents.length, ...incidentSnapshot);
        throw error;
      } finally { release(); }
    },
  }, model(rules), model(incidents));
};
const rule = normalizeRegistryMissingRule({ ruleId: 'auth-missing', serviceName: 'auth', forSeconds: 60, deployGraceSeconds: 120, severity: 'critical', channels: ['Email'], emailRecipients: ['OPS@example.test', 'ops@example.test'], notifyOnRecovery: true });
const star = (services: unknown) => ({ registry: { services: { list: jest.fn(async () => services) } }, logger: { warn: jest.fn() } });

describe('registry missing alerts', () => {
  it('uses Chinese text for missing-service and recovery notifications', async () => {
    const store = repository([rule], []);
    const outbox = { createNotificationEventInTransaction: jest.fn(async () => true) };
    const base = new Date('2026-08-12T00:00:00.000Z');

    await evaluateRegistryMissingRules(store, outbox, star([]), base);
    await evaluateRegistryMissingRules(store, outbox, star([]), new Date(base.getTime() + 180_000));
    expect(outbox.createNotificationEventInTransaction).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      payload: expect.objectContaining({ message: '服务“auth”未注册或连接已断开，请检查服务进程和 Kafka 服务发现。' }),
    }));

    await evaluateRegistryMissingRules(store, outbox, star([{ name: 'auth' }]), new Date(base.getTime() + 240_000));
    expect(outbox.createNotificationEventInTransaction).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      payload: expect.objectContaining({ message: '服务“auth”已重新注册，服务连接已恢复。' }),
    }));
  });

  it('accepts every service in the 20-service gateway readiness baseline', () => {
    const services = [
      'gateway', 'auth', 'user', 'file', 'metrics', 'metrics-query', 'metrics-alerts', 'metrics-compat',
      'metrics-lifecycle', 'logs', 'subscription', 'subscription-billing', 'micro-app', 'video',
      'trails-durable-content', 'trails-durable-media', 'trails-durable-workspace', 'trails-durable-trips',
      'trails-durable-site', 'trails-durable-site-public',
    ];

    for (const serviceName of services) {
      expect(() => normalizeRegistryMissingRule({ ...rule, serviceName })).not.toThrow();
    }
  });

  it('waits for continuous absence and deploy grace before a single opened event, then a single recovery event', async () => {
    const rules: Stored[] = []; const incidents: Stored[] = [];
    const store = repository(rules, incidents); await store.saveRule(rule);
    const outbox = { createNotificationEventInTransaction: jest.fn(async () => true) };
    const base = new Date('2026-08-12T00:00:00.000Z');
    await evaluateRegistryMissingRules(store, outbox, star([]), base);
    await evaluateRegistryMissingRules(store, outbox, star([]), new Date(base.getTime() + 179000));
    expect(outbox.createNotificationEventInTransaction).not.toHaveBeenCalled();
    await evaluateRegistryMissingRules(store, outbox, star([]), new Date(base.getTime() + 180000));
    await evaluateRegistryMissingRules(store, outbox, star([]), new Date(base.getTime() + 240000));
    expect(outbox.createNotificationEventInTransaction).toHaveBeenCalledTimes(1);
    expect(outbox.createNotificationEventInTransaction).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ eventKey: 'opened:1', channels: [{ channel: 'Email', target: 'ops@example.test' }] }));
    await evaluateRegistryMissingRules(store, outbox, star([{ name: 'auth' }]), new Date(base.getTime() + 300000));
    await evaluateRegistryMissingRules(store, outbox, star([{ name: 'auth' }]), new Date(base.getTime() + 360000));
    expect(outbox.createNotificationEventInTransaction).toHaveBeenCalledTimes(2);
    expect(outbox.createNotificationEventInTransaction).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ eventKey: 'recovered:1' }));
  });

  it('never treats a registry read failure as an absent service', async () => {
    const rules: Stored[] = []; const incidents: Stored[] = [];
    const store = repository(rules, incidents); await store.saveRule({ ...rule, deployGraceSeconds: 0 });
    const outbox = { createNotificationEventInTransaction: jest.fn(async () => true) };
    const failedStar = { registry: { services: { list: jest.fn(async () => { throw new Error('registry unavailable'); }) } }, logger: { warn: jest.fn() } };
    await evaluateRegistryMissingRules(store, outbox, failedStar, new Date());
    expect(outbox.createNotificationEventInTransaction).not.toHaveBeenCalled();
    expect(await store.loadIncident(rule.ruleId)).toBeNull();
  });

  it('uses the Gateway registry snapshot when the local view is stale', async () => {
    const rules: Stored[] = []; const incidents: Stored[] = [];
    const store = repository(rules, incidents); await store.saveRule({ ...rule, deployGraceSeconds: 0 });
    const outbox = { createNotificationEventInTransaction: jest.fn(async () => true) };
    const staleLocalStar = {
      call: jest.fn(async () => ({ data: { content: { services: ['auth'] } } })),
      registry: { services: { list: jest.fn(async () => []) } },
      logger: { warn: jest.fn() },
    };
    await evaluateRegistryMissingRules(store, outbox, staleLocalStar, new Date('2026-08-12T00:00:00.000Z'));
    await evaluateRegistryMissingRules(store, outbox, staleLocalStar, new Date('2026-08-12T00:01:00.000Z'));
    expect(outbox.createNotificationEventInTransaction).not.toHaveBeenCalled();
    expect(staleLocalStar.registry.services.list).not.toHaveBeenCalled();
  });

  it('recognizes only system administrators for registry rule management', () => {
    expect(isSystemAdministrator({ user: { isAdmin: true } })).toBe(true);
    expect(isSystemAdministrator({ user: { power: 999 } })).toBe(true);
    expect(isSystemAdministrator({ user: { isAdmin: false, power: 1 } })).toBe(false);
    expect(isSystemAdministrator(undefined)).toBe(false);
  });

  it('rolls back the incident when durable event creation fails', async () => {
    const rules: Stored[] = []; const incidents: Stored[] = [];
    const store = repository(rules, incidents); await store.saveRule({ ...rule, deployGraceSeconds: 0, forSeconds: 60 });
    const outbox = { createNotificationEventInTransaction: jest.fn(async () => { throw new Error('outbox unavailable'); }) };
    await expect(evaluateRegistryMissingRules(store, outbox, star([]), new Date('2026-08-12T00:00:00.000Z'))).resolves.toBeUndefined();
    await expect(evaluateRegistryMissingRules(store, outbox, star([]), new Date('2026-08-12T00:01:00.000Z'))).rejects.toThrow('outbox unavailable');
    expect(await store.loadIncident(rule.ruleId)).toMatchObject({ status: 'absent' });
  });

  it('serializes concurrent evaluations into one opened incident event', async () => {
    const rules: Stored[] = []; const incidents: Stored[] = [];
    const store = repository(rules, incidents); await store.saveRule({ ...rule, deployGraceSeconds: 0, forSeconds: 60 });
    const outbox = { createNotificationEventInTransaction: jest.fn(async () => true) };
    const first = new Date('2026-08-12T00:00:00.000Z');
    await evaluateRegistryMissingRules(store, outbox, star([]), first);
    await Promise.all([
      evaluateRegistryMissingRules(store, outbox, star([]), new Date('2026-08-12T00:01:00.000Z')),
      evaluateRegistryMissingRules(store, outbox, star([]), new Date('2026-08-12T00:01:00.000Z')),
    ]);
    expect(await store.loadIncident(rule.ruleId)).toMatchObject({ status: 'active', generation: 1 });
    expect(outbox.createNotificationEventInTransaction).toHaveBeenCalledTimes(1);
    expect(outbox.createNotificationEventInTransaction).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ eventKey: 'opened:1' }));
  });

});
