/**
 * 验证器统一导出
 * 集中管理所有验证逻辑
 */
import { Context } from 'node-universe';
import * as commonValidators from './common';
import metricsValidators from './metrics';

/**
 * 验证AppKey名称
 */
export function validateAppKeyName(name: any): string {
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('Invalid name: must be a non-empty string');
  }
  if (name.length > 100) {
    throw new Error('Invalid name: must be less than 100 characters');
  }
  return name.trim();
}

/**
 * 验证AppKey描述
 */
export function validateAppKeyDescription(description: any): string | undefined {
  if (description === undefined || description === null) {
    return undefined;
  }
  if (typeof description !== 'string') {
    throw new Error('Invalid description: must be a string');
  }
  if (description.length > 500) {
    throw new Error('Invalid description: must be less than 500 characters');
  }
  return description;
}

/**
 * 验证权限数组
 */
export function validatePermissions(permissions: any): string[] {
  if (!Array.isArray(permissions)) {
    throw new Error('Invalid permissions: must be an array');
  }
  const validPermissions = ['read', 'write', 'admin'];
  for (const permission of permissions) {
    if (typeof permission !== 'string' || !validPermissions.includes(permission)) {
      throw new Error(`Invalid permission: must be one of ${validPermissions.join(', ')}`);
    }
  }
  return permissions;
}

/**
 * 验证过期时间
 */
export function validateExpiresAt(expiresAt: any): Date | undefined {
  if (expiresAt === undefined || expiresAt === null) {
    return undefined;
  }
  const date = new Date(expiresAt);
  if (isNaN(date.getTime())) {
    throw new Error('Invalid expiresAt: must be a valid date string');
  }
  if (date <= new Date()) {
    throw new Error('Invalid expiresAt: must be a future date');
  }
  return date;
}

/**
 * 验证速率限制
 */
export function validateRateLimit(rateLimit: any): number {
  const numRateLimit = Number(rateLimit);
  if (isNaN(numRateLimit) || numRateLimit <= 0) {
    throw new Error('Invalid rateLimit: must be a positive number');
  }
  if (numRateLimit > 10000) {
    throw new Error('Invalid rateLimit: must be less than or equal to 10000');
  }
  return numRateLimit;
}

/**
 * 验证AppKey生成参数
 */
export function validateAppKeyGenerateParams(params: any) {
  return {
    name: validateAppKeyName(params.name),
    description: validateAppKeyDescription(params.description),
    permissions: validatePermissions(params.permissions || ['read', 'write']),
    expiresAt: validateExpiresAt(params.expiresAt),
    rateLimit: validateRateLimit(params.rateLimit || 1000),
  };
}

/**
 * 通用参数验证中间件
 */
export function createValidator(validationFn: (params: any) => any) {
  return (ctx: Context, next: () => Promise<any>) => {
    try {
      ctx.params = validationFn(ctx.params);
      return next();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      ctx.service?.logger?.error('Parameter validation failed:', error);
      throw new Error(`Validation error: ${errorMessage}`);
    }
  };
}

/**
 * 验证原始指标数据参数
 */
export function validateRawDataParams(params: any) {
  // 基本验证逻辑
  if (!params.metrics) {
    throw new Error('Invalid metrics: metrics data is required');
  }

  const validFormats = ['prometheus', 'statsd', 'datadog', 'otlp', 'custom', 'official'];
  if (params.format && !validFormats.includes(params.format)) {
    throw new Error(`Invalid format: must be one of ${validFormats.join(', ')}`);
  }

  if (params.timestamp && (typeof params.timestamp !== 'number' || params.timestamp < 0)) {
    throw new Error('Invalid timestamp: must be a positive number');
  }

  return {
    metrics: params.metrics,
    format: params.format || 'custom',
    timestamp: params.timestamp,
    tenantId: params.tenantId,
  };
}

/**
 * 验证查询参数
 */
const validateQueryParams = (params: any) => {
  // 查询参数验证需要在action中手动处理，因为需要appKey验证后的tenantId
  return { valid: true };
};

/**
 * 预定义的验证器
 */
export const validators = {
  appKeyGenerate: createValidator(validateAppKeyGenerateParams),
  rawData: createValidator(validateRawDataParams),
  queryParams: createValidator(validateQueryParams),
};

// 导出所有验证器
export { commonValidators, metricsValidators };
