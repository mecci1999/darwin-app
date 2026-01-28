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
  /*
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

          if (currentUsage + increment > limit) {
            // 触发配额超限事件
            await ctx.emit('quota.exceeded', { tenantId, userId, quotaType });
          }
        }
      } catch (error) {
        ctx.service.logger.error('Failed to handle quota.check event:', error);
      }
    },
  },
  */

  // 处理指标使用量更新
  'metrics.usage.update': {
    async handler(ctx: any) {
      try {
        const { userId, count } = ctx.params;
        const metricsState: MetricsState = ctx.service.metricsState;

        // 更新内存中的配额缓存
        const cacheKey = `usage:${userId}`;
        const current = metricsState.cache.quotas.get(cacheKey) || { count: 0 };
        (current as any).count = ((current as any).count || 0) + count;
        (current as any).updatedAt = Date.now();
        metricsState.cache.quotas.set(cacheKey, current);
      } catch (error) {
        ctx.service.logger.error('Failed to handle metrics.usage.update:', error);
      }
    },
  },
};
