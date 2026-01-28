/**
 * 网关服务常量定义
 */

// 应用配置
export const APP_NAME = 'gateway';
export const DEFAULT_PORT = 6666;

// 限流配置
export const RATE_LIMIT_WINDOW = 30 * 1000; // 30秒
export const RATE_LIMIT_COUNT = 30; // 30次请求

// 定时器配置
export const IP_SYNC_INTERVAL = 30 * 60 * 1000; // 30分钟

// 性能配置
export const SLOW_QUERY_THRESHOLD = 1000; // 1秒

// WebSocket配置
export const WEBSOCKET_DEFAULT_PORT = 6668;

// Kafka配置
export const KAFKA_BROKERS = process.env.KAFKA_BROKERS || 'localhost:9092';
export const KAFKA_USER = process.env.KAFKA_USER || '';
export const KAFKA_PASSWORD = process.env.KAFKA_PASSWORD || '';
export const KAFKA_CLIENT_ID = 'gateway-service';
export const KAFKA_GROUP_ID = 'gateway-group';

// Redis配置
export const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
export const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');
export const REDIS_PASSWORD = process.env.REDIS_PASSWORD || '';
export const REDIS_DB = parseInt(process.env.REDIS_DB || '0');