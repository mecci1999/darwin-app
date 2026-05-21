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

export const validateQuerySpec = (query: any, normalizeMetricsScope: (value?: unknown) => 'tenant' | 'system') => {
  const issues: string[] = [];
  const normalizedScope = normalizeMetricsScope(query?.scope);
  const sourceKind = query?.sourceKind || 'auto';
  const subjectType = query?.subject?.type || 'system';
  const metricRef = String(query?.metricRef || '').trim();
  const aggregation = query?.aggregation;
  const visualization = query?.visualizationHint || 'line';
  const calculation = query?.calculation;

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
  if (metricRef && aggregation && allowedAggregations.length > 0 && !allowedAggregations.includes(String(aggregation))) {
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
      if (numeratorAggregation && !['latest', 'avg', 'sum', 'max', 'p95'].includes(String(numeratorAggregation))) {
        issues.push('calculation.numerator.aggregation is invalid');
      }
      if (denominatorAggregation && !['latest', 'avg', 'sum', 'max', 'p95'].includes(String(denominatorAggregation))) {
        issues.push('calculation.denominator.aggregation is invalid');
      }
      if (calculation.scale !== undefined && (!Number.isFinite(Number(calculation.scale)) || Number(calculation.scale) <= 0)) {
        issues.push('calculation.scale must be a positive number');
      }
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

export const resolveQueryResultKind = (metricRef: string) => {
  if (metricRef?.startsWith('custom.')) return 'timeseries';
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

export const getAllowedAggregationsForMetric = (metricRef: string, visualizationHint?: string | null) => {
  const visualization = visualizationHint || 'line';

  if (metricRef === 'service.cpu.usage' || metricRef === 'service.memory.usage' || metricRef === 'service.memory.usage.percent') {
    return visualization === 'number' || visualization === 'donut'
      ? ['latest', 'avg', 'max']
      : ['avg', 'max'];
  }

  if (metricRef === 'service.qps') {
    return visualization === 'number' ? ['latest'] : ['sum'];
  }

  if (metricRef === 'service.response.time' || metricRef === 'service.error.rate') {
    return visualization === 'number' ? ['latest', 'avg'] : ['avg'];
  }

  if (metricRef === 'service.request.stats') {
    return ['sum'];
  }

  if (metricRef === 'instance.cpu.usage' || metricRef === 'instance.memory.usage') {
    return ['latest'];
  }

  return [];
};

export const isVisualizationSupportedForMetric = (metricRef: string, visualizationHint?: string | null) => {
  const resultKind = resolveQueryResultKind(metricRef);
  const visualization = visualizationHint || 'line';

  if (resultKind === 'timeseries') return TIMESTRING_VISUALIZATIONS.has(visualization) || NUMBER_VISUALIZATIONS.has(visualization);
  if (resultKind === 'distribution') return DISTRIBUTION_VISUALIZATIONS.has(visualization);
  if (resultKind === 'table') return TABLE_VISUALIZATIONS.has(visualization);
  return false;
};

const METRIC_SCHEMA_BASE: SupportedMetricSchemaItem[] = [
  {
    name: 'service.cpu.usage',
    description: 'Service CPU usage over time',
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
    description: 'Service memory usage over time',
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
    description: 'Service memory usage percentage over time',
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
    description: 'Service queries per second',
    type: 'counter',
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
    description: 'Service response time',
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
    description: 'Service error rate',
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
    description: 'Service request distribution',
    type: 'counter',
    unit: 'count',
    scope: ['tenant', 'system'],
    sourceKind: 'auto',
    subjectKinds: ['system', 'service'],
    allowedAggregations: ['sum'],
    recommendedVisualizations: ['bar', 'donut'],
    labelNames: ['metric'],
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
    if (sourceKind && sourceKind !== 'auto' && item.sourceKind !== 'auto' && item.sourceKind !== sourceKind && item.sourceKind !== 'mixed') {
      return false;
    }
    if (params?.serviceId && item.sourceServices.length > 0 && !item.sourceServices.includes(params.serviceId)) {
      return false;
    }
    return true;
  });
};
