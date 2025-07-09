/**
 * 指标数据微服务类型定义
 */
import { DatabaseState } from '../../db/mysql';

/**
 * 指标数据微服务全局状态接口
 * 继承通用数据库状态接口
 */
export interface MetricsState extends DatabaseState {
  influxdbConnected: boolean;
  kafkaConsumers: any[];
  processingQueue: MetricsBatch[];
  lastFlushTime: number;
  timers: {
    dataProcessor: NodeJS.Timeout | null;
    quotaChecker: NodeJS.Timeout | null;
    batchProcessor: NodeJS.Timeout | null;
  };
  cache: {
    metrics: Map<string, any>;
    quotas: Map<string, any>;
    aggregations: Map<string, any>;
  };
  stats: {
    processed: number;
    lastProcessed: number;
  };
}

/**
 * 指标数据批次接口
 */
export interface MetricsBatch {
  id: string;
  format: string;
  data: any[];
  timestamp: number;
  retryCount: number;
}

/**
 * 原始指标数据接口
 */
export interface RawMetricsData {
  source: string;
  format: 'prometheus' | 'statsd' | 'datadog' | 'otlp' | 'custom' | 'official';
  timestamp: number;
  data: any;
  metadata?: {
    userId?: string;
    appKeyId?: string;
    tags?: Record<string, string>;
  };
}

/**
 * 处理后的指标数据接口
 */
export interface ProcessedMetricsData {
  measurement: string;
  tags: Record<string, string>;
  fields: Record<string, number | string | boolean>;
  timestamp: number;
}

/**
 * 配额警告参数接口
 */
export interface QuotaWarningParams {
  userId: string;
  quotaType: string;
  usage: number;
  limit: number;
  threshold: number;
  email?: string;
}

/**
 * InfluxDB连接配置接口
 */
export interface InfluxDBConfig {
  url: string;
  token: string;
  org: string;
  bucket: string;
}

/**
 * Kafka消费者配置接口
 */
export interface KafkaConsumerConfig {
  topic: string;
  groupId: string;
  handler: (message: any) => Promise<void>;
}