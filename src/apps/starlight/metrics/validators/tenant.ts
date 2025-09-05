/**
 * 租户管理相关参数验证器
 */
import { validateTenantId, validateTimestamp, validatePagination } from './common';

/**
 * 验证租户状态
 */
export const validateTenantStatus = {
  type: 'string',
  enum: ['active', 'suspended', 'deleted', 'trial'],
  messages: {
    required: '租户状态不能为空',
    enum: '租户状态必须是: active, suspended, deleted, trial 之一',
  },
};

/**
 * 验证租户计划
 */
export const validateTenantPlan = {
  type: 'string',
  enum: ['free', 'basic', 'pro', 'enterprise', 'custom'],
  messages: {
    required: '租户计划不能为空',
    enum: '租户计划必须是: free, basic, pro, enterprise, custom 之一',
  },
};

/**
 * 验证租户创建参数
 */
export const validateTenantCreate = {
  tenantId: validateTenantId,
  tenantName: {
    type: 'string',
    min: 1,
    max: 128,
    messages: {
      required: '租户名称不能为空',
      stringMin: '租户名称长度不能少于1个字符',
      stringMax: '租户名称长度不能超过128个字符',
    },
  },
  plan: validateTenantPlan,
  metadata: {
    type: 'object',
    optional: true,
    props: {
      description: {
        type: 'string',
        optional: true,
        max: 512,
      },
      industry: {
        type: 'string',
        optional: true,
        max: 64,
      },
      region: {
        type: 'string',
        optional: true,
        max: 32,
      },
      timezone: {
        type: 'string',
        optional: true,
        max: 32,
      },
    },
  },
};

/**
 * 验证租户更新参数
 */
export const validateTenantUpdate = {
  tenantId: validateTenantId,
  tenantName: {
    type: 'string',
    optional: true,
    min: 1,
    max: 128,
  },
  plan: { ...validateTenantPlan, optional: true },
  status: { ...validateTenantStatus, optional: true },
  metadata: {
    type: 'object',
    optional: true,
    props: {
      description: {
        type: 'string',
        optional: true,
        max: 512,
      },
      industry: {
        type: 'string',
        optional: true,
        max: 64,
      },
      region: {
        type: 'string',
        optional: true,
        max: 32,
      },
      timezone: {
        type: 'string',
        optional: true,
        max: 32,
      },
    },
  },
};

/**
 * 验证租户删除参数
 */
export const validateTenantDelete = {
  tenantId: validateTenantId,
  force: {
    type: 'boolean',
    optional: true,
    default: false,
  },
  reason: {
    type: 'string',
    optional: true,
    max: 256,
  },
};

/**
 * 验证租户状态更新参数
 */
export const validateTenantStatusUpdate = {
  tenantId: validateTenantId,
  status: validateTenantStatus,
  reason: {
    type: 'string',
    optional: true,
    max: 256,
    messages: {
      stringMax: '状态更新原因不能超过256个字符',
    },
  },
};

/**
 * 验证租户计划更新参数
 */
export const validateTenantPlanUpdate = {
  tenantId: validateTenantId,
  oldPlan: validateTenantPlan,
  newPlan: validateTenantPlan,
  effectiveDate: {
    type: 'number',
    optional: true,
    positive: true,
    integer: true,
  },
};

/**
 * 验证租户查询参数
 */
export const validateTenantQuery = {
  tenantId: { ...validateTenantId, optional: true },
  status: { ...validateTenantStatus, optional: true },
  plan: { ...validateTenantPlan, optional: true },
  ...validatePagination,
  sortBy: {
    type: 'string',
    optional: true,
    enum: ['tenantId', 'tenantName', 'createdAt', 'updatedAt', 'plan', 'status'],
    default: 'createdAt',
  },
  sortOrder: {
    type: 'string',
    optional: true,
    enum: ['asc', 'desc'],
    default: 'desc',
  },
  search: {
    type: 'string',
    optional: true,
    max: 128,
  },
};

/**
 * 验证租户指标查询参数
 */
export const validateTenantMetrics = {
  tenantId: validateTenantId,
  metricType: {
    type: 'string',
    optional: true,
    enum: ['processed', 'storage', 'apiCalls', 'users', 'quotas'],
  },
  timeRange: {
    type: 'string',
    optional: true,
    enum: ['1h', '6h', '12h', '1d', '7d', '30d'],
    default: '1d',
  },
  aggregation: {
    type: 'string',
    optional: true,
    enum: ['sum', 'avg', 'min', 'max', 'count'],
    default: 'sum',
  },
};

/**
 * 验证租户配额配置参数
 */
export const validateTenantQuotaConfig = {
  tenantId: validateTenantId,
  quotas: {
    type: 'object',
    props: {
      api_calls: {
        type: 'number',
        optional: true,
        positive: true,
        min: 1,
      },
      data_ingest: {
        type: 'number',
        optional: true,
        positive: true,
        min: 1,
      },
      storage: {
        type: 'number',
        optional: true,
        positive: true,
        min: 1,
      },
      queries: {
        type: 'number',
        optional: true,
        positive: true,
        min: 1,
      },
      bandwidth: {
        type: 'number',
        optional: true,
        positive: true,
        min: 1,
      },
    },
  },
};

/**
 * 租户验证器导出
 */
export default {
  validateTenantStatus,
  validateTenantPlan,
  validateTenantCreate,
  validateTenantUpdate,
  validateTenantDelete,
  validateTenantStatusUpdate,
  validateTenantPlanUpdate,
  validateTenantQuery,
  validateTenantMetrics,
  validateTenantQuotaConfig,
};
