import { describe, expect, it } from 'vitest';
import { MEMORY_USAGE_PERCENT_UNIT, MEMORY_USAGE_UNIT, calculateMemoryUsagePercent, normalizeRssMemoryValue } from '../../src/apps/starlight/metrics/utils/memory-units';
import {
  buildSupportedMetricSchema,
  getAllowedAggregationsForMetric,
  isVisualizationSupportedForMetric,
  parseRangeSeconds,
  resolveInterval,
  resolveQueryResultKind,
  validateQuerySpec,
} from '../../src/apps/starlight/metrics-query/utils/query-contract';

describe('metrics-query query contract helpers', () => {
  it('parses relative time ranges into seconds', () => {
    expect(parseRangeSeconds('-15m')).toBe(900);
    expect(parseRangeSeconds('-1h')).toBe(3600);
    expect(parseRangeSeconds('-7d')).toBe(604800);
  });

  it('derives safe aggregation intervals from time ranges', () => {
    expect(resolveInterval('-1h')).toBe('150s');
    expect(resolveInterval('-1d')).toBe('1h');
  });

  it('validates and normalizes a valid query spec', () => {
    const result = validateQuerySpec(
      {
        scope: 'tenant',
        sourceKind: 'auto',
        subject: { type: 'service', id: 'svc-1' },
        metricRef: 'service.cpu.usage',
        aggregation: 'avg',
      },
      (value) => (value === 'system' ? 'system' : 'tenant')
    );

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.normalizedQuery.scope).toBe('tenant');
  });

  it('validates structured ratio calculation query specs', () => {
    const result = validateQuerySpec(
      {
        scope: 'system',
        sourceKind: 'auto',
        subject: { type: 'system' },
        metricRef: 'custom.memory.usage.percent',
        aggregation: 'latest',
        visualizationHint: 'donut',
        calculation: {
          type: 'ratio',
          numerator: { metricRef: 'process.memory.rss', aggregation: 'latest' },
          denominator: { metricRef: 'os.memory.total', aggregation: 'latest' },
          scale: 100,
          unit: '%',
        },
      },
      (value) => (value === 'system' ? 'system' : 'tenant')
    );

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(resolveQueryResultKind(result.normalizedQuery.metricRef)).toBe('timeseries');
    expect(isVisualizationSupportedForMetric(result.normalizedQuery.metricRef, 'donut')).toBe(true);
  });

  it('rejects incomplete ratio calculation query specs', () => {
    const result = validateQuerySpec(
      {
        scope: 'system',
        sourceKind: 'auto',
        subject: { type: 'system' },
        metricRef: 'custom.memory.usage.percent',
        aggregation: 'latest',
        visualizationHint: 'donut',
        calculation: {
          type: 'ratio',
          numerator: { metricRef: '' },
          denominator: {},
          scale: 0,
        },
      },
      (value) => (value === 'system' ? 'system' : 'tenant')
    );

    expect(result.valid).toBe(false);
    expect(result.issues).toContain('calculation.numerator.metricRef is required');
    expect(result.issues).toContain('calculation.denominator.metricRef is required');
    expect(result.issues).toContain('calculation.scale must be a positive number');
  });

  it('rejects invalid source kinds and missing subject ids', () => {
    const result = validateQuerySpec(
      {
        scope: 'system',
        sourceKind: 'sdk',
        subject: { type: 'service' },
        metricRef: '',
        aggregation: 'bad',
      },
      (value) => (value === 'system' ? 'system' : 'tenant')
    );

    expect(result.valid).toBe(false);
    expect(result.issues).toContain('metricRef is required');
    expect(result.issues).toContain('aggregation is invalid');
    expect(result.issues).toContain('subject.id is required for service queries');
    expect(result.issues).toContain('system scope only supports darwin-event or auto source');
  });

  it('rejects instance subject type while instance authoring is closed', () => {
    const result = validateQuerySpec(
      {
        scope: 'tenant',
        sourceKind: 'auto',
        subject: { type: 'instance', id: 'inst-1' },
        metricRef: 'service.cpu.usage',
        aggregation: 'avg',
      },
      (value) => (value === 'system' ? 'system' : 'tenant')
    );

    expect(result.valid).toBe(false);
    expect(result.issues).toContain('subject.type is invalid');
  });

  it('rejects aggregations that a metric does not actually support', () => {
    const result = validateQuerySpec(
      {
        scope: 'tenant',
        sourceKind: 'auto',
        subject: { type: 'service', id: 'svc-1' },
        metricRef: 'service.qps',
        aggregation: 'p95',
      },
      (value) => (value === 'system' ? 'system' : 'tenant')
    );

    expect(result.valid).toBe(false);
    expect(result.issues).toContain('aggregation is unsupported for this metric');
  });

  it('derives allowed aggregations from metric and visualization together', () => {
    expect(getAllowedAggregationsForMetric('service.qps', 'line')).toEqual(['sum']);
    expect(getAllowedAggregationsForMetric('service.qps', 'number')).toEqual(['latest']);
    expect(getAllowedAggregationsForMetric('service.response.time', 'line')).toEqual(['avg']);
    expect(getAllowedAggregationsForMetric('service.response.time', 'number')).toEqual(['latest', 'avg']);
  });

  it('exposes a consistent metric result-kind and visualization matrix', () => {
    expect(resolveQueryResultKind('service.cpu.usage')).toBe('timeseries');
    expect(resolveQueryResultKind('service.request.stats')).toBe('distribution');
    expect(resolveQueryResultKind('instance.cpu.usage')).toBe('table');

    expect(isVisualizationSupportedForMetric('service.cpu.usage', 'number')).toBe(true);
    expect(isVisualizationSupportedForMetric('service.cpu.usage', 'donut')).toBe(true);
    expect(isVisualizationSupportedForMetric('service.cpu.usage', 'table')).toBe(false);
    expect(isVisualizationSupportedForMetric('service.request.stats', 'donut')).toBe(true);
    expect(isVisualizationSupportedForMetric('instance.cpu.usage', 'table')).toBe(true);
    expect(isVisualizationSupportedForMetric('instance.cpu.usage', 'line')).toBe(false);
  });

  it('normalizes RSS memory bytes to MB for query display', () => {
    expect(normalizeRssMemoryValue(151630643.2)).toBe(144.61);
    expect(MEMORY_USAGE_UNIT).toBe('MB');
  });

  it('calculates RSS memory percent from RSS and total memory bytes', () => {
    expect(calculateMemoryUsagePercent(512, 1024)).toBe(50);
    expect(calculateMemoryUsagePercent(1536, 1024)).toBe(100);
    expect(calculateMemoryUsagePercent(512, 0)).toBe(0);
    expect(MEMORY_USAGE_PERCENT_UNIT).toBe('%');
  });

  it('builds schema items from the same supported query contract', () => {
    const items = buildSupportedMetricSchema({ scope: 'tenant' });

    expect(items.map((item) => item.name)).toEqual([
      'service.cpu.usage',
      'service.memory.usage',
      'service.memory.usage.percent',
      'service.qps',
      'service.response.time',
      'service.error.rate',
      'service.request.stats',
    ]);
    expect(items.find((item) => item.name === 'service.memory.usage')?.unit).toBe(MEMORY_USAGE_UNIT);
    expect(items.find((item) => item.name === 'service.memory.usage.percent')?.unit).toBe(MEMORY_USAGE_PERCENT_UNIT);
    expect(items.find((item) => item.name === 'service.memory.usage.percent')?.recommendedVisualizations).toContain('donut');
    expect(items.find((item) => item.name === 'service.qps')?.allowedAggregations).toEqual(['latest', 'sum']);
    expect(items.find((item) => item.name === 'service.request.stats')?.recommendedVisualizations).toEqual(['bar', 'donut']);
  });
});
