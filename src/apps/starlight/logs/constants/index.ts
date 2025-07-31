/**
 * 日志微服务常量定义
 */

// 应用配置
export const APP_NAME = 'logs';
export const DEFAULT_PORT = 6668;

// Elasticsearch配置
export const ELASTICSEARCH_URL = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
export const ELASTICSEARCH_USERNAME = process.env.ELASTICSEARCH_USERNAME || 'elastic';
export const ELASTICSEARCH_PASSWORD = process.env.ELASTICSEARCH_PASSWORD || 'changeme';
export const ELASTICSEARCH_INDEX_PREFIX = process.env.ELASTICSEARCH_INDEX_PREFIX || 'logs';
export const ELASTICSEARCH_MAX_RETRIES = parseInt(process.env.ELASTICSEARCH_MAX_RETRIES || '3');
export const ELASTICSEARCH_REQUEST_TIMEOUT = parseInt(process.env.ELASTICSEARCH_REQUEST_TIMEOUT || '30000');

// 数据处理配置
export const BATCH_SIZE = 1000; // 批处理大小
export const FLUSH_INTERVAL = 5000; // 刷新间隔(ms)
export const MAX_RETRIES = 3; // 最大重试次数
export const MAX_LOG_SIZE = 64 * 1024; // 64KB 单条日志最大大小
export const MAX_BATCH_SIZE = 10 * 1024 * 1024; // 10MB 批量处理最大大小

// 支持的日志级别
export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

// 支持的日志来源
export const LOG_SOURCES = ['server', 'client', 'mobile', 'iot', 'system'] as const;

// 支持的日志格式
export const SUPPORTED_FORMATS = ['json', 'text', 'structured', 'syslog', 'custom'] as const;

// Kafka配置
export const KAFKA_CLIENT_ID = 'logs-service';
export const KAFKA_GROUP_ID = 'logs-group';
export const KAFKA_BROKERS = process.env.KAFKA_BROKERS || 'localhost:9092';
export const KAFKA_TOPICS = {
  LOGS_RAW: 'logs-raw',
  LOGS_PROCESSED: 'logs-processed',
  LOGS_ALERTS: 'logs-alerts',
  TENANT_EVENTS: 'tenant-events',
} as const;

// Redis配置
export const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
export const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');
export const REDIS_PASSWORD = process.env.REDIS_PASSWORD || '';
export const REDIS_DB = parseInt(process.env.REDIS_DB || '1'); // 使用不同的DB避免与metrics冲突
export const REDIS_PREFIX = 'logs:';

// API配置
export const API_RATE_LIMIT = {
  INGEST: 1000, // 每分钟最大摄取请求数
  SEARCH: 100,  // 每分钟最大搜索请求数
  EXPORT: 10,   // 每分钟最大导出请求数
  STREAM: 5,    // 每分钟最大流连接数
} as const;

// 配额配置
export const DEFAULT_QUOTAS = {
  LOGS_PER_MINUTE: 10000,
  STORAGE_GB: 50,
  RETENTION_DAYS: 90,
  SEARCH_REQUESTS_PER_DAY: 10000,
  EXPORT_REQUESTS_PER_DAY: 100,
} as const;

// 配额重置间隔
export const QUOTA_RESET_INTERVALS = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
} as const;

// 配额警告阈值
export const QUOTA_WARNING_THRESHOLDS = {
  LOW: 0.5,      // 50%
  MEDIUM: 0.75,  // 75%
  HIGH: 0.9,     // 90%
  CRITICAL: 0.95, // 95%
} as const;

// 索引配置
export const INDEX_SETTINGS = {
  NUMBER_OF_SHARDS: 1,
  NUMBER_OF_REPLICAS: 0,
  REFRESH_INTERVAL: '5s',
  MAX_RESULT_WINDOW: 10000,
} as const;

// 搜索配置
export const SEARCH_DEFAULTS = {
  SIZE: 100,
  MAX_SIZE: 1000,
  TIMEOUT: '30s',
  SCROLL_TIMEOUT: '5m',
} as const;

// 搜索分页配置
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 1000;
export const SEARCH_TIMEOUT = '30s';

// 支持的日志级别和来源（用于搜索验证）
export const SUPPORTED_LOG_LEVELS = LOG_LEVELS;
export const SUPPORTED_LOG_SOURCES = LOG_SOURCES;

// 导出配置
export const EXPORT_LIMITS = {
  MAX_RECORDS: 50000,
  MAX_FILE_SIZE: 100 * 1024 * 1024, // 100MB
  SUPPORTED_FORMATS: ['json', 'csv'] as const,
  DAILY_LIMIT: 100000, // 每日最大导出记录数
} as const;

// 流配置
export const STREAM_CONFIG = {
  MAX_CONNECTIONS: 100,
  HEARTBEAT_INTERVAL: 30000, // 30秒
  CONNECTION_TIMEOUT: 300000, // 5分钟
  BUFFER_SIZE: 1000,
} as const;

// 性能配置
export const SLOW_QUERY_THRESHOLD = 2000; // 2秒
export const CACHE_TTL = 3600; // 1小时缓存
export const STATS_CACHE_TTL = 300; // 5分钟统计缓存
export const DEFAULT_STATS_INTERVAL = '1h'; // 默认统计间隔

// 监控配置
export const METRICS_PORT = 3002;
export const METRICS_PATH = '/metrics';
export const HEALTH_CHECK_PATH = '/health';

// 安全配置
export const API_KEY_LENGTH = 32;
export const API_KEY_PREFIX = 'logs_';
export const API_KEY_EXPIRY_DAYS = 365; // API密钥默认有效期
export const API_KEY_MAX_PER_TENANT = 50; // 每个租户最大API密钥数量
export const SUPPORTED_PERMISSIONS = ['read', 'write', 'admin', 'ingest', 'search', 'export', 'stats', 'anomaly', 'report'] as const;
export const SENSITIVE_FIELDS = [
  'password',
  'token',
  'secret',
  'key',
  'authorization',
  'cookie',
  'session',
  'credit_card',
  'ssn',
  'email',
  'phone'
] as const;

// 错误代码
export const ERROR_CODES = {
  INVALID_API_KEY: 'INVALID_API_KEY',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  INVALID_LOG_FORMAT: 'INVALID_LOG_FORMAT',
  ELASTICSEARCH_ERROR: 'ELASTICSEARCH_ERROR',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  TENANT_NOT_FOUND: 'TENANT_NOT_FOUND',
  LOG_TOO_LARGE: 'LOG_TOO_LARGE',
  BATCH_TOO_LARGE: 'BATCH_TOO_LARGE',
  SEARCH_TIMEOUT: 'SEARCH_TIMEOUT',
  EXPORT_FAILED: 'EXPORT_FAILED',
  STREAM_ERROR: 'STREAM_ERROR',
} as const;