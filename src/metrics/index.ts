/**
 * 指标数据微服务
 * SaaS化系统监控服务 - 核心数据处理服务
 * 支持多种指标格式：Prometheus、StatsD、DataDog、OTLP、自定义格式
 */
import { pinoLoggerOptions } from '../config';
import { Star } from 'node-universe';
import metricsActions from './actions';
import { DatabaseInitializer } from '../db/mysql';
import { MetricsState, RawMetricsData, ProcessedMetricsData, QuotaWarningParams } from './types';
import {
  APP_NAME,
  DEFAULT_PORT,
  INFLUXDB_URL,
  INFLUXDB_TOKEN,
  INFLUXDB_ORG,
  INFLUXDB_BUCKET,
  KAFKA_BROKERS,
  REDIS_HOST,
  REDIS_PORT,
  REDIS_PASSWORD,
  REDIS_DB,
  METRICS_PORT,
  METRICS_PATH,
  BATCH_SIZE,
  FLUSH_INTERVAL,
  MAX_RETRIES,
  SUPPORTED_FORMATS,
} from './constants';
import { MetricsUtils, InfluxDBHandler, KafkaHandler, DataProcessor, QuotaChecker } from './utils';
import metricsMethod from './methods';

// 全局状态管理
const metricsState: MetricsState = {
  ips: [],
  ipBlackList: [],
  configs: [],
  ipTimer: null,
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
  },
  stats: {
    processed: 0,
    lastProcessed: 0,
  },
};

// 服务初始化函数
async function initializeMetricsService(service: any) {
  try {
    service.logger?.info('Initializing metrics service...');

    // 初始化数据库连接
    await DatabaseInitializer.fullInitialize(service.logger, metricsState, {
      enableSlowQueryLog: true,
      slowQueryThreshold: 1000,
      enableIpBlacklist: false,
      enableIpSyncTimer: false,
    });

    // 初始化InfluxDB连接
    await InfluxDBHandler.initialize(
      {
        url: INFLUXDB_URL,
        token: INFLUXDB_TOKEN,
        org: INFLUXDB_ORG,
        bucket: INFLUXDB_BUCKET,
      },
      service,
    );
    metricsState.influxdbConnected = true;

    // 设置Kafka消费者
    const consumerConfigs = [
      {
        topic: 'metrics-raw',
        groupId: 'metrics-processor',
        handler: async (data: any) => {
          await KafkaHandler.handleRawMetrics(data, service);
        },
      },
      {
        topic: 'quota-warnings',
        groupId: 'quota-processor',
        handler: async (data: any) => {
          await KafkaHandler.handleQuotaWarning(data, service);
        },
      },
    ];

    await KafkaHandler.setupConsumers(consumerConfigs, service, metricsState);
    await KafkaHandler.setupProducer(service);

    // 启动数据处理器
    DataProcessor.start(service, metricsState);

    // 启动配额检查器
    QuotaChecker.start(service);

    // 启动批处理定时器
    metricsState.timers.batchProcessor = setInterval(async () => {
      await processBatchedMetrics(service);
    }, FLUSH_INTERVAL);

    service.logger?.info('Metrics service initialized successfully');
  } catch (error) {
    service.logger?.error('Failed to initialize metrics service:', error);
    throw error;
  }
}

// 批处理指标数据
async function processBatchedMetrics(service: any) {
  try {
    if (metricsState.processingQueue.length === 0) {
      return;
    }

    await DataProcessor.processBatches(service, metricsState);

    metricsState.lastFlushTime = Date.now();
  } catch (error) {
    service.logger?.error('Failed to process batched metrics:', error);
  }
}

// 创建Star实例
const star = new Star({
  namespace: 'darwin-app',
  transporter: {
    type: 'KAFKA',
    debug: true,
    host: KAFKA_BROKERS,
  },
  serializer: {
    type: 'NotePack',
  },
  cacher: {
    type: 'Redis',
    clone: true,
    options: {
      port: REDIS_PORT,
      host: REDIS_HOST,
      password: REDIS_PASSWORD,
      db: REDIS_DB,
    },
  },
  metrics: {
    enabled: true,
    reporter: {
      type: 'Prometheus',
      options: {
        port: METRICS_PORT,
        path: METRICS_PATH,
      },
    },
  },
});

// 创建指标数据处理服务
const metrics = star.createService({
  name: APP_NAME,
  version: 1,

  // 服务设置
  settings: {
    // InfluxDB连接配置
    influxdb: {
      url: INFLUXDB_URL,
      token: INFLUXDB_TOKEN,
      org: INFLUXDB_ORG,
      bucket: INFLUXDB_BUCKET,
    },
    // Kafka配置
    kafka: {
      brokers: KAFKA_BROKERS,
      topics: {
        metricsRaw: 'metrics-raw',
        quotaWarnings: 'quota-warnings',
        metricsProcessed: 'metrics-processed',
      },
    },
    // 处理配置
    processing: {
      batchSize: BATCH_SIZE,
      flushInterval: FLUSH_INTERVAL,
      maxRetries: MAX_RETRIES,
      supportedFormats: SUPPORTED_FORMATS,
    },
  },

  // 服务动作
  actions: metricsActions(star),

  // 服务方法
  methods: metricsMethod(star, metricsState),

  // 生命周期钩子
  async created() {
    this.logger?.info('Metrics service created');

    // 初始化服务状态
    metricsState.timers = {
      dataProcessor: null,
      quotaChecker: null,
      batchProcessor: null,
    };

    this.logger?.info('Metrics service state initialized');
  },

  async started() {
    this.logger?.info('Metrics service starting...');

    try {
      // 初始化指标服务
      await initializeMetricsService(this);

      // 设置Kafka消费者
      if (this.kafka) {
        await this.setupKafkaConsumers(this);
      }

      this.logger?.info('Metrics service started successfully');
    } catch (error) {
      this.logger?.error('Failed to start metrics service:', error);
      throw error;
    }
  },

  async stopped() {
    this.logger?.info('Metrics service stopping...');

    try {
      // 停止定时任务
      Object.values(metricsState.timers).forEach((timer) => {
        if (timer) {
          clearInterval(timer);
        }
      });

      // 停止数据处理器
      DataProcessor.stop(this);

      // 停止配额检查器
      QuotaChecker.stop(this);

      // 关闭Kafka连接
      await KafkaHandler.closeAll(this, metricsState);

      // 关闭InfluxDB连接
      await InfluxDBHandler.close(this);

      // 关闭数据库连接
      if (this.db) {
        await this.db.close();
      }

      // 关闭Redis连接
      if (this.redis) {
        await this.redis.quit();
      }

      // 清理状态
      metricsState.processingQueue.length = 0;
      metricsState.kafkaConsumers.length = 0;
      metricsState.cache.metrics.clear();
      metricsState.cache.quotas.clear();
      metricsState.cache.aggregations.clear();

      this.logger?.info('Metrics service stopped successfully');
    } catch (error) {
      this.logger?.error('Failed to stop metrics service:', error);
    }
  },

  // 事件处理
  events: {
    // 处理原始指标数据
    'metrics.raw': {
      async handler(ctx: any) {
        try {
          const data = ctx.params;
          await star.call('metrics.1.ingestMetrics', data);
          star.logger?.debug(`Raw metrics processed from ${data.source}`);
        } catch (error) {
          star.logger?.error('Failed to handle metrics.raw event:', error);
        }
      },
    },

    // 处理配额警告
    'quota.warning': {
      async handler(ctx: any) {
        try {
          const params = ctx.params;
          await star.call('metrics.1.handleQuotaWarning', params);
          star.logger?.warn(`Quota warning handled for user: ${params.userId}`);
        } catch (error) {
          star.logger?.error('Failed to handle quota.warning event:', error);
        }
      },
    },

    // 处理配额超限
    'quota.exceeded': {
      async handler(ctx: any) {
        try {
          const params = ctx.params;
          // 发送配额超限警告
          await star.emit('quota.alert', {
            ...params,
            severity: 'critical',
            timestamp: Date.now(),
          });
          star.logger?.error(`Quota exceeded handled for user: ${params.userId}`);
        } catch (error) {
          star.logger?.error('Failed to handle quota.exceeded event:', error);
        }
      },
    },

    // 处理指标处理完成事件
    'metrics.processed': {
      async handler(ctx: any) {
        try {
          const data = ctx.params;
          // 更新处理统计
          metricsState.stats.processed += data.count || 1;
          metricsState.stats.lastProcessed = Date.now();
          star.logger?.debug(`Metrics batch processed: ${data.batchId}`);
        } catch (error) {
          star.logger?.error('Failed to handle metrics.processed event:', error);
        }
      },
    },

    // 处理用户创建事件
    'user.created': {
      async handler(ctx: any) {
        try {
          const { userId } = ctx.params;

          // 清理用户相关缓存
          metricsState.cache.quotas.delete(`quota:${userId}`);
          metricsState.cache.metrics.delete(`metrics:${userId}`);

          star.logger?.info(`User quota initialized for: ${userId}`);
        } catch (error) {
          star.logger?.error('Failed to handle user.created event:', error);
        }
      },
    },

    // 处理订阅更新事件
    'subscription.updated': {
      async handler(ctx: any) {
        try {
          const { userId, planId } = ctx.params;

          // 清理相关缓存
          metricsState.cache.quotas.delete(`quota:${userId}`);
          metricsState.cache.metrics.delete(`metrics:${userId}`);

          star.logger?.info(`User quota updated for: ${userId} to plan: ${planId}`);
        } catch (error) {
          star.logger?.error('Failed to handle subscription.updated event:', error);
        }
      },
    },
  },
});

// 导出服务
export default metrics;
