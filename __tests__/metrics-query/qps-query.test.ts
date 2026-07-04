jest.mock(
  'config',
  () => ({
    isTransportDebugEnabled: jest.fn(() => false),
  }),
  { virtual: true },
);

jest.mock('../../src/apps/starlight/metrics/utils/influxdb-handler', () => ({
  InfluxDBHandler: {
    getBucketName: jest.fn(() => 'metrics'),
    queryMetrics: jest.fn(),
  },
}));

import { InfluxDBHandler } from '../../src/apps/starlight/metrics/utils/influxdb-handler';
import { queryServiceQpsSeries } from '../../src/apps/starlight/metrics-query';

const queryMetricsMock = InfluxDBHandler.queryMetrics as jest.MockedFunction<
  typeof InfluxDBHandler.queryMetrics
>;

describe('metrics-query service.qps query', () => {
  beforeEach(() => {
    queryMetricsMock.mockReset();
    (InfluxDBHandler.getBucketName as jest.Mock).mockReturnValue('metrics');
  });

  it('calculates QPS from protocol request event counts without double-counting count fields', async () => {
    queryMetricsMock.mockResolvedValueOnce([{ _time: '2026-06-25T00:00:00.000Z', _value: 60 }]);

    const series = await queryServiceQpsSeries({ timeRange: '-5m', star: {} as any });

    expect(series).toEqual([{ timestamp: Date.parse('2026-06-25T00:00:00.000Z'), value: 1 }]);
    expect(queryMetricsMock.mock.calls[0][0]).toContain('r["_field"] == "value"');
    expect(queryMetricsMock.mock.calls[0][0]).not.toContain('r["_field"] == "count"');
  });

  it('falls back to Node-Universe rate field instead of summing cumulative counters', async () => {
    queryMetricsMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ _time: '2026-06-25T00:00:00.000Z', _value: 6 }]);

    const series = await queryServiceQpsSeries({ timeRange: '-5m', star: {} as any });

    expect(series).toEqual([{ timestamp: Date.parse('2026-06-25T00:00:00.000Z'), value: 0.1 }]);
    expect(queryMetricsMock.mock.calls[1][0]).toContain('r["_field"] == "rate"');
  });

  it('falls back to non-negative counter deltas when rate field is unavailable', async () => {
    queryMetricsMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ _time: '2026-06-25T00:00:00.000Z', _value: 30 }]);

    const series = await queryServiceQpsSeries({ timeRange: '-5m', star: {} as any });

    expect(series).toEqual([{ timestamp: Date.parse('2026-06-25T00:00:00.000Z'), value: 0.5 }]);
    expect(queryMetricsMock.mock.calls[2][0]).toContain('difference(nonNegative: true)');
  });
});
