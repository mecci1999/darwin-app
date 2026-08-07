import { InfluxDBHandler } from '../../src/apps/starlight/metrics/utils/influxdb-handler';

describe('InfluxDBHandler query scheduling', () => {
  afterEach(() => {
    const handler = InfluxDBHandler as unknown as {
      activeQueryCount: number;
      queryQueue: Array<() => void>;
      queryApi: unknown;
    };
    handler.activeQueryCount = 0;
    handler.queryQueue = [];
    handler.queryApi = null;
  });

  it('rejects new queries when the bounded wait queue is full', async () => {
    const handler = InfluxDBHandler as unknown as {
      activeQueryCount: number;
      queryQueue: Array<() => void>;
      queryApi: { queryRows: jest.Mock };
    };
    let completeFirstQuery: (() => void) | undefined;
    handler.queryApi = {
      queryRows: jest.fn((_query: string, observer: { complete: () => void }) => {
        completeFirstQuery = observer.complete;
      }),
    };

    const star = { logger: { debug: jest.fn(), error: jest.fn() } } as any;
    const pendingQueries = Array.from({ length: 35 }, () =>
      InfluxDBHandler.queryMetrics('from(bucket: "metrics")', star),
    );

    await expect(pendingQueries[34]).rejects.toThrow('InfluxDB query queue is full');
    completeFirstQuery?.();
    await Promise.resolve();
  });
});
