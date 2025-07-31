// User微服务常量定义

// 应用配置
export const APP_NAME = 'user';

// 数据库配置
export const DB_CONFIG = {
  SLOW_QUERY_THRESHOLD: 1000, // 慢查询阈值(ms)
  CONNECTION_TIMEOUT: 30000, // 连接超时时间(ms)
  QUERY_TIMEOUT: 10000, // 查询超时时间(ms)
};

// Redis配置
export const REDIS_CONFIG = {
  HOST: process.env.REDIS_HOST || 'localhost',
  PORT: parseInt(process.env.REDIS_PORT || '6379'),
  PASSWORD: process.env.REDIS_PASSWORD,
  DB: parseInt(process.env.REDIS_DB || '0'),
  KEY_PREFIX: 'user:',
};

// Kafka配置
export const KAFKA_CONFIG = {
  CLIENT_ID: 'user-service',
  GROUP_ID: 'user-service-group',
  BROKERS: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  TOPICS: {
    USER_EVENTS: 'user-events',
    AUTH_EVENTS: 'auth-events',
    SUBSCRIPTION_EVENTS: 'subscription-events',
  },
};

// 用户配置
export const USER_CONFIG = {
  DEFAULT_NICKNAME_PREFIX: '星际公民',
  NICKNAME_ID_LENGTH: 9,
  AVATAR_DEFAULT_URL: '/assets/default-avatar.png',
  STATUS: {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    SUSPENDED: 'suspended',
    DELETED: 'deleted',
  },
};

// 缓存配置
export const CACHE_CONFIG = {
  USER_INFO_TTL: 3600, // 用户信息缓存时间(秒)
  USER_PROFILE_TTL: 1800, // 用户资料缓存时间(秒)
  USER_STATS_TTL: 300, // 用户统计缓存时间(秒)
};

// 验证配置
export const VALIDATION_CONFIG = {
  NICKNAME_MIN_LENGTH: 2,
  NICKNAME_MAX_LENGTH: 20,
  BIO_MAX_LENGTH: 500,
  ALLOWED_SOURCES: ['web', 'mobile', 'api', 'admin'],
};

// 监控配置
export const MONITORING_CONFIG = {
  METRICS_PORT: 9094,
  METRICS_PATH: '/metrics',
  HEALTH_CHECK_INTERVAL: 30000, // 健康检查间隔(ms)
};

// 事件类型
export const EVENT_TYPES = {
  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_DELETED: 'user.deleted',
  USER_STATUS_CHANGED: 'user.status.changed',
  USER_PROFILE_UPDATED: 'user.profile.updated',
  USER_LOGIN: 'user.login',
  USER_LOGOUT: 'user.logout',
};
