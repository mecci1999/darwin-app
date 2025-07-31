/**
 * 指标数据微服务
 * SaaS化系统监控服务 - 核心数据处理服务
 * 支持多种指标格式：Prometheus、StatsD、DataDog、OTLP、自定义格式
 */
import { DatabaseService } from 'db/mysql';
import { Star } from 'node-universe';
import { Starlight } from 'typings';
import createActions from './actions';
import { APP_NAME } from './constants';
import { MetricsState } from './types';

// 服务状态管理
const metricsState: MetricsState = {
  ips: [],
  influxdbConnected: false,
  kafkaConsumers: [],
  processingQueue: [],
  lastFlushTime: 0,
  timers: {
    dataProcessor: null,
    quotaChecker: null,
    batchProcessor: null,
  },
  cache: {
    metrics: new Map(),
    quotas: new Map(),
    aggregations: new Map(),
    lastCacheUpdate: 0,
  },
  stats: {
    processed: 0,
    lastProcessed: 0,
  },
};

// 批处理指标数据
async function processBatchedMetrics() {
  if (metricsState.processingQueue.length === 0) return;

  // 处理批量指标数据逻辑
  metricsState.stats.processed += metricsState.processingQueue.length;
  metricsState.processingQueue = [];
  metricsState.lastFlushTime = Date.now();
}

// 创建并配置指标数据处理微服务
function createMetricsService() {
  // 创建Star实例
  const star = new Star({
    namespace: 'darwin-app',
    nodeID: `metrics-${process.env.NODE_ENV || 'development'}-${Date.now()}`,
    transporter: {
      type: 'Kafka',
      options: {
        kafka: {
          brokers: ['localhost:9092'],
          clientId: 'metrics-service',
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
        prefix: 'metrics:',
        ttl: 3600, // 1小时缓存
      },
    },
    logger: true,
    metrics: {
      enabled: true,
      reporter: {
        type: 'Event',
        options: {
          eventName: 'metrics.report',
          interval: 5000,
        },
      },
    },
  }) as Starlight;

  // 创建指标数据处理服务
  const metricsService = star.createService({
    name: APP_NAME,
    version: 1,

    // SaaS化配置
    settings: {
      // 多租户支持
      multiTenant: true,
      tenantIdField: 'tenantId',

      // InfluxDB连接配置
      influxdb: {
        url: 'http://localhost:8086',
        token: 'your-token',
        org: 'your-org',
        bucket: 'metrics',
        timeout: 10000,
        retries: 3,
      },

      // Kafka主题配置
      kafka: {
        topics: {
          metricsRaw: 'metrics-raw',
          quotaWarnings: 'quota-warnings',
          metricsProcessed: 'metrics-processed',
          tenantEvents: 'tenant-events',
        },
        consumerGroups: {
          metricsProcessor: 'metrics-processor-group',
          quotaProcessor: 'quota-processor-group',
        },
      },

      // 处理配置
      processing: {
        batchSize: 100,
        flushInterval: 5000,
        maxRetries: 3,
        supportedFormats: ['prometheus', 'statsd', 'datadog', 'otlp'],
        maxConcurrentBatches: 5,
      },

      // SaaS配额配置
      quotas: {
        defaultLimits: {
          metricsPerMinute: 1000,
          storageGB: 10,
          retentionDays: 30,
        },
        checkInterval: 60000, // 1分钟检查一次
      },
    },

    // 生命周期钩子
    async created() {
      this.logger.info('Metrics service created');

      // 在 created 生命周期中手动初始化数据库连接
      const databaseService = new DatabaseService(star, APP_NAME);
      star.db = databaseService;

      // 初始化服务状态
      metricsState.serviceId = this.fullName;
      metricsState.startTime = Date.now();

      this.logger.info('Metrics service state initialized');
    },

    async started() {
      this.logger.info('Starting metrics service...');

      try {
        // 初始化数据库连接
        await star.db.simpleInitialize();

        // 初始化InfluxDB连接（示例实现）
        metricsState.influxdbConnected = true;
        this.logger.info('InfluxDB connection initialized');

        // 启动处理器（示例实现）
        this.logger.info('Starting metrics processors...');

        // 启动批处理定时器
        const batchInterval = setInterval(
          processBatchedMetrics,
          this.settings.processing.flushInterval,
        );

        // 存储定时器引用以便清理
        metricsState.timers = {
          dataProcessor: null,
          quotaChecker: null,
          batchProcessor: batchInterval,
        };

        this.logger.info('Metrics service started successfully');
      } catch (error) {
        this.logger.error('Failed to start metrics service:', error);
        throw error;
      }
    },

    async stopped() {
      this.logger.info('Stopping metrics service...');

      try {
        // 停止定时任务
        if (metricsState.timers.batchProcessor) {
          clearInterval(metricsState.timers.batchProcessor);
        }

        // 清理数据库连接
        if (star.db) {
          await star.db.cleanup();
        }

        // 清理状态
        metricsState.processingQueue = [];
        metricsState.kafkaConsumers = [];
        metricsState.cache.metrics.clear();
        metricsState.cache.quotas.clear();
        metricsState.cache.aggregations.clear();

        this.logger.info('Metrics service stopped successfully');
      } catch (error) {
        this.logger.error('Failed to stop metrics service:', error);
      }
    },

    // SaaS化事件处理
    events: {
      // 处理原始指标数据（支持多租户）
      'metrics.raw': {
        async handler(ctx: any) {
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
            metricsState.processingQueue.push(enrichedData);

            ctx.service.logger.debug(`Raw metrics processed for tenant: ${tenantId}`);
          } catch (error) {
            ctx.service.logger.error('Failed to handle metrics.raw event:', error);
          }
        },
      },

      // 处理配额警告（SaaS化）
      'quota.warning': {
        async handler(ctx: any) {
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

      // 处理指标处理完成事件
      'metrics.processed': {
        async handler(ctx: any) {
          try {
            const { tenantId, batchId, count } = ctx.params;

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

      // 处理租户创建事件
      'tenant.created': {
        async handler(ctx: any) {
          try {
            const { tenantId, planId } = ctx.params;

            // 初始化租户配额
            const quotaKey = `quota:${tenantId}`;
            metricsState.cache.quotas.set(quotaKey, {
              tenantId,
              planId,
              limits: ctx.service.settings.quotas.defaultLimits,
              createdAt: Date.now(),
            });

            ctx.service.logger.info(`Tenant quota initialized: ${tenantId}`);
          } catch (error) {
            ctx.service.logger.error('Failed to handle tenant.created event:', error);
          }
        },
      },

      // 处理用户创建事件（多租户）
      'user.created': {
        async handler(ctx: any) {
          try {
            const { tenantId, userId } = ctx.params;

            // 清理用户相关缓存
            metricsState.cache.quotas.delete(`quota:${tenantId}:${userId}`);
            metricsState.cache.metrics.delete(`metrics:${tenantId}:${userId}`);

            ctx.service.logger.info(
              `User quota initialized for tenant: ${tenantId}, user: ${userId}`,
            );
          } catch (error) {
            ctx.service.logger.error('Failed to handle user.created event:', error);
          }
        },
      },

      // 处理订阅更新事件（SaaS化）
      'subscription.updated': {
        async handler(ctx: any) {
          try {
            const { tenantId, userId, planId, oldPlanId } = ctx.params;

            // 更新租户配额
            const quotaKey = `quota:${tenantId}:${userId}`;
            const existingQuota = metricsState.cache.quotas.get(quotaKey);
            if (existingQuota) {
              (existingQuota as any).planId = planId;
              (existingQuota as any).updatedAt = Date.now();
              metricsState.cache.quotas.set(quotaKey, existingQuota);
            }

            // 清理相关缓存
            metricsState.cache.metrics.delete(`metrics:${tenantId}:${userId}`);

            ctx.service.logger.info(
              `Subscription updated for tenant: ${tenantId}, user: ${userId}, plan: ${planId}`,
            );
          } catch (error) {
            ctx.service.logger.error('Failed to handle subscription.updated event:', error);
          }
        },
      },

      // 处理租户删除事件
      'tenant.deleted': {
        async handler(ctx: any) {
          try {
            const { tenantId } = ctx.params;

            // 清理缓存
            for (const [key] of metricsState.cache.metrics) {
              if (key.startsWith(`tenant:${tenantId}`) || key.includes(`:${tenantId}:`)) {
                metricsState.cache.metrics.delete(key);
              }
            }

            for (const [key] of metricsState.cache.quotas) {
              if (key.includes(`:${tenantId}:`)) {
                metricsState.cache.quotas.delete(key);
              }
            }

            ctx.service.logger.info(`Tenant data cleaned up: ${tenantId}`);
          } catch (error) {
            ctx.service.logger.error('Failed to handle tenant.deleted event:', error);
          }
        },
      },
    },

    // Actions（API接口）
    actions: createActions(star),
  });

  return { star, metricsService };
}

// 启动服务
async function startMetricsService() {
  try {
    const { star, metricsService } = createMetricsService();

    // 启动微服务
    await star.start();

    star.logger?.info(`Metrics service ${APP_NAME} started successfully`);

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

    return { star, metricsService };
  } catch (error) {
    console.error('Failed to start metrics service:', error);
    process.exit(1);
  }
}

// 导出服务和启动函数
export { createMetricsService, startMetricsService };
export default startMetricsService;

// 如果直接运行此文件，则启动服务
if (require.main === module) {
  startMetricsService();
}
