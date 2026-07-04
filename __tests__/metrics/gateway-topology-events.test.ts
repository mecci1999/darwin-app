import { queueGatewayTopologyMetric } from '../../src/apps/starlight/metrics/events/metrics';

type TestMetricsBatch = {
  data: Array<{
    measurement: string;
    tags: Record<string, unknown>;
    fields: Record<string, number>;
    timestamp: number;
  }>;
};

type TestContext = {
  params: Record<string, unknown>;
  service: {
    metricsState: {
      processingQueue: TestMetricsBatch[];
      cache: Record<string, unknown>;
    };
    logger: {
      info: jest.Mock;
    };
  };
};

const createContext = (params: Record<string, unknown>): TestContext => ({
  params,
  service: {
    metricsState: {
      processingQueue: [],
      cache: {},
    },
    logger: {
      info: jest.fn(),
    },
  },
});

describe('gateway topology metrics event', () => {
  it('queues both downstream service metrics and gateway ingress metrics', () => {
    const ctx = createContext({
      sourceService: 'gateway',
      targetService: 'metrics',
      version: 'v1',
      action: 'catalog.services',
      status: 'success',
      durationMs: 291,
      phase: 'finish',
      method: 'GET',
      requestUrl: '/api/metrics/v1/catalog/services',
      timestamp: 1718175238580,
    });

    queueGatewayTopologyMetric(ctx as any);

    const batch = ctx.service.metricsState.processingQueue[0];
    expect(batch.data).toHaveLength(4);
    expect(batch.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          measurement: 'http_requests_total',
          tags: expect.objectContaining({
            service: 'gateway',
            target_service: 'metrics',
            url: '/api/metrics/v1/catalog/services',
            path: '/api/metrics/v1/catalog/services',
          }),
          fields: { value: 1, count: 1 },
        }),
        expect.objectContaining({
          measurement: 'http_request_duration_ms',
          tags: expect.objectContaining({ service: 'gateway', target_service: 'metrics' }),
          fields: { value: 291, duration: 291 },
        }),
        expect.objectContaining({
          measurement: 'http_requests_total',
          tags: expect.objectContaining({
            source: 'gateway-ingress',
            service: 'gateway',
            target_service: 'gateway',
            downstream_service: 'metrics',
          }),
          fields: { value: 1, count: 1 },
        }),
        expect.objectContaining({
          measurement: 'http_request_duration_ms',
          tags: expect.objectContaining({
            source: 'gateway-ingress',
            service: 'gateway',
            target_service: 'gateway',
            downstream_service: 'metrics',
          }),
          fields: { value: 291, duration: 291 },
        }),
      ]),
    );
  });

  it('does not queue metrics for the start phase', () => {
    const ctx = createContext({
      sourceService: 'gateway',
      targetService: 'metrics',
      phase: 'start',
      timestamp: 1718175238580,
    });

    queueGatewayTopologyMetric(ctx as any);

    expect(ctx.service.metricsState.processingQueue).toHaveLength(0);
  });
});
