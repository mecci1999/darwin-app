/**
 * 日志微服务
 * SaaS化日志管理服务 - 核心数据处理服务
 * 支持多种日志格式：JSON、文本、Syslog、结构化日志
 */
import { DatabaseService } from 'db/mysql';
import { DEFAULT_LOG_CATEGORY_ENABLED, isTransportDebugEnabled } from 'config';
import { Star } from 'node-universe';
import { Starlight } from 'typings';
import '../../../utils/loadEnv';
import createActions from './actions';
import {
  APP_NAME,
  ELASTICSEARCH_MAX_RETRIES,
  ELASTICSEARCH_PASSWORD,
  ELASTICSEARCH_REQUEST_TIMEOUT,
  ELASTICSEARCH_URL,
  ELASTICSEARCH_USERNAME,
  KAFKA_BROKERS,
  KAFKA_CLIENT_ID,
  KAFKA_PASSWORD,
  KAFKA_USER,
  REDIS_DB,
  REDIS_HOST,
  REDIS_PASSWORD,
  REDIS_PORT,
} from './constants';
import { createEventHandlersManager } from './events';
import { LogsState } from './types/index';
import {
  createDarwinLogCaptureMiddleware,
  publishDarwinLogToGateway,
  startDarwinLogCapture,
  stopDarwinLogCapture,
} from './utils/darwin-log-capture';
import { elasticsearchManager } from './utils/elasticsearch-manager';
import { summarizeElasticsearchError } from './utils/elasticsearch';

// 加载环境变量

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
        consumer: {
          'fetch.min.bytes': 1,
          'fetch.wait.max.ms': 100,
        },
        sasl:
          KAFKA_USER && KAFKA_PASSWORD
            ? {
                mechanism: 'plain',
                username: KAFKA_USER,
                password: KAFKA_PASSWORD,
              }
            : undefined,
        ssl: false,
        groupId: `${KAFKA_CLIENT_ID}-group-${process.env.NODE_ENV === 'development' ? Math.floor(Math.random() * 100000) : 'prod'}`,
        clientId: KAFKA_CLIENT_ID,
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
        prefix: 'logs:',
        ttl: 3600, // 1小时缓存
      },
    },
    logger: {
      type: 'Console',
      options: {
        level: 'info',
        categories: DEFAULT_LOG_CATEGORY_ENABLED,
      },
    },
    middlewares: [createDarwinLogCaptureMiddleware()],
    metrics: {
      enabled: true,
      reporter: {
        type: 'Event'
      }
    },
  }) as Starlight;

  // 创建日志处理服务
  const logsService = star.createService({
    name: APP_NAME,
    // version: '1',

    // SaaS化配置
    settings: {
      // 多租户支持
      multiTenant: true,
      tenantIdField: 'tenantId',

      // Elasticsearch连接配置
      elasticsearch: {
        node: ELASTICSEARCH_URL,
        auth: {
          username: ELASTICSEARCH_USERNAME,
          password: ELASTICSEARCH_PASSWORD,
        },
        maxRetries: ELASTICSEARCH_MAX_RETRIES,
        requestTimeout: ELASTICSEARCH_REQUEST_TIMEOUT,
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

        const elasticsearchConfig = {
          node: this.settings.elasticsearch.node,
          password: this.settings.elasticsearch.auth?.password,
          username: this.settings.elasticsearch.auth?.username,
        };

        // Elasticsearch 是日志存储后端，但开发环境里容器可能还在恢复或磁盘水位保护中。
        // 这里允许服务先启动，Darwin 日志会落到 fallback 文件，ES 恢复后再重放。
        try {
          await elasticsearchManager.initialize(elasticsearchConfig);
          logsState.elasticsearchConnected = true;
          this.logger.info('Elasticsearch connection initialized');
        } catch (error) {
          elasticsearchManager.configure(elasticsearchConfig);
          logsState.elasticsearchConnected = false;
          this.logger.warn('Elasticsearch unavailable on startup; logs service will run with fallback storage', summarizeElasticsearchError(error));
        }

        startDarwinLogCapture({
          onBroadcast: (log) => {
            void publishDarwinLogToGateway(star, log)
          },
        });

        // 启动处理器（示例实现）
        this.logger.info('Starting log processors...');

        // 启动批处理定时器
        const batchInterval = setInterval(
          processBatchedLogs,
          this.settings.processing.flushInterval,
        );
        const elasticsearchReconnectInterval = setInterval(async () => {
          if (logsState.elasticsearchConnected) return;
          const connected = await elasticsearchManager.ensureConnected();
          if (connected) {
            logsState.elasticsearchConnected = true;
            this.logger.info('Elasticsearch connection restored');
          }
        }, 30000);

        // 存储定时器引用以便清理
        logsState.timers = {
          dataProcessor: null,
          batchProcessor: batchInterval,
          quotaChecker: null,
          elasticsearchReconnect: elasticsearchReconnectInterval,
          diskMonitor: elasticsearchManager.startDiskMonitor(),
        };

        this.logger.info('Logs service started successfully');
      } catch (error) {
        this.logger.error('Failed to start logs service:', summarizeElasticsearchError(error));
        throw error;
      }
    },

    async stopped() {
      this.logger.info('Stopping logs service...');

      try {
        // 停止定时任务
        await stopDarwinLogCapture();
        if (logsState.timers.batchProcessor) {
          clearInterval(logsState.timers.batchProcessor);
        }
        if (logsState.timers.quotaChecker) {
          clearInterval(logsState.timers.quotaChecker);
        }
        if (logsState.timers.elasticsearchReconnect) {
          clearInterval(logsState.timers.elasticsearchReconnect);
        }
        if (logsState.timers.diskMonitor) {
          clearInterval(logsState.timers.diskMonitor);
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

    // 事件处理器（使用重构后的事件系统）
    events: (() => {
      const eventHandlersManager = createEventHandlersManager(logsState);
      return eventHandlersManager.getAllEventHandlers();
    })(),

    // Actions（API接口）
    actions: createActions(star),

    methods: {},
  });

  return { star, logsService };
}

// 启动服务
async function startLogsService() {
  try {
    const { star, logsService } = createLogsService();

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

    return { star, logsService };
  } catch (error) {
    console.error('Failed to start logs service:', summarizeElasticsearchError(error));
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
