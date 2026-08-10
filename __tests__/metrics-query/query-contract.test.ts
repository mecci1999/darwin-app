import {
  MEMORY_USAGE_PERCENT_UNIT,
  MEMORY_USAGE_UNIT,
  calculateMemoryUsagePercent,
  normalizeRssMemoryValue,
} from '../../src/apps/starlight/metrics/utils/memory-units';
import {
  RESPONSE_DURATION_COMPLETED_REQUEST_FILTER,
  RESPONSE_DURATION_FIELD_FILTER,
  RESPONSE_DURATION_MEASUREMENT_FILTER,
  RESPONSE_DURATION_MS_NORMALIZATION_FLUX,
  isProtocolDurationMetricRef,
} from '../../src/apps/starlight/metrics/utils/duration-metrics';
import {
  buildSupportedMetricSchema,
  getAllowedAggregationsForMetric,
  isVisualizationSupportedForMetric,
  parseRangeSeconds,
  resolveInterval,
  resolveQueryResultKind,
  validateQuerySpec,
} from '../../src/apps/starlight/metrics-query/utils/query-contract';
import {
  buildGatewayRequestUrlDistributionItems,
  buildRequestStatsDistributionItems,
} from '../../src/apps/starlight/metrics-query/utils/request-stats';

describe('metrics-query query contract helpers', () => {
  it('parses relative time ranges into seconds', () => {
    expect(parseRangeSeconds('-15m')).toBe(900);
    expect(parseRangeSeconds('-1h')).toBe(3600);
    expect(parseRangeSeconds('-7d')).toBe(604800);
  });

  it('derives safe aggregation intervals from time ranges', () => {
    expect(resolveInterval('-1h')).toBe('150s');
    expect(parseRangeSeconds(resolveInterval('-1h'))).toBe(150);
    expect(Math.floor(parseRangeSeconds('-1h') / parseRangeSeconds(resolveInterval('-1h')))).toBe(
      24,
    );
    expect(getAllowedAggregationsForMetric('service.response.time', 'line')).toEqual(['avg', 'max', 'p95']);
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
      (value) => (value === 'system' ? 'system' : 'tenant'),
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
      (value) => (value === 'system' ? 'system' : 'tenant'),
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
      (value) => (value === 'system' ? 'system' : 'tenant'),
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
      (value) => (value === 'system' ? 'system' : 'tenant'),
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
      (value) => (value === 'system' ? 'system' : 'tenant'),
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
      (value) => (value === 'system' ? 'system' : 'tenant'),
    );

    expect(result.valid).toBe(false);
    expect(result.issues).toContain('aggregation is unsupported for this metric');
  });

  it('accepts structured compare only for number query cards', () => {
    const normalizeScope = (value: unknown) =>
      (value === 'system' ? 'system' : 'tenant') as 'tenant' | 'system';
    const numberResult = validateQuerySpec(
      {
        scope: 'tenant',
        sourceKind: 'auto',
        subject: { type: 'service', id: 'svc-1' },
        metricRef: 'service.cpu.usage',
        aggregation: 'latest',
        visualizationHint: 'number',
        compare: {
          enabled: true,
          mode: 'previous-week',
          display: 'both',
          directionality: 'decrease_better',
        },
      },
      normalizeScope,
    );
    const lineResult = validateQuerySpec(
      {
        scope: 'tenant',
        sourceKind: 'auto',
        subject: { type: 'service', id: 'svc-1' },
        metricRef: 'service.cpu.usage',
        aggregation: 'avg',
        visualizationHint: 'line',
        compare: { enabled: true, mode: 'previous-period' },
      },
      normalizeScope,
    );

    expect(numberResult.valid).toBe(true);
    expect(numberResult.issues).toEqual([]);
    expect(lineResult.valid).toBe(false);
    expect(lineResult.issues).toContain('compare only supports number visualization');
  });

  it('derives allowed aggregations from metric and visualization together', () => {
    expect(getAllowedAggregationsForMetric('service.qps', 'line')).toEqual(['sum']);
    expect(getAllowedAggregationsForMetric('service.qps', 'number')).toEqual(['latest']);
    expect(getAllowedAggregationsForMetric('service.response.time', 'line')).toEqual(['avg', 'max', 'p95']);
    expect(getAllowedAggregationsForMetric('service.response.time', 'number')).toEqual([
      'latest',
      'avg',
      'max',
      'p95',
    ]);
  });

  it('accepts P95 response-time number queries used by overview summary widgets', () => {
    const result = validateQuerySpec(
      {
        scope: 'system',
        sourceKind: 'auto',
        subject: { type: 'system' },
        metricRef: 'service.response.time',
        aggregation: 'p95',
        visualizationHint: 'number',
      },
      (value) => (value === 'system' ? 'system' : 'tenant'),
    );

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('exposes a consistent metric result-kind and visualization matrix', () => {
    expect(resolveQueryResultKind('service.cpu.usage')).toBe('timeseries');
    expect(resolveQueryResultKind('service.request.stats')).toBe('distribution');
    expect(resolveQueryResultKind('gateway.request.url.total')).toBe('distribution');
    expect(resolveQueryResultKind('instance.cpu.usage')).toBe('table');

    expect(isVisualizationSupportedForMetric('service.cpu.usage', 'number')).toBe(true);
    expect(isVisualizationSupportedForMetric('service.cpu.usage', 'donut')).toBe(true);
    expect(isVisualizationSupportedForMetric('service.cpu.usage', 'table')).toBe(false);
    expect(isVisualizationSupportedForMetric('service.request.stats', 'donut')).toBe(true);
    expect(isVisualizationSupportedForMetric('gateway.request.url.total', 'bar')).toBe(true);
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

  it('documents the process heap utilization source for service memory percent', () => {
    const items = buildSupportedMetricSchema({ scope: 'system', sourceKind: 'darwin-event' });

    expect(items.find((item) => item.name === 'process.memory.heap.utilization')?.unit).toBe('%');
    expect(
      items.find((item) => item.name === 'process.memory.heap.utilization')?.subjectKinds,
    ).toContain('service');
  });

  it('builds schema items from the same supported query contract', () => {
    const items = buildSupportedMetricSchema({ scope: 'tenant' });

    expect(items.map((item) => item.name)).toEqual([
      'gateway.request.url.total',
      'service.cpu.usage',
      'service.memory.usage',
      'service.memory.usage.percent',
      'service.qps',
      'service.response.time',
      'service.error.rate',
      'service.request.stats',
    ]);
    expect(items.find((item) => item.name === 'service.memory.usage')?.unit).toBe(
      MEMORY_USAGE_UNIT,
    );
    expect(items.find((item) => item.name === 'service.memory.usage.percent')?.unit).toBe(
      MEMORY_USAGE_PERCENT_UNIT,
    );
    expect(
      items.find((item) => item.name === 'service.memory.usage.percent')?.recommendedVisualizations,
    ).toContain('donut');
    expect(items.find((item) => item.name === 'service.qps')?.allowedAggregations).toEqual([
      'latest',
      'sum',
    ]);
    expect(
      items.find((item) => item.name === 'service.request.stats')?.recommendedVisualizations,
    ).toEqual(['bar', 'donut']);
    expect(items.find((item) => item.name === 'gateway.request.url.total')?.labelNames).toEqual([
      'url',
      'path',
      'method',
      'status',
      'target_service',
      'downstream_service',
    ]);
    expect(items.find((item) => item.name === 'service.request.stats')?.labelNames).toEqual([
      'service',
      'target_service',
      'route',
      'action',
      'method',
    ]);
  });

  it('normalizes second-based HTTP duration metrics to milliseconds before aggregation', () => {
    expect(RESPONSE_DURATION_MEASUREMENT_FILTER).toContain('http_request_duration_ms');
    expect(RESPONSE_DURATION_MEASUREMENT_FILTER).toContain('http_request_duration');
    expect(RESPONSE_DURATION_MEASUREMENT_FILTER).toContain('messaging_duration_ms');
    expect(RESPONSE_DURATION_FIELD_FILTER).toContain('response_time');
    expect(RESPONSE_DURATION_MS_NORMALIZATION_FLUX).toContain(
      'r["_measurement"] == "http_request_duration"',
    );
    expect(RESPONSE_DURATION_MS_NORMALIZATION_FLUX).toContain('r.unit == "s"');
    expect(RESPONSE_DURATION_MS_NORMALIZATION_FLUX).toContain('* 1000.0');
    expect(RESPONSE_DURATION_COMPLETED_REQUEST_FILTER).toContain('r.phase != "start"');
    expect(RESPONSE_DURATION_COMPLETED_REQUEST_FILTER).toContain('> 0.0');
  });

  it('classifies protocol duration metric refs for duration-specific normalization', () => {
    expect(isProtocolDurationMetricRef('http_request_duration_ms')).toBe(true);
    expect(isProtocolDurationMetricRef('http_request_duration')).toBe(true);
    expect(isProtocolDurationMetricRef('rpc_duration_ms')).toBe(true);
    expect(isProtocolDurationMetricRef('messaging_duration_ms')).toBe(true);
    expect(isProtocolDurationMetricRef('db_query_duration_ms')).toBe(true);
    expect(isProtocolDurationMetricRef('http_requests_total')).toBe(false);
  });

  it('exposes Chinese descriptions for system metric catalog items', () => {
    const items = buildSupportedMetricSchema({ scope: 'system', sourceKind: 'darwin-event' });

    expect(items.map((item) => item.name)).toContain('process.memory.heap.utilization');
    expect(items.map((item) => item.name)).toContain('os.memory.utilization');
    expect(items.find((item) => item.name === 'os.cpu.utilization')?.description).toBe(
      'Node-Universe 采集的系统 CPU 平均使用率',
    );
    expect(items.find((item) => item.name === 'process.memory.heap.utilization')?.description).toBe(
      'Node-Universe 采集的进程堆内存使用率',
    );
    expect(items.find((item) => item.name === 'os.memory.utilization')?.description).toBe(
      'Node-Universe 采集的系统内存使用率',
    );
    expect(
      items.some((item) => /Darwin raw|Service CPU usage|request count/.test(item.description)),
    ).toBe(false);
  });

  it('builds request distribution labels from request targets instead of dates', () => {
    const items = buildRequestStatsDistributionItems([
      {
        _field: 'value',
        _value: 4,
        stat_target: 'metrics-query',
        stat_route: 'v2.query.cards',
        stat_method: 'POST',
      },
      {
        _field: 'count',
        _value: 4,
        stat_target: 'metrics-query',
        stat_route: 'v2.query.cards',
        stat_method: 'POST',
      },
      { _field: 'value', _value: 9, service: 'gateway', action: 'v1.health' },
      { _field: 'total', _value: 99, service: 'gateway', action: 'v1.health' },
      { _field: 'value', _value: 2, stat_target: 'logs', stat_route: 'v1.search' },
    ]);

    expect(items).toEqual([
      { name: 'gateway · v1.health', value: 9 },
      { name: 'metrics-query · POST v2.query.cards', value: 4 },
      { name: 'logs · v1.search', value: 2 },
    ]);
  });

  it('builds gateway request URL distribution labels from URL and method tags', () => {
    const items = buildGatewayRequestUrlDistributionItems([
      { _value: 12, request_url: '/api/metrics/v2/query/cards', request_method: 'POST' },
      { _value: 4, url: '/api/logs/v1/search', method: 'GET' },
      { _value: 2, path: '/api/metrics/v2/query/cards', method: 'POST' },
      { _value: 99, request_url: '', method: 'GET' },
    ]);

    expect(items).toEqual([
      { name: 'POST /api/metrics/v2/query/cards', value: 14 },
      { name: 'GET /api/logs/v1/search', value: 4 },
    ]);
  });
});
