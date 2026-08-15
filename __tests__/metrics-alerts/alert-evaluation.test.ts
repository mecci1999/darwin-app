jest.mock(
  'typings',
  () => ({
    HttpResponseCode: { Success: 0, ParamsError: 400, ServiceActionFaild: 500 },
  }),
  { virtual: true },
);

jest.mock(
  'db/mysql/apis/user',
  () => ({
    queryAllUsers: jest.fn(async () => []),
  }),
  { virtual: true },
);

import {
  buildNotifications,
  evaluateAlertRules,
} from '../../src/apps/starlight/metrics/actions/alerts';
import createAlertActions from '../../src/apps/starlight/metrics/actions/alerts';
import { InfluxDBHandler } from '../../src/apps/starlight/metrics/utils/influxdb-handler';

const parseStoredValue = (value: unknown) => {
  if (!value) return null;
  return typeof value === 'string' ? JSON.parse(value) : value;
};

const createRedisMock = () => {
  const store = new Map<string, unknown>();
  return {
    store,
    async get(key: string) {
      return store.get(key) || null;
    },
    async set(key: string, value: unknown) {
      store.set(key, value);
      return 'OK';
    },
    async del(key: string) {
      store.delete(key);
      return 1;
    },
    async keys(pattern: string) {
      const prefix = pattern.replace('*', '');
      return Array.from(store.keys()).filter((key) => key.startsWith(prefix));
    },
    async scan(cursor: string, _match: string, pattern: string) {
      const prefix = pattern.replace('*', '');
      return [cursor === '0' ? '0' : cursor, Array.from(store.keys()).filter((key) => key.startsWith(prefix))];
    },
  };
};

const createDurableRedisContext = () => {
  const client = createRedisMock();
  return {
    redis: {
      client,
      prefix: 'metrics-alerts:',
      async get(key: string) {
        return client.get(`metrics-alerts:-${key}`);
      },
      async set(key: string, value: unknown) {
        return client.set(`metrics-alerts:-${key}`, value);
      },
    },
    client,
  };
};

describe('metrics alert evaluation', () => {
  it('promotes sustained warning and critical rules to active alerts and notifications', async () => {
    const redis = createRedisMock();
    const now = Date.now();
    await redis.set(
      'metrics:alerts:rule:warning-rule',
      JSON.stringify({
        id: 'warning-rule',
        name: 'CPU 警告',
        service: 'gateway',
        metric: 'service.cpu.usage',
        operator: '>',
        threshold: 80,
        unit: '%',
        duration: 5,
        level: 'warning',
        enabled: true,
        channels: ['InApp'],
      }),
    );
    await redis.set(
      'metrics:alerts:rule:critical-rule',
      JSON.stringify({
        id: 'critical-rule',
        name: 'CPU 严重',
        service: 'gateway',
        metric: 'service.cpu.usage',
        operator: '>',
        threshold: 90,
        unit: '%',
        duration: 3,
        level: 'critical',
        enabled: true,
        channels: ['in-app', 'email', 'webhook'],
      }),
    );
    await redis.set(
      'metrics:alerts:state:alert-rule-warning-rule',
      JSON.stringify({ conditionStartedAt: now - 6 * 60 * 1000 }),
    );
    await redis.set(
      'metrics:alerts:state:alert-rule-critical-rule',
      JSON.stringify({ conditionStartedAt: now - 4 * 60 * 1000 }),
    );

    jest.spyOn(InfluxDBHandler, 'getBucketName').mockReturnValue('metrics');
    jest.spyOn(InfluxDBHandler, 'queryMetrics').mockResolvedValue([{ _value: 0.95 }]);

    const star = {
      logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
    } as any;
    const outbox = {
      saveInstance: jest.fn(async () => undefined),
      saveInstanceAndCreateNotificationEvent: jest.fn(async () => true),
    };
    const results = await evaluateAlertRules({ redis, tenantId: 'tenant-a', alertOutboxRepository: outbox }, star);

    expect(results).toHaveLength(2);
    expect(results.map((item) => item.status)).toEqual(['active', 'active']);
    expect(results.map((item) => item.level)).toEqual(['warning', 'critical']);
    expect(
      parseStoredValue(await redis.get('metrics:alerts:state:alert-rule-critical-rule')),
    ).toMatchObject({
      status: 'active',
      level: 'critical',
      value: 95,
      threshold: 90,
    });
    expect(await redis.keys('metrics:alerts:notification:*')).toEqual([]);
    expect(outbox.saveInstanceAndCreateNotificationEvent).toHaveBeenCalledTimes(2);
    expect(outbox.saveInstanceAndCreateNotificationEvent).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      channels: [{ channel: 'InApp', target: 'in-app' }],
    }));
  });

  it('returns an empty notification list for blank status without building fallback alerts', async () => {
    const redis = createRedisMock();
    const serviceContext = {
      redis,
      getServicesList: jest.fn(async () => {
        throw new Error('service catalog should not be queried for notifications');
      }),
    };

    await expect(buildNotifications(serviceContext, { status: '' })).resolves.toEqual([]);
    expect(serviceContext.getServicesList).not.toHaveBeenCalled();
  });

  it('fans out normalized Email recipients with InApp delivery through the durable outbox', async () => {
    const redis = createRedisMock();
    const now = Date.now();
    await redis.set('metrics:alerts:rule:fanout-rule', JSON.stringify({
      id: 'fanout-rule', name: 'Fan out', service: 'gateway', metric: 'service.cpu.usage',
      operator: '>', threshold: 80, duration: 1, level: 'critical', enabled: true,
      channels: ['InApp', 'Email'], emailRecipients: [' OPS@example.test ', 'ops@example.test', 'other@example.test'],
      notifyOnRecovery: true,
    }));
    await redis.set('metrics:alerts:state:alert-rule-fanout-rule', JSON.stringify({ conditionStartedAt: now - 2 * 60 * 1000 }));
    jest.spyOn(InfluxDBHandler, 'getBucketName').mockReturnValue('metrics');
    jest.spyOn(InfluxDBHandler, 'queryMetrics').mockResolvedValue([{ _value: 0.95 }]);
    const outbox = { saveInstance: jest.fn(async () => undefined), saveInstanceAndCreateNotificationEvent: jest.fn(async () => true) };

    await evaluateAlertRules({ redis, tenantId: 'tenant-a', alertOutboxRepository: outbox }, { logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } } as any);

    expect(outbox.saveInstanceAndCreateNotificationEvent).toHaveBeenCalledWith(expect.objectContaining({
      channels: [
        { channel: 'InApp', target: 'in-app' },
        { channel: 'Email', target: 'ops@example.test' },
        { channel: 'Email', target: 'other@example.test' },
      ],
    }));
  });

  it('emits exactly one recovery event only for an active-to-resolved rule with recovery enabled', async () => {
    const redis = createRedisMock();
    const activeSince = Date.now() - 10 * 60 * 1000;
    await redis.set('metrics:alerts:rule:recovery-rule', JSON.stringify({
      id: 'recovery-rule', name: 'Recovery', service: 'gateway', metric: 'service.cpu.usage',
      operator: '>', threshold: 80, duration: 1, level: 'warning', enabled: true,
      channels: ['InApp', 'Email'], emailRecipients: ['Ops@example.test'], notifyOnRecovery: true,
    }));
    await redis.set('metrics:alerts:state:alert-rule-recovery-rule', JSON.stringify({
      status: 'active', firstTriggeredAt: activeSince, conditionStartedAt: activeSince, lastNotificationAt: activeSince,
    }));
    jest.spyOn(InfluxDBHandler, 'getBucketName').mockReturnValue('metrics');
    jest.spyOn(InfluxDBHandler, 'queryMetrics').mockResolvedValue([{ _value: 0.2 }]);
    const outbox = { saveInstance: jest.fn(async () => undefined), saveInstanceAndCreateNotificationEvent: jest.fn(async () => true) };
    const context = { redis, tenantId: 'tenant-a', alertOutboxRepository: outbox };
    const star = { logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } } as any;

    await evaluateAlertRules(context, star);
    await evaluateAlertRules(context, star);

    expect(outbox.saveInstanceAndCreateNotificationEvent).toHaveBeenCalledTimes(1);
    expect(outbox.saveInstanceAndCreateNotificationEvent).toHaveBeenCalledWith(expect.objectContaining({
      status: 'resolved', eventKey: `recovered:recovery-rule:${activeSince}`,
      channels: [{ channel: 'InApp', target: 'in-app' }, { channel: 'Email', target: 'ops@example.test' }],
    }));
  });

  it('rejects Email rules without recipients on create, import, and update', async () => {
    const redis = createRedisMock();
    const actions = createAlertActions({ logger: { error: jest.fn() } } as any) as any;
    const context = { redis, getServicesList: jest.fn(async () => ({ services: [] })) };
    const invalid = { name: 'No recipient', service: 'gateway', metric: 'service.cpu.usage', operator: '>', threshold: 80, duration: 1, level: 'warning', channels: ['Email'] };

    await expect(actions['v1.alert-rules/create'].handler.call(context, { params: invalid })).resolves.toMatchObject({ status: 400 });
    await expect(actions['v1.alert-rules/import'].handler.call(context, { params: { rules: [invalid] } })).resolves.toMatchObject({ status: 400 });
    await redis.set('metrics:alerts:rule:existing', JSON.stringify({ ...invalid, id: 'existing', channels: ['InApp'] }));
    await expect(actions['v1.alert-rules/:id'].handler.call(context, { params: { id: 'existing', channels: ['Email'], emailRecipients: [] } })).resolves.toMatchObject({ status: 400 });
  });

  it('keeps existing alert rules when updating a single rule', async () => {
    const redis = createRedisMock();
    await redis.set(
      'metrics:alerts:rule:rule-a',
      JSON.stringify({
        id: 'rule-a',
        name: '规则 A',
        service: 'all',
        metric: 'service.cpu.usage',
        operator: '>',
        threshold: 80,
        level: 'warning',
        enabled: true,
        channels: ['Email'],
        emailRecipients: ['ops@example.test'],
      }),
    );
    await redis.set(
      'metrics:alerts:rule:rule-b',
      JSON.stringify({
        id: 'rule-b',
        name: '规则 B',
        service: 'all',
        metric: 'service.memory.usage.percent',
        operator: '>',
        threshold: 85,
        level: 'warning',
        enabled: true,
        channels: ['Webhook'],
        emailRecipients: ['ops@example.test'],
      }),
    );
    await redis.set(
      'metrics:alerts:rule:rule-c',
      JSON.stringify({
        id: 'rule-c',
        name: '规则 C',
        service: 'all',
        metric: 'service.response.time',
        operator: '>',
        threshold: 1000,
        level: 'critical',
        enabled: true,
        channels: ['InApp'],
      }),
    );

    const star = {
      logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
    } as any;
    const actions = createAlertActions(star) as any;
    const redisWithStaleCacheIndex = Object.assign(redis, {
      getCacheKeys: jest.fn(async () => [{ key: 'metrics:alerts:rule:rule-b' }]),
    });
    const serviceContext = {
      redis: redisWithStaleCacheIndex,
      getServicesList: jest.fn(async () => ({ services: [] })),
    };

    await actions['v1.alert-rules/:id'].handler.call(serviceContext, {
      params: {
        id: 'rule-b',
        name: '规则 B 已更新',
        service: 'all',
        metric: 'service.memory.usage.percent',
        operator: '>',
        threshold: 90,
        level: 'warning',
        enabled: true,
        channels: ['Email'],
        emailRecipients: ['ops@example.test'],
      },
    });

    const response = await actions['v1.alert-rules'].handler.call(serviceContext, { params: {} });
    const rules = response.data.content;

    expect(rules.map((rule: any) => rule.id).sort()).toEqual(['rule-a', 'rule-b', 'rule-c']);
    expect(rules.find((rule: any) => rule.id === 'rule-b')).toMatchObject({
      name: '规则 B 已更新',
      threshold: 90,
      channels: ['Email'],
    });
  });

  it('stores alert rules as durable Redis keys without relying on the cacher ttl', async () => {
    const { redis, client } = createDurableRedisContext();
    const star = {
      logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
    } as any;
    const actions = createAlertActions(star) as any;
    const serviceContext = {
      redis,
      getServicesList: jest.fn(async () => ({ services: [] })),
    };

    await actions['v1.alert-rules/create'].handler.call(serviceContext, {
      params: {
        name: '持久化 CPU 告警',
        service: 'gateway',
        metric: 'service.cpu.usage',
        operator: '>',
        threshold: 80,
        level: 'warning',
        enabled: true,
        channels: ['InApp'],
      },
    });

    const keys = await client.keys('metrics-alerts:-metrics:alerts:rule:*');
    expect(keys).toHaveLength(1);
    const response = await actions['v1.alert-rules'].handler.call(serviceContext, { params: {} });
    expect(response.data.content).toHaveLength(1);
    expect(response.data.content[0]).toMatchObject({ name: '持久化 CPU 告警', metric: 'service.cpu.usage' });
  });

});
