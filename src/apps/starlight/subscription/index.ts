/**
 * 订阅管理微服务
 * SaaS化订阅计划管理服务 - 支持多租户订阅管理
 * 功能：订阅计划管理、配额控制、计费集成、升级降级
 */
import { DatabaseService } from 'db/mysql';
import { Context, Star } from 'node-universe';
import { Starlight } from 'typings';
import createActions from './actions';
import { APP_NAME } from './constants';
import { SubscriptionState } from './types';

// 服务状态管理
const subscriptionState: SubscriptionState = {
  ips: [],
  configs: [] as any[],
  // 活跃订阅计划映射表
  activePlanMap: new Map(),
  activePlans: new Map(),
  userSubscriptions: new Map(),
  billingQueue: [],
  timers: {},
  // 支付网关连接状态
  paymentGateways: {
    stripe: false,
    paypal: false,
    alipay: false,
  },
  // 通知服务状态
  notificationServices: {
    email: false,
    sms: false,
    push: false,
  },
  // 订阅处理队列
  subscriptionQueue: [],
  // 支付处理队列
  paymentQueue: [],
  cache: {
    plans: new Map(),
    subscriptions: new Map(),
    lastCacheUpdate: 0,
  },
  stats: {
    totalRevenue: 0,
    activeSubscriptions: 0,
    trialUsers: 0,
  },
};

// 批处理计费数据
async function processBillingQueue() {
  if (subscriptionState.billingQueue.length === 0) return;

  // 处理计费队列逻辑
  subscriptionState.stats.totalRevenue += 100; // 示例
}

// 创建并配置订阅管理微服务
function createSubscriptionService() {
  // 创建Star实例
  const star = new Star({
    namespace: 'darwin-app',
    nodeID: `subscription-${process.env.NODE_ENV || 'development'}-${Date.now()}`,
    transporter: {
      type: 'Kafka',
      options: {
        kafka: {
          brokers: ['localhost:9092'],
          clientId: 'subscription-service',
          connectionTimeout: 3000,
          requestTimeout: 30000,
        },
      },
    },
    serializer: {
      type: 'NotePack',
    },
    cacher: {
      type: 'Redis',
      options: {
        redis: {
          host: 'localhost',
          port: 6379,
          db: 0,
          retryDelayOnFailover: 100,
          maxRetriesPerRequest: 3,
        },
        prefix: 'subscription:',
        ttl: 7200, // 2小时缓存
      },
    },
    logger: true,
    metrics: {
      enabled: true,
      reporter: {
        type: 'Event',
        options: {
          eventName: 'subscription.metrics',
          interval: 10000,
        },
      },
    },
  }) as Starlight;

  // 创建订阅管理服务
  const subscriptionService = star.createService({
    name: APP_NAME,
    version: 1,

    // SaaS化配置
    settings: {
      // 多租户支持
      multiTenant: true,
      tenantIdField: 'tenantId',

      // 订阅计划配置
      plans: {
        defaultPlan: 'free',
        trialDuration: 14, // 14天试用
        gracePeriod: 3, // 3天宽限期
      },

      // 计费配置
      billing: {
        currency: 'USD',
        billingCycle: 'monthly',
        prorationEnabled: true,
        invoicePrefix: 'INV-',
      },

      // Kafka主题配置
      kafka: {
        topics: {
          subscriptionEvents: 'subscription-events',
          billingEvents: 'billing-events',
          quotaUpdates: 'quota-updates',
          tenantEvents: 'tenant-events',
        },
        consumerGroups: {
          subscriptionProcessor: 'subscription-processor-group',
          billingProcessor: 'billing-processor-group',
        },
      },

      // 处理配置
      processing: {
        billingBatchSize: 100,
        billingBatchInterval: 3600000, // 1小时
        quotaCheckInterval: 300000, // 5分钟
        planSyncInterval: 86400000, // 24小时
        maxConcurrentBatches: 5,
      },

      // 支付集成配置
      payments: {
        providers: ['stripe', 'paypal'],
        webhookRetries: 3,
        webhookTimeout: 30000,
      },
    },

    // 生命周期钩子
    async created() {
      this.logger.info('Subscription service created');

      // 在 created 生命周期中手动初始化数据库连接
      const databaseService = new DatabaseService(star, APP_NAME);
      star.db = databaseService;

      // 初始化服务状态
      subscriptionState.serviceId = this.fullName;
      subscriptionState.startTime = Date.now();

      this.logger.info('Subscription service state initialized');
    },

    async started() {
      this.logger.info('Starting subscription service...');

      try {
        // 启动处理器（示例实现）
        this.logger.info('Starting subscription processors...');

        // 设置定时任务
        const billingInterval = setInterval(
          processBillingQueue,
          this.settings.processing.billingBatchInterval,
        );

        // 存储定时器引用以便清理
        subscriptionState.timers = {
          billingProcessor: billingInterval,
        };

        this.logger.info('Subscription service started successfully');
      } catch (error) {
        this.logger.error('Failed to start subscription service:', error);
        throw error;
      }
    },

    async stopped() {
      this.logger.info('Stopping subscription service...');

      try {
        // 停止定时任务
        if (subscriptionState.timers.billingProcessor) {
          clearInterval(subscriptionState.timers.billingProcessor);
        }

        // 清理数据库连接
        if (star.db) {
          await star.db.cleanup();
        }

        // 清理状态
        subscriptionState.billingQueue = [];
        subscriptionState.activePlans.clear();
        subscriptionState.userSubscriptions.clear();
        subscriptionState.cache.plans.clear();
        subscriptionState.cache.subscriptions.clear();

        this.logger.info('Subscription service stopped successfully');
      } catch (error) {
        this.logger.error('Failed to stop subscription service:', error);
      }
    },

    // SaaS化事件处理
    events: {
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
    },

    // Actions（API接口）
    actions: createActions(star),
  });

  return { star, subscriptionService };
}

// 启动服务
async function startSubscriptionService() {
  try {
    const { star, subscriptionService } = createSubscriptionService();

    // 启动微服务
    await star.start();

    star.logger?.info(`Subscription service ${APP_NAME} started successfully`);

    // 优雅关闭处理
    process.on('SIGINT', async () => {
      star.logger?.info('Received SIGINT, shutting down gracefully...');
      await star.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      star.logger?.info('Received SIGTERM, shutting down gracefully...');
      await star.stop();
      process.exit(0);
    });

    return { star, subscriptionService };
  } catch (error) {
    console.error('Failed to start subscription service:', error);
    process.exit(1);
  }
}

// 导出服务和启动函数
export { createSubscriptionService, startSubscriptionService };
export default startSubscriptionService;

// 如果直接运行此文件，则启动服务
if (require.main === module) {
  startSubscriptionService();
}
