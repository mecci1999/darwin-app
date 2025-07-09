/**
 * Subscription微服务核心工具类
 */
import { Star } from 'node-universe';
import { SubscriptionState, UserSubscription, SubscriptionPlan, UsageStats } from '../types';
import {
  MONITORING_CONFIG,
  CACHE_CONFIG,
  VALIDATION_CONFIG,
  SUBSCRIPTION_CONFIG,
} from '../constants';

export class SubscriptionUtils {
  /**
   * 验证订阅数据格式
   */
  static validateSubscriptionData(data: any): boolean {
    try {
      if (!data || typeof data !== 'object') {
        return false;
      }

      // 检查必需字段
      const requiredFields = ['userId', 'planId'];
      for (const field of requiredFields) {
        if (!data[field]) {
          return false;
        }
      }

      // 验证状态
      if (data.status && !Object.values(SUBSCRIPTION_CONFIG.STATUS).includes(data.status)) {
        return false;
      }

      // 验证日期格式
      if (data.startDate && isNaN(Date.parse(data.startDate))) {
        return false;
      }

      if (data.endDate && isNaN(Date.parse(data.endDate))) {
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 生成订阅ID
   */
  static generateSubscriptionId(userId: string, planId: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `sub_${userId}_${planId}_${timestamp}_${random}`;
  }

  /**
   * 生成发票号码
   */
  static generateInvoiceNumber(subscriptionId: string): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `INV-${year}${month}${day}-${random}`;
  }

  /**
   * 计算订阅到期时间
   */
  static calculateExpirationDate(startDate: Date, billingCycle: string): Date {
    const expiration = new Date(startDate);

    switch (billingCycle) {
      case SUBSCRIPTION_CONFIG.BILLING_CYCLES.DAILY:
        expiration.setDate(expiration.getDate() + 1);
        break;
      case SUBSCRIPTION_CONFIG.BILLING_CYCLES.WEEKLY:
        expiration.setDate(expiration.getDate() + 7);
        break;
      case SUBSCRIPTION_CONFIG.BILLING_CYCLES.MONTHLY:
        expiration.setMonth(expiration.getMonth() + 1);
        break;
      case SUBSCRIPTION_CONFIG.BILLING_CYCLES.YEARLY:
        expiration.setFullYear(expiration.getFullYear() + 1);
        break;
      default:
        expiration.setMonth(expiration.getMonth() + 1); // 默认月付
    }

    return expiration;
  }

  /**
   * 计算下次计费日期
   */
  static calculateNextBillingDate(currentBillingDate: Date, billingCycle: string): Date {
    return this.calculateExpirationDate(currentBillingDate, billingCycle);
  }

  /**
   * 检查订阅是否过期
   */
  static isSubscriptionExpired(subscription: UserSubscription): boolean {
    return new Date() > subscription.endDate;
  }

  /**
   * 检查订阅是否即将过期
   */
  static isSubscriptionExpiringSoon(
    subscription: UserSubscription,
    daysThreshold: number = 7,
  ): boolean {
    const now = new Date();
    const threshold = new Date(now.getTime() + daysThreshold * 24 * 60 * 60 * 1000);
    return subscription.endDate <= threshold && subscription.endDate > now;
  }

  /**
   * 计算订阅剩余天数
   */
  static calculateRemainingDays(subscription: UserSubscription): number {
    const now = new Date();
    const diffTime = subscription.endDate.getTime() - now.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  /**
   * 格式化货币金额
   */
  static formatCurrency(amount: number, currency: string = 'USD'): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount / 100); // 假设金额以分为单位存储
  }

  /**
   * 计算折扣后价格
   */
  static calculateDiscountedPrice(
    originalPrice: number,
    discountType: string,
    discountValue: number,
  ): number {
    switch (discountType) {
      case 'percentage':
        return originalPrice * (1 - discountValue / 100);
      case 'fixed_amount':
        return Math.max(0, originalPrice - discountValue);
      default:
        return originalPrice;
    }
  }

  /**
   * 计算税费
   */
  static calculateTax(amount: number, taxRate: number): number {
    return amount * (taxRate / 100);
  }

  /**
   * 验证优惠券代码
   */
  static validateCouponCode(code: string): boolean {
    // 基本格式验证
    const codeRegex = /^[A-Z0-9]{4,20}$/;
    return codeRegex.test(code.toUpperCase());
  }

  /**
   * 生成优惠券代码
   */
  static generateCouponCode(length: number = 8): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * 计算订阅统计信息
   */
  static calculateSubscriptionStats(subscriptions: UserSubscription[]): any {
    const stats = {
      total: subscriptions.length,
      active: 0,
      inactive: 0,
      cancelled: 0,
      expired: 0,
      pending: 0,
      suspended: 0,
      revenue: {
        monthly: 0,
        yearly: 0,
        total: 0,
      },
      churnRate: 0,
      retentionRate: 0,
    };

    subscriptions.forEach((subscription) => {
      // 统计状态分布
      switch (subscription.status) {
        case 'active':
          stats.active++;
          break;
        case 'inactive':
          stats.inactive++;
          break;
        case 'cancelled':
          stats.cancelled++;
          break;
        case 'expired':
          stats.expired++;
          break;
        case 'pending':
          stats.pending++;
          break;
        case 'suspended':
          stats.suspended++;
          break;
      }
    });

    // 计算流失率和留存率
    if (stats.total > 0) {
      stats.churnRate = (stats.cancelled + stats.expired) / stats.total;
      stats.retentionRate = 1 - stats.churnRate;
    }

    return stats;
  }

  /**
   * 格式化时间戳
   */
  static formatTimestamp(timestamp: Date | string | number): string {
    const date = new Date(timestamp);
    return date.toISOString();
  }

  /**
   * 解析时间范围
   */
  static parseTimeRange(range: string): { start: Date; end: Date } {
    const now = new Date();
    const end = new Date(now);
    const start = new Date(now);

    switch (range) {
      case 'today':
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        break;
      case 'yesterday':
        start.setDate(start.getDate() - 1);
        start.setHours(0, 0, 0, 0);
        end.setDate(end.getDate() - 1);
        end.setHours(23, 59, 59, 999);
        break;
      case 'last7days':
        start.setDate(start.getDate() - 7);
        break;
      case 'last30days':
        start.setDate(start.getDate() - 30);
        break;
      case 'last90days':
        start.setDate(start.getDate() - 90);
        break;
      case 'thisMonth':
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        break;
      case 'lastMonth':
        start.setMonth(start.getMonth() - 1, 1);
        start.setHours(0, 0, 0, 0);
        end.setDate(0);
        end.setHours(23, 59, 59, 999);
        break;
      case 'thisYear':
        start.setMonth(0, 1);
        start.setHours(0, 0, 0, 0);
        break;
      default:
        // 默认最近30天
        start.setDate(start.getDate() - 30);
    }

    return { start, end };
  }

  /**
   * 生成重试延迟时间
   */
  static calculateRetryDelay(attempt: number): number {
    const baseDelay = 1000; // 1秒基础延迟
    const backoffFactor = 2; // 指数退避因子
    return Math.min(baseDelay * Math.pow(backoffFactor, attempt), 30000); // 最大30秒
  }

  /**
   * 验证邮箱格式
   */
  static validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * 验证手机号格式
   */
  static validatePhoneNumber(phone: string): boolean {
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    return phoneRegex.test(phone.replace(/[\s-()]/g, ''));
  }

  /**
   * 生成唯一请求ID
   */
  static generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  /**
   * 深度克隆对象
   */
  static deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (obj instanceof Date) {
      return new Date(obj.getTime()) as unknown as T;
    }

    if (obj instanceof Array) {
      return obj.map((item) => this.deepClone(item)) as unknown as T;
    }

    if (typeof obj === 'object') {
      const cloned = {} as T;
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          cloned[key] = this.deepClone(obj[key]);
        }
      }
      return cloned;
    }

    return obj;
  }
}
