import { describe, expect, it, vi } from 'vitest';

vi.mock('typings', () => ({
  HttpResponseCode: { Success: 0, ServiceActionFaild: 500 },
}));

vi.mock('db/mysql/apis/user', () => ({
  queryAllUsers: vi.fn(async () => []),
}));

import { buildNotifications, evaluateAlertRules } from '../../src/apps/starlight/metrics/actions/alerts';
import { InfluxDBHandler } from '../../src/apps/starlight/metrics/utils/influxdb-handler';

const createRedisMock = () => {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      return store.get(key) || null;
    },
    async set(key: string, value: string) {
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
        channels: ['InApp', 'Email'],
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

    vi.spyOn(InfluxDBHandler, 'getBucketName').mockReturnValue('metrics');
    vi.spyOn(InfluxDBHandler, 'queryMetrics').mockResolvedValue([{ _value: 0.95 }]);

    const star = { logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } } as any;
    const results = await evaluateAlertRules({ redis }, star);

    expect(results).toHaveLength(2);
    expect(results.map((item) => item.status)).toEqual(['active', 'active']);
    expect(results.map((item) => item.level)).toEqual(['warning', 'critical']);
    expect(JSON.parse((await redis.get('metrics:alerts:state:alert-rule-critical-rule')) || '{}')).toMatchObject({
      status: 'active',
      level: 'critical',
      value: 95,
      threshold: 90,
    });
    const notificationKeys = await redis.keys('metrics:alerts:notification:*');
    expect(notificationKeys).toHaveLength(3);
    const notifications = await Promise.all(notificationKeys.map(async (key) => JSON.parse((await redis.get(key)) || '{}')));
    expect(notifications.map((item) => item.type).sort()).toEqual(['critical', 'critical', 'warning']);
    expect(notifications.every((item) => item.mobileTitle && item.mobileBody)).toBe(true);
  });

  it('returns an empty notification list for blank status without building fallback alerts', async () => {
    const redis = createRedisMock();
    const serviceContext = {
      redis,
      getServicesList: vi.fn(async () => {
        throw new Error('service catalog should not be queried for notifications');
      }),
    };

    await expect(buildNotifications(serviceContext, { status: '' })).resolves.toEqual([]);
    expect(serviceContext.getServicesList).not.toHaveBeenCalled();
  });
});
