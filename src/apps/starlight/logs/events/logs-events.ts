/**
 * 日志微服务事件处理器
 * 处理日志相关的事件，包括原始日志处理、配额管理、租户管理等
 */
import { LogsState } from '../types';

/**
 * 日志事件处理器类
 */
export class LogsEventHandlers {
  constructor(private logsState: LogsState) {}

  /**
   * 处理原始日志数据（支持多租户）
   */
  async handleLogsRaw(ctx: any) {
    try {
      const { tenantId, data } = ctx.params;

      // 多租户数据隔离
      const enrichedData = {
        ...data,
        tenantId,
        timestamp: Date.now(),
        serviceId: ctx.service.fullName,
      };

      // 添加到处理队列
      this.logsState.processingQueue.push(enrichedData);

      ctx.service.logger.debug(`Raw logs processed for tenant: ${tenantId}`);
    } catch (error) {
      ctx.service.logger.error('Failed to handle logs.raw event:', error);
    }
  }

  /**
   * 处理配额警告（SaaS化）
   */
  async handleQuotaWarning(ctx: any) {
    try {
      const { tenantId, userId, quotaType, usage, limit } = ctx.params;

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
      this.logsState.cache.quotas.set(warningKey, warningData);

      ctx.service.logger.warn(`Quota warning for tenant: ${tenantId}, user: ${userId}`);
    } catch (error) {
      ctx.service.logger.error('Failed to handle quota.warning event:', error);
    }
  }

  /**
   * 处理配额超限（SaaS化）
   */
  async handleQuotaExceeded(ctx: any) {
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
  }

  /**
   * 处理日志处理完成事件
   */
  async handleLogsProcessed(ctx: any) {
    try {
      const { tenantId, batchId, count } = ctx.params;

      // 更新处理统计（按租户）
      const tenantKey = `tenant:${tenantId}`;
      const currentStats = this.logsState.cache.logs.get(tenantKey) || { ingested: 0 };
      currentStats.ingested += count || 1;
      currentStats.lastIngested = Date.now();
      this.logsState.cache.logs.set(tenantKey, currentStats);

      // 全局统计
      this.logsState.stats.processed += count || 1;
      this.logsState.stats.lastProcessed = Date.now();

      ctx.service.logger.debug(
        `Logs batch processed for tenant: ${tenantId}, batch: ${batchId}`,
      );
    } catch (error) {
      ctx.service.logger.error('Failed to handle logs.processed event:', error);
    }
  }

  /**
   * 获取事件处理器映射
   */
  getEventHandlers() {
    return {
      'logs.raw': {
        handler: this.handleLogsRaw.bind(this),
      },
      'quota.warning': {
        handler: this.handleQuotaWarning.bind(this),
      },
      'quota.exceeded': {
        handler: this.handleQuotaExceeded.bind(this),
      },
      'logs.processed': {
        handler: this.handleLogsProcessed.bind(this),
      },
    };
  }
}

/**
 * 创建日志事件处理器实例
 */
export function createLogsEventHandlers(logsState: LogsState) {
  return new LogsEventHandlers(logsState);
}