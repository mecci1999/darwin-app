/**
 * 租户事件处理器
 * 处理租户生命周期相关的事件，包括创建、删除、订阅更新等
 */
import { LogsState } from '../types';

/**
 * 租户事件处理器类
 */
export class TenantEventHandlers {
  constructor(private logsState: LogsState) {}

  /**
   * 处理租户创建事件
   */
  async handleTenantCreated(ctx: any) {
    try {
      const { tenantId, planId } = ctx.params;

      // 初始化租户配额
      const quotaKey = `quota:${tenantId}`;
      this.logsState.cache.quotas.set(quotaKey, {
        tenantId,
        planId,
        limits: ctx.service.settings.quotas.defaultLimits,
        createdAt: Date.now(),
      });

      ctx.service.logger.info(`Tenant quota initialized: ${tenantId}`);
    } catch (error) {
      ctx.service.logger.error('Failed to handle tenant.created event:', error);
    }
  }

  /**
   * 处理用户创建事件（多租户）
   */
  async handleUserCreated(ctx: any) {
    try {
      const { tenantId, userId } = ctx.params;

      // 清理用户相关缓存
      this.logsState.cache.quotas.delete(`quota:${tenantId}:${userId}`);
      this.logsState.cache.logs.delete(`logs:${tenantId}:${userId}`);
      this.logsState.cache.searches.delete(`searches:${tenantId}:${userId}`);

      ctx.service.logger.info(`User cache cleared for tenant: ${tenantId}, user: ${userId}`);
    } catch (error) {
      ctx.service.logger.error('Failed to handle user.created event:', error);
    }
  }

  /**
   * 处理订阅更新事件（SaaS化）
   */
  async handleSubscriptionUpdated(ctx: any) {
    try {
      const { tenantId, userId, planId, oldPlanId } = ctx.params;

      // 更新租户配额
      const quotaKey = `quota:${tenantId}:${userId}`;
      const existingQuota = this.logsState.cache.quotas.get(quotaKey);
      if (existingQuota) {
        (existingQuota as any).planId = planId;
        (existingQuota as any).updatedAt = Date.now();
        this.logsState.cache.quotas.set(quotaKey, existingQuota);
      }

      // 清理相关缓存
      this.logsState.cache.logs.delete(`logs:${tenantId}:${userId}`);
      this.logsState.cache.searches.delete(`searches:${tenantId}:${userId}`);

      ctx.service.logger.info(
        `Subscription updated for tenant: ${tenantId}, user: ${userId}, plan: ${planId}`,
      );
    } catch (error) {
      ctx.service.logger.error('Failed to handle subscription.updated event:', error);
    }
  }

  /**
   * 处理租户删除事件
   */
  async handleTenantDeleted(ctx: any) {
    try {
      const { tenantId } = ctx.params;

      // 清理缓存
      for (const [key] of this.logsState.cache.logs) {
        if (key.startsWith(`tenant:${tenantId}`) || key.includes(`:${tenantId}:`)) {
          this.logsState.cache.logs.delete(key);
        }
      }

      for (const [key] of this.logsState.cache.quotas) {
        if (key.includes(`:${tenantId}:`)) {
          this.logsState.cache.quotas.delete(key);
        }
      }

      for (const [key] of this.logsState.cache.searches) {
        if (key.includes(`:${tenantId}:`)) {
          this.logsState.cache.searches.delete(key);
        }
      }

      ctx.service.logger.info(`Tenant data cleaned up: ${tenantId}`);
    } catch (error) {
      ctx.service.logger.error('Failed to handle tenant.deleted event:', error);
    }
  }

  /**
   * 获取事件处理器映射
   */
  getEventHandlers() {
    return {
      'tenant.created': {
        handler: this.handleTenantCreated.bind(this),
      },
      'user.created': {
        handler: this.handleUserCreated.bind(this),
      },
      'subscription.updated': {
        handler: this.handleSubscriptionUpdated.bind(this),
      },
      'tenant.deleted': {
        handler: this.handleTenantDeleted.bind(this),
      },
    };
  }
}

/**
 * 创建租户事件处理器实例
 */
export function createTenantEventHandlers(logsState: LogsState) {
  return new TenantEventHandlers(logsState);
}