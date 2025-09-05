/**
 * 租户管理相关事件处理器
 */
import { MetricsState } from '../types';

/**
 * 租户事件处理器
 */
export default {
  // 处理租户创建事件
  'tenant.created': {
    async handler(ctx: any) {
      try {
        const { tenantId, tenantName, plan } = ctx.params;
        const metricsState: MetricsState = ctx.service.metricsState;

        // 初始化租户指标缓存
        const tenantKey = `tenant:${tenantId}`;
        const tenantData = {
          id: tenantId,
          name: tenantName,
          plan,
          createdAt: Date.now(),
          metrics: {
            processed: 0,
            storage: 0,
            apiCalls: 0,
          },
          quotas: {},
          status: 'active',
        };

        metricsState.cache.metrics.set(tenantKey, tenantData);

        ctx.service.logger.info(`Tenant created: ${tenantId} (${tenantName})`);
      } catch (error) {
        ctx.service.logger.error('Failed to handle tenant.created event:', error);
      }
    },
  },

  // 处理租户删除事件
  'tenant.deleted': {
    async handler(ctx: any) {
      try {
        const { tenantId } = ctx.params;
        const metricsState: MetricsState = ctx.service.metricsState;

        // 清理租户相关缓存
        const tenantKey = `tenant:${tenantId}`;
        metricsState.cache.metrics.delete(tenantKey);

        // 清理租户相关配额缓存
        for (const [key] of metricsState.cache.quotas) {
          if (key.includes(`tenant:${tenantId}`)) {
            metricsState.cache.quotas.delete(key);
          }
        }

        // 清理租户相关聚合缓存
        for (const [key] of metricsState.cache.aggregations) {
          if (key.includes(tenantId)) {
            metricsState.cache.aggregations.delete(key);
          }
        }

        ctx.service.logger.info(`Tenant deleted: ${tenantId}`);
      } catch (error) {
        ctx.service.logger.error('Failed to handle tenant.deleted event:', error);
      }
    },
  },

  // 处理租户状态更新事件
  'tenant.status.updated': {
    async handler(ctx: any) {
      try {
        const { tenantId, status, reason } = ctx.params;
        const metricsState: MetricsState = ctx.service.metricsState;

        // 更新租户状态
        const tenantKey = `tenant:${tenantId}`;
        const tenantData = metricsState.cache.metrics.get(tenantKey);
        if (tenantData) {
          (tenantData as any).status = status;
          (tenantData as any).statusUpdatedAt = Date.now();
          (tenantData as any).statusReason = reason;
          metricsState.cache.metrics.set(tenantKey, tenantData);
        }

        // 如果租户被暂停，停止处理其数据
        if (status === 'suspended') {
          // 清理处理队列中的租户数据
          metricsState.processingQueue = metricsState.processingQueue.filter(
            (batch) => !batch.data.some((item: any) => item.tenantId === tenantId),
          );
        }

        ctx.service.logger.info(`Tenant status updated: ${tenantId} -> ${status}`);
      } catch (error) {
        ctx.service.logger.error('Failed to handle tenant.status.updated event:', error);
      }
    },
  },

  // 处理租户计划更新事件
  'tenant.plan.updated': {
    async handler(ctx: any) {
      try {
        const { tenantId, oldPlan, newPlan } = ctx.params;
        const metricsState: MetricsState = ctx.service.metricsState;

        // 更新租户计划信息
        const tenantKey = `tenant:${tenantId}`;
        const tenantData = metricsState.cache.metrics.get(tenantKey);
        if (tenantData) {
          (tenantData as any).plan = newPlan;
          (tenantData as any).planUpdatedAt = Date.now();
          metricsState.cache.metrics.set(tenantKey, tenantData);
        }

        // 触发配额重新计算
        await ctx.emit('quota.recalculate', {
          tenantId,
          oldPlan,
          newPlan,
        });

        ctx.service.logger.info(
          `Tenant plan updated: ${tenantId} from ${oldPlan} to ${newPlan}`,
        );
      } catch (error) {
        ctx.service.logger.error('Failed to handle tenant.plan.updated event:', error);
      }
    },
  },
};