/**
 * 配额管理相关事件处理器
 */
import { MetricsState } from '../types';

/**
 * 配额事件处理器
 */
export default {
  // 处理配额警告（SaaS化）
  'quota.warning': {
    async handler(ctx: any) {
      try {
        const { tenantId, userId, quotaType, usage, limit } = ctx.params;
        const metricsState: MetricsState = ctx.service.metricsState;

        // 处理配额警告逻辑
        const warningData = {
          tenantId,
          userId,
          quotaType,
          usage,
          limit,
          severity: 'warning',
          timestamp: Date.now(),
        };

        // 缓存警告信息
        const warningKey = `warning:${tenantId}:${userId}:${quotaType}`;
        metricsState.cache.quotas.set(warningKey, warningData);

        ctx.service.logger.warn(`Quota warning for tenant: ${tenantId}, user: ${userId}`);
      } catch (error) {
        ctx.service.logger.error('Failed to handle quota.warning event:', error);
      }
    },
  },

  // 处理配额超限（SaaS化）
  'quota.exceeded': {
    async handler(ctx: any) {
      try {
        const { tenantId, userId, quotaType } = ctx.params;

        // 发送配额超限警告
        await ctx.emit('quota.alert', {
          tenantId,
          userId,
          quotaType,
          severity: 'critical',
          timestamp: Date.now(),
          action: 'throttle', // 限流处理
        });

        ctx.service.logger.error(`Quota exceeded for tenant: ${tenantId}, user: ${userId}`);
      } catch (error) {
        ctx.service.logger.error('Failed to handle quota.exceeded event:', error);
      }
    },
  },

  // 处理配额重置事件
  'quota.reset': {
    async handler(ctx: any) {
      try {
        const { tenantId, userId, quotaType } = ctx.params;
        const metricsState: MetricsState = ctx.service.metricsState;

        // 重置配额使用量
        const quotaKey = `quota:${tenantId}:${userId}:${quotaType}`;
        const existingQuota = metricsState.cache.quotas.get(quotaKey);
        if (existingQuota) {
          (existingQuota as any).usage = 0;
          (existingQuota as any).resetAt = Date.now();
          metricsState.cache.quotas.set(quotaKey, existingQuota);
        }

        ctx.service.logger.info(
          `Quota reset for tenant: ${tenantId}, user: ${userId}, type: ${quotaType}`,
        );
      } catch (error) {
        ctx.service.logger.error('Failed to handle quota.reset event:', error);
      }
    },
  },

  // 处理配额检查事件
  'quota.check': {
    async handler(ctx: any) {
      try {
        const { tenantId, userId, quotaType, increment = 1 } = ctx.params;
        const metricsState: MetricsState = ctx.service.metricsState;

        // 检查配额使用情况
        const quotaKey = `quota:${tenantId}:${userId}:${quotaType}`;
        const quota = metricsState.cache.quotas.get(quotaKey);
        
        if (quota) {
          const currentUsage = (quota as any).usage || 0;
          const limit = (quota as any).limit || 0;
          const newUsage = currentUsage + increment;

          // 更新使用量
          (quota as any).usage = newUsage;
          (quota as any).lastChecked = Date.now();
          metricsState.cache.quotas.set(quotaKey, quota);

          // 检查是否需要发送警告
          const warningThreshold = limit * 0.8; // 80%警告阈值
          if (newUsage >= limit) {
            await ctx.emit('quota.exceeded', { tenantId, userId, quotaType });
          } else if (newUsage >= warningThreshold) {
            await ctx.emit('quota.warning', {
              tenantId,
              userId,
              quotaType,
              usage: newUsage,
              limit,
            });
          }
        }

        ctx.service.logger.debug(
          `Quota checked for tenant: ${tenantId}, user: ${userId}, type: ${quotaType}`,
        );
      } catch (error) {
        ctx.service.logger.error('Failed to handle quota.check event:', error);
      }
    },
  },
};