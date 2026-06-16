/**
 * 日志微服务类型定义
 * SaaS化日志管理系统的TypeScript类型
 */

// 日志级别枚举
export enum LogLevel {
  TRACE = 'trace',
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  FATAL = 'fatal',
}

// 日志来源枚举
export enum LogSource {
  SERVER = 'server',
  CLIENT = 'client',
  MOBILE = 'mobile',
  IOT = 'iot',
  SYSTEM = 'system',
}

export type LogOriginType = 'darwin-app' | 'microservice';
export type LogVisibility = 'admin' | 'tenant';

// 基础日志接口
export interface BaseLog {
  message: string;
  level: LogLevel;
  timestamp?: string | number | Date;
  metadata?: Record<string, any>;
  source?: LogSource;
  originType?: LogOriginType;
  visibility?: LogVisibility;
  tags?: string[];
  service?: string;
  hostname?: string;
  containerId?: string;
  nodeID?: string;
  namespace?: string;
  mod?: string;
  svc?: string;
  version?: string;
  userId?: string;
  sessionId?: string;
  traceId?: string;
}

// 存储的日志接口
export interface StoredLog extends BaseLog {
  id: string;
  tenantId: string;
  userId?: string;
  apiKeyId: string;
  timestamp: string;
  indexed: boolean;
  createdAt: string;
  updatedAt: string;
  receivedAt: string;
  service?: string;
  originType: LogOriginType;
  visibility: LogVisibility;
}

// 日志摄取请求
export interface LogIngestRequest {
  tenantId: string;
  userId?: string;
  apiKey: string;
  log: BaseLog;
  format?: 'json' | 'text' | 'structured';
}

// 批量日志摄取请求
export interface LogBatchIngestRequest {
  tenantId: string;
  userId?: string;
  apiKey: string;
  logs: BaseLog[];
  format?: 'json' | 'text' | 'structured';
  batchId?: string;
}

// API 响应接口
export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  meta?: {
    timestamp: string;
    requestId: string;
    version: string;
  };
}

// Elasticsearch 客户端接口
export interface ElasticsearchClient {
  index(params: any): Promise<any>;
  search(params: any): Promise<any>;
  bulk(params: any): Promise<any>;
  indices: {
    create(params: any): Promise<any>;
    exists(params: any): Promise<boolean>;
    delete(params: any): Promise<any>;
    putMapping(params: any): Promise<any>;
  };
}

// 上下文接口
export interface Context<T = any> {
  params: T;
  meta: {
    tenantId: string;
    userId?: string;
    apiKey: string;
    requestId: string;
    timestamp: string;
  };
  service: {
    logger: {
      debug(message: string, ...args: any[]): void;
      info(message: string, ...args: any[]): void;
      warn(message: string, ...args: any[]): void;
      error(message: string, ...args: any[]): void;
    };
    broker: {
      emit(event: string, data: any): Promise<void>;
    };
    settings: {
      elasticsearch: {
        host: string;
        index: string;
      };
    };
  };
}

// API 权限枚举
export enum ApiPermission {
  READ = 'read',
  WRITE = 'write',
  ADMIN = 'admin',
  INGEST = 'ingest',
  SEARCH = 'search',
  EXPORT = 'export',
  STATS = 'stats',
  ANOMALY = 'anomaly',
  REPORT = 'report',
}

// 错误类型
export interface LogError extends Error {
  code?: string;
  retryAfter?: number;
  statusCode?: number;
}

// 中间件函数类型
export type MiddlewareFunction = (ctx: Context, next: () => Promise<void>) => Promise<void>;

// API 密钥验证中间件
export declare function validateApiKeyMiddleware(
  ctx: Context,
  next: () => Promise<void>,
): Promise<void>;

// 权限检查中间件
export declare function requirePermission(permission: ApiPermission): MiddlewareFunction;

// 基础日志接口
export interface LogEntry {
  id?: string;
  level: LogLevel;
  message: string;
  timestamp: string | number;
  service?: string;
  source: LogSource;
  originType?: LogOriginType;
  visibility?: LogVisibility;
  nodeID?: string;
  namespace?: string;
  mod?: string;
  svc?: string;
  metadata?: Record<string, any>;
  tenantId: string;
  userId?: string;
  sessionId?: string;
  traceId?: string;
  spanId?: string;
  tags?: string[];
  environment?: string;
  version?: string;
  hostname?: string;
  containerId?: string;
  ip?: string;
  userAgent?: string;
  requestId?: string;
  correlationId?: string;
  duration?: number;
  statusCode?: number;
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  };
}

// 日志格式
export type LogFormat =
  | 'json'
  | 'text'
  | 'structured'
  | 'syslog'
  | 'csv'
  | 'clf' // Common Log Format
  | 'combined'; // Combined Log Format

// 批量日志接口
export interface LogBatch {
  logs: LogEntry[];
  batchId?: string;
  tenantId: string;
  timestamp: number;
  source: string;
  format: LogFormat;
  compression?: 'gzip' | 'deflate';
  checksum?: string;
}

// 日志搜索参数
export interface LogSearchParams {
  query?: string;
  service?: string;
  level?: LogLevel | LogLevel[];
  levels?: LogLevel[];
  source?: LogSource | LogSource[];
  sources?: LogSource[];
  originType?: LogOriginType;
  visibility?: LogVisibility;
  startTime?: string | number;
  endTime?: string | number;
  timeRange?: string;
  tenantId: string;
  userId?: string;
  tags?: string[];
  environment?: string;
  traceId?: string;
  sessionId?: string;
  requestId?: string;
  hostname?: string;
  excludeNodeIDs?: string[];
  excludeServices?: string[];
  page?: number;
  pageSize?: number;
  limit?: number;
  size?: number;
  from?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  fields?: string[];
  highlight?: boolean;
  aggregations?: LogAggregation[];
  filters?: Record<string, any>;
}

// 日志聚合
export interface LogAggregation {
  name: string;
  type: 'terms' | 'date_histogram' | 'range' | 'stats' | 'cardinality';
  field: string;
  size?: number;
  interval?: string;
  ranges?: Array<{ from?: number; to?: number; key?: string }>;
}

// 日志搜索结果
export interface LogSearchResult {
  logs: LogEntry[];
  total: number;
  page: number;
  limit: number;
  took: number;
  aggregations?: Record<string, any>;
  highlights?: Record<string, string[]>;
  suggestions?: string[];
}

// 日志统计参数
export interface LogStatsParams {
  service?: string;
  level?: LogLevel;
  source?: LogSource;
  query?: string;
  hostname?: string;
  excludeNodeIDs?: string[];
  startTime?: string | number;
  endTime?: string | number;
  timeRange: string; // '1h', '24h', '7d', '30d'
  groupBy: 'level' | 'service' | 'source' | 'hour' | 'day';
  tenantId: string;
  userId?: string;
  environment?: string;
  tags?: string[];
  interval?: string;
  originType?: LogOriginType;
  visibility?: LogVisibility;
  filters?: Record<string, any>;
}

// 日志统计结果
export interface LogStatsResult {
  total: number;
  timeRange: string;
  groupBy: string;
  data: Array<{
    key: string;
    count: number;
    percentage: number;
    trend?: number; // 相比上一周期的变化百分比
  }>;
  trends: {
    current: number;
    previous: number;
    change: number;
    changePercent: number;
  };
  topServices: Array<{
    service: string;
    count: number;
    errorRate: number;
  }>;
  errorRate: number;
  avgResponseTime?: number;
}

// 日志导出参数
export interface LogExportParams {
  format: 'json' | 'csv' | 'xlsx';
  query?: string;
  service?: string;
  level?: LogLevel;
  source?: LogSource;
  startTime?: string | number;
  endTime?: string | number;
  tenantId: string;
  userId?: string;
  limit?: number;
  fields?: string[];
  compression?: boolean;
  originType?: LogOriginType;
  visibility?: LogVisibility;
}

// 日志流参数
export interface LogStreamParams {
  service?: string;
  level?: LogLevel | LogLevel[];
  keywords?: string;
  source?: LogSource;
  tenantId: string;
  userId?: string;
  tags?: string[];
  environment?: string;
  filters?: Record<string, any>;
  bufferSize?: number;
  heartbeat?: boolean;
}

// 日志流连接
export interface LogStreamConnection {
  id: string;
  tenantId: string;
  userId?: string;
  params: LogStreamParams;
  response: any; // HTTP Response object
  createdAt: number;
  lastActivity: number;
  isActive: boolean;
  messageCount: number;
}

// API密钥接口
export interface ApiKey {
  id: string;
  key: string;
  name: string;
  description?: string;
  tenantId: string;
  userId: string;
  permissions: ApiPermission[];
  rateLimit?: {
    requestsPerMinute: number;
    requestsPerHour: number;
    requestsPerDay: number;
  };
  quotas?: {
    logsPerDay: number;
    storageGB: number;
    searchRequestsPerDay: number;
    exportRequestsPerDay: number;
  };
  isActive: boolean;
  expiresAt?: number;
  lastUsedAt?: number;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, any>;
}

// 配额接口
export interface Quota {
  tenantId: string;
  userId?: string;
  planId: string;
  resetInterval: 'daily' | 'weekly' | 'monthly';
  limits: {
    logsPerMinute: number;
    logsPerDay: number;
    storageGB: number;
    retentionDays: number;
    searchRequestsPerDay: number;
    exportRequestsPerDay: number;
    streamConnections: number;
  };
  usage: {
    logsToday: number;
    storageUsedGB: number;
    searchRequestsToday: number;
    exportRequestsToday: number;
    activeStreamConnections: number;
  };
  resetDate: string;
  warningThreshold: number; // 0.8 = 80%
  isExceeded: boolean;
  createdAt: number;
  updatedAt: number;
}

// 服务状态接口
export interface LogsState {
  serviceId?: string;
  startTime?: number;
  ips: string[];
  elasticsearchConnected: boolean;
  kafkaConsumers: any[];
  processingQueue: any[];
  lastFlushTime: number;
  timers: {
    dataProcessor: NodeJS.Timeout | null;
    quotaChecker: NodeJS.Timeout | null;
    batchProcessor: NodeJS.Timeout | null;
    elasticsearchReconnect?: NodeJS.Timeout | null;
    streamCleaner?: NodeJS.Timeout | null;
  };
  cache: {
    logs: Map<string, any>;
    quotas: Map<string, any>;
    searches: Map<string, any>;
    lastCacheUpdate: number;
  };
  stats: {
    processed: number;
    lastProcessed: number;
  };
}

// 日志处理器配置
export interface LogProcessorConfig {
  batchSize: number;
  flushInterval: number;
  maxRetries: number;
  supportedFormats: LogFormat[];
  maxConcurrentBatches: number;
  enableCompression: boolean;
  enableEncryption: boolean;
  sensitiveFields: string[];
}

// Elasticsearch配置
export interface ElasticsearchConfig {
  url: string;
  username?: string;
  password?: string;
  apiKey?: string;
  indexPrefix: string;
  maxRetries: number;
  requestTimeout: number;
  pingTimeout: number;
  sniffOnStart: boolean;
  sniffInterval: number;
  maxConnections: number;
  compression: boolean;
}

// 日志索引映射
export interface LogIndexMapping {
  properties: {
    '@timestamp': { type: 'date' };
    level: { type: 'keyword' };
    message: { type: 'text'; analyzer: 'standard' };
    service: { type: 'keyword' };
    source: { type: 'keyword' };
    tenantId: { type: 'keyword' };
    userId: { type: 'keyword' };
    sessionId: { type: 'keyword' };
    traceId: { type: 'keyword' };
    spanId: { type: 'keyword' };
    tags: { type: 'keyword' };
    environment: { type: 'keyword' };
    hostname: { type: 'keyword' };
    ip: { type: 'ip' };
    duration: { type: 'long' };
    statusCode: { type: 'integer' };
    metadata: { type: 'object'; enabled: false };
    error: {
      properties: {
        name: { type: 'keyword' };
        message: { type: 'text' };
        stack: { type: 'text'; index: false };
        code: { type: 'keyword' };
      };
    };
  };
}

// 错误代码
export enum LogErrorCode {
  INVALID_API_KEY = 'INVALID_API_KEY',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  INVALID_LOG_FORMAT = 'INVALID_LOG_FORMAT',
  ELASTICSEARCH_ERROR = 'ELASTICSEARCH_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  TENANT_NOT_FOUND = 'TENANT_NOT_FOUND',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

// 日志事件
export interface LogEvent {
  type: 'log.ingested' | 'log.processed' | 'log.exported' | 'quota.warning' | 'quota.exceeded';
  tenantId: string;
  userId?: string;
  data: any;
  timestamp: number;
  metadata?: Record<string, any>;
}

// 日志警报规则
export interface LogAlertRule {
  id: string;
  name: string;
  description?: string;
  tenantId: string;
  userId: string;
  isActive: boolean;
  conditions: {
    query?: string;
    level?: LogLevel[];
    service?: string[];
    source?: LogSource[];
    threshold: {
      count: number;
      timeWindow: string; // '5m', '1h', etc.
      operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq';
    };
  };
  actions: {
    type: 'email' | 'webhook' | 'slack';
    config: Record<string, any>;
  }[];
  cooldown: number; // 冷却时间（秒）
  lastTriggered?: number;
  createdAt: number;
  updatedAt: number;
}

// 日志仪表板配置
export interface LogDashboard {
  id: string;
  name: string;
  description?: string;
  tenantId: string;
  userId: string;
  isPublic: boolean;
  widgets: LogWidget[];
  layout: {
    columns: number;
    rows: number;
  };
  filters: {
    timeRange: string;
    service?: string;
    environment?: string;
  };
  refreshInterval: number;
  createdAt: number;
  updatedAt: number;
}

// 日志小部件
export interface LogWidget {
  id: string;
  type: 'chart' | 'table' | 'metric' | 'map';
  title: string;
  position: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  config: {
    query?: string;
    aggregation?: LogAggregation;
    visualization?: {
      chartType: 'line' | 'bar' | 'pie' | 'area';
      xAxis?: string;
      yAxis?: string;
      groupBy?: string;
    };
    fields?: string[];
    limit?: number;
  };
}

// API密钥创建请求
export interface CreateApiKeyRequest {
  name: string;
  description?: string;
  permissions?: ApiPermission[];
}

// API密钥创建响应
export interface CreateApiKeyResponse {
  id: string;
  name: string;
  key: string;
  permissions: ApiPermission[];
  createdAt: string;
}

// Elasticsearch查询构建器接口
export interface ESQueryBuilder {
  buildSearchQuery(params: LogSearchParams): any;
  buildStatsQuery(params: LogStatsParams): any;
  buildExportQuery(params: LogExportParams): any;
}

// 日志流事件
export interface LogStreamEvent {
  type: 'log' | 'error' | 'connected' | 'disconnected' | 'heartbeat' | 'message' | 'broadcast';
  data?: LogEntry | string;
  timestamp: string;
}

// 租户配置
export interface TenantConfig {
  id: string;
  name: string;
  maxLogsPerDay: number;
  retentionDays: number;
  allowedSources: LogSource[];
  isActive: boolean;
}

// 日志服务配置
export interface LogServiceConfig {
  elasticsearch: {
    node: string;
    index: string;
    password?: string;
  };
  pagination: {
    defaultLimit: number;
    maxLimit: number;
  };
  rateLimit: {
    maxRequestsPerMinute: number;
    maxBatchSize: number;
  };
}

// 错误响应接口
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: any;
  };
  timestamp: string;
}

// 成功响应接口
export interface SuccessResponse<T = any> {
  success: true;
  data: T;
  timestamp: string;
}
