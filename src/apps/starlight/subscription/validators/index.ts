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
 * 统一验证器对象
 */
export const validators = {
  /**
   * General query parameter validation
   */
  query: async (ctx: Context) => {
    // 这里可以添加通用的查询参数验证逻辑
    // 目前主要是依靠params schema进行验证
  },

  /**
   * 订阅创建验证
   */
  subscriptionCreate: async (ctx: Context) => {
    const { planName, billingCycle, paymentMethodId } = ctx.params;

    if (!planName) {
      throw new Error('Plan name is required');
    }

    if (billingCycle) {
      validateBillingCycle(billingCycle);
    }
  },

  /**
   * 支付验证
   */
  payment: async (ctx: Context) => {
    const { amount, currency } = ctx.params;

    if (amount !== undefined) {
      validateAmount(amount);
    }

    if (currency) {
      validateCurrency(currency);
    }
  },
};
