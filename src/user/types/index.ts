// User微服务类型定义
import { DatabaseState } from '../../db/mysql';

// 用户服务状态
export interface UserState extends DatabaseState {
  kafkaConsumers: Map<string, any>;
  cache: {
    users: Map<string, any>;
    profiles: Map<string, any>;
    stats: Map<string, any>;
  };
  timers: {
    cacheCleanup?: NodeJS.Timeout;
    healthCheck?: NodeJS.Timeout;
    statsUpdate?: NodeJS.Timeout;
  };
  metrics: {
    totalUsers: number;
    activeUsers: number;
    createdToday: number;
    lastUpdated: Date;
  };
}

// 用户基本信息
export interface UserInfo {
  userId: string;
  nickname: string;
  avatar?: string;
  email?: string;
  phone?: string;
  bio?: string;
  source: string;
  status: 'active' | 'inactive' | 'suspended' | 'deleted';
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date;
}

// 用户资料
export interface UserProfile {
  userId: string;
  nickname: string;
  avatar?: string;
  bio?: string;
  preferences: {
    language: string;
    timezone: string;
    notifications: {
      email: boolean;
      push: boolean;
      sms: boolean;
    };
  };
  metadata: Record<string, any>;
}

// 用户统计信息
export interface UserStats {
  userId: string;
  loginCount: number;
  lastLoginAt?: Date;
  totalApiCalls: number;
  subscriptionStatus: string;
  quotaUsage: {
    used: number;
    limit: number;
    percentage: number;
  };
  createdAt: Date;
}

// 创建用户参数
export interface CreateUserParams {
  userId: string;
  nickname?: string;
  avatar?: string;
  email?: string;
  phone?: string;
  source: string;
  metadata?: Record<string, any>;
}

// 更新用户参数
export interface UpdateUserParams {
  userId: string;
  nickname?: string;
  avatar?: string;
  email?: string;
  phone?: string;
  bio?: string;
  status?: 'active' | 'inactive' | 'suspended' | 'deleted';
  preferences?: Partial<UserProfile['preferences']>;
  metadata?: Record<string, any>;
}

// 用户查询参数
export interface UserQueryParams {
  userId?: string;
  email?: string;
  phone?: string;
  status?: string;
  source?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  limit?: number;
  offset?: number;
}

// 用户事件数据
export interface UserEventData {
  userId: string;
  eventType: string;
  timestamp: Date;
  data: Record<string, any>;
  source: string;
  metadata?: Record<string, any>;
}

// 用户登录事件
export interface UserLoginEvent {
  userId: string;
  source: string;
  ip?: string;
  userAgent?: string;
  timestamp: Date;
  success: boolean;
  failureReason?: string;
}

// 用户状态变更事件
export interface UserStatusChangeEvent {
  userId: string;
  oldStatus: string;
  newStatus: string;
  reason?: string;
  changedBy: string;
  timestamp: Date;
}

// Kafka消费者配置
export interface KafkaConsumerConfig {
  groupId: string;
  topics: string[];
  autoCommit: boolean;
  sessionTimeout: number;
}

// 缓存配置
export interface CacheConfig {
  ttl: number;
  maxSize: number;
  cleanupInterval: number;
}

// 服务健康状态
export interface ServiceHealth {
  status: 'healthy' | 'unhealthy' | 'degraded';
  database: boolean;
  redis: boolean;
  kafka: boolean;
  uptime: number;
  version: string;
  timestamp: Date;
}

// 用户服务配置
export interface UserServiceConfig {
  database: {
    slowQueryThreshold: number;
    connectionTimeout: number;
    queryTimeout: number;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
    db: number;
    keyPrefix: string;
  };
  kafka: {
    clientId: string;
    groupId: string;
    brokers: string[];
    topics: Record<string, string>;
  };
  cache: {
    userInfoTtl: number;
    userProfileTtl: number;
    userStatsTtl: number;
  };
  monitoring: {
    metricsPort: number;
    metricsPath: string;
    healthCheckInterval: number;
  };
}
