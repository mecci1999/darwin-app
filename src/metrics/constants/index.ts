/**
 * 指标数据微服务常量定义
 */

// 应用配置
export const APP_NAME = 'metrics';
export const DEFAULT_PORT = 6667;

// InfluxDB配置
export const INFLUXDB_URL = process.env.INFLUXDB_URL || 'http://localhost:8086';
export const INFLUXDB_TOKEN = process.env.INFLUXDB_TOKEN || '';
export const INFLUXDB_ORG = process.env.INFLUXDB_ORG || 'darwin-monitoring';
export const INFLUXDB_BUCKET = process.env.INFLUXDB_BUCKET || 'metrics';

// 数据处理配置
export const BATCH_SIZE = 1000; // 批处理大小
export const FLUSH_INTERVAL = 5000; // 刷新间隔(ms)
export const MAX_RETRIES = 3; // 最大重试次数

// 支持的指标格式
export const SUPPORTED_FORMATS = ['prometheus', 'statsd', 'datadog', 'otlp', 'custom', 'official'];

// Kafka配置
export const KAFKA_CLIENT_ID = 'metrics-service';
export const KAFKA_GROUP_ID = 'metrics-group';
export const KAFKA_BROKERS = process.env.KAFKA_BROKERS || 'localhost:9092';

// Redis配置
export const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
export const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');
export const REDIS_PASSWORD = process.env.REDIS_PASSWORD || '';
export const REDIS_DB = parseInt(process.env.REDIS_DB || '0');

// 性能配置
export const SLOW_QUERY_THRESHOLD = 1000; // 1秒

// 监控配置
export const METRICS_PORT = 3001;
export const METRICS_PATH = '/metrics';