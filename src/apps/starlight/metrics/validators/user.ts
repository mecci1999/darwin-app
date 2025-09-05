/**
 * 用户管理相关参数验证器
 */
import {
  validateTenantId,
  validateUserId,
  validateTimestamp,
  validatePagination,
  validateTimeRange,
} from './common';

/**
 * 验证用户状态
 */
export const validateUserStatus = {
  type: 'string',
  enum: ['active', 'suspended', 'deleted', 'pending'],
  messages: {
    required: '用户状态不能为空',
    enum: '用户状态必须是: active, suspended, deleted, pending 之一',
  },
};

/**
 * 验证用户角色
 */
export const validateUserRole = {
  type: 'string',
  enum: ['admin', 'user', 'viewer', 'developer'],
  default: 'user',
  messages: {
    enum: '用户角色必须是: admin, user, viewer, developer 之一',
  },
};

/**
 * 验证用户创建参数
 */
export const validateUserCreate = {
  tenantId: validateTenantId,
  userId: validateUserId,
  userInfo: {
    type: 'object',
    props: {
      email: {
        type: 'email',
        messages: {
          required: '邮箱不能为空',
          email: '邮箱格式不正确',
        },
      },
      name: {
        type: 'string',
        min: 1,
        max: 64,
        messages: {
          required: '用户名不能为空',
          stringMin: '用户名长度不能少于1个字符',
          stringMax: '用户名长度不能超过64个字符',
        },
      },
      role: validateUserRole,
      avatar: {
        type: 'url',
        optional: true,
        messages: {
          url: '头像URL格式不正确',
        },
      },
      timezone: {
        type: 'string',
        optional: true,
        max: 32,
      },
      language: {
        type: 'string',
        optional: true,
        enum: ['zh-CN', 'en-US', 'ja-JP'],
        default: 'zh-CN',
      },
    },
  },
};

/**
 * 验证用户更新参数
 */
export const validateUserUpdate = {
  tenantId: validateTenantId,
  userId: validateUserId,
  userInfo: {
    type: 'object',
    optional: true,
    props: {
      email: {
        type: 'email',
        optional: true,
      },
      name: {
        type: 'string',
        optional: true,
        min: 1,
        max: 64,
      },
      role: { ...validateUserRole, optional: true },
      avatar: {
        type: 'url',
        optional: true,
      },
      timezone: {
        type: 'string',
        optional: true,
        max: 32,
      },
      language: {
        type: 'string',
        optional: true,
        enum: ['zh-CN', 'en-US', 'ja-JP'],
      },
    },
  },
  status: { ...validateUserStatus, optional: true },
};

/**
 * 验证用户删除参数
 */
export const validateUserDelete = {
  tenantId: validateTenantId,
  userId: validateUserId,
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
 * 验证用户状态更新参数
 */
export const validateUserStatusUpdate = {
  tenantId: validateTenantId,
  userId: validateUserId,
  status: validateUserStatus,
  reason: {
    type: 'string',
    optional: true,
    max: 256,
  },
};

/**
 * 验证用户活动记录参数
 */
export const validateUserActivity = {
  tenantId: validateTenantId,
  userId: validateUserId,
  activityType: {
    type: 'string',
    enum: ['api_call', 'data_ingest', 'query_execute', 'login', 'logout'],
    messages: {
      required: '活动类型不能为空',
      enum: '活动类型必须是: api_call, data_ingest, query_execute, login, logout 之一',
    },
  },
  metadata: {
    type: 'object',
    optional: true,
    props: {
      size: {
        type: 'number',
        optional: true,
        positive: true,
      },
      duration: {
        type: 'number',
        optional: true,
        positive: true,
      },
      source: {
        type: 'string',
        optional: true,
        max: 128,
      },
      userAgent: {
        type: 'string',
        optional: true,
        max: 512,
      },
      ip: {
        type: 'string',
        optional: true,
        pattern: /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/,
      },
    },
  },
  timestamp: { ...validateTimestamp, optional: true },
};

/**
 * 验证用户查询参数
 */
export const validateUserQuery = {
  tenantId: validateTenantId,
  userId: { ...validateUserId, optional: true },
  status: { ...validateUserStatus, optional: true },
  role: { ...validateUserRole, optional: true },
  ...validatePagination,
  sortBy: {
    type: 'string',
    optional: true,
    enum: ['userId', 'email', 'name', 'createdAt', 'lastActivity', 'status'],
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
 * 验证用户指标查询参数
 */
export const validateUserMetrics = {
  tenantId: validateTenantId,
  userId: validateUserId,
  metricType: {
    type: 'string',
    optional: true,
    enum: ['apiCalls', 'dataIngested', 'queriesExecuted', 'lastActivity'],
  },
  ...validateTimeRange,
  aggregation: {
    type: 'string',
    optional: true,
    enum: ['sum', 'avg', 'min', 'max', 'count'],
    default: 'sum',
  },
};

/**
 * 验证用户配额更新参数
 */
export const validateUserQuotaUpdate = {
  tenantId: validateTenantId,
  userId: validateUserId,
  quotaType: {
    type: 'string',
    enum: ['api_calls', 'data_ingest', 'storage', 'queries', 'bandwidth'],
    messages: {
      required: '配额类型不能为空',
      enum: '配额类型必须是: api_calls, data_ingest, storage, queries, bandwidth 之一',
    },
  },
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
 * 验证用户活动历史查询参数
 */
export const validateUserActivityHistory = {
  tenantId: validateTenantId,
  userId: validateUserId,
  activityType: {
    type: 'string',
    optional: true,
    enum: ['api_call', 'data_ingest', 'query_execute', 'login', 'logout'],
  },
  ...validateTimeRange,
  ...validatePagination,
  sortBy: {
    type: 'string',
    optional: true,
    enum: ['timestamp', 'activityType'],
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
 * 用户验证器导出
 */
export default {
  validateUserStatus,
  validateUserRole,
  validateUserCreate,
  validateUserUpdate,
  validateUserDelete,
  validateUserStatusUpdate,
  validateUserActivity,
  validateUserQuery,
  validateUserMetrics,
  validateUserQuotaUpdate,
  validateUserActivityHistory,
};
