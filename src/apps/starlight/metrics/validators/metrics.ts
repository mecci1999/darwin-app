/**
 * 指标数据相关参数验证器
 */
import {
  validateTenantId,
  validateUserId,
  validateTimestamp,
  validateTags,
  validateMetadata,
  validatePagination,
  validateTimeRange,
} from './common';

/**
 * 验证指标数据格式
 */
export const validateMetricsFormat = {
  type: 'string',
  enum: ['prometheus', 'statsd', 'datadog', 'otlp', 'custom', 'official'],
  default: 'custom',
  messages: {
    required: '指标数据格式不能为空',
    enum: '指标数据格式必须是: prometheus, statsd, datadog, otlp, custom, official 之一',
  },
};

/**
 * 验证原始指标数据
 */
export const validateRawMetricsData = {
  tenantId: validateTenantId,
  source: {
    type: 'string',
    min: 1,
    max: 128,
    messages: {
      required: '数据源不能为空',
      stringMin: '数据源长度不能少于1个字符',
      stringMax: '数据源长度不能超过128个字符',
    },
  },
  format: validateMetricsFormat,
  timestamp: { ...validateTimestamp, optional: true },
  data: {
    type: 'any',
    messages: {
      required: '指标数据不能为空',
    },
  },
  metadata: validateMetadata,
};

/**
 * 验证处理后的指标数据
 */
export const validateProcessedMetricsData = {
  measurement: {
    type: 'string',
    min: 1,
    max: 128,
    messages: {
      required: '测量名称不能为空',
      stringMin: '测量名称长度不能少于1个字符',
      stringMax: '测量名称长度不能超过128个字符',
    },
  },
  tags: validateTags,
  fields: {
    type: 'object',
    messages: {
      required: '字段数据不能为空',
      object: '字段数据必须是对象',
    },
  },
  timestamp: validateTimestamp,
};

/**
 * 验证指标查询参数
 */
export const validateMetricsQuery = {
  tenantId: validateTenantId,
  measurement: {
    type: 'string',
    optional: true,
    max: 128,
  },
  tags: {
    type: 'object',
    optional: true,
    additionalProperties: {
      type: 'string',
      max: 256,
    },
  },
  fields: {
    type: 'array',
    optional: true,
    items: {
      type: 'string',
      max: 64,
    },
  },
  ...validateTimeRange,
  ...validatePagination,
  aggregation: {
    type: 'string',
    optional: true,
    enum: ['sum', 'avg', 'min', 'max', 'count', 'last', 'first'],
  },
  groupBy: {
    type: 'array',
    optional: true,
    items: {
      type: 'string',
      max: 64,
    },
  },
  interval: {
    type: 'string',
    optional: true,
    pattern: /^\d+[smhd]$/,
    messages: {
      stringPattern: '时间间隔格式错误，应为数字+单位(s/m/h/d)，如: 5m, 1h, 1d',
    },
  },
};

/**
 * 验证指标聚合参数
 */
export const validateMetricsAggregation = {
  tenantId: validateTenantId,
  timeRange: {
    type: 'string',
    enum: ['1h', '6h', '12h', '1d', '7d', '30d'],
    messages: {
      required: '时间范围不能为空',
      enum: '时间范围必须是: 1h, 6h, 12h, 1d, 7d, 30d 之一',
    },
  },
  aggregationType: {
    type: 'string',
    enum: ['sum', 'avg', 'min', 'max', 'count'],
    messages: {
      required: '聚合类型不能为空',
      enum: '聚合类型必须是: sum, avg, min, max, count 之一',
    },
  },
  measurement: {
    type: 'string',
    optional: true,
    max: 128,
  },
  groupBy: {
    type: 'array',
    optional: true,
    items: {
      type: 'string',
      max: 64,
    },
  },
};

/**
 * 验证批量指标数据
 */
export const validateMetricsBatch = {
  tenantId: validateTenantId,
  batchId: {
    type: 'string',
    min: 1,
    max: 64,
    messages: {
      required: '批次ID不能为空',
      stringMin: '批次ID长度不能少于1个字符',
      stringMax: '批次ID长度不能超过64个字符',
    },
  },
  format: validateMetricsFormat,
  data: {
    type: 'array',
    min: 1,
    max: 1000,
    items: {
      type: 'object',
    },
    messages: {
      required: '批量数据不能为空',
      arrayMin: '批量数据至少包含1条记录',
      arrayMax: '批量数据不能超过1000条记录',
    },
  },
  timestamp: { ...validateTimestamp, optional: true },
};

/**
 * 指标验证器导出
 */
export default {
  validateMetricsFormat,
  validateRawMetricsData,
  validateProcessedMetricsData,
  validateMetricsQuery,
  validateMetricsAggregation,
  validateMetricsBatch,
};
