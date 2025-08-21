// User微服务常量定义

// 应用配置
export const APP_NAME = 'user';

// Redis配置
export const REDIS_CONFIG = {
  HOST: process.env.REDIS_HOST || 'localhost',
  PORT: parseInt(process.env.REDIS_PORT || '6379'),
  PASSWORD: process.env.REDIS_PASSWORD,
  DB: parseInt(process.env.REDIS_DB || '0'),
  KEY_PREFIX: 'user:',
};

// 用户配置
export const USER_CONFIG = {
  DEFAULT_NICKNAME_PREFIX: '星际游民',
  NICKNAME_ID_LENGTH: 8,
  AVATAR_DEFAULT_URL: '/default-avatar.png',
  STATUS: {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    SUSPENDED: 'suspended',
    DELETED: 'deleted',
  },
};

// 验证配置
export const VALIDATION_CONFIG = {
  NICKNAME_MIN_LENGTH: 2,
  NICKNAME_MAX_LENGTH: 20,
  BIO_MAX_LENGTH: 200,
  ALLOWED_SOURCES: ['system', 'wechat', 'email', 'invite'],
};
