/**
 * 指标数据相关事件处理器
 */
import { MetricsState } from '../types';

/**
 * 指标数据事件处理器
 */
export default {
  // 处理原始指标数据（支持多租户）
  'metrics.raw': {
    async handler(ctx: any) {
      try {
        const { tenantId, data } = ctx.params;
        const metricsState: MetricsState = ctx.service.metricsState;

        // 多租户数据隔离
        const enrichedData = {
          ...data,
          tenantId,
          timestamp: Date.now(),
          serviceId: ctx.service.fullName,
        };

        // 添加到处理队列
        metricsState.processingQueue.push({
          id: `${tenantId}-${Date.now()}`,
          format: data.format || 'custom',
          data: [enrichedData],
          timestamp: Date.now(),
          retryCount: 0,
        });

        ctx.service.logger.debug(`Raw metrics processed for tenant: ${tenantId}`);
      } catch (error) {
        ctx.service.logger.error('Failed to handle metrics.raw event:', error);
      }
    },
  },

  // 处理指标处理完成事件
  'metrics-processed': {
    async handler(ctx: any) {
      try {
        const { tenantId, batchId, count } = ctx.params;
        const metricsState: MetricsState = ctx.service.metricsState;

        // 更新处理统计（按租户）
        const tenantKey = `tenant:${tenantId}`;
        const currentStats = metricsState.cache.metrics.get(tenantKey) || { processed: 0 };
        currentStats.processed += count || 1;
        currentStats.lastProcessed = Date.now();
        metricsState.cache.metrics.set(tenantKey, currentStats);

        // 全局统计
        metricsState.stats.processed += count || 1;
        metricsState.stats.lastProcessed = Date.now();

        ctx.service.logger.debug(
          `Metrics batch processed for tenant: ${tenantId}, batch: ${batchId}`,
        );
      } catch (error) {
        ctx.service.logger.error('Failed to handle metrics.processed event:', error);
      }
    },
  },

  // 处理指标聚合事件
  'metrics.aggregate': {
    async handler(ctx: any) {
      try {
        const { tenantId, timeRange, aggregationType } = ctx.params;
        const metricsState: MetricsState = ctx.service.metricsState;

        // 执行聚合逻辑
        const aggregationKey = `agg:${tenantId}:${timeRange}:${aggregationType}`;
        const aggregationResult = {
          tenantId,
          timeRange,
          aggregationType,
          result: {}, // 实际聚合结果
          timestamp: Date.now(),
        };

        // 缓存聚合结果
        metricsState.cache.aggregations.set(aggregationKey, aggregationResult);

        ctx.service.logger.debug(
          `Metrics aggregated for tenant: ${tenantId}, type: ${aggregationType}`,
        );
      } catch (error) {
        ctx.service.logger.error('Failed to handle metrics.aggregate event:', error);
      }
    },
  },

  // 处理系统指标上报事件 (node-universe metrics reporter)
  'metrics.report': {
    async handler(ctx: any) {
      try {
        const { nodeID, metrics } = ctx.params;
        const metricsState: MetricsState = ctx.service.metricsState;

        if (!metrics || !Array.isArray(metrics)) {
          return;
        }

        // 转换系统指标为统一格式
        const enrichedData = metrics.map((metric: any) => ({
          measurement: metric.name,
          tags: {
            nodeID,
            type: metric.type,
            unit: metric.unit,
            ...metric.tags,
          },
          fields: {
            value: metric.value,
          },
          timestamp: Date.now(),
          tenantId: 'system', // 系统级指标归类为 system 租户
          serviceId: ctx.service.fullName,
        }));

        // 添加到处理队列
        metricsState.processingQueue.push({
          id: `system-${nodeID}-${Date.now()}`,
          format: 'system',
          data: enrichedData,
          timestamp: Date.now(),
          retryCount: 0,
        });

        ctx.service.logger.debug(`System metrics received from node: ${nodeID}`);
      } catch (error) {
        ctx.service.logger.error('Failed to handle metrics.report event:', error);
      }
    },
  },
};
