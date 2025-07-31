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