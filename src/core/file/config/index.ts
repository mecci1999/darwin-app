/**
 * 文件微服务配置管理
 * 提供配置加载、验证和管理功能
 */

import { Starlight } from 'typings';
import { 
  StorageConfig, 
  FileCategory, 
  ProcessingProfile 
} from '../types';

/**
 * 环境类型
 */
export enum Environment {
  DEVELOPMENT = 'development',
  STAGING = 'staging',
  PRODUCTION = 'production',
  TEST = 'test'
}

/**
 * 配置接口
 */
export interface FileServiceConfig {
  // 基础配置
  environment: Environment;
  serviceName: string;
  version: string;
  port: number;
  host: string;
  
  // 存储配置
  storage: StorageConfig;
  
  // 上传配置
  upload: {
    maxFileSize: number;
    maxFiles: number;
    allowedMimeTypes: string[];
    tempDir: string;
    cleanupInterval: number;
  };
  
  // 处理配置
  processing: {
    profiles: Record<FileCategory, ProcessingProfile>;
    concurrency: number;
    timeout: number;
    retryAttempts: number;
  };
  
  // 安全配置
  security: {
    enableVirusScanning: boolean;
    maxRequestsPerMinute: number;
    allowedOrigins: string[];
    enableCors: boolean;
    jwtSecret?: string;
    encryptionKey?: string;
  };
  
  // 缓存配置
  cache: {
    enabled: boolean;
    provider: 'memory' | 'redis';
    ttl: number;
    maxSize: number;
    redis?: {
      host: string;
      port: number;
      password?: string;
      db: number;
    };
  };
  
  // 日志配置
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    format: 'json' | 'text';
    enableConsole: boolean;
    enableFile: boolean;
    filePath?: string;
    maxFileSize: string;
    maxFiles: number;
  };
  
  // 监控配置
  monitoring: {
    enabled: boolean;
    metricsInterval: number;
    healthCheckInterval: number;
    alertThresholds: {
      errorRate: number;
      responseTime: number;
      diskUsage: number;
      memoryUsage: number;
    };
  };
  
  // 队列配置
  queue: {
    enabled: boolean;
    provider: 'memory' | 'redis' | 'rabbitmq';
    concurrency: number;
    retryAttempts: number;
    retryDelay: number;
  };
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: FileServiceConfig = {
  environment: Environment.DEVELOPMENT,
  serviceName: 'file-service',
  version: '1.0.0',
  port: 3000,
  host: '0.0.0.0',
  
  storage: {
    provider: 'local',
    basePath: './uploads',
    maxFileSize: 10 * 1024 * 1024, // 10MB
    allowedMimeTypes: [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
      'text/plain',
      'application/json'
    ],
    enableCompression: true,
    enableEncryption: false,
    retentionDays: 365,
    backupEnabled: false
  },
  
  upload: {
    maxFileSize: 10 * 1024 * 1024, // 10MB
    maxFiles: 10,
    allowedMimeTypes: [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
      'text/plain'
    ],
    tempDir: './temp',
    cleanupInterval: 3600000 // 1小时
  },
  
  processing: {
    profiles: {
      [FileCategory.AVATAR]: {
        maxSize: 2 * 1024 * 1024, // 2MB
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
        imageProcessing: {
          resize: {
            width: 200,
            height: 200,
            fit: 'cover'
          },
          quality: 85,
          format: 'webp',
          thumbnail: {
            width: 64,
            height: 64,
            quality: 80
          }
        }
      },
      [FileCategory.BLOG_IMAGE]: {
        maxSize: 5 * 1024 * 1024, // 5MB
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
        imageProcessing: {
          resize: {
            width: 1200,
            height: 800,
            fit: 'inside'
          },
          quality: 85,
          format: 'webp',
          thumbnail: {
            width: 300,
            height: 200,
            quality: 80
          }
        }
      },
      [FileCategory.DOCUMENT]: {
        maxSize: 10 * 1024 * 1024, // 10MB
        allowedMimeTypes: [
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'text/plain'
        ]
      },
      [FileCategory.GENERAL]: {
        maxSize: 10 * 1024 * 1024, // 10MB
        allowedMimeTypes: [
          'image/jpeg',
          'image/png',
          'image/gif',
          'application/pdf',
          'text/plain',
          'application/json'
        ]
      },
      [FileCategory.OTHER]: {
        maxSize: 5 * 1024 * 1024, // 5MB
        allowedMimeTypes: ['*/*'] // 允许所有类型，但会有额外验证
      }
    },
    concurrency: 3,
    timeout: 30000, // 30秒
    retryAttempts: 3
  },
  
  security: {
    enableVirusScanning: false,
    maxRequestsPerMinute: 100,
    allowedOrigins: ['*'],
    enableCors: true,
    jwtSecret: undefined,
    encryptionKey: undefined
  },
  
  cache: {
    enabled: true,
    provider: 'memory',
    ttl: 3600, // 1小时
    maxSize: 1000,
    redis: {
      host: 'localhost',
      port: 6379,
      password: undefined,
      db: 0
    }
  },
  
  logging: {
    level: 'info',
    format: 'json',
    enableConsole: true,
    enableFile: false,
    filePath: './logs/file-service.log',
    maxFileSize: '10MB',
    maxFiles: 5
  },
  
  monitoring: {
    enabled: true,
    metricsInterval: 60000, // 1分钟
    healthCheckInterval: 30000, // 30秒
    alertThresholds: {
      errorRate: 0.05, // 5%
      responseTime: 1000, // 1秒
      diskUsage: 0.8, // 80%
      memoryUsage: 0.8 // 80%
    }
  },
  
  queue: {
    enabled: false,
    provider: 'memory',
    concurrency: 5,
    retryAttempts: 3,
    retryDelay: 1000 // 1秒
  }
};

/**
 * 配置管理器
 */
export class ConfigManager {
  private static instance: ConfigManager;
  private config: FileServiceConfig;
  private star?: Starlight;

  private constructor() {
    this.config = { ...DEFAULT_CONFIG };
  }

  /**
   * 获取单例实例
   */
  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  /**
   * 初始化配置
   */
  initialize(star?: Starlight): void {
    this.star = star;
    this.loadFromEnvironment();
    this.validateConfig();
    
    this.star?.logger?.info('配置初始化完成', {
      environment: this.config.environment,
      serviceName: this.config.serviceName,
      version: this.config.version
    });
  }

  /**
   * 从环境变量加载配置
   */
  private loadFromEnvironment(): void {
    const env = process.env;
    
    // 基础配置
    if (env.NODE_ENV) {
      this.config.environment = env.NODE_ENV as Environment;
    }
    if (env.SERVICE_NAME) {
      this.config.serviceName = env.SERVICE_NAME;
    }
    if (env.SERVICE_VERSION) {
      this.config.version = env.SERVICE_VERSION;
    }
    if (env.PORT) {
      this.config.port = parseInt(env.PORT, 10);
    }
    if (env.HOST) {
      this.config.host = env.HOST;
    }
    
    // 存储配置
    if (env.STORAGE_PROVIDER) {
      this.config.storage.provider = env.STORAGE_PROVIDER as any;
    }
    if (env.STORAGE_BASE_PATH) {
      this.config.storage.basePath = env.STORAGE_BASE_PATH;
    }
    if (env.MAX_FILE_SIZE) {
      this.config.storage.maxFileSize = parseInt(env.MAX_FILE_SIZE, 10);
      this.config.upload.maxFileSize = parseInt(env.MAX_FILE_SIZE, 10);
    }
    
    // 安全配置
    if (env.JWT_SECRET) {
      this.config.security.jwtSecret = env.JWT_SECRET;
    }
    if (env.ENCRYPTION_KEY) {
      this.config.security.encryptionKey = env.ENCRYPTION_KEY;
    }
    if (env.MAX_REQUESTS_PER_MINUTE) {
      this.config.security.maxRequestsPerMinute = parseInt(env.MAX_REQUESTS_PER_MINUTE, 10);
    }
    if (env.ALLOWED_ORIGINS) {
      this.config.security.allowedOrigins = env.ALLOWED_ORIGINS.split(',');
    }
    
    // 缓存配置
    if (env.CACHE_ENABLED) {
      this.config.cache.enabled = env.CACHE_ENABLED === 'true';
    }
    if (env.CACHE_PROVIDER) {
      this.config.cache.provider = env.CACHE_PROVIDER as any;
    }
    if (env.REDIS_HOST) {
      this.config.cache.redis!.host = env.REDIS_HOST;
    }
    if (env.REDIS_PORT) {
      this.config.cache.redis!.port = parseInt(env.REDIS_PORT, 10);
    }
    if (env.REDIS_PASSWORD) {
      this.config.cache.redis!.password = env.REDIS_PASSWORD;
    }
    
    // 日志配置
    if (env.LOG_LEVEL) {
      this.config.logging.level = env.LOG_LEVEL as any;
    }
    if (env.LOG_FORMAT) {
      this.config.logging.format = env.LOG_FORMAT as any;
    }
    if (env.LOG_FILE_PATH) {
      this.config.logging.filePath = env.LOG_FILE_PATH;
    }
    
    // 监控配置
    if (env.MONITORING_ENABLED) {
      this.config.monitoring.enabled = env.MONITORING_ENABLED === 'true';
    }
  }

  /**
   * 验证配置
   */
  private validateConfig(): void {
    const errors: string[] = [];
    
    // 验证端口
    if (this.config.port < 1 || this.config.port > 65535) {
      errors.push('端口号必须在1-65535之间');
    }
    
    // 验证文件大小
    if (this.config.upload.maxFileSize <= 0) {
      errors.push('最大文件大小必须大于0');
    }
    
    // 验证存储路径
    if (!this.config.storage.basePath) {
      errors.push('存储路径不能为空');
    }
    
    // 验证JWT密钥（生产环境）
    if (this.config.environment === Environment.PRODUCTION && !this.config.security.jwtSecret) {
      errors.push('生产环境必须设置JWT密钥');
    }
    
    // 验证Redis配置（如果启用）
    if (this.config.cache.enabled && this.config.cache.provider === 'redis') {
      if (!this.config.cache.redis?.host) {
        errors.push('Redis缓存启用时必须配置主机地址');
      }
    }
    
    if (errors.length > 0) {
      const errorMessage = `配置验证失败: ${errors.join(', ')}`;
      this.star?.logger?.error(errorMessage);
      throw new Error(errorMessage);
    }
  }

  /**
   * 获取完整配置
   */
  getConfig(): FileServiceConfig {
    return { ...this.config };
  }

  /**
   * 获取特定配置项
   */
  get<K extends keyof FileServiceConfig>(key: K): FileServiceConfig[K] {
    return this.config[key];
  }

  /**
   * 设置配置项
   */
  set<K extends keyof FileServiceConfig>(key: K, value: FileServiceConfig[K]): void {
    this.config[key] = value;
    this.star?.logger?.debug('配置项已更新', { key, value });
  }

  /**
   * 更新配置
   */
  updateConfig(updates: Partial<FileServiceConfig>): void {
    Object.assign(this.config, updates);
    this.validateConfig();
    this.star?.logger?.info('配置已更新', { updates });
  }

  /**
   * 重新加载配置
   */
  reload(): void {
    this.config = { ...DEFAULT_CONFIG };
    this.loadFromEnvironment();
    this.validateConfig();
    this.star?.logger?.info('配置已重新加载');
  }

  /**
   * 获取环境特定配置
   */
  getEnvironmentConfig(): Partial<FileServiceConfig> {
    const envConfigs: Record<Environment, Partial<FileServiceConfig>> = {
      [Environment.DEVELOPMENT]: {
        logging: {
          ...this.config.logging,
          level: 'debug',
          enableConsole: true
        },
        monitoring: {
          ...this.config.monitoring,
          enabled: true
        }
      },
      [Environment.STAGING]: {
        logging: {
          ...this.config.logging,
          level: 'info',
          enableFile: true
        },
        security: {
          ...this.config.security,
          enableVirusScanning: true
        }
      },
      [Environment.PRODUCTION]: {
        logging: {
          ...this.config.logging,
          level: 'warn',
          enableFile: true,
          enableConsole: false
        },
        security: {
          ...this.config.security,
          enableVirusScanning: true,
          maxRequestsPerMinute: 50
        },
        cache: {
          ...this.config.cache,
          provider: 'redis'
        }
      },
      [Environment.TEST]: {
        logging: {
          ...this.config.logging,
          level: 'error',
          enableConsole: false,
          enableFile: false
        },
        cache: {
          ...this.config.cache,
          enabled: false
        }
      }
    };
    
    return envConfigs[this.config.environment] || {};
  }

  /**
   * 检查功能是否启用
   */
  isFeatureEnabled(feature: string): boolean {
    switch (feature) {
      case 'cache':
        return this.config.cache.enabled;
      case 'monitoring':
        return this.config.monitoring.enabled;
      case 'queue':
        return this.config.queue.enabled;
      case 'virusScanning':
        return this.config.security.enableVirusScanning;
      case 'cors':
        return this.config.security.enableCors;
      default:
        return false;
    }
  }

  /**
   * 获取处理配置文件
   */
  getProcessingProfile(category: FileCategory): ProcessingProfile {
    return this.config.processing.profiles[category] || this.config.processing.profiles[FileCategory.GENERAL];
  }

  /**
   * 导出配置为JSON
   */
  exportConfig(): string {
    const exportConfig = { ...this.config };
    
    // 移除敏感信息
    if (exportConfig.security.jwtSecret) {
      exportConfig.security.jwtSecret = '***';
    }
    if (exportConfig.security.encryptionKey) {
      exportConfig.security.encryptionKey = '***';
    }
    if (exportConfig.cache.redis?.password) {
      exportConfig.cache.redis.password = '***';
    }
    
    return JSON.stringify(exportConfig, null, 2);
  }
}

/**
 * 配置工具函数
 */
export class ConfigUtils {
  /**
   * 解析文件大小字符串
   */
  static parseFileSize(sizeStr: string): number {
    const units: Record<string, number> = {
      'B': 1,
      'KB': 1024,
      'MB': 1024 * 1024,
      'GB': 1024 * 1024 * 1024
    };
    
    const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)$/i);
    if (!match) {
      throw new Error(`无效的文件大小格式: ${sizeStr}`);
    }
    
    const [, size, unit] = match;
    return Math.floor(parseFloat(size) * units[unit.toUpperCase()]);
  }

  /**
   * 格式化文件大小
   */
  static formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  /**
   * 验证MIME类型
   */
  static isValidMimeType(mimeType: string, allowedTypes: string[]): boolean {
    if (allowedTypes.includes('*/*')) {
      return true;
    }
    
    return allowedTypes.some(allowed => {
      if (allowed.endsWith('/*')) {
        const prefix = allowed.slice(0, -2);
        return mimeType.startsWith(prefix);
      }
      return allowed === mimeType;
    });
  }

  /**
   * 合并配置对象
   */
  static mergeConfigs<T extends Record<string, any>>(base: T, override: Partial<T>): T {
    const result = { ...base };
    
    for (const key in override) {
      if (override[key] !== undefined) {
        if (typeof override[key] === 'object' && !Array.isArray(override[key]) && override[key] !== null) {
          result[key] = this.mergeConfigs(result[key] || {} as any, override[key] as any) as any;
        } else {
          result[key] = override[key] as any;
        }
      }
    }
    
    return result;
  }
}

/**
 * 获取配置管理器实例
 */
export function getConfigManager(): ConfigManager {
  return ConfigManager.getInstance();
}

/**
 * 初始化配置
 */
export function initializeConfig(star?: Starlight): FileServiceConfig {
  const configManager = getConfigManager();
  configManager.initialize(star);
  return configManager.getConfig();
}

/**
 * 默认导出
 */
export default {
  ConfigManager,
  ConfigUtils,
  Environment,
  DEFAULT_CONFIG,
  getConfigManager,
  initializeConfig
};