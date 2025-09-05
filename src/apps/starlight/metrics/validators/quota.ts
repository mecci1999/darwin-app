/**
 * 配额管理相关参数验证器
 */
import {
  validateTenantId,
  validateUserId,
  validateTimestamp,
  validatePagination,
  validateTimeRange,
} from './common';

/**
 * 验证配额类型
 */
export const validateQuotaType = {
  type: 'string',
  enum: ['api_calls', 'data_ingest', 'storage', 'queries', 'bandwidth', 'custom'],
  messages: {
    required: '配额类型不能为空',
    enum: '配额类型必须是: api_calls, data_ingest, storage, queries, bandwidth, custom 之一',
  },
};

/**
 * 验证配额检查参数
 */
export const validateQuotaCheck = {
  tenantId: validateTenantId,
  userId: validateUserId,
  quotaType: validateQuotaType,
  increment: {
    type: 'number',
    positive: true,
    default: 1,
    min: 0,
    max: 1000000,
    messages: {
      numberPositive: '增量必须是正数',
      numberMin: '增量不能小于0',
      numberMax: '增量不能超过1000000',
    },
  },
};

/**
 * 验证配额状态查询参数
 */
export const validateQuotaStatus = {
  tenantId: validateTenantId,
  userId: { ...validateUserId, optional: true },
  quotaType: { ...validateQuotaType, optional: true },
  ...validatePagination,
};

/**
 * 验证配额历史查询参数
 */
export const validateQuotaHistory = {
  tenantId: validateTenantId,
  userId: validateUserId,
  quotaType: { ...validateQuotaType, optional: true },
  ...validateTimeRange,
  ...validatePagination,
  sortBy: {
    type: 'string',
    optional: true,
    enum: ['timestamp', 'usage', 'quotaType'],
    default: 'timestamp',
  },
  sortOrder: {
    type: 'string',
    optional: true,
    enum: ['asc', 'desc'],
    default: 'desc',
  },
};

/**
 * 验证配额重置参数
 */
export const validateQuotaReset = {
  tenantId: validateTenantId,
  userId: validateUserId,
  quotaType: validateQuotaType,
  resetValue: {
    type: 'number',
    min: 0,
    default: 0,
    messages: {
      numberMin: '重置值不能小于0',
    },
  },
};

/**
 * 验证配额限制更新参数
 */
export const validateQuotaLimitUpdate = {
  tenantId: validateTenantId,
  userId: validateUserId,
  quotaType: validateQuotaType,
  newLimit: {
    type: 'number',
    positive: true,
    min: 1,
    max: 999999999,
    messages: {
      required: '新限制值不能为空',
      numberPositive: '新限制值必须是正数',
      numberMin: '新限制值不能小于1',
      numberMax: '新限制值不能超过999999999',
    },
  },
};

/**
 * 验证配额警告参数
 */
export const validateQuotaWarning = {
  tenantId: validateTenantId,
  userId: validateUserId,
  quotaType: validateQuotaType,
  usage: {
    type: 'number',
    min: 0,
    messages: {
      required: '使用量不能为空',
      numberMin: '使用量不能小于0',
    },
  },
  limit: {
    type: 'number',
    positive: true,
    messages: {
      required: '限制值不能为空',
      numberPositive: '限制值必须是正数',
    },
  },
  threshold: {
    type: 'number',
    min: 0,
    max: 1,
    default: 0.8,
    messages: {
      numberMin: '阈值不能小于0',
      numberMax: '阈值不能大于1',
    },
  },
  email: {
    type: 'email',
    optional: true,
    messages: {
      email: '邮箱格式不正确',
    },
  },
};

/**
 * 验证配额预测参数
 */
export const validateQuotaForecast = {
  tenantId: validateTenantId,
  userId: validateUserId,
  quotaType: validateQuotaType,
  forecastDays: {
    type: 'number',
    positive: true,
    integer: true,
    min: 1,
    max: 90,
    default: 30,
    messages: {
      numberPositive: '预测天数必须是正数',
      numberInteger: '预测天数必须是整数',
      numberMin: '预测天数不能小于1',
      numberMax: '预测天数不能超过90',
    },
  },
  algorithm: {
    type: 'string',
    optional: true,
    enum: ['linear', 'exponential', 'seasonal'],
    default: 'linear',
  },
};

/**
 * 验证配额消费记录参数
 */
export const validateQuotaConsume = {
  tenantId: validateTenantId,
  userId: validateUserId,
  quotaType: validateQuotaType,
  amount: {
    type: 'number',
    positive: true,
    min: 0.001,
    max: 1000000,
    messages: {
      required: '消费量不能为空',
      numberPositive: '消费量必须是正数',
      numberMin: '消费量不能小于0.001',
      numberMax: '消费量不能超过1000000',
    },
  },
  metadata: {
    type: 'object',
    optional: true,
    props: {
      source: {
        type: 'string',
        optional: true,
        max: 128,
      },
      operation: {
        type: 'string',
        optional: true,
        max: 64,
      },
      requestId: {
        type: 'string',
        optional: true,
        max: 64,
      },
    },
  },
  timestamp: { ...validateTimestamp, optional: true },
};

/**
 * 配额验证器导出
 */
export default {
  validateQuotaType,
  validateQuotaCheck,
  validateQuotaStatus,
  validateQuotaHistory,
  validateQuotaReset,
  validateQuotaLimitUpdate,
  validateQuotaWarning,
  validateQuotaForecast,
  validateQuotaConsume,
};
