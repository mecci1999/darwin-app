/**
 * 认证服务常量定义
 */

// 应用名称
export const APP_NAME = 'auth';

// RSA密钥配置
export const RSA_CONFIG = {
  keySize: 2048,
  publicKeyEncoding: {
    type: 'spki' as const,
    format: 'pem' as const,
  },
  privateKeyEncoding: {
    type: 'pkcs8' as const,
    format: 'pem' as const,
  },
};

// 数据库配置
export const DB_CONFIG = {
  enableSlowQueryLog: true,
  slowQueryThreshold: 1000,
  enableBenchmark: true,
};

// 缓存配置
export const CACHE_CONFIG = {
  redis: {
    port: 6379,
    host: 'localhost',
  },
};

// 消息队列配置
export const MQ_CONFIG = {
  kafka: {
    host: 'localhost:9092',
    debug: true,
  },
};

// 认证相关配置
export const AUTH_CONFIG = {
  tokenExpireTime: process.env.AUTH_TOKEN_EXPIRE_TIME || '2h',
  refreshTokenExpireTime: process.env.AUTH_REFRESH_TOKEN_EXPIRE_TIME || '7d',
  verificationCodeExpireTime: parseInt(process.env.AUTH_VERIFICATION_CODE_EXPIRE_TIME || '300'),
  maxLoginAttempts: parseInt(process.env.AUTH_MAX_LOGIN_ATTEMPTS || '5'),
  loginAttemptWindow: parseInt(process.env.AUTH_LOGIN_ATTEMPT_WINDOW || '900'), // 15分钟

  // 邮箱配置
  email: {
    service: process.env.AUTH_EMAIL_SERVICE || '163',
    user: process.env.AUTH_EMAIL_USER || 'mecci1999@163.com',
    pass: process.env.AUTH_EMAIL_PASS || 'YEVimrR6xg6pNYKK',
  },
};
