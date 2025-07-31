/**
 * 日志工具类
 * 提供各种日志处理的辅助功能
 */

import crypto from 'crypto';
import { StoredLog, LogLevel, LogSource, LogSearchParams, BaseLog } from '../types';
import { LOG_LEVELS, LOG_SOURCES } from '../constants';

export class LogUtils {
  /**
   * 格式化时间范围
   */
  static formatTimeRange(startTime?: string, endTime?: string): { gte?: string; lte?: string } {
    const range: { gte?: string; lte?: string } = {};
    
    if (startTime) {
      range.gte = new Date(startTime).toISOString();
    }
    
    if (endTime) {
      range.lte = new Date(endTime).toISOString();
    }
    
    return range;
  }

  /**
   * 解析相对时间（如 '1h', '30m', '7d'）
   */
  static parseRelativeTime(relativeTime: string): { startTime: string; endTime: string } {
    const now = new Date();
    const endTime = now.toISOString();
    
    const match = relativeTime.match(/^(\d+)([smhd])$/);
    if (!match) {
      throw new Error('无效的相对时间格式，支持格式：1s, 30m, 2h, 7d');
    }
    
    const [, amount, unit] = match;
    const value = parseInt(amount, 10);
    
    let milliseconds: number;
    switch (unit) {
      case 's':
        milliseconds = value * 1000;
        break;
      case 'm':
        milliseconds = value * 60 * 1000;
        break;
      case 'h':
        milliseconds = value * 60 * 60 * 1000;
        break;
      case 'd':
        milliseconds = value * 24 * 60 * 60 * 1000;
        break;
      default:
        throw new Error('不支持的时间单位');
    }
    
    const startTime = new Date(now.getTime() - milliseconds).toISOString();
    
    return { startTime, endTime };
  }

  /**
   * 解析时间范围（如 '1h', '24h', '7d', '30d'）
   */
  static parseTimeRange(timeRange: string): { start: string; end: string } {
    const now = new Date();
    const end = now.toISOString();
    
    let start: Date;
    
    if (timeRange.endsWith('h')) {
      const hours = parseInt(timeRange.slice(0, -1));
      start = new Date(now.getTime() - hours * 60 * 60 * 1000);
    } else if (timeRange.endsWith('d')) {
      const days = parseInt(timeRange.slice(0, -1));
      start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    } else {
      // 默认24小时
      start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }

    return {
      start: start.toISOString(),
      end
    };
  }



  /**
   * 验证日志级别
   */
  static isValidLogLevel(level: string): level is LogLevel {
    return LOG_LEVELS.includes(level as LogLevel);
  }

  /**
   * 验证日志来源
   */
  static isValidLogSource(source: string): source is LogSource {
    return LOG_SOURCES.includes(source as LogSource);
  }

  /**
   * 获取日志级别的数值权重（用于排序和过滤）
   */
  static getLogLevelWeight(level: LogLevel): number {
    const weights: Record<LogLevel, number> = {
      trace: 0,
      debug: 1,
      info: 2,
      warn: 3,
      error: 4,
      fatal: 5
    };
    return weights[level] || 0;
  }

  /**
   * 过滤日志级别（返回指定级别及以上的日志）
   */
  static filterByLogLevel(logs: StoredLog[], minLevel: LogLevel): StoredLog[] {
    const minWeight = this.getLogLevelWeight(minLevel);
    return logs.filter(log => this.getLogLevelWeight(log.level) >= minWeight);
  }

  /**
   * 按时间排序日志
   */
  static sortByTimestamp(logs: StoredLog[], order: 'asc' | 'desc' = 'desc'): StoredLog[] {
    return logs.sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      return order === 'desc' ? timeB - timeA : timeA - timeB;
    });
  }

  /**
   * 分组日志（按指定字段）
   */
  static groupLogs<K extends keyof StoredLog>(
    logs: StoredLog[],
    groupBy: K
  ): Record<string, StoredLog[]> {
    const groups: Record<string, StoredLog[]> = {};
    
    logs.forEach(log => {
      const key = String(log[groupBy] || 'unknown');
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(log);
    });
    
    return groups;
  }

  /**
   * 计算日志统计信息
   */
  static calculateStats(logs: StoredLog[]): {
    total: number;
    byLevel: Record<LogLevel, number>;
    byService: Record<string, number>;
    bySource: Record<LogSource, number>;
    timeRange: { start: string; end: string } | null;
    avgLogsPerMinute: number;
  } {
    const stats = {
      total: logs.length,
      byLevel: {} as Record<LogLevel, number>,
      byService: {} as Record<string, number>,
      bySource: {} as Record<LogSource, number>,
      timeRange: null as { start: string; end: string } | null,
      avgLogsPerMinute: 0
    };

    if (logs.length === 0) {
      return stats;
    }

    // 初始化计数器
    LOG_LEVELS.forEach(level => {
      stats.byLevel[level] = 0;
    });

    LOG_SOURCES.forEach(source => {
      stats.bySource[source] = 0;
    });

    // 计算统计信息
    let minTime = logs[0].timestamp;
    let maxTime = logs[0].timestamp;

    logs.forEach(log => {
      // 按级别统计
      stats.byLevel[log.level]++;

      // 按服务统计
      const service = log.service || 'unknown';
      stats.byService[service] = (stats.byService[service] || 0) + 1;

      // 按来源统计
      if (log.source) {
        stats.bySource[log.source]++;
      }

      // 时间范围
      if (log.timestamp < minTime) minTime = log.timestamp;
      if (log.timestamp > maxTime) maxTime = log.timestamp;
    });

    stats.timeRange = { start: minTime, end: maxTime };

    // 计算平均每分钟日志数
    const timeSpanMs = new Date(maxTime).getTime() - new Date(minTime).getTime();
    const timeSpanMinutes = timeSpanMs / (1000 * 60);
    stats.avgLogsPerMinute = timeSpanMinutes > 0 ? logs.length / timeSpanMinutes : 0;

    return stats;
  }

  /**
   * 生成时间直方图数据
   */
  static generateTimeHistogram(
    logs: StoredLog[],
    interval: '1m' | '5m' | '15m' | '1h' | '1d' = '5m'
  ): Array<{ timestamp: string; count: number }> {
    if (logs.length === 0) {
      return [];
    }

    // 获取间隔毫秒数
    const intervalMs = this.getIntervalMs(interval);
    
    // 找到时间范围
    const timestamps = logs.map(log => new Date(log.timestamp).getTime());
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);
    
    // 对齐到间隔边界
    const startTime = Math.floor(minTime / intervalMs) * intervalMs;
    const endTime = Math.ceil(maxTime / intervalMs) * intervalMs;
    
    // 创建时间桶
    const buckets: Record<number, number> = {};
    
    // 初始化所有桶
    for (let time = startTime; time <= endTime; time += intervalMs) {
      buckets[time] = 0;
    }
    
    // 分配日志到桶中
    logs.forEach(log => {
      const logTime = new Date(log.timestamp).getTime();
      const bucketTime = Math.floor(logTime / intervalMs) * intervalMs;
      buckets[bucketTime] = (buckets[bucketTime] || 0) + 1;
    });
    
    // 转换为数组格式
    return Object.entries(buckets)
      .map(([timestamp, count]) => ({
        timestamp: new Date(parseInt(timestamp)).toISOString(),
        count
      }))
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  /**
   * 获取间隔毫秒数
   */
  private static getIntervalMs(interval: string): number {
    switch (interval) {
      case '1m': return 60 * 1000;
      case '5m': return 5 * 60 * 1000;
      case '15m': return 15 * 60 * 1000;
      case '1h': return 60 * 60 * 1000;
      case '1d': return 24 * 60 * 60 * 1000;
      default: return 5 * 60 * 1000;
    }
  }

  /**
   * 提取日志中的关键词
   */
  static extractKeywords(logs: StoredLog[], minFrequency: number = 2): Array<{ keyword: string; count: number }> {
    const wordCounts: Record<string, number> = {};
    
    logs.forEach(log => {
      // 提取消息中的单词
      const words = log.message
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 2); // 过滤短词
      
      words.forEach(word => {
        wordCounts[word] = (wordCounts[word] || 0) + 1;
      });
    });
    
    return Object.entries(wordCounts)
      .filter(([, count]) => count >= minFrequency)
      .map(([keyword, count]) => ({ keyword, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50); // 返回前50个关键词
  }

  /**
   * 检测异常模式
   */
  static detectAnomalies(logs: StoredLog[]): {
    errorSpikes: Array<{ timestamp: string; count: number }>;
    unusualServices: Array<{ service: string; count: number }>;
    suspiciousPatterns: Array<{ pattern: string; count: number }>;
  } {
    const result = {
      errorSpikes: [] as Array<{ timestamp: string; count: number }>,
      unusualServices: [] as Array<{ service: string; count: number }>,
      suspiciousPatterns: [] as Array<{ pattern: string; count: number }>
    };

    // 检测错误峰值
    const errorLogs = logs.filter(log => log.level === 'error' || log.level === 'fatal');
    const errorHistogram = this.generateTimeHistogram(errorLogs, '5m');
    
    const avgErrorCount = errorHistogram.reduce((sum, bucket) => sum + bucket.count, 0) / errorHistogram.length;
    const threshold = avgErrorCount * 3; // 3倍平均值作为阈值
    
    result.errorSpikes = errorHistogram.filter(bucket => bucket.count > threshold);

    // 检测异常服务
    const serviceStats = this.calculateStats(logs).byService;
    const avgServiceCount = Object.values(serviceStats).reduce((sum, count) => sum + count, 0) / Object.keys(serviceStats).length;
    const serviceThreshold = avgServiceCount * 0.1; // 低于10%平均值的服务
    
    result.unusualServices = Object.entries(serviceStats)
      .filter(([, count]) => count < serviceThreshold)
      .map(([service, count]) => ({ service, count }));

    // 检测可疑模式（简单实现）
    const patterns: Record<string, number> = {};
    logs.forEach(log => {
      // 检测重复错误消息
      if (log.level === 'error') {
        const pattern = log.message.substring(0, 50); // 取前50个字符作为模式
        patterns[pattern] = (patterns[pattern] || 0) + 1;
      }
    });
    
    result.suspiciousPatterns = Object.entries(patterns)
      .filter(([, count]) => count > 5) // 出现5次以上的模式
      .map(([pattern, count]) => ({ pattern, count }))
      .sort((a, b) => b.count - a.count);

    return result;
  }

  /**
   * 格式化文件大小
   */
  static formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  /**
   * 格式化持续时间
   */
  static formatDuration(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
      return `${days}天 ${hours % 24}小时`;
    } else if (hours > 0) {
      return `${hours}小时 ${minutes % 60}分钟`;
    } else if (minutes > 0) {
      return `${minutes}分钟 ${seconds % 60}秒`;
    } else {
      return `${seconds}秒`;
    }
  }

  /**
   * 生成日志摘要
   */
  static generateSummary(logs: StoredLog[]): {
    overview: string;
    keyMetrics: Record<string, any>;
    recommendations: string[];
  } {
    const stats = this.calculateStats(logs);
    const anomalies = this.detectAnomalies(logs);
    
    const overview = `分析了 ${stats.total} 条日志，时间范围从 ${stats.timeRange?.start} 到 ${stats.timeRange?.end}。`;
    
    const keyMetrics = {
      totalLogs: stats.total,
      errorRate: ((stats.byLevel.error + stats.byLevel.fatal) / stats.total * 100).toFixed(2) + '%',
      topService: Object.entries(stats.byService).sort(([,a], [,b]) => b - a)[0]?.[0] || 'unknown',
      avgLogsPerMinute: stats.avgLogsPerMinute.toFixed(2),
      errorSpikes: anomalies.errorSpikes.length,
      suspiciousPatterns: anomalies.suspiciousPatterns.length
    };
    
    const recommendations: string[] = [];
    
    if (keyMetrics.errorRate > '5%') {
      recommendations.push('错误率较高，建议检查应用程序状态');
    }
    
    if (anomalies.errorSpikes.length > 0) {
      recommendations.push('检测到错误峰值，建议调查相关时间段的问题');
    }
    
    if (anomalies.suspiciousPatterns.length > 0) {
      recommendations.push('发现重复错误模式，建议修复相关问题');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('日志状态正常，无明显异常');
    }
    
    return { overview, keyMetrics, recommendations };
  }

  /**
   * 验证搜索参数
   */
  static validateSearchParams(params: LogSearchParams): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    // 验证时间范围
    if (params.startTime && params.endTime) {
      const start = new Date(params.startTime);
      const end = new Date(params.endTime);
      
      if (start >= end) {
        errors.push('开始时间必须早于结束时间');
      }
      
      // 检查时间范围是否过大（超过30天）
      const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays > 30) {
        errors.push('时间范围不能超过30天');
      }
    }
    
    // 验证分页参数
    if (params.size && (params.size < 1 || params.size > 1000)) {
      errors.push('分页大小必须在1-1000之间');
    }
    
    if (params.from && params.from < 0) {
      errors.push('分页偏移量不能为负数');
    }
    
    // 验证日志级别
    if (params.level) {
      const levels = Array.isArray(params.level) ? params.level : [params.level];
      const invalidLevels = levels.filter(level => !this.isValidLogLevel(level));
      if (invalidLevels.length > 0) {
        errors.push(`无效的日志级别: ${invalidLevels.join(', ')}`);
      }
    }
    
    // 验证日志来源
    if (params.source) {
      const sources = Array.isArray(params.source) ? params.source : [params.source];
      const invalidSources = sources.filter(source => !this.isValidLogSource(source));
      if (invalidSources.length > 0) {
        errors.push(`无效的日志来源: ${invalidSources.join(', ')}`);
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
}

// 导出工具类
export const logUtils = LogUtils;

// 以下是从 src/utils/log-utils.ts 合并过来的独有函数

/**
 * 日志格式验证相关函数
 */
export function validateLogFormat(log: BaseLog): boolean {
  if (!log.level || !log.message) {
    return false;
  }

  const validLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
  if (!validLevels.includes(log.level)) {
    return false;
  }

  if (log.source && !['server', 'client'].includes(log.source)) {
    return false;
  }

  return true;
}

/**
 * 批量日志格式验证
 */
export function validateBatchLogFormat(logs: any[], format: string) {
  const errors: string[] = [];
  const validLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];

    // 基本结构验证
    if (!log || typeof log !== 'object') {
      errors.push(`日志 ${i + 1}: 无效的日志结构`);
      continue;
    }

    // 必需字段验证
    if (!log.message || typeof log.message !== 'string') {
      errors.push(`日志 ${i + 1}: 消息是必需的，且必须是字符串`);
    }

    // 日志级别验证
    if (log.level && !validLevels.includes(log.level)) {
      errors.push(`日志 ${i + 1}: 无效的日志级别 '${log.level}'`);
    }

    // 时间戳验证
    if (log.timestamp && isNaN(new Date(log.timestamp).getTime())) {
      errors.push(`日志 ${i + 1}: 无效的时间戳格式`);
    }

    // 消息长度验证
    if (log.message && log.message.length > 10000) {
      errors.push(`日志 ${i + 1}: 消息过长（最大 10000 个字符）`);
    }
  }

  return {
    valid: errors.length === 0,
    message: errors.length > 0 ? `发现 ${errors.length} 个验证错误` : '所有日志均有效',
    errors,
  };
}

/**
 * 日志转换相关函数
 */
export function transformToStoredLog(log: BaseLog, apiKeyId: string, tenantId: string): StoredLog {
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    level: log.level,
    message: log.message,
    timestamp: typeof log.timestamp === 'string' ? log.timestamp : now,
    source: log.source || LogSource.SERVER,
    metadata: log.metadata || {},
    tags: log.tags || [],
    apiKeyId,
    tenantId,
    indexed: true,
    createdAt: now,
    updatedAt: now,
    receivedAt: now,
  };
}

/**
 * 敏感信息清理相关函数
 */
export function sanitizeLog(log: BaseLog): BaseLog {
  const sanitized = { ...log };

  // 清理消息中的敏感信息
  if (sanitized.message) {
    sanitized.message = removeSensitiveData(sanitized.message);
  }

  // 清理元数据中的敏感信息
  if (sanitized.metadata) {
    sanitized.metadata = sanitizeMetadata(sanitized.metadata);
  }

  return sanitized;
}

export function removeSensitiveData(text: string): string {
  // 移除可能的密码、令牌等敏感信息
  const patterns = [
    /password["']?\s*[:=]\s*["']?[^\s"',}]+/gi,
    /token["']?\s*[:=]\s*["']?[^\s"',}]+/gi,
    /key["']?\s*[:=]\s*["']?[^\s"',}]+/gi,
    /secret["']?\s*[:=]\s*["']?[^\s"',}]+/gi,
  ];

  let sanitized = text;
  patterns.forEach((pattern) => {
    sanitized = sanitized.replace(pattern, (match) => {
      const parts = match.split(/[:=]/);
      return parts[0] + (parts[1] ? ': [REDACTED]' : '');
    });
  });

  return sanitized;
}

export function sanitizeMetadata(metadata: Record<string, any>): Record<string, any> {
  const sanitized = { ...metadata };
  const sensitiveKeys = ['password', 'token', 'key', 'secret', 'auth', 'authorization'];

  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some((sensitive) => key.toLowerCase().includes(sensitive))) {
      sanitized[key] = '[REDACTED]';
    }
  }

  return sanitized;
}

/**
 * ID生成相关函数
 */
export function generateLogId(): string {
  return `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function generateBatchId(): string {
  return `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 导出格式验证和转换函数
 */
export function validateExportParams(params: { format: string; limit: number }): boolean {
  // 验证格式
  const validFormats = ['json', 'csv'];
  if (!validFormats.includes(params.format)) {
    return false;
  }

  // 验证限制
  if (params.limit <= 0 || params.limit > 50000) {
    return false;
  }

  return true;
}

export function convertToJSON(logs: StoredLog[]): string {
  const exportData = {
    metadata: {
      exportedAt: new Date().toISOString(),
      count: logs.length,
      version: '1.0',
    },
    logs: logs.map((log) => ({
      id: log.id,
      timestamp: log.timestamp,
      level: log.level,
      message: log.message,
      service: log.service,
      source: log.source,
      userId: log.userId,
      sessionId: log.sessionId,
      traceId: log.traceId,
      metadata: log.metadata,
      receivedAt: log.receivedAt,
    })),
  };

  return JSON.stringify(exportData, null, 2);
}

export function convertToCSV(logs: StoredLog[]): string {
  if (logs.length === 0) {
    return 'timestamp,level,message,service,source,userId,sessionId,traceId,metadata\n';
  }

  // CSV头部
  const headers = [
    'timestamp',
    'level',
    'message',
    'service',
    'source',
    'userId',
    'sessionId',
    'traceId',
    'metadata',
    'receivedAt',
  ];

  const csvRows = [headers.join(',')];

  // 转换每一行数据
  logs.forEach((log) => {
    const row = [
      escapeCsvValue(log.timestamp),
      escapeCsvValue(log.level),
      escapeCsvValue(log.message),
      escapeCsvValue(log.service || ''),
      escapeCsvValue(log.source || ''),
      escapeCsvValue(log.userId || ''),
      escapeCsvValue(log.sessionId || ''),
      escapeCsvValue(log.traceId || ''),
      escapeCsvValue(JSON.stringify(log.metadata || {})),
      escapeCsvValue(log.receivedAt),
    ];
    csvRows.push(row.join(','));
  });

  return csvRows.join('\n');
}

export function escapeCsvValue(value: string): string {
  if (value === null || value === undefined) {
    return '';
  }

  const stringValue = String(value);

  // 如果包含逗号、引号或换行符，需要用引号包围并转义内部引号
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

/**
 * 搜索参数验证函数
 */
export function validateSearchParams(params: any): boolean {
  // 验证时间范围
  if (params.startTime && params.endTime) {
    const start = new Date(params.startTime);
    const end = new Date(params.endTime);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return false;
    }

    if (start >= end) {
      return false;
    }

    // 限制查询时间范围（最多90天）
    const maxRange = 90 * 24 * 60 * 60 * 1000; // 90天
    if (end.getTime() - start.getTime() > maxRange) {
      return false;
    }
  }

  // 验证排序字段
  const validSortFields = ['timestamp', 'level', 'service', 'source', 'receivedAt'];
  if (params.sortBy && !validSortFields.includes(params.sortBy)) {
    return false;
  }

  return true;
}

export function buildHighlightConfig(query?: string) {
  if (!query) return undefined;

  return {
    fields: {
      message: {
        pre_tags: ['<mark>'],
        post_tags: ['</mark>'],
        fragment_size: 150,
        number_of_fragments: 3,
      },
      'metadata.*': {
        pre_tags: ['<mark>'],
        post_tags: ['</mark>'],
        fragment_size: 100,
        number_of_fragments: 1,
      },
    },
  };
}

export function generateCacheKey(params: any, tenantId: string): string {
  const keyParts = [
    'search',
    tenantId,
    params.query || 'all',
    params.service || 'all',
    params.level || 'all',
    params.source || 'all',
    params.startTime || 'nostart',
    params.endTime || 'noend',
    params.page || 1,
    params.limit || 50,
    params.sortBy || 'timestamp',
    params.sortOrder || 'desc',
  ];

  return keyParts.join(':');
}

/**
 * 统计参数验证函数
 */
export function validateStatsParams(params: {
  service?: string;
  timeRange: string;
  groupBy: string;
}): boolean {
  // 验证时间范围
  const validTimeRanges = ['1h', '6h', '12h', '24h', '7d', '30d'];
  if (!validTimeRanges.includes(params.timeRange)) {
    return false;
  }

  // 验证分组字段
  const validGroupByFields = ['level', 'service', 'source', 'hour', 'day'];
  if (!validGroupByFields.includes(params.groupBy)) {
    return false;
  }

  return true;
}