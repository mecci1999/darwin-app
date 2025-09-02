/**
 * 订阅微服务事件处理器
 * 处理订阅相关的各种事件
 */
import { Context } from 'node-universe';
import { Starlight } from 'typings';
import { SubscriptionState } from '../types';

/**
 * 创建订阅微服务的事件处理器
 */
export function createEvents(star: Starlight, subscriptionState: SubscriptionState) {
  return {
    // 处理订阅创建事件
    'subscription.created': {
      async handler(ctx: Context) {
        try {
          const { tenantId, userId, planId, subscriptionId } = ctx.params;

          // 更新订阅缓存
          const subscriptionKey = `subscription:${tenantId}:${userId}`;
          subscriptionState.cache.subscriptions.set(subscriptionKey, {
            id: subscriptionId,
            userId,
            planId,
            status: 'active',
            startDate: new Date(),
            endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30天后
            nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            autoRenew: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          // 发送配额更新事件
          await ctx.emit('quota.updated', {
            tenantId,
            userId,
            planId,
            action: 'activate',
          });

          ctx.service?.logger?.info(
            `Subscription created for tenant: ${tenantId}, user: ${userId}`,
          );
        } catch (error) {
          ctx.service?.logger?.error('Failed to handle subscription.created event:', error);
        }
      },
    },

    // 处理订阅更新事件
    'subscription.updated': {
      async handler(ctx: Context) {
        try {
          const { tenantId, userId, planId, oldPlanId, subscriptionId } = ctx.params;

          // 更新订阅缓存
          const subscriptionKey = `subscription:${tenantId}:${userId}`;
          subscriptionState.cache.subscriptions.set(subscriptionKey, {
            id: subscriptionId,
            userId,
            planId,
            status: 'active',
            startDate: new Date(),
            endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            autoRenew: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          // 处理计划变更
          await ctx.call('subscription.1.handlePlanChange', {
            tenantId,
            userId,
            planId,
            oldPlanId,
            subscriptionId,
          });

          // 发送配额更新事件
          await ctx.emit('quota.updated', {
            tenantId,
            userId,
            planId,
            oldPlanId,
            action: 'update',
          });

          ctx.service?.logger?.info(
            `Subscription updated for tenant: ${tenantId}, user: ${userId}`,
          );
        } catch (error) {
          ctx.service?.logger?.error('Failed to handle subscription.updated event:', error);
        }
      },
    },

    // 处理订阅取消事件
    'subscription.cancelled': {
      async handler(ctx: Context) {
        try {
          const { tenantId, userId, subscriptionId, reason } = ctx.params;

          // 更新订阅状态
          const subscriptionKey = `subscription:${tenantId}:${userId}`;
          const subscription = subscriptionState.cache.subscriptions.get(subscriptionKey);
          if (subscription) {
            subscription.status = 'cancelled';
            (subscription as any).cancelledAt = Date.now();
            (subscription as any).cancelReason = reason;
            subscriptionState.cache.subscriptions.set(subscriptionKey, subscription);
          }

          // 处理取消逻辑
          await ctx.call('subscription.1.handleCancellation', {
            tenantId,
            userId,
            subscriptionId,
            reason,
          });

          // 发送配额更新事件
          await ctx.emit('quota.updated', {
            tenantId,
            userId,
            action: 'deactivate',
          });

          ctx.service?.logger?.info(
            `Subscription cancelled for tenant: ${tenantId}, user: ${userId}`,
          );
        } catch (error) {
          ctx.service?.logger?.error('Failed to handle subscription.cancelled event:', error);
        }
      },
    },

    // 处理支付成功事件
    'payment.succeeded': {
      async handler(ctx: Context) {
        try {
          const { tenantId, userId, subscriptionId, amount, currency } = ctx.params;

          // 更新收入统计
          subscriptionState.stats.totalRevenue += amount;

          // 处理支付成功逻辑
          await ctx.call('subscription.1.handlePaymentSuccess', {
            tenantId,
            userId,
            subscriptionId,
            amount,
            currency,
            timestamp: Date.now(),
          });

          ctx.service?.logger?.info(
            `Payment succeeded for tenant: ${tenantId}, amount: ${amount} ${currency}`,
          );
        } catch (error) {
          ctx.service?.logger?.error('Failed to handle payment.succeeded event:', error);
        }
      },
    },

    // 处理支付失败事件
    'payment.failed': {
      async handler(ctx: Context) {
        try {
          const { tenantId, userId, subscriptionId, reason } = ctx.params;

          // 处理支付失败逻辑
          await ctx.call('subscription.1.handlePaymentFailure', {
            tenantId,
            userId,
            subscriptionId,
            reason,
            timestamp: Date.now(),
          });

          // 发送警告通知
          await ctx.emit('notification.send', {
            tenantId,
            userId,
            type: 'payment_failed',
            message: `Payment failed for subscription: ${reason}`,
            severity: 'warning',
          });

          ctx.service?.logger?.warn(`Payment failed for tenant: ${tenantId}, reason: ${reason}`);
        } catch (error) {
          ctx.service?.logger?.error('Failed to handle payment.failed event:', error);
        }
      },
    },

    // 处理试用期开始事件
    'trial.started': {
      async handler(ctx: any) {
        try {
          const { tenantId, userId, planId, trialEndDate } = ctx.params;

          // 设置试用期配额
          await ctx.call('subscription.1.setupTrialQuota', {
            tenantId,
            userId,
            planId,
            trialEndDate,
          });

          ctx.service.logger.info(`Trial started for tenant: ${tenantId}, user: ${userId}`);
        } catch (error) {
          ctx.service.logger.error('Failed to handle trial.started event:', error);
        }
      },
    },

    // 处理试用期结束事件
    'trial.ended': {
      async handler(ctx: any) {
        try {
          const { tenantId, userId, converted } = ctx.params;

          if (!converted) {
            // 试用期结束但未转换为付费用户
            await ctx.call('subscription.1.handleTrialExpiry', {
              tenantId,
              userId,
            });

            // 发送转换提醒
            await ctx.emit('notification.send', {
              tenantId,
              userId,
              type: 'trial_expired',
              message:
                'Your trial period has ended. Please upgrade to continue using our service.',
              severity: 'info',
            });
          }

          ctx.service.logger.info(
            `Trial ended for tenant: ${tenantId}, user: ${userId}, converted: ${converted}`,
          );
        } catch (error) {
          ctx.service.logger.error('Failed to handle trial.ended event:', error);
        }
      },
    },

    // 处理租户删除事件
    'tenant.deleted': {
      async handler(ctx: any) {
        try {
          const { tenantId } = ctx.params;

          // 清理租户相关订阅数据
          await ctx.call('subscription.1.cleanupTenantSubscriptions', { tenantId });

          // 清理缓存
          for (const [key] of subscriptionState.cache.subscriptions) {
            if (key.includes(`:${tenantId}:`)) {
              subscriptionState.cache.subscriptions.delete(key);
            }
          }

          ctx.service.logger.info(`Tenant subscription data cleaned up: ${tenantId}`);
        } catch (error) {
          ctx.service.logger.error('Failed to handle tenant.deleted event:', error);
        }
      },
    },
  };
}