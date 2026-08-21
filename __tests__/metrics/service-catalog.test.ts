jest.mock('../../src/apps/starlight/metrics/utils/influxdb-handler', () => ({
  InfluxDBHandler: {
    getBucketName: jest.fn(() => 'metrics'),
    queryMetrics: jest.fn(),
  },
}));

import { buildServiceCatalogSnapshot } from '../../src/apps/starlight/metrics/utils/service-catalog';
import { InfluxDBHandler } from '../../src/apps/starlight/metrics/utils/influxdb-handler';

const queryMetricsMock = InfluxDBHandler.queryMetrics as jest.MockedFunction<typeof InfluxDBHandler.queryMetrics>;

describe('service catalog metrics snapshot', () => {
  beforeEach(() => {
    queryMetricsMock.mockReset();
    (InfluxDBHandler.getBucketName as jest.Mock).mockReturnValue('metrics');
  });

  it('maps per-service QPS, error rate, and P95 latency from normalized metric tags', async () => {
    queryMetricsMock
      .mockResolvedValueOnce([{ service_metric_key: 'system:gateway', _value: 600 }])
      .mockResolvedValueOnce([{ service_metric_key: 'gateway', _value: 247.8 }])
      .mockResolvedValueOnce([{ service_metric_key: 'gateway', _value: 600 }])
      .mockResolvedValueOnce([{ service_metric_key: 'system:gateway', _value: 12 }])
      .mockResolvedValueOnce([]);

    const snapshot = await buildServiceCatalogSnapshot(
      { page: 1, pageSize: 10, scope: 'system' },
      {
        registry: {
          getNodeList: () => [
            {
              id: 'node-1',
              hostname: 'node-1.local',
              available: true,
              services: [{ name: 'gateway' }],
            },
          ],
        },
      } as unknown as import('node-universe').Star,
    );

    expect(queryMetricsMock.mock.calls[0][0]).toContain('service_metric_key');
    expect(queryMetricsMock.mock.calls[1][0]).toContain('quantile(q: 0.95');
    expect(snapshot.services).toHaveLength(1);
    expect(snapshot.services[0]).toEqual(expect.objectContaining({
      id: 'system:gateway',
      qps: 2,
      latency: 248,
      errorRate: 0.02,
      health: 'degraded',
    }));
  });

  it('attributes gateway topology metrics to the target service instead of gateway', async () => {
    queryMetricsMock
      .mockResolvedValueOnce([{ service_metric_key: 'auth', _value: 129 }])
      .mockResolvedValueOnce([{ service_metric_key: 'auth', _value: 12 }])
      .mockResolvedValueOnce([{ service_metric_key: 'auth', _value: 129 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const snapshot = await buildServiceCatalogSnapshot(
      { page: 1, pageSize: 10, scope: 'system' },
      {
        registry: {
          getNodeList: () => [
            {
              id: 'node-1',
              hostname: 'node-1.local',
              available: true,
              services: [{ name: 'gateway' }, { name: 'auth' }],
            },
          ],
        },
      } as any,
    );

    expect(queryMetricsMock.mock.calls[0][0]).toContain('string(v: r.source) == "gateway-ingress"');
    expect(queryMetricsMock.mock.calls[0][0]).toContain('else if exists r.target_service');
    expect(snapshot.services.find((service) => service.name === 'auth')).toEqual(expect.objectContaining({
      id: 'system:auth',
      qps: 0.43,
      latency: 12,
      errorRate: 0,
    }));
    expect(snapshot.services.find((service) => service.name === 'gateway')).toEqual(expect.objectContaining({
      id: 'system:gateway',
      qps: null,
      latency: null,
      errorRate: null,
      metricStatus: expect.objectContaining({
        qps: 'unavailable',
        latency: 'unavailable',
        errorRate: 'unavailable',
      }),
    }));
  });

  it('keeps gateway ingress metrics attributed to the gateway service', async () => {
    queryMetricsMock
      .mockResolvedValueOnce([{ service_metric_key: 'gateway', _value: 90 }])
      .mockResolvedValueOnce([{ service_metric_key: 'gateway', _value: 180 }])
      .mockResolvedValueOnce([{ service_metric_key: 'gateway', _value: 90 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const snapshot = await buildServiceCatalogSnapshot(
      { page: 1, pageSize: 10, scope: 'system' },
      {
        registry: {
          getNodeList: () => [
            {
              id: 'node-1',
              hostname: 'node-1.local',
              available: true,
              services: [{ name: 'gateway' }],
            },
          ],
        },
      } as any,
    );

    expect(snapshot.services[0]).toEqual(expect.objectContaining({
      id: 'system:gateway',
      qps: 0.3,
      latency: 180,
      errorRate: 0,
      metricStatus: expect.objectContaining({
        qps: 'observed',
        latency: 'observed',
        errorRate: 'observed',
      }),
    }));
  });

  it('keeps RED metrics null but returns runtime samples when a service has no request traffic', async () => {
    queryMetricsMock.mockImplementation(async (fluxQuery: string) => {
      if (fluxQuery.includes('os.cpu.utilization') && fluxQuery.includes('process.memory.rss')) {
        return [
        {
          service_metric_key: 'auth',
          _measurement: 'os.cpu.utilization',
          _value: 7.25,
          _time: '2026-06-12T06:17:00.000Z',
        },
        {
          service_metric_key: 'auth',
          _measurement: 'process.memory.rss',
          _value: 104857600,
          _time: '2026-06-12T06:17:00.000Z',
        },
        ];
      }
      return [];
    });

    const snapshot = await buildServiceCatalogSnapshot(
      { page: 1, pageSize: 10, scope: 'system' },
      {
        registry: {
          getNodeList: () => [
            {
              id: 'node-1',
              hostname: 'node-1.local',
              available: true,
              services: [{ name: 'auth' }],
            },
          ],
        },
      } as any,
    );

    expect(snapshot.services[0]).toEqual(expect.objectContaining({
      id: 'system:auth',
      qps: null,
      latency: null,
      errorRate: null,
      health: 'healthy',
      runtimeMetrics: {
        cpu: 7.25,
        memory: 100,
        lastSampleAt: '2026-06-12T06:17:00.000Z',
      },
      metricStatus: {
        qps: 'unavailable',
        latency: 'unavailable',
        errorRate: 'unavailable',
        runtime: 'observed',
      },
    }));
  });

  it('falls back to completed duration events when request counters are absent', async () => {
    queryMetricsMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ service_metric_key: 'metrics', _value: 2 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ service_metric_key: 'metrics', _value: 30 }])
      .mockResolvedValueOnce([{ service_metric_key: 'metrics', _value: 30 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const snapshot = await buildServiceCatalogSnapshot(
      { page: 1, pageSize: 10, scope: 'system' },
      {
        registry: {
          getNodeList: () => [
            {
              id: 'node-1',
              hostname: 'node-1.local',
              available: true,
              services: [{ name: 'metrics' }],
            },
          ],
        },
      } as any,
    );

    expect(queryMetricsMock.mock.calls.some((call) => call[0].includes('|> count()'))).toBe(true);
    expect(snapshot.services[0]).toEqual(expect.objectContaining({
      id: 'system:metrics',
      qps: 0.1,
      latency: 2,
      errorRate: null,
      health: 'healthy',
    }));
  });

  it('coalesces concurrent system metric-map builds and reuses the short-lived result', async () => {
    let resolvePrimaryBatch: (() => void) | undefined;
    const primaryBatch = new Promise<void>((resolve) => {
      resolvePrimaryBatch = resolve;
    });
    queryMetricsMock.mockImplementation(async () => {
      await primaryBatch;
      return [{ service_metric_key: 'gateway', _value: 300 }];
    });
    const star = {
      registry: {
        getNodeList: () => [
          {
            id: 'node-1',
            hostname: 'node-1.local',
            available: true,
            services: [{ name: 'gateway' }],
          },
        ],
      },
    } as unknown as import('node-universe').Star;

    const first = buildServiceCatalogSnapshot({ page: 1, pageSize: 10, scope: 'system' }, star);
    const second = buildServiceCatalogSnapshot({ page: 2, pageSize: 10, scope: 'system' }, star);

    await Promise.resolve();
    expect(queryMetricsMock).toHaveBeenCalledTimes(5);
    resolvePrimaryBatch?.();
    await Promise.all([first, second]);

    await buildServiceCatalogSnapshot({ page: 1, pageSize: 1, scope: 'system' }, star);
    expect(queryMetricsMock).toHaveBeenCalledTimes(5);
  });

  it('projects live Trails action shards into one dynamically discovered system service', async () => {
    queryMetricsMock.mockResolvedValue([]);
    const snapshot = await buildServiceCatalogSnapshot(
      { page: 1, pageSize: 10, scope: 'system' },
      {
        registry: {
          getNodeList: () => [
            {
              id: 'trails-node', hostname: 'trails.local', available: true,
              services: [{ name: 'trails-durable-content' }, { name: 'trails-durable-media' }, { name: 'trails-community' }],
            },
          ],
        },
      } as any,
    );

    expect(snapshot.services).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'trails', name: 'trails', displayName: '星迹', instances: 2, visibilityScope: 'system-admin',
      }),
      expect.objectContaining({ id: 'trails-community', instances: 1 }),
    ]));
    expect(snapshot.services.some((service) => service.name === 'trails-durable-content')).toBe(false);
    expect(snapshot.services.some((service) => service.name === 'trails-durable-media')).toBe(false);
  });

  it('keeps every Trails shard in the runtime catalog used by the service topology', async () => {
    queryMetricsMock.mockResolvedValue([]);
    const snapshot = await buildServiceCatalogSnapshot(
      { page: 1, pageSize: 20, scope: 'system', granularity: 'runtime' },
      {
        registry: {
          getNodeList: () => [
            {
              id: 'trails-node', hostname: 'trails.local', available: true,
              services: [
                { name: 'trails-durable-content' },
                { name: 'trails-durable-media' },
                { name: 'trails-community' },
              ],
            },
          ],
        },
      } as any,
    );

    expect(snapshot.total).toBe(3);
    expect(snapshot.services.map((service) => service.name).sort()).toEqual([
      'trails-community',
      'trails-durable-content',
      'trails-durable-media',
    ]);
    expect(snapshot.services.every((service) => service.sourceType === 'darwin-system')).toBe(true);
  });

  it('includes an arbitrary live registry service without adding it to a client or system-name allowlist', async () => {
    queryMetricsMock.mockResolvedValue([]);
    const snapshot = await buildServiceCatalogSnapshot(
      { page: 1, pageSize: 10, scope: 'system' },
      {
        registry: {
          getNodeList: () => [
            {
              id: 'new-service-node', hostname: 'new-service.local', available: true,
              services: [{ name: 'new-service' }],
            },
          ],
        },
      } as unknown as import('node-universe').Star,
    );

    expect(snapshot.services).toEqual([
      expect.objectContaining({ id: 'new-service', name: 'new-service', instances: 1, visibilityScope: 'system-admin' }),
    ]);
  });
});
