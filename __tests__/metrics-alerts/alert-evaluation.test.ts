jest.mock(
  'typings',
  () => ({
    HttpResponseCode: { Success: 0, ServiceActionFaild: 500 },
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
    const results = await evaluateAlertRules({ redis }, star);

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
    const notificationKeys = await redis.keys('metrics:alerts:notification:*');
    expect(notificationKeys).toHaveLength(4);
    const notifications = await Promise.all(
      notificationKeys.map(async (key) => parseStoredValue(await redis.get(key))),
    );
    expect(notifications.map((item) => item.type).sort()).toEqual([
      'critical',
      'critical',
      'critical',
      'warning',
    ]);
    expect(notifications.map((item) => item.channel).sort()).toEqual([
      'Email',
      'InApp',
      'InApp',
      'Webhook',
    ]);
    expect(notifications.find((item) => item.channel === 'Webhook')?.target).toBe(
      'https://hooks.starlight.local/alerts',
    );
    expect(notifications.every((item) => item.mobileTitle && item.mobileBody)).toBe(true);
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
});
