/**
 * 订阅微服务参数验证器
 * 提供各种API参数的验证逻辑
 */
import { Context } from 'node-universe';

/**
 * 验证租户ID
 */
export function validateTenantId(tenantId: any): string {
  if (!tenantId || typeof tenantId !== 'string') {
    throw new Error('Invalid tenantId: must be a non-empty string');
  }
  return tenantId;
}

/**
 * 验证用户ID
 */
export function validateUserId(userId: any): string {
  if (!userId || typeof userId !== 'string') {
    throw new Error('Invalid userId: must be a non-empty string');
  }
  return userId;
}

/**
 * 验证订阅计划ID
 */
export function validatePlanId(planId: any): string {
  if (!planId || typeof planId !== 'string') {
    throw new Error('Invalid planId: must be a non-empty string');
  }
  return planId;
}

/**
 * 验证订阅ID
 */
export function validateSubscriptionId(subscriptionId: any): string {
  if (!subscriptionId || typeof subscriptionId !== 'string') {
    throw new Error('Invalid subscriptionId: must be a non-empty string');
  }
  return subscriptionId;
}

/**
 * 验证货币代码
 */
export function validateCurrency(currency: any): string {
  const validCurrencies = ['USD', 'EUR', 'CNY', 'JPY', 'GBP'];
  if (!currency || typeof currency !== 'string' || !validCurrencies.includes(currency)) {
    throw new Error(`Invalid currency: must be one of ${validCurrencies.join(', ')}`);
  }
  return currency;
}

/**
 * 验证金额
 */
export function validateAmount(amount: any): number {
  const numAmount = Number(amount);
  if (isNaN(numAmount) || numAmount < 0) {
    throw new Error('Invalid amount: must be a non-negative number');
  }
  return numAmount;
}

/**
 * 验证计费周期
 */
export function validateBillingCycle(billingCycle: any): string {
  const validCycles = ['monthly', 'yearly', 'weekly', 'daily'];
  if (!billingCycle || typeof billingCycle !== 'string' || !validCycles.includes(billingCycle)) {
    throw new Error(`Invalid billingCycle: must be one of ${validCycles.join(', ')}`);
  }
  return billingCycle;
}

/**
 * 验证订阅状态
 */
export function validateSubscriptionStatus(status: any): string {
  const validStatuses = ['active', 'cancelled', 'expired', 'trial', 'suspended'];
  if (!status || typeof status !== 'string' || !validStatuses.includes(status)) {
    throw new Error(`Invalid status: must be one of ${validStatuses.join(', ')}`);
  }
  return status;
}

/**
 * 验证日期
 */
export function validateDate(date: any, fieldName: string): Date {
  if (!date) {
    throw new Error(`Invalid ${fieldName}: date is required`);
  }
  
  const parsedDate = new Date(date);
  if (isNaN(parsedDate.getTime())) {
    throw new Error(`Invalid ${fieldName}: must be a valid date`);
  }
  
  return parsedDate;
}

/**
 * 验证分页参数
 */
export function validatePagination(params: any): { page: number; limit: number } {
  const page = Math.max(1, parseInt(params.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(params.limit) || 10));
  
  return { page, limit };
}

/**
 * 验证订阅创建参数
 */
export function validateSubscriptionCreateParams(params: any) {
  return {
    tenantId: validateTenantId(params.tenantId),
    userId: validateUserId(params.userId),
    planId: validatePlanId(params.planId),
    billingCycle: validateBillingCycle(params.billingCycle || 'monthly'),
    currency: validateCurrency(params.currency || 'USD'),
    autoRenew: Boolean(params.autoRenew !== false), // 默认为true
  };
}

/**
 * 验证订阅更新参数
 */
export function validateSubscriptionUpdateParams(params: any) {
  const validated: any = {
    subscriptionId: validateSubscriptionId(params.subscriptionId),
  };

  if (params.planId !== undefined) {
    validated.planId = validatePlanId(params.planId);
  }

  if (params.status !== undefined) {
    validated.status = validateSubscriptionStatus(params.status);
  }

  if (params.autoRenew !== undefined) {
    validated.autoRenew = Boolean(params.autoRenew);
  }

  if (params.endDate !== undefined) {
    validated.endDate = validateDate(params.endDate, 'endDate');
  }

  return validated;
}

/**
 * 验证支付参数
 */
export function validatePaymentParams(params: any) {
  return {
    subscriptionId: validateSubscriptionId(params.subscriptionId),
    amount: validateAmount(params.amount),
    currency: validateCurrency(params.currency),
    paymentMethodId: params.paymentMethodId ? String(params.paymentMethodId) : undefined,
  };
}

/**
 * 验证查询参数
 */
export function validateQueryParams(params: any) {
  const validated: any = {};

  if (params.tenantId !== undefined) {
    validated.tenantId = validateTenantId(params.tenantId);
  }

  if (params.userId !== undefined) {
    validated.userId = validateUserId(params.userId);
  }

  if (params.status !== undefined) {
    validated.status = validateSubscriptionStatus(params.status);
  }

  if (params.planId !== undefined) {
    validated.planId = validatePlanId(params.planId);
  }

  if (params.startDate !== undefined) {
    validated.startDate = validateDate(params.startDate, 'startDate');
  }

  if (params.endDate !== undefined) {
    validated.endDate = validateDate(params.endDate, 'endDate');
  }

  // 验证分页参数
  const pagination = validatePagination(params);
  validated.page = pagination.page;
  validated.limit = pagination.limit;

  return validated;
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
 * 预定义的验证器
 */
export const validators = {
  subscriptionCreate: createValidator(validateSubscriptionCreateParams),
  subscriptionUpdate: createValidator(validateSubscriptionUpdateParams),
  payment: createValidator(validatePaymentParams),
  query: createValidator(validateQueryParams),
};