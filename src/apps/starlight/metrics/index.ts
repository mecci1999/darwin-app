/**
 * 指标数据微服务
 * SaaS化系统监控服务 - 核心数据处理服务
 * 支持多种指标格式：Prometheus、StatsD、DataDog、OTLP、自定义格式
 */
import dotenv from 'dotenv';
import path from 'path';

// 加载环境变量
const envFile = process.env.NODE_ENV ? `.env.${process.env.NODE_ENV}` : '.env';
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { DatabaseService } from 'db/mysql';
import { isTransportDebugEnabled } from 'config';
import { Star } from 'node-universe';
import { Starlight } from 'typings';
import { registerDarwinLogForwarding } from '../logs/utils/darwin-log-capture';
import { installDarwinKafkaRecoveryLifecycle } from 'core/kafka-recovery-lifecycle';
import createActions from './actions';
import {
  APP_NAME,
  INFLUXDB_BUCKET,
  INFLUXDB_ORG,
  INFLUXDB_TOKEN,
  INFLUXDB_URL,
  KAFKA_BROKERS,
  KAFKA_PASSWORD,
  KAFKA_USER,
  REDIS_DB,
  REDIS_HOST,
  REDIS_PASSWORD,
  REDIS_PORT,
} from './constants';
import { coreEvents, lifecycleEvents } from './events';
import createMethods from './methods';
import { MetricsState } from './types';
import { AlertEngine } from './utils/alert-engine';
import { createServiceReadiness } from 'core/readiness/service-readiness';
import { createKafkaConsumerOptions, createServiceMetricsOptions, stabilizeNodeUniverseInstanceId } from 'core/runtime-observability';
import { enqueueMetricsBatch, takeMetricsFlushBatch } from './utils/processing-queue';

// 服务状态管理
const metricsState: MetricsState = {
  ips: [],
  influxdbConnected: false,
  kafkaConsumers: [],
  processingQueue: [],
  lastFlushTime: 0,
  alertEngine: undefined,
  timers: {
    dataProcessor: null,
    quotaChecker: null,
    batchProcessor: null,
    topologySnapshot: null,
  },
  cache: {
    metrics: new Map(),
    quotas: new Map(),
    aggregations: new Map(),
    topologyObservedEdges: new Map(),
    lastCacheUpdate: 0,
  },
  stats: {
    processed: 0,
    lastProcessed: 0,
  },
};

import { InfluxDBHandler } from './utils/influxdb-handler';

const METRICS_RETRY_MAX_ATTEMPTS = 3;
const METRICS_RETRY_BASE_DELAY_MS = 5_000;
const METRICS_RETRY_MAX_DELAY_MS = 60_000;
let metricsFlushInFlight = false;
let metricsNextFlushAt = 0;
let metricsConsecutiveFlushFailures = 0;

// 批处理指标数据
async function processBatchedMetrics(star: Starlight) {
  if (metricsFlushInFlight || metricsState.processingQueue.length === 0 || Date.now() < metricsNextFlushAt) return;

  const metricsToFlush = takeMetricsFlushBatch(metricsState);
  if (metricsToFlush.length === 0) return;
  metricsFlushInFlight = true;

  try {
    // 写入 InfluxDB
    const flatMetrics = metricsToFlush.flatMap((batch) => batch.data);
    await InfluxDBHandler.writeMetrics(flatMetrics, star);

    metricsState.stats.processed += metricsToFlush.length;
    metricsState.lastFlushTime = Date.now();
    metricsConsecutiveFlushFailures = 0;
    metricsNextFlushAt = 0;
  } catch (error) {
    console.error('Failed to flush metrics:', error);
    metricsConsecutiveFlushFailures += 1;
    const delay = Math.min(
      METRICS_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, metricsConsecutiveFlushFailures - 1),
      METRICS_RETRY_MAX_DELAY_MS,
    );
    metricsNextFlushAt = Date.now() + delay;

    // Retry bounded telemetry at most three times. Do not let an unavailable
    // InfluxDB turn a monitoring service into an unbounded heap consumer.
    let discarded = 0;
    for (const batch of metricsToFlush) {
      if (batch.retryCount >= METRICS_RETRY_MAX_ATTEMPTS) {
        discarded += batch.data.length;
        continue;
      }
      if (!enqueueMetricsBatch(metricsState, { ...batch, retryCount: batch.retryCount + 1 })) {
        discarded += batch.data.length;
      }
    }
    if (discarded > 0) {
      console.warn(`Discarded ${discarded} telemetry points after bounded retry/queue protection`);
    }
  } finally {
    metricsFlushInFlight = false;
  }
}

// 创建并配置指标数据处理微服务
function createMetricsService() {
  // 创建Star实例
  const star = new Star({
    namespace: 'darwin-app',
    nodeID: `${APP_NAME}-${process.env.NODE_ENV || 'development'}-${process.env.NODE_INSTANCE_ID || process.env.HOSTNAME || process.pid}`,
    transporter: {
      type: 'KAFKA',
      debug: isTransportDebugEnabled(),
      host: KAFKA_BROKERS,
      options: {
        producer: {
          'linger.ms': 0,
          'batch.size': 0,
          acks: 1,
        },
        consumer: createKafkaConsumerOptions(),
        sasl:
          KAFKA_USER && KAFKA_PASSWORD
            ? {
                mechanism: 'plain',
                username: KAFKA_USER,
                password: KAFKA_PASSWORD,
              }
            : undefined,
        ssl: false,
        groupId: `metrics-group-${process.env.NODE_ENV === 'development' ? Math.floor(Math.random() * 100000) : 'prod'}`,
        clientId: 'metrics-service',
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
          host: REDIS_HOST,
          port: REDIS_PORT,
          password: REDIS_PASSWORD,
          db: REDIS_DB,
          retryDelayOnFailover: 100,
          maxRetriesPerRequest: 3,
        },
        prefix: 'metrics:',
        ttl: 3600, // 1小时缓存
      },
    },
    logger: true,
    metrics: createServiceMetricsOptions(),
  }) as Starlight;
  stabilizeNodeUniverseInstanceId(star);
  registerDarwinLogForwarding(star);
    installDarwinKafkaRecoveryLifecycle(star);
  const readiness = createServiceReadiness(star, { serviceName: APP_NAME });

  // 创建指标数据处理服务
  const metricsService = star.createService({
    name: APP_NAME,

    // SaaS化配置
    settings: {
      // 多租户支持
      multiTenant: true,
      tenantIdField: 'tenantId',

      // InfluxDB连接配置
      influxdb: {
        url: INFLUXDB_URL,
        token: INFLUXDB_TOKEN,
        org: INFLUXDB_ORG,
        bucket: INFLUXDB_BUCKET,
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

      // 绑定内部方法到服务实例
      const methods = createMethods(star as any, metricsState);
      Object.assign(this, methods);

      // 初始化服务状态
      metricsState.serviceId = this.fullName;
      metricsState.startTime = Date.now();
      metricsState.alertEngine = new AlertEngine(star);
      (this as any).metricsState = metricsState;

      this.logger.info('Metrics service state initialized');
    },

    async started() {
      this.logger.info('Starting metrics service...');

      try {
        // 初始化数据库连接
        await star.db.simpleInitialize();

        // 初始化InfluxDB连接
        await InfluxDBHandler.initialize(this.settings.influxdb, star);
        metricsState.influxdbConnected = true;
        this.logger.info('InfluxDB connection initialized');

        // 启动告警引擎
        await metricsState.alertEngine?.loadRules();
        metricsState.alertEngine?.start();

        // 启动处理器（示例实现）
        this.logger.info('Starting metrics processors...');

        // 启动批处理定时器
        const batchInterval = setInterval(
          () => void processBatchedMetrics(star),
          this.settings.processing.flushInterval,
        );

        // 存储定时器引用以便清理
        metricsState.timers = {
          dataProcessor: null,
          quotaChecker: null,
          batchProcessor: batchInterval,
          topologySnapshot: null,
        };

        this.logger.info('Metrics service started successfully');
        readiness.markStarted();
      } catch (error) {
        this.logger.error('Failed to start metrics service:', error);
        throw error;
      }
    },

    async stopped() {
      readiness.markStopping();
      this.logger.info('Stopping metrics service...');

      try {
        // 停止告警引擎
        metricsState.alertEngine?.stop();

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

    // 事件处理器（核心摄取 / quota / system metrics）
    events: coreEvents,

    methods: {},

    // Actions（API接口）
    actions: createActions(star),
  });

  const metricsLifecycleService = star.createService({
    name: `${APP_NAME}-lifecycle`,

    settings: {
      multiTenant: true,
    },

    async created() {
      this.logger.info('Metrics lifecycle service created');
      (this as any).metricsState = metricsState;
    },

    async started() {
      this.logger.info('Metrics lifecycle service started successfully');
    },

    async stopped() {
      this.logger.info('Metrics lifecycle service stopped');
    },

    events: lifecycleEvents,
  });

  return { star, metricsService, metricsLifecycleService, readiness };
}

// 启动服务
async function startMetricsService() {
  try {
    const { star, metricsService, readiness } = createMetricsService();

    // 启动微服务
    await readiness.start();
    try {
      await star.start();
      star.logger?.info(`微服务 ${APP_NAME.toUpperCase()} 启动成功`);
    } catch (error) {
      await readiness.stop();
      throw error;
    }

    // 优雅关闭处理
    process.on('SIGINT', async () => {
      star.logger?.info('Received SIGINT, shutting down gracefully...');
      await star.stop();
      await readiness.stop();
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
