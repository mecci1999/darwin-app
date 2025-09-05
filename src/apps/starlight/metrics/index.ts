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
import events from './events';
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

    // 事件处理器（从events目录导入）
    events,

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
