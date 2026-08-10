import { MEMORY_USAGE_PERCENT_UNIT, MEMORY_USAGE_UNIT } from '../../metrics/utils/memory-units';

export const parseRangeSeconds = (range: string) => {
  const value = range?.toString().trim() || '-1h';
  const match = value.match(/-?(\d+)([smhdw])/);
  if (!match) return 3600;
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier =
    unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : unit === 'd' ? 86400 : 604800;
  return amount * multiplier;
};

export type SupportedMetricSchemaItem = {
  name: string;
  description: string;
  type: 'gauge' | 'counter' | 'histogram' | 'summary' | 'info';
  unit: string;
  scope: Array<'tenant' | 'system'>;
  sourceKind: 'sdk' | 'darwin-event' | 'mixed' | 'auto';
  subjectKinds: Array<'system' | 'service' | 'instance'>;
  allowedAggregations: Array<'latest' | 'avg' | 'sum' | 'max' | 'p95'>;
  recommendedVisualizations: Array<'number' | 'line' | 'bar' | 'table' | 'donut'>;
  labelNames: string[];
  sampleLabels: Record<string, string[]>;
  sampleCount: number;
  lastSeenAt: number | null;
  sourceServices: string[];
};

export const formatInterval = (seconds: number) => {
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
};

export const resolveInterval = (timeRange: string, buckets = 24) => {
  const seconds = parseRangeSeconds(timeRange);
  const intervalSeconds = Math.max(60, Math.floor(seconds / buckets));
  return formatInterval(intervalSeconds);
};

export const validateQuerySpec = (
  query: any,
  normalizeMetricsScope: (value?: unknown) => 'tenant' | 'system',
) => {
  const issues: string[] = [];
  const normalizedScope = normalizeMetricsScope(query?.scope);
  const sourceKind = query?.sourceKind || 'auto';
  const subjectType = query?.subject?.type || 'system';
  const metricRef = String(query?.metricRef || '').trim();
  const aggregation = query?.aggregation;
  const visualization = query?.visualizationHint || 'line';
  const calculation = query?.calculation;
  const compare = query?.compare;

  if (!metricRef) issues.push('metricRef is required');
  if (!['auto', 'sdk', 'darwin-event'].includes(String(sourceKind))) {
    issues.push('sourceKind is invalid');
  }
  if (!['system', 'service'].includes(String(subjectType))) {
    issues.push('subject.type is invalid');
  }
  if (!['latest', 'avg', 'sum', 'max', 'p95'].includes(String(aggregation || ''))) {
    issues.push('aggregation is invalid');
  }
  const allowedAggregations = getAllowedAggregationsForMetric(metricRef, visualization);
  if (
    metricRef &&
    aggregation &&
    allowedAggregations.length > 0 &&
    !allowedAggregations.includes(String(aggregation))
  ) {
    issues.push('aggregation is unsupported for this metric');
  }
  if (!isVisualizationSupportedForMetric(metricRef, query?.visualizationHint)) {
    issues.push('visualization is unsupported for this metric');
  }
  if (normalizedScope === 'system' && sourceKind !== 'darwin-event' && sourceKind !== 'auto') {
    issues.push('system scope only supports darwin-event or auto source');
  }
  if (subjectType === 'service' && !query?.subject?.id) {
    issues.push('subject.id is required for service queries');
  }
  if (calculation !== undefined) {
    if (!calculation || calculation.type !== 'ratio') {
      issues.push('calculation.type is unsupported');
    } else {
      if (!String(calculation?.numerator?.metricRef || '').trim()) {
        issues.push('calculation.numerator.metricRef is required');
      }
      if (!String(calculation?.denominator?.metricRef || '').trim()) {
        issues.push('calculation.denominator.metricRef is required');
      }
      const numeratorAggregation = calculation?.numerator?.aggregation;
      const denominatorAggregation = calculation?.denominator?.aggregation;
      if (
        numeratorAggregation &&
        !['latest', 'avg', 'sum', 'max', 'p95'].includes(String(numeratorAggregation))
      ) {
        issues.push('calculation.numerator.aggregation is invalid');
      }
      if (
        denominatorAggregation &&
        !['latest', 'avg', 'sum', 'max', 'p95'].includes(String(denominatorAggregation))
      ) {
        issues.push('calculation.denominator.aggregation is invalid');
      }
      if (
        calculation.scale !== undefined &&
        (!Number.isFinite(Number(calculation.scale)) || Number(calculation.scale) <= 0)
      ) {
        issues.push('calculation.scale must be a positive number');
      }
    }
  }
  if (compare !== undefined && compare !== null) {
    if (visualization !== 'number') {
      issues.push('compare only supports number visualization');
    }
    if (typeof compare === 'string') {
      if (!['previous-period', 'same-period'].includes(compare)) {
        issues.push('compare is invalid');
      }
    } else if (typeof compare === 'object') {
      if (compare.enabled !== undefined && typeof compare.enabled !== 'boolean') {
        issues.push('compare.enabled is invalid');
      }
      if (
        !['previous-period', 'previous-day', 'previous-week'].includes(String(compare.mode || ''))
      ) {
        issues.push('compare.mode is invalid');
      }
      if (
        compare.display !== undefined &&
        !['relative', 'absolute', 'both'].includes(String(compare.display))
      ) {
        issues.push('compare.display is invalid');
      }
      if (
        compare.directionality !== undefined &&
        !['increase_better', 'decrease_better', 'neutral'].includes(String(compare.directionality))
      ) {
        issues.push('compare.directionality is invalid');
      }
    } else {
      issues.push('compare is invalid');
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    normalizedQuery: {
      ...query,
      scope: normalizedScope,
      sourceKind,
      subject: query?.subject || { type: 'system' },
    },
  };
};

const TIMESTRING_VISUALIZATIONS = new Set(['line', 'bar']);
const NUMBER_VISUALIZATIONS = new Set(['number', 'donut']);
const DISTRIBUTION_VISUALIZATIONS = new Set(['bar', 'donut']);
const TABLE_VISUALIZATIONS = new Set(['table']);

const SYSTEM_RAW_METRIC_REFS = new Set([
  'os.cpu.utilization',
  'process.memory.rss',
  'process.memory.heap.utilization',
  'os.memory.total',
  'os.memory.utilization',
  'universe.request.total',
  'universe.request.error.total',
  'universe.request.time',
  'http_requests_total',
  'gateway.request.url.total',
  'http_request_duration_ms',
  'http_request_duration',
  'rpc_requests_total',
  'rpc_duration_ms',
  'messaging_requests_total',
  'messaging_duration_ms',
  'db_query_duration_ms',
]);

export const isRawSystemMetricRef = (metricRef: string) => SYSTEM_RAW_METRIC_REFS.has(metricRef);

export const resolveQueryResultKind = (metricRef: string) => {
  if (metricRef?.startsWith('custom.')) return 'timeseries';
  if (metricRef === 'gateway.request.url.total') return 'distribution';
  if (isRawSystemMetricRef(metricRef)) return 'timeseries';
  if (!metricRef) return 'unknown';
  if (metricRef === 'instance.cpu.usage' || metricRef === 'instance.memory.usage') return 'table';
  if (metricRef === 'service.request.stats') return 'distribution';
  if (
    [
      'service.cpu.usage',
      'service.memory.usage',
      'service.memory.usage.percent',
      'service.qps',
      'service.response.time',
      'service.error.rate',
    ].includes(metricRef)
  ) {
    return 'timeseries';
  }
  return 'unknown';
};

export const getAllowedAggregationsForMetric = (
  metricRef: string,
  visualizationHint?: string | null,
) => {
  const visualization = visualizationHint || 'line';

  if (
    metricRef === 'service.cpu.usage' ||
    metricRef === 'service.memory.usage' ||
    metricRef === 'service.memory.usage.percent'
  ) {
    return visualization === 'number' || visualization === 'donut'
      ? ['latest', 'avg', 'max']
      : ['avg', 'max'];
  }

  if (metricRef === 'service.qps') {
    return visualization === 'number' ? ['latest'] : ['sum'];
  }

  if (metricRef === 'service.response.time' || metricRef === 'service.error.rate') {
    if (metricRef === 'service.response.time') {
      return visualization === 'number' ? ['latest', 'avg', 'max', 'p95'] : ['avg', 'max', 'p95'];
    }
    return visualization === 'number' ? ['latest', 'avg', 'max'] : ['avg', 'max'];
  }

  if (metricRef === 'service.request.stats' || metricRef === 'gateway.request.url.total') {
    return ['sum'];
  }

  if (metricRef === 'instance.cpu.usage' || metricRef === 'instance.memory.usage') {
    return ['latest'];
  }

  if (isRawSystemMetricRef(metricRef)) {
    return ['latest', 'avg', 'sum', 'max'];
  }

  return [];
};

export const isVisualizationSupportedForMetric = (
  metricRef: string,
  visualizationHint?: string | null,
) => {
  const resultKind = resolveQueryResultKind(metricRef);
  const visualization = visualizationHint || 'line';

  if (resultKind === 'timeseries')
    return TIMESTRING_VISUALIZATIONS.has(visualization) || NUMBER_VISUALIZATIONS.has(visualization);
  if (resultKind === 'distribution') return DISTRIBUTION_VISUALIZATIONS.has(visualization);
  if (resultKind === 'table') return TABLE_VISUALIZATIONS.has(visualization);
  return false;
};

const METRIC_SCHEMA_BASE: SupportedMetricSchemaItem[] = [
  {
    name: 'os.cpu.utilization',
    description: 'Node-Universe 采集的系统 CPU 平均使用率',
    type: 'gauge',
    unit: '%',
    scope: ['system'],
    sourceKind: 'darwin-event',
    subjectKinds: ['system', 'service'],
    allowedAggregations: ['latest', 'avg', 'max'],
    recommendedVisualizations: ['line', 'number', 'bar'],
    labelNames: ['service', 'nodeID', 'type', 'unit'],
    sampleLabels: {},
    sampleCount: 0,
    lastSeenAt: null,
    sourceServices: [],
  },
  {
    name: 'process.memory.rss',
    description: 'Node-Universe 采集的进程常驻内存大小',
    type: 'gauge',
    unit: MEMORY_USAGE_UNIT,
    scope: ['system'],
    sourceKind: 'darwin-event',
    subjectKinds: ['system', 'service'],
    allowedAggregations: ['latest', 'avg', 'max'],
    recommendedVisualizations: ['line', 'number', 'bar'],
    labelNames: ['service', 'nodeID', 'type', 'unit'],
    sampleLabels: {},
    sampleCount: 0,
    lastSeenAt: null,
    sourceServices: [],
  },
  {
    name: 'process.memory.heap.utilization',
    description: 'Node-Universe 采集的进程堆内存使用率',
    type: 'gauge',
    unit: '%',
    scope: ['system'],
    sourceKind: 'darwin-event',
    subjectKinds: ['system', 'service'],
    allowedAggregations: ['latest', 'avg', 'max'],
    recommendedVisualizations: ['line', 'number', 'donut', 'bar'],
    labelNames: ['service', 'nodeID', 'type', 'unit'],
    sampleLabels: {},
    sampleCount: 0,
    lastSeenAt: null,
    sourceServices: [],
  },
  {
    name: 'os.memory.total',
    description: 'Node-Universe 采集的主机总内存，用于计算内存占比',
    type: 'gauge',
    unit: MEMORY_USAGE_UNIT,
    scope: ['system'],
    sourceKind: 'darwin-event',
    subjectKinds: ['system'],
    allowedAggregations: ['latest', 'max'],
    recommendedVisualizations: ['number', 'line'],
    labelNames: ['nodeID', 'type', 'unit'],
    sampleLabels: {},
    sampleCount: 0,
    lastSeenAt: null,
    sourceServices: [],
  },
  {
    name: 'os.memory.utilization',
    description: 'Node-Universe 采集的系统内存使用率',
    type: 'gauge',
    unit: '%',
    scope: ['system'],
    sourceKind: 'darwin-event',
    subjectKinds: ['system'],
    allowedAggregations: ['latest', 'avg', 'max'],
    recommendedVisualizations: ['line', 'number', 'donut'],
    labelNames: ['nodeID', 'type', 'unit'],
    sampleLabels: {},
    sampleCount: 0,
    lastSeenAt: null,
    sourceServices: [],
  },
  {
    name: 'universe.request.total',
    description: 'Node-Universe 采集的微服务请求总次数',
    type: 'counter',
    unit: 'count',
    scope: ['system'],
    sourceKind: 'darwin-event',
    subjectKinds: ['system', 'service'],
    allowedAggregations: ['latest', 'sum'],
    recommendedVisualizations: ['line', 'number', 'bar'],
    labelNames: ['service', 'nodeID', 'action'],
    sampleLabels: {},
    sampleCount: 0,
    lastSeenAt: null,
    sourceServices: [],
  },
  {
    name: 'universe.request.error.total',
    description: 'Node-Universe 采集的微服务请求失败总次数',
    type: 'counter',
    unit: 'count',
    scope: ['system'],
    sourceKind: 'darwin-event',
    subjectKinds: ['system', 'service'],
    allowedAggregations: ['latest', 'sum'],
    recommendedVisualizations: ['line', 'number', 'bar'],
    labelNames: ['service', 'nodeID', 'action'],
    sampleLabels: {},
    sampleCount: 0,
    lastSeenAt: null,
    sourceServices: [],
  },
  {
    name: 'universe.request.time',
    description: 'Node-Universe 采集的微服务请求执行耗时',
    type: 'histogram',
    unit: 'ms',
    scope: ['system'],
    sourceKind: 'darwin-event',
    subjectKinds: ['system', 'service'],
    allowedAggregations: ['latest', 'avg', 'max'],
    recommendedVisualizations: ['line', 'number', 'bar'],
    labelNames: ['service', 'nodeID', 'action'],
    sampleLabels: {},
    sampleCount: 0,
    lastSeenAt: null,
    sourceServices: [],
  },
  {
    name: 'http_requests_total',
    description: 'Darwin 网关观测到的 HTTP 请求总次数',
    type: 'counter',
    unit: 'count',
    scope: ['system'],
    sourceKind: 'darwin-event',
    subjectKinds: ['system', 'service'],
    allowedAggregations: ['latest', 'sum'],
    recommendedVisualizations: ['line', 'number', 'bar'],
    labelNames: ['service', 'source_service', 'target_service', 'method', 'status', 'route'],
    sampleLabels: {},
    sampleCount: 0,
    lastSeenAt: null,
    sourceServices: [],
  },
  {
    name: 'http_request_duration_ms',
    description: 'Darwin 网关观测到的 HTTP 请求耗时',
    type: 'histogram',
    unit: 'ms',
    scope: ['system'],
    sourceKind: 'darwin-event',
    subjectKinds: ['system', 'service'],
    allowedAggregations: ['latest', 'avg', 'max'],
    recommendedVisualizations: ['line', 'number', 'bar'],
    labelNames: ['service', 'source_service', 'target_service', 'method', 'status', 'route'],
    sampleLabels: {},
    sampleCount: 0,
    lastSeenAt: null,
    sourceServices: [],
  },
  {
    name: 'gateway.request.url.total',
    description: 'Darwin 网关按接口请求 URL 统计的 HTTP 请求次数',
    type: 'counter',
    unit: 'count',
    scope: ['tenant', 'system'],
    sourceKind: 'auto',
    subjectKinds: ['system', 'service'],
    allowedAggregations: ['sum'],
    recommendedVisualizations: ['bar', 'donut'],
    labelNames: ['url', 'path', 'method', 'status', 'target_service', 'downstream_service'],
    sampleLabels: {},
    sampleCount: 0,
    lastSeenAt: null,
    sourceServices: [],
  },
  {
    name: 'rpc_requests_total',
    description: 'Darwin RPC 请求总次数',
    type: 'counter',
    unit: 'count',
    scope: ['system'],
    sourceKind: 'darwin-event',
    subjectKinds: ['system', 'service'],
    allowedAggregations: ['latest', 'sum'],
    recommendedVisualizations: ['line', 'number', 'bar'],
    labelNames: ['service', 'protocol', 'rpc.system', 'action'],
    sampleLabels: {},
    sampleCount: 0,
    lastSeenAt: null,
    sourceServices: [],
  },
  {
    name: 'rpc_duration_ms',
    description: 'Darwin RPC 调用耗时',
    type: 'histogram',
    unit: 'ms',
    scope: ['system'],
    sourceKind: 'darwin-event',
    subjectKinds: ['system', 'service'],
    allowedAggregations: ['latest', 'avg', 'max'],
    recommendedVisualizations: ['line', 'number', 'bar'],
    labelNames: ['service', 'protocol', 'rpc.system', 'action'],
    sampleLabels: {},
    sampleCount: 0,
    lastSeenAt: null,
    sourceServices: [],
  },
  {
    name: 'messaging_requests_total',
    description: 'Darwin 消息请求总次数',
    type: 'counter',
    unit: 'count',
    scope: ['system'],
    sourceKind: 'darwin-event',
    subjectKinds: ['system', 'service'],
    allowedAggregations: ['latest', 'sum'],
    recommendedVisualizations: ['line', 'number', 'bar'],
    labelNames: ['service', 'protocol', 'messaging.system'],
    sampleLabels: {},
    sampleCount: 0,
    lastSeenAt: null,
    sourceServices: [],
  },
  {
    name: 'messaging_duration_ms',
    description: 'Darwin 消息处理耗时',
    type: 'histogram',
    unit: 'ms',
    scope: ['system'],
    sourceKind: 'darwin-event',
    subjectKinds: ['system', 'service'],
    allowedAggregations: ['latest', 'avg', 'max'],
    recommendedVisualizations: ['line', 'number', 'bar'],
    labelNames: ['service', 'protocol', 'messaging.system'],
    sampleLabels: {},
    sampleCount: 0,
    lastSeenAt: null,
    sourceServices: [],
  },
  {
    name: 'db_query_duration_ms',
    description: 'Darwin 数据库查询耗时',
    type: 'histogram',
    unit: 'ms',
    scope: ['system'],
    sourceKind: 'darwin-event',
    subjectKinds: ['system', 'service'],
    allowedAggregations: ['latest', 'avg', 'max'],
    recommendedVisualizations: ['line', 'number', 'bar'],
    labelNames: ['service', 'protocol', 'db.system'],
    sampleLabels: {},
    sampleCount: 0,
    lastSeenAt: null,
    sourceServices: [],
  },
  {
    name: 'service.cpu.usage',
    description: '服务 CPU 使用率趋势',
    type: 'gauge',
    unit: '%',
    scope: ['tenant', 'system'],
    sourceKind: 'auto',
    subjectKinds: ['system', 'service'],
    allowedAggregations: ['latest', 'avg', 'max'],
    recommendedVisualizations: ['line', 'number', 'donut', 'bar'],
    labelNames: ['service'],
    sampleLabels: {},
    sampleCount: 0,
    lastSeenAt: null,
    sourceServices: [],
  },
  {
    name: 'service.memory.usage',
    description: '服务内存使用量趋势',
    type: 'gauge',
    unit: MEMORY_USAGE_UNIT,
    scope: ['tenant', 'system'],
    sourceKind: 'auto',
    subjectKinds: ['system', 'service'],
    allowedAggregations: ['latest', 'avg', 'max'],
    recommendedVisualizations: ['line', 'number', 'donut', 'bar'],
    labelNames: ['service'],
    sampleLabels: {},
    sampleCount: 0,
    lastSeenAt: null,
    sourceServices: [],
  },
  {
    name: 'service.memory.usage.percent',
    description: '服务内存使用率趋势',
    type: 'gauge',
    unit: MEMORY_USAGE_PERCENT_UNIT,
    scope: ['tenant', 'system'],
    sourceKind: 'auto',
    subjectKinds: ['system', 'service'],
    allowedAggregations: ['latest', 'avg', 'max'],
    recommendedVisualizations: ['line', 'number', 'donut', 'bar'],
    labelNames: ['service'],
    sampleLabels: {},
    sampleCount: 0,
    lastSeenAt: null,
    sourceServices: [],
  },
  {
    name: 'service.qps',
    description: '由请求总数指标按时间窗口换算的服务每秒请求数',
    type: 'gauge',
    unit: 'count/s',
    scope: ['tenant', 'system'],
    sourceKind: 'auto',
    subjectKinds: ['system', 'service'],
    allowedAggregations: ['latest', 'sum'],
    recommendedVisualizations: ['line', 'number', 'bar'],
    labelNames: ['service'],
    sampleLabels: {},
    sampleCount: 0,
    lastSeenAt: null,
    sourceServices: [],
  },
  {
    name: 'service.response.time',
    description: '服务响应耗时',
    type: 'histogram',
    unit: 'ms',
    scope: ['tenant', 'system'],
    sourceKind: 'auto',
    subjectKinds: ['system', 'service'],
    allowedAggregations: ['latest', 'avg'],
    recommendedVisualizations: ['line', 'number', 'bar'],
    labelNames: ['service'],
    sampleLabels: {},
    sampleCount: 0,
    lastSeenAt: null,
    sourceServices: [],
  },
  {
    name: 'service.error.rate',
    description: '服务错误率',
    type: 'gauge',
    unit: '%',
    scope: ['tenant', 'system'],
    sourceKind: 'auto',
    subjectKinds: ['system', 'service'],
    allowedAggregations: ['latest', 'avg'],
    recommendedVisualizations: ['line', 'number', 'bar'],
    labelNames: ['service'],
    sampleLabels: {},
    sampleCount: 0,
    lastSeenAt: null,
    sourceServices: [],
  },
  {
    name: 'service.request.stats',
    description: '服务请求分布',
    type: 'counter',
    unit: 'count',
    scope: ['tenant', 'system'],
    sourceKind: 'auto',
    subjectKinds: ['system', 'service'],
    allowedAggregations: ['sum'],
    recommendedVisualizations: ['bar', 'donut'],
    labelNames: ['service', 'target_service', 'route', 'action', 'method'],
    sampleLabels: {},
    sampleCount: 0,
    lastSeenAt: null,
    sourceServices: [],
  },
];

export const buildSupportedMetricSchema = (params?: {
  scope?: 'tenant' | 'system';
  sourceKind?: 'sdk' | 'darwin-event' | 'mixed' | 'auto';
  serviceId?: string;
}) => {
  const scope = params?.scope;
  const sourceKind = params?.sourceKind;

  return METRIC_SCHEMA_BASE.filter((item) => {
    if (scope && !item.scope.includes(scope)) return false;
    if (
      sourceKind &&
      sourceKind !== 'auto' &&
      item.sourceKind !== 'auto' &&
      item.sourceKind !== sourceKind &&
      item.sourceKind !== 'mixed'
    ) {
      return false;
    }
    if (
      params?.serviceId &&
      item.sourceServices.length > 0 &&
      !item.sourceServices.includes(params.serviceId)
    ) {
      return false;
    }
    return true;
  });
};
