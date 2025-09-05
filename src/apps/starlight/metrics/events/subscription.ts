/**
 * 订阅管理相关事件处理器
 */
import { MetricsState } from '../types';

/**
 * 订阅事件处理器
 */
export default {
  // 处理订阅创建事件
  'subscription.created': {
    async handler(ctx: any) {
      try {
        const { tenantId, userId, subscriptionId, planId, quotas } = ctx.params;
        const metricsState: MetricsState = ctx.service.metricsState;

        // 初始化订阅相关配额
        if (quotas) {
          for (const [quotaType, limit] of Object.entries(quotas)) {
            const quotaKey = `quota:${tenantId}:${userId}:${quotaType}`;
            const quotaData = {
              tenantId,
              userId,
              subscriptionId,
              quotaType,
              limit,
              usage: 0,
              createdAt: Date.now(),
              resetPeriod: 'monthly', // 默认月度重置
            };
            metricsState.cache.quotas.set(quotaKey, quotaData);
          }
        }

        ctx.service.logger.info(
          `Subscription created: ${subscriptionId} for user: ${userId} in tenant: ${tenantId}`,
        );
      } catch (error) {
        ctx.service.logger.error('Failed to handle subscription.created event:', error);
      }
    },
  },

  // 处理订阅取消事件
  'subscription.cancelled': {
    async handler(ctx: any) {
      try {
        const { tenantId, userId, subscriptionId } = ctx.params;
        const metricsState: MetricsState = ctx.service.metricsState;

        // 清理订阅相关配额
        for (const [key, quota] of metricsState.cache.quotas) {
          if ((quota as any).subscriptionId === subscriptionId) {
            metricsState.cache.quotas.delete(key);
          }
        }

        // 更新用户状态
        const userKey = `user:${tenantId}:${userId}`;
        const userData = metricsState.cache.metrics.get(userKey);
        if (userData) {
          (userData as any).subscriptionStatus = 'cancelled';
          (userData as any).subscriptionCancelledAt = Date.now();
          metricsState.cache.metrics.set(userKey, userData);
        }

        ctx.service.logger.info(
          `Subscription cancelled: ${subscriptionId} for user: ${userId} in tenant: ${tenantId}`,
        );
      } catch (error) {
        ctx.service.logger.error('Failed to handle subscription.cancelled event:', error);
      }
    },
  },

  // 处理订阅升级事件
  'subscription.upgraded': {
    async handler(ctx: any) {
      try {
        const { tenantId, userId, subscriptionId, oldPlanId, newPlanId, newQuotas } = ctx.params;
        const metricsState: MetricsState = ctx.service.metricsState;

        // 更新配额限制
        if (newQuotas) {
          for (const [quotaType, newLimit] of Object.entries(newQuotas)) {
            const quotaKey = `quota:${tenantId}:${userId}:${quotaType}`;
            const existingQuota = metricsState.cache.quotas.get(quotaKey);
            if (existingQuota) {
              (existingQuota as any).limit = newLimit;
              (existingQuota as any).upgradedAt = Date.now();
              (existingQuota as any).oldLimit = (existingQuota as any).limit;
              metricsState.cache.quotas.set(quotaKey, existingQuota);
            }
          }
        }

        // 更新用户订阅信息
        const userKey = `user:${tenantId}:${userId}`;
        const userData = metricsState.cache.metrics.get(userKey);
        if (userData) {
          (userData as any).planId = newPlanId;
          (userData as any).subscriptionUpgradedAt = Date.now();
          metricsState.cache.metrics.set(userKey, userData);
        }

        ctx.service.logger.info(
          `Subscription upgraded: ${subscriptionId} from ${oldPlanId} to ${newPlanId} for user: ${userId}`,
        );
      } catch (error) {
        ctx.service.logger.error('Failed to handle subscription.upgraded event:', error);
      }
    },
  },

  // 处理订阅降级事件
  'subscription.downgraded': {
    async handler(ctx: any) {
      try {
        const { tenantId, userId, subscriptionId, oldPlanId, newPlanId, newQuotas } = ctx.params;
        const metricsState: MetricsState = ctx.service.metricsState;

        // 更新配额限制
        if (newQuotas) {
          for (const [quotaType, newLimit] of Object.entries(newQuotas)) {
            const quotaKey = `quota:${tenantId}:${userId}:${quotaType}`;
            const existingQuota = metricsState.cache.quotas.get(quotaKey);
            if (existingQuota) {
              const currentUsage = (existingQuota as any).usage || 0;
              (existingQuota as any).limit = newLimit;
              (existingQuota as any).downgradedAt = Date.now();
              (existingQuota as any).oldLimit = (existingQuota as any).limit;
              
              // 如果当前使用量超过新限制，发送警告
              if (currentUsage > (newLimit as number)) {
                await ctx.emit('quota.exceeded', {
                  tenantId,
                  userId,
                  quotaType,
                  usage: currentUsage,
                  limit: newLimit,
                });
              }
              
              metricsState.cache.quotas.set(quotaKey, existingQuota);
            }
          }
        }

        // 更新用户订阅信息
        const userKey = `user:${tenantId}:${userId}`;
        const userData = metricsState.cache.metrics.get(userKey);
        if (userData) {
          (userData as any).planId = newPlanId;
          (userData as any).subscriptionDowngradedAt = Date.now();
          metricsState.cache.metrics.set(userKey, userData);
        }

        ctx.service.logger.info(
          `Subscription downgraded: ${subscriptionId} from ${oldPlanId} to ${newPlanId} for user: ${userId}`,
        );
      } catch (error) {
        ctx.service.logger.error('Failed to handle subscription.downgraded event:', error);
      }
    },
  },

  // 处理订阅续费事件
  'subscription.renewed': {
    async handler(ctx: any) {
      try {
        const { tenantId, userId, subscriptionId, renewalDate } = ctx.params;
        const metricsState: MetricsState = ctx.service.metricsState;

        // 重置月度配额（如果是月度订阅）
        for (const [key, quota] of metricsState.cache.quotas) {
          if ((quota as any).tenantId === tenantId && 
              (quota as any).userId === userId && 
              (quota as any).resetPeriod === 'monthly') {
            (quota as any).usage = 0;
            (quota as any).lastReset = Date.now();
            metricsState.cache.quotas.set(key, quota);
          }
        }

        // 更新用户订阅信息
        const userKey = `user:${tenantId}:${userId}`;
        const userData = metricsState.cache.metrics.get(userKey);
        if (userData) {
          (userData as any).subscriptionRenewedAt = Date.now();
          (userData as any).subscriptionExpiresAt = renewalDate;
          metricsState.cache.metrics.set(userKey, userData);
        }

        ctx.service.logger.info(
          `Subscription renewed: ${subscriptionId} for user: ${userId} in tenant: ${tenantId}`,
        );
      } catch (error) {
        ctx.service.logger.error('Failed to handle subscription.renewed event:', error);
      }
    },
  },
};