/**
 * 订阅管理微服务
 * SaaS化订阅计划管理服务 - 支持多租户订阅管理
 * 功能：订阅计划管理、配额控制、计费集成、升级降级
 */
import { DatabaseService } from 'db/mysql';
import { isTransportDebugEnabled } from 'config';
import { Context, Star } from 'node-universe';
import { Starlight } from 'typings';
import { registerDarwinLogForwarding } from '../logs/utils/darwin-log-capture';
import { installDarwinKafkaRecoveryLifecycle } from 'core/kafka-recovery-lifecycle';
import { createKafkaConsumerOptions, createServiceMetricsOptions, stabilizeNodeUniverseInstanceId } from 'core/runtime-observability';
import '../../../utils/loadEnv';
import createActions from './actions';
import billingActions from './actions/billing';
import { APP_NAME, KAFKA_CONFIG, REDIS_CONFIG } from './constants';
import { createEvents } from './events';
import { createMethods } from './methods';
import { SubscriptionState } from './types';
import { NotificationHandler } from './utils/notification-handler';
import { PaymentHandler } from './utils/payment-handler';
import { WebhookProcessor } from './utils/webhook-processor';

// 加载环境变量

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
    nodeID: `${APP_NAME}-${process.env.NODE_ENV || 'development'}-${process.env.NODE_INSTANCE_ID || process.env.HOSTNAME || process.pid}`,
    transporter: {
      type: 'KAFKA',
      debug: isTransportDebugEnabled(),
      host: KAFKA_CONFIG.BROKERS.join(','),
      options: {
        producer: {
          'linger.ms': 0,
          'batch.size': 0,
          acks: 1,
        },
        consumer: createKafkaConsumerOptions(),
        sasl:
          KAFKA_CONFIG.USERNAME && KAFKA_CONFIG.PASSWORD
            ? {
                mechanism: 'plain',
                username: KAFKA_CONFIG.USERNAME,
                password: KAFKA_CONFIG.PASSWORD,
              }
            : undefined,
        ssl: false,
        groupId: `${KAFKA_CONFIG.GROUP_ID}-${process.env.NODE_ENV === 'development' ? Math.floor(Math.random() * 100000) : 'prod'}`,
        clientId: KAFKA_CONFIG.CLIENT_ID,
        heartbeatInterval: 3000,
        sessionTimeout: 30000,
        requestTimeout: 60000,
        connectionTimeout: 10000,
      },
    },
    serializer: {
      type: 'NotePack',
    },
    cacher: {
      type: 'Redis',
      options: {
        redis: {
          host: REDIS_CONFIG.HOST,
          port: REDIS_CONFIG.PORT,
          password: REDIS_CONFIG.PASSWORD,
          db: REDIS_CONFIG.DB,
          retryDelayOnFailover: 100,
          maxRetriesPerRequest: 3,
        },
        prefix: 'subscription:',
        ttl: 7200, // 2小时缓存
      },
    },
    logger: true,
    metrics: createServiceMetricsOptions(),
  }) as Starlight;
  stabilizeNodeUniverseInstanceId(star);
  registerDarwinLogForwarding(star);
    installDarwinKafkaRecoveryLifecycle(star);

  // 创建订阅管理服务
  const subscriptionService = star.createService({
    name: APP_NAME,
    // version: '1',

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

      // 绑定内部方法到服务实例
      const methods = createMethods(star as any);
      Object.assign(this, methods);

      this.logger.info('Subscription service state initialized');
    },

    async started() {
      this.logger.info('Starting subscription service...');

      try {
        await star.db.simpleInitialize();
        this.logger.info('Subscription database connection initialized');

        this.logger.info('Starting subscription processors...');

        await PaymentHandler.initialize(star as any, subscriptionState);
        await NotificationHandler.initialize(star as any, subscriptionState);
        await WebhookProcessor.startProcessor(star as any);

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

        await WebhookProcessor.stopProcessor(star as any);
        await PaymentHandler.closeAll(star as any, subscriptionState);
        await NotificationHandler.closeAll(star as any, subscriptionState);

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
    events: createEvents(star, subscriptionState),

    // 方法（仅绑定到服务实例，避免被 schema 计入数量上限）

    // Actions（API接口）
    actions: createActions(star),
  });

  const subscriptionBillingService = star.createService({
    name: 'subscription-billing',
    settings: {
      multiTenant: true,
      tenantIdField: 'tenantId',
    },
    async created() {
      this.logger.info('Subscription billing service created');
      if (!star.db) {
        const databaseService = new DatabaseService(star, 'subscription-billing');
        star.db = databaseService;
      }
      const methods = createMethods(star as any);
      Object.assign(this, methods);
    },
    async started() {
      await star.db.simpleInitialize();
      this.logger.info('Subscription billing service started successfully');
    },
    async stopped() {
      this.logger.info('Subscription billing service stopped successfully');
    },
    actions: billingActions(star),
  });

  return { star, subscriptionService, subscriptionBillingService };
}

// 启动服务
async function startSubscriptionService() {
  try {
    const { star, subscriptionService } = createSubscriptionService();

    // 启动微服务
    await star.start();

    star.logger?.info(`微服务 ${APP_NAME.toUpperCase()} 启动成功`);

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
