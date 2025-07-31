/**
 * 配额检查器
 */
import { Star } from 'node-universe';
import { QuotaWarningParams } from '../types';

export class QuotaChecker {
  private static checkTimer: NodeJS.Timeout | null = null;
  private static readonly CHECK_INTERVAL = 60000; // 1分钟
  private static readonly WARNING_THRESHOLD = 0.8; // 80%
  private static readonly CRITICAL_THRESHOLD = 0.95; // 95%

  /**
   * 启动配额检查器
   */
  static start(star: Star): void {
    if (this.checkTimer) {
      return;
    }

    this.checkTimer = setInterval(async () => {
      await this.performQuotaCheck(star);
    }, this.CHECK_INTERVAL);

    star.logger?.info('Quota checker started');
  }

  /**
   * 停止配额检查器
   */
  static stop(star: Star): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
      star.logger?.info('Quota checker stopped');
    }
  }

  /**
   * 执行配额检查
   */
  private static async performQuotaCheck(star: Star): Promise<void> {
    try {
      // 获取所有活跃用户的配额信息
      const users = await star.call('subscription.1.getActiveUsers');
      
      for (const user of users) {
        await this.checkUserQuotas(user, star);
      }
    } catch (error) {
      star.logger?.error('Failed to perform quota check:', error);
    }
  }

  /**
   * 检查单个用户的配额
   */
  private static async checkUserQuotas(user: any, star: Star): Promise<void> {
    try {
      const { userId, subscriptionPlan } = user;
      
      // 获取用户的订阅计划限制
      const planLimits = await star.call('subscription.1.getPlanLimits', { planName: subscriptionPlan });
      
      // 获取用户当前使用量
      const usage = await this.getUserUsage(userId, star);
      
      // 检查各种配额
      await this.checkMetricsQuota(userId, usage.metrics, planLimits.metrics, star);
      await this.checkApiKeyQuota(userId, usage.apiKeys, planLimits.apiKeys, star);
      await this.checkStorageQuota(userId, usage.storage, planLimits.storage, star);
      
    } catch (error) {
      star.logger?.error(`Failed to check quotas for user ${user.userId}:`, error);
    }
  }

  /**
   * 获取用户使用量
   */
  private static async getUserUsage(userId: string, star: Star): Promise<{
    metrics: { hourly: number; daily: number; monthly: number };
    apiKeys: number;
    storage: number;
  }> {
    try {
      const now = new Date();
      const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      // 获取指标使用量
      const metricsUsage = await star.call('metrics.1.getUserMetricsCount', {
        userId,
        timeRanges: {
          hourly: { start: hourAgo, end: now },
          daily: { start: dayAgo, end: now },
          monthly: { start: monthAgo, end: now },
        },
      });

      // 获取API密钥数量
      const apiKeysCount = await star.call('metrics.1.getUserApiKeysCount', { userId });

      // 获取存储使用量
      const storageUsage = await star.call('metrics.1.getUserStorageUsage', { userId });

      return {
        metrics: metricsUsage,
        apiKeys: apiKeysCount,
        storage: storageUsage,
      };
    } catch (error) {
      star.logger?.error(`Failed to get usage for user ${userId}:`, error);
      return {
        metrics: { hourly: 0, daily: 0, monthly: 0 },
        apiKeys: 0,
        storage: 0,
      };
    }
  }

  /**
   * 检查指标配额
   */
  private static async checkMetricsQuota(
    userId: string,
    usage: { hourly: number; daily: number; monthly: number },
    limits: { hourly: number; daily: number; monthly: number },
    star: Star
  ): Promise<void> {
    const checks = [
      { type: 'metrics_hourly', usage: usage.hourly, limit: limits.hourly },
      { type: 'metrics_daily', usage: usage.daily, limit: limits.daily },
      { type: 'metrics_monthly', usage: usage.monthly, limit: limits.monthly },
    ];

    for (const check of checks) {
      if (check.limit > 0) { // -1 表示无限制
        const ratio = check.usage / check.limit;
        
        if (ratio >= this.CRITICAL_THRESHOLD) {
          await this.sendQuotaAlert(userId, check.type, check.usage, check.limit, 'critical', star);
        } else if (ratio >= this.WARNING_THRESHOLD) {
          await this.sendQuotaAlert(userId, check.type, check.usage, check.limit, 'warning', star);
        }
      }
    }
  }

  /**
   * 检查API密钥配额
   */
  private static async checkApiKeyQuota(
    userId: string,
    usage: number,
    limit: number,
    star: Star
  ): Promise<void> {
    if (limit > 0) { // -1 表示无限制
      const ratio = usage / limit;
      
      if (ratio >= this.CRITICAL_THRESHOLD) {
        await this.sendQuotaAlert(userId, 'api_keys', usage, limit, 'critical', star);
      } else if (ratio >= this.WARNING_THRESHOLD) {
        await this.sendQuotaAlert(userId, 'api_keys', usage, limit, 'warning', star);
      }
    }
  }

  /**
   * 检查存储配额
   */
  private static async checkStorageQuota(
    userId: string,
    usage: number,
    limit: number,
    star: Star
  ): Promise<void> {
    if (limit > 0) { // -1 表示无限制
      const ratio = usage / limit;
      
      if (ratio >= this.CRITICAL_THRESHOLD) {
        await this.sendQuotaAlert(userId, 'storage', usage, limit, 'critical', star);
      } else if (ratio >= this.WARNING_THRESHOLD) {
        await this.sendQuotaAlert(userId, 'storage', usage, limit, 'warning', star);
      }
    }
  }

  /**
   * 发送配额警告
   */
  private static async sendQuotaAlert(
    userId: string,
    quotaType: string,
    usage: number,
    limit: number,
    severity: 'warning' | 'critical',
    star: Star
  ): Promise<void> {
    try {
      const alertData: QuotaWarningParams = {
        userId,
        quotaType,
        usage,
        limit,
        threshold: usage / limit,
      };

      // 发送内部事件
      await star.emit('quota.alert', {
        ...alertData,
        severity,
        timestamp: Date.now(),
      });

      // 发送到订阅服务处理
      await star.call('subscription.1.handleQuotaAlert', alertData);

      star.logger?.warn(
        `Quota ${severity} for user ${userId}: ${quotaType} usage ${usage}/${limit} (${Math.round((usage / limit) * 100)}%)`
      );
    } catch (error) {
      star.logger?.error('Failed to send quota alert:', error);
    }
  }

  /**
   * 手动检查用户配额
   */
  static async checkUserQuota(userId: string, star: Star): Promise<{
    status: 'ok' | 'warning' | 'critical';
    quotas: Array<{
      type: string;
      usage: number;
      limit: number;
      ratio: number;
    }>;
  }> {
    try {
      // 获取用户信息
      const user = await star.call('user.1.getUserById', { userId });
      if (!user) {
        throw new Error('User not found');
      }

      // 获取订阅计划限制
      const planLimits = await star.call('subscription.1.getPlanLimits', { 
        planName: user.subscriptionPlan 
      });
      
      // 获取用户使用量
      const usage = await this.getUserUsage(userId, star);
      
      const quotas = [
        {
          type: 'metrics_hourly',
          usage: usage.metrics.hourly,
          limit: planLimits.metrics.hourly,
          ratio: planLimits.metrics.hourly > 0 ? usage.metrics.hourly / planLimits.metrics.hourly : 0,
        },
        {
          type: 'metrics_daily',
          usage: usage.metrics.daily,
          limit: planLimits.metrics.daily,
          ratio: planLimits.metrics.daily > 0 ? usage.metrics.daily / planLimits.metrics.daily : 0,
        },
        {
          type: 'metrics_monthly',
          usage: usage.metrics.monthly,
          limit: planLimits.metrics.monthly,
          ratio: planLimits.metrics.monthly > 0 ? usage.metrics.monthly / planLimits.metrics.monthly : 0,
        },
        {
          type: 'api_keys',
          usage: usage.apiKeys,
          limit: planLimits.apiKeys,
          ratio: planLimits.apiKeys > 0 ? usage.apiKeys / planLimits.apiKeys : 0,
        },
        {
          type: 'storage',
          usage: usage.storage,
          limit: planLimits.storage,
          ratio: planLimits.storage > 0 ? usage.storage / planLimits.storage : 0,
        },
      ];

      // 确定整体状态
      const maxRatio = Math.max(...quotas.map(q => q.ratio));
      let status: 'ok' | 'warning' | 'critical';
      
      if (maxRatio >= this.CRITICAL_THRESHOLD) {
        status = 'critical';
      } else if (maxRatio >= this.WARNING_THRESHOLD) {
        status = 'warning';
      } else {
        status = 'ok';
      }

      return { status, quotas };
    } catch (error) {
      star.logger?.error(`Failed to check quota for user ${userId}:`, error);
      throw error;
    }
  }
}