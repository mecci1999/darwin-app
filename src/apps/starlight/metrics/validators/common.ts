/**
 * 通用参数验证器
 */

/**
 * 验证租户ID
 */
export const validateTenantId = {
  type: 'string',
  min: 1,
  max: 64,
  pattern: /^[a-zA-Z0-9_-]+$/,
  messages: {
    required: '租户ID不能为空',
    string: '租户ID必须是字符串',
    stringMin: '租户ID长度不能少于1个字符',
    stringMax: '租户ID长度不能超过64个字符',
    stringPattern: '租户ID只能包含字母、数字、下划线和连字符',
  },
};

/**
 * 验证用户ID
 */
export const validateUserId = {
  type: 'string',
  min: 1,
  max: 64,
  pattern: /^[a-zA-Z0-9_-]+$/,
  messages: {
    required: '用户ID不能为空',
    string: '用户ID必须是字符串',
    stringMin: '用户ID长度不能少于1个字符',
    stringMax: '用户ID长度不能超过64个字符',
    stringPattern: '用户ID只能包含字母、数字、下划线和连字符',
  },
};

/**
 * 验证时间戳
 */
export const validateTimestamp = {
  type: 'number',
  positive: true,
  integer: true,
  messages: {
    required: '时间戳不能为空',
    number: '时间戳必须是数字',
    numberPositive: '时间戳必须是正数',
    numberInteger: '时间戳必须是整数',
  },
};

/**
 * 验证分页参数
 */
export const validatePagination = {
  page: {
    type: 'number',
    positive: true,
    integer: true,
    default: 1,
    min: 1,
    max: 10000,
  },
  limit: {
    type: 'number',
    positive: true,
    integer: true,
    default: 20,
    min: 1,
    max: 1000,
  },
};

/**
 * 验证时间范围
 */
export const validateTimeRange = {
  startTime: {
    type: 'number',
    positive: true,
    integer: true,
    optional: true,
  },
  endTime: {
    type: 'number',
    positive: true,
    integer: true,
    optional: true,
  },
};

/**
 * 验证标签
 */
export const validateTags = {
  type: 'object',
  optional: true,
  props: {},
  additionalProperties: {
    type: 'string',
    max: 256,
  },
};

/**
 * 验证元数据
 */
export const validateMetadata = {
  type: 'object',
  optional: true,
  props: {
    userId: { ...validateUserId, optional: true },
    appKeyId: {
      type: 'string',
      optional: true,
      max: 64,
    },
    tags: validateTags,
  },
};

/**
 * 通用验证器导出
 */
// 为了保持向后兼容，同时导出带有简化名称的对象
export const metadata = validateMetadata;
export const tenantId = validateTenantId;
export const userId = validateUserId;
export const timestamp = validateTimestamp;
export const pagination = validatePagination;
export const timeRange = validateTimeRange;
export const tags = validateTags;

export default {
  validateTenantId,
  validateUserId,
  validateTimestamp,
  validatePagination,
  validateTimeRange,
  validateTags,
  validateMetadata,
  // 简化名称
  metadata: validateMetadata,
  tenantId: validateTenantId,
  userId: validateUserId,
  timestamp: validateTimestamp,
  pagination: validatePagination,
  timeRange: validateTimeRange,
  tags: validateTags,
};
