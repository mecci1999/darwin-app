/**
 * 用户管理相关事件处理器
 */
import { MetricsState } from '../types';

/**
 * 用户事件处理器
 */
export default {
  // 处理用户创建事件
  'user.created': {
    async handler(ctx: any) {
      try {
        const { tenantId, userId, userInfo } = ctx.params;
        const metricsState: MetricsState = ctx.service.metricsState;

        // 初始化用户指标缓存
        const userKey = `user:${tenantId}:${userId}`;
        const userData = {
          tenantId,
          userId,
          userInfo,
          createdAt: Date.now(),
          metrics: {
            apiCalls: 0,
            dataIngested: 0,
            queriesExecuted: 0,
            lastActivity: Date.now(),
          },
          quotas: {},
          status: 'active',
        };

        metricsState.cache.metrics.set(userKey, userData);

        ctx.service.logger.info(`User created: ${userId} in tenant: ${tenantId}`);
      } catch (error) {
        ctx.service.logger.error('Failed to handle user.created event:', error);
      }
    },
  },

  // 处理用户删除事件
  'user.deleted': {
    async handler(ctx: any) {
      try {
        const { tenantId, userId } = ctx.params;
        const metricsState: MetricsState = ctx.service.metricsState;

        // 清理用户相关缓存
        const userKey = `user:${tenantId}:${userId}`;
        metricsState.cache.metrics.delete(userKey);

        // 清理用户相关配额缓存
        for (const [key] of metricsState.cache.quotas) {
          if (key.includes(`${tenantId}:${userId}`)) {
            metricsState.cache.quotas.delete(key);
          }
        }

        ctx.service.logger.info(`User deleted: ${userId} from tenant: ${tenantId}`);
      } catch (error) {
        ctx.service.logger.error('Failed to handle user.deleted event:', error);
      }
    },
  },

  // 处理用户活动事件
  'user.activity': {
    async handler(ctx: any) {
      try {
        const { tenantId, userId, activityType, metadata } = ctx.params;
        const metricsState: MetricsState = ctx.service.metricsState;

        // 更新用户活动指标
        const userKey = `user:${tenantId}:${userId}`;
        const userData = metricsState.cache.metrics.get(userKey);
        if (userData) {
          const metrics = (userData as any).metrics;
          metrics.lastActivity = Date.now();

          // 根据活动类型更新相应指标
          switch (activityType) {
            case 'api_call':
              metrics.apiCalls += 1;
              break;
            case 'data_ingest':
              metrics.dataIngested += metadata?.size || 1;
              break;
            case 'query_execute':
              metrics.queriesExecuted += 1;
              break;
          }

          metricsState.cache.metrics.set(userKey, userData);

          // 触发配额检查
          await ctx.emit('quota.check', {
            tenantId,
            userId,
            quotaType: activityType,
            increment: metadata?.size || 1,
          });
        }

        ctx.service.logger.debug(
          `User activity: ${userId} in tenant: ${tenantId}, type: ${activityType}`,
        );
      } catch (error) {
        ctx.service.logger.error('Failed to handle user.activity event:', error);
      }
    },
  },

  // 处理用户状态更新事件
  'user.status.updated': {
    async handler(ctx: any) {
      try {
        const { tenantId, userId, status, reason } = ctx.params;
        const metricsState: MetricsState = ctx.service.metricsState;

        // 更新用户状态
        const userKey = `user:${tenantId}:${userId}`;
        const userData = metricsState.cache.metrics.get(userKey);
        if (userData) {
          (userData as any).status = status;
          (userData as any).statusUpdatedAt = Date.now();
          (userData as any).statusReason = reason;
          metricsState.cache.metrics.set(userKey, userData);
        }

        // 如果用户被暂停，清理其处理队列中的数据
        if (status === 'suspended') {
          metricsState.processingQueue = metricsState.processingQueue.filter(
            (batch) => !batch.data.some(
              (item: any) => item.tenantId === tenantId && item.metadata?.userId === userId,
            ),
          );
        }

        ctx.service.logger.info(
          `User status updated: ${userId} in tenant: ${tenantId} -> ${status}`,
        );
      } catch (error) {
        ctx.service.logger.error('Failed to handle user.status.updated event:', error);
      }
    },
  },

  // 处理用户配额更新事件
  'user.quota.updated': {
    async handler(ctx: any) {
      try {
        const { tenantId, userId, quotaType, newLimit } = ctx.params;
        const metricsState: MetricsState = ctx.service.metricsState;

        // 更新用户配额
        const quotaKey = `quota:${tenantId}:${userId}:${quotaType}`;
        const existingQuota = metricsState.cache.quotas.get(quotaKey) || {};
        (existingQuota as any).limit = newLimit;
        (existingQuota as any).updatedAt = Date.now();
        metricsState.cache.quotas.set(quotaKey, existingQuota);

        ctx.service.logger.info(
          `User quota updated: ${userId} in tenant: ${tenantId}, type: ${quotaType}, limit: ${newLimit}`,
        );
      } catch (error) {
        ctx.service.logger.error('Failed to handle user.quota.updated event:', error);
      }
    },
  },
};