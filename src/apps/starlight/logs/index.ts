/**
 * 日志微服务
 * SaaS化日志管理服务 - 核心数据处理服务
 * 支持多种日志格式：JSON、文本、Syslog、结构化日志
 */
import { DatabaseService } from 'db/mysql';
import { Star } from 'node-universe';
import { Starlight } from 'typings';
import createActions from './actions';
import { APP_NAME } from './constants';
import { LogsState } from './types/index';
import { elasticsearchManager } from './utils/elasticsearch-manager';

// 服务状态管理
const logsState: LogsState = {
  ips: [],
  elasticsearchConnected: false,
  kafkaConsumers: [],
  processingQueue: [],
  lastFlushTime: 0,
  timers: {
    dataProcessor: null,
    batchProcessor: null,
    quotaChecker: null,
  },
  cache: {
    logs: new Map(),
    quotas: new Map(),
    searches: new Map(),
    lastCacheUpdate: 0,
  },
  stats: {
    processed: 0,
    lastProcessed: 0,
  },
};

// 批处理日志数据
async function processBatchedLogs() {
  if (logsState.processingQueue.length === 0) return;

  // 处理批量日志数据逻辑
  logsState.stats.processed += logsState.processingQueue.length;
  logsState.processingQueue = [];
  logsState.lastFlushTime = Date.now();
}

// 创建并配置日志处理微服务
function createLogsService() {
  // 创建Star实例
  const star = new Star({
    namespace: 'darwin-app',
    nodeID: `logs-${process.env.NODE_ENV || 'development'}-${Date.now()}`,
    transporter: {
      type: 'Kafka',
      options: {
        kafka: {
          brokers: ['localhost:9092'],
          clientId: 'logs-service',
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
          db: 1,
          retryDelayOnFailover: 100,
          maxRetriesPerRequest: 3,
        },
        prefix: 'logs:',
        ttl: 3600, // 1小时缓存
      },
    },
    logger: true,
    metrics: {
      enabled: true,
      reporter: {
        type: 'Event',
        options: {
          eventName: 'logs.metrics.report',
          interval: 5000,
        },
      },
    },
  }) as Starlight;

  // 创建日志处理服务
  const logsService = star.createService({
    name: APP_NAME,
    version: 1,

    // SaaS化配置
    settings: {
      // 多租户支持
      multiTenant: true,
      tenantIdField: 'tenantId',

      // Elasticsearch连接配置
      elasticsearch: {
        node: 'http://localhost:9200',
        auth: {
          username: 'elastic',
          password: 'changeme',
        },
        maxRetries: 3,
        requestTimeout: 30000,
        sniffOnStart: true,
      },

      // Kafka主题配置
      kafka: {
        topics: {
          logsRaw: 'logs-raw',
          quotaWarnings: 'quota-warnings',
          logsProcessed: 'logs-processed',
          tenantEvents: 'tenant-events',
        },
        consumerGroups: {
          logsProcessor: 'logs-processor-group',
          quotaProcessor: 'quota-processor-group',
        },
      },

      // 处理配置
      processing: {
        batchSize: 100,
        flushInterval: 5000,
        maxRetries: 3,
        supportedFormats: ['json', 'text', 'syslog', 'csv'],
        maxConcurrentBatches: 5,
      },

      // SaaS配额配置
      quotas: {
        defaultLimits: {
          logsPerDay: 10000,
          searchesPerDay: 1000,
          exportsPerDay: 10,
          maxStorageGB: 5,
          maxStreamConnections: 10,
        },
        checkInterval: 60000, // 1分钟检查一次
      },

      // 流式传输配置
      streaming: {
        heartbeatInterval: 30000,
        connectionTimeout: 300000,
        maxConnections: 1000,
      },
    },

    // 生命周期钩子
    async created() {
      this.logger.info('Logs service created');

      // 在 created 生命周期中手动初始化数据库连接
      const databaseService = new DatabaseService(star, APP_NAME);
      star.db = databaseService;

      // 初始化服务状态
      logsState.serviceId = this.fullName;
      logsState.startTime = Date.now();

      this.logger.info('Logs service state initialized');
    },

    async started() {
      this.logger.info('Starting logs service...');

      try {
        // 初始化数据库连接
        await star.db.simpleInitialize();

        // 初始化Elasticsearch连接
        await elasticsearchManager.initialize({
          node: this.settings.elasticsearch.node,
          password: this.settings.elasticsearch.auth?.password,
          username: this.settings.elasticsearch.auth?.username,
        });
        logsState.elasticsearchConnected = true;
        this.logger.info('Elasticsearch connection initialized');

        // 启动处理器（示例实现）
        this.logger.info('Starting log processors...');

        // 启动批处理定时器
        const batchInterval = setInterval(
          processBatchedLogs,
          this.settings.processing.flushInterval,
        );

        // 存储定时器引用以便清理
        logsState.timers = {
          dataProcessor: null,
          batchProcessor: batchInterval,
          quotaChecker: null,
        };

        this.logger.info('Logs service started successfully');
      } catch (error) {
        this.logger.error('Failed to start logs service:', error);
        throw error;
      }
    },

    async stopped() {
      this.logger.info('Stopping logs service...');

      try {
        // 停止定时任务
        if (logsState.timers.batchProcessor) {
          clearInterval(logsState.timers.batchProcessor);
        }
        if (logsState.timers.quotaChecker) {
          clearInterval(logsState.timers.quotaChecker);
        }

        // 关闭Elasticsearch连接
        await elasticsearchManager.close();

        // 清理数据库连接
        if (star.db) {
          await star.db.cleanup();
        }

        // 清理状态
        logsState.processingQueue = [];
        logsState.kafkaConsumers = [];
        logsState.cache.logs.clear();
        logsState.cache.quotas.clear();
        logsState.cache.searches.clear();

        this.logger.info('Logs service stopped successfully');
      } catch (error) {
        this.logger.error('Failed to stop logs service:', error);
      }
    },

    // SaaS化事件处理
    events: {
      // 处理原始日志数据（支持多租户）
      'logs.raw': {
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
            logsState.processingQueue.push(enrichedData);

            ctx.service.logger.debug(`Raw logs processed for tenant: ${tenantId}`);
          } catch (error) {
            ctx.service.logger.error('Failed to handle logs.raw event:', error);
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
            logsState.cache.quotas.set(warningKey, warningData);

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

      // 处理日志处理完成事件
      'logs.processed': {
        async handler(ctx: any) {
          try {
            const { tenantId, batchId, count } = ctx.params;

            // 更新处理统计（按租户）
            const tenantKey = `tenant:${tenantId}`;
            const currentStats = logsState.cache.logs.get(tenantKey) || { ingested: 0 };
            currentStats.ingested += count || 1;
            currentStats.lastIngested = Date.now();
            logsState.cache.logs.set(tenantKey, currentStats);

            // 全局统计
            logsState.stats.processed += count || 1;
            logsState.stats.lastProcessed = Date.now();

            ctx.service.logger.debug(
              `Logs batch processed for tenant: ${tenantId}, batch: ${batchId}`,
            );
          } catch (error) {
            ctx.service.logger.error('Failed to handle logs.processed event:', error);
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
            logsState.cache.quotas.set(quotaKey, {
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
            logsState.cache.quotas.delete(`quota:${tenantId}:${userId}`);
            logsState.cache.logs.delete(`logs:${tenantId}:${userId}`);
            logsState.cache.searches.delete(`searches:${tenantId}:${userId}`);

            ctx.service.logger.info(`User cache cleared for tenant: ${tenantId}, user: ${userId}`);
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
            const existingQuota = logsState.cache.quotas.get(quotaKey);
            if (existingQuota) {
              (existingQuota as any).planId = planId;
              (existingQuota as any).updatedAt = Date.now();
              logsState.cache.quotas.set(quotaKey, existingQuota);
            }

            // 清理相关缓存
            logsState.cache.logs.delete(`logs:${tenantId}:${userId}`);
            logsState.cache.searches.delete(`searches:${tenantId}:${userId}`);

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
            for (const [key] of logsState.cache.logs) {
              if (key.startsWith(`tenant:${tenantId}`) || key.includes(`:${tenantId}:`)) {
                logsState.cache.logs.delete(key);
              }
            }

            for (const [key] of logsState.cache.quotas) {
              if (key.includes(`:${tenantId}:`)) {
                logsState.cache.quotas.delete(key);
              }
            }

            for (const [key] of logsState.cache.searches) {
              if (key.includes(`:${tenantId}:`)) {
                logsState.cache.searches.delete(key);
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

  return { star, logsService };
}

// 启动服务
async function startLogsService() {
  try {
    const { star, logsService } = createLogsService();

    // 启动微服务
    await star.start();

    star.logger?.info(`Logs service ${APP_NAME} started successfully`);

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

    return { star, logsService };
  } catch (error) {
    console.error('Failed to start logs service:', error);
    process.exit(1);
  }
}

// 导出服务和启动函数
export { createLogsService, startLogsService };
export default startLogsService;

// 如果直接运行此文件，则启动服务
if (require.main === module) {
  startLogsService();
}
