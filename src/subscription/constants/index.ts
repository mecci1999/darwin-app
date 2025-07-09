// Subscription微服务常量配置

// 应用配置
export const APP_NAME = 'subscription';
export const SERVICE_VERSION = '1.0.0';
export const SERVICE_PORT = parseInt(process.env.SUBSCRIPTION_PORT || '3002');

// 数据库配置
export const DATABASE_CONFIG = {
  HOST: process.env.MYSQL_HOST || 'localhost',
  PORT: parseInt(process.env.MYSQL_PORT || '3306'),
  USER: process.env.MYSQL_USER || 'root',
  PASSWORD: process.env.MYSQL_PASSWORD || 'DarwinApp2024_MySQL!',
  DATABASE: process.env.MYSQL_DATABASE || 'darwin_app',
  CHARSET: 'utf8mb4',
  TIMEZONE: '+08:00',
};

// Redis配置
export const REDIS_CONFIG = {
  HOST: process.env.REDIS_HOST || 'localhost',
  PORT: parseInt(process.env.REDIS_PORT || '6379'),
  PASSWORD: process.env.REDIS_PASSWORD || 'DarwinApp2024_Redis!',
  DB: parseInt(process.env.REDIS_DB || '0'),
};

// Kafka配置
export const KAFKA_CONFIG = {
  BROKERS: (process.env.KAFKA_HOST || 'localhost:9092').split(','),
  CLIENT_ID: 'subscription-service',
  GROUP_ID: 'subscription-group',
  USERNAME: process.env.KAFKA_USER || '',
  PASSWORD: process.env.KAFKA_PASSWORD || 'DarwinApp2024_Kafka!',
};

// 缓存配置
export const CACHE_CONFIG = {
  TTL: 300, // 5分钟
  SESSION_TTL: 86400, // 24小时
  RATE_LIMIT_TTL: 3600, // 1小时
  LOCK_TTL: 30, // 30秒
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000,
};

// 验证配置
export const VALIDATION_CONFIG = {
  PASSWORD_MIN_LENGTH: 8,
  PASSWORD_MAX_LENGTH: 128,
  EMAIL_MAX_LENGTH: 255,
  NAME_MAX_LENGTH: 100,
  PHONE_REGEX: /^1[3-9]\d{9}$/,
  EMAIL_REGEX: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
};

// 监控配置
export const MONITORING_CONFIG = {
  HEALTH_CHECK_INTERVAL: 30000, // 30秒
  METRICS_COLLECTION_INTERVAL: 60000, // 1分钟
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  ENABLE_METRICS: process.env.ENABLE_METRICS === 'true',
  ENABLE_TRACING: process.env.ENABLE_TRACING === 'true',
};

// 订阅配置
export const SUBSCRIPTION_CONFIG = {
  STATUS: {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    CANCELLED: 'cancelled',
    EXPIRED: 'expired',
    PENDING: 'pending',
    SUSPENDED: 'suspended',
  },
  BILLING_CYCLES: {
    MONTHLY: 'monthly',
    YEARLY: 'yearly',
    WEEKLY: 'weekly',
    DAILY: 'daily',
  },
  WEBHOOK_PROCESSING_INTERVAL: 5000, // 5秒
  WEBHOOK_MAX_RETRIES: 3,
};

// 支付网关配置
export const PAYMENT_GATEWAY_CONFIG = {
  STRIPE: {
    ENABLED: process.env.STRIPE_ENABLED === 'true',
    PUBLIC_KEY: process.env.STRIPE_PUBLIC_KEY || '',
    SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
    WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || '',
  },
  PAYPAL: {
    ENABLED: process.env.PAYPAL_ENABLED === 'true',
    CLIENT_ID: process.env.PAYPAL_CLIENT_ID || '',
    CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET || '',
    WEBHOOK_ID: process.env.PAYPAL_WEBHOOK_ID || '',
  },
  ALIPAY: {
    ENABLED: process.env.ALIPAY_ENABLED === 'true',
    APP_ID: process.env.ALIPAY_APP_ID || '',
    PRIVATE_KEY: process.env.ALIPAY_PRIVATE_KEY || '',
    PUBLIC_KEY: process.env.ALIPAY_PUBLIC_KEY || '',
  },
};

// 支付网关列表（向后兼容）
export const PAYMENT_GATEWAYS = PAYMENT_GATEWAY_CONFIG;

// 通知配置
export const NOTIFICATION_CONFIG = {
  EMAIL: {
    ENABLED: process.env.EMAIL_ENABLED === 'true',
    SMTP_HOST: process.env.SMTP_HOST || 'localhost',
    SMTP_PORT: parseInt(process.env.SMTP_PORT || '587'),
    SMTP_USER: process.env.SMTP_USER || '',
    SMTP_PASSWORD: process.env.SMTP_PASSWORD || '',
    FROM_EMAIL: process.env.FROM_EMAIL || 'noreply@example.com',
    FROM_NAME: process.env.FROM_NAME || 'Darwin App',
  },
  SMS: {
    ENABLED: process.env.SMS_ENABLED === 'true',
    PROVIDER: process.env.SMS_PROVIDER || 'twilio',
    API_KEY: process.env.SMS_API_KEY || '',
    API_SECRET: process.env.SMS_API_SECRET || '',
    FROM_NUMBER: process.env.SMS_FROM_NUMBER || '',
  },
  PUSH: {
    ENABLED: process.env.PUSH_ENABLED === 'true',
    FCM_SERVER_KEY: process.env.FCM_SERVER_KEY || '',
    APNS_KEY_ID: process.env.APNS_KEY_ID || '',
    APNS_TEAM_ID: process.env.APNS_TEAM_ID || '',
    APNS_PRIVATE_KEY: process.env.APNS_PRIVATE_KEY || '',
  },
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 5000, // 5秒
};

// 事件类型
export const EVENT_TYPES = {
  SUBSCRIPTION_CREATED: 'subscription.created',
  SUBSCRIPTION_UPDATED: 'subscription.updated',
  SUBSCRIPTION_CANCELLED: 'subscription.cancelled',
  SUBSCRIPTION_EXPIRED: 'subscription.expired',
  PAYMENT_COMPLETED: 'payment.completed',
  PAYMENT_FAILED: 'payment.failed',
  QUOTA_WARNING: 'quota.warning',
  QUOTA_EXCEEDED: 'quota.exceeded',
};