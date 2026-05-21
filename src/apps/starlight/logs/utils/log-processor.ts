/**
 * 日志处理器工具类
 * 负责日志的格式化、验证、清理和转换
 */

import { BaseLog, StoredLog, LogLevel, LogSource } from '../types';
import { LOG_LEVELS, LOG_SOURCES, SENSITIVE_FIELDS, MAX_LOG_SIZE } from '../constants';
import { grokParser } from './grok-parser';

export class LogProcessor {
  private sensitiveFields: Set<string>;

  constructor() {
    this.sensitiveFields = new Set(SENSITIVE_FIELDS);
  }

  /**
   * 验证日志格式
   */
  validateLog(log: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // 检查必需字段
    if (!log.message || typeof log.message !== 'string') {
      errors.push('message字段是必需的且必须是字符串');
    }

    if (!log.timestamp) {
      errors.push('timestamp字段是必需的');
    }

    if (!log.level || !LOG_LEVELS.includes(log.level)) {
      errors.push(`level字段必须是以下值之一: ${LOG_LEVELS.join(', ')}`);
    }

    if (log.source && !LOG_SOURCES.includes(log.source)) {
      errors.push(`source字段必须是以下值之一: ${LOG_SOURCES.join(', ')}`);
    }

    // 检查日志大小
    const logSize = JSON.stringify(log).length;
    if (logSize > MAX_LOG_SIZE) {
      errors.push(`日志大小超过限制 (${MAX_LOG_SIZE} bytes)`);
    }

    // 检查字段类型
    if (log.userId && typeof log.userId !== 'string') {
      errors.push('userId必须是字符串');
    }

    if (log.sessionId && typeof log.sessionId !== 'string') {
      errors.push('sessionId必须是字符串');
    }

    if (log.traceId && typeof log.traceId !== 'string') {
      errors.push('traceId必须是字符串');
    }

    if (log.service && typeof log.service !== 'string') {
      errors.push('service必须是字符串');
    }

    if (log.metadata && typeof log.metadata !== 'object') {
      errors.push('metadata必须是对象');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * 标准化日志格式
   */
  normalizeLog(log: BaseLog, tenantId: string): StoredLog {
    const now = new Date().toISOString();

    return {
      id: this.generateLogId(),
      tenantId,
      timestamp: this.normalizeTimestamp(log.timestamp || new Date().toISOString()),
      level: log.level,
      message: this.sanitizeMessage(log.message),
      service: log.service || 'unknown',
      hostname: log.hostname,
      containerId: log.containerId,
      source: log.source || LogSource.SERVER,
      originType: log.originType || 'microservice',
      visibility: log.visibility || 'tenant',
      nodeID: log.nodeID,
      namespace: log.namespace,
      mod: log.mod,
      svc: log.svc,
      version: log.version,
      userId: log.userId,
      sessionId: log.sessionId,
      traceId: log.traceId,
      metadata: this.sanitizeMetadata(log.metadata || {}),
      apiKeyId: '',
      indexed: false,
      createdAt: now,
      updatedAt: now,
      receivedAt: now,
    };
  }

  /**
   * 批量处理日志
   */
  processBatch(
    logs: BaseLog[],
    tenantId: string,
  ): {
    processed: StoredLog[];
    errors: Array<{ index: number; error: string; log: any }>;
  } {
    const processed: StoredLog[] = [];
    const errors: Array<{ index: number; error: string; log: any }> = [];

    logs.forEach((log, index) => {
      try {
        const validation = this.validateLog(log);
        if (!validation.valid) {
          errors.push({
            index,
            error: validation.errors.join(', '),
            log,
          });
          return;
        }

        const normalizedLog = this.normalizeLog(log, tenantId);
        processed.push(normalizedLog);
      } catch (error) {
        errors.push({
          index,
          error: error instanceof Error ? error.message : '未知错误',
          log,
        });
      }
    });

    return { processed, errors };
  }

  /**
   * 清理敏感信息
   */
  sanitizeMetadata(metadata: Record<string, any>): Record<string, any> {
    const sanitized = { ...metadata };

    // 递归清理敏感字段
    this.sanitizeObject(sanitized);

    return sanitized;
  }

  /**
   * 递归清理对象中的敏感信息
   */
  private sanitizeObject(obj: any): void {
    if (!obj || typeof obj !== 'object') {
      return;
    }

    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const lowerKey = key.toLowerCase();

        // 检查是否是敏感字段
        if (this.isSensitiveField(lowerKey)) {
          obj[key] = '[REDACTED]';
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          // 递归处理嵌套对象
          this.sanitizeObject(obj[key]);
        }
      }
    }
  }

  /**
   * 检查是否是敏感字段
   */
  private isSensitiveField(fieldName: string): boolean {
    return Array.from(this.sensitiveFields).some((sensitive) => fieldName.includes(sensitive));
  }

  /**
   * 清理消息内容
   */
  private sanitizeMessage(message: string): string {
    if (!message || typeof message !== 'string') {
      return '';
    }

    // 移除潜在的敏感信息模式
    let sanitized = message;

    // 清理信用卡号
    sanitized = sanitized.replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[CREDIT_CARD]');

    // 清理邮箱
    sanitized = sanitized.replace(
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      '[EMAIL]',
    );

    // 清理电话号码
    sanitized = sanitized.replace(/\b\d{3}[\s-]?\d{3}[\s-]?\d{4}\b/g, '[PHONE]');

    // 清理JWT token
    sanitized = sanitized.replace(
      /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\b/g,
      '[JWT_TOKEN]',
    );

    // 清理API密钥模式
    sanitized = sanitized.replace(/\b[A-Za-z0-9]{32,}\b/g, '[API_KEY]');

    return sanitized;
  }

  /**
   * 标准化时间戳
   */
  private normalizeTimestamp(timestamp: string | number | Date): string {
    try {
      if (typeof timestamp === 'string') {
        return new Date(timestamp).toISOString();
      } else if (typeof timestamp === 'number') {
        return new Date(timestamp).toISOString();
      } else if (timestamp instanceof Date) {
        return timestamp.toISOString();
      } else {
        return new Date().toISOString();
      }
    } catch (error) {
      return new Date().toISOString();
    }
  }

  /**
   * 生成唯一日志ID
   */
  private generateLogId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 15);
    return `log_${timestamp}_${random}`;
  }

  /**
   * 解析结构化日志
   */
  parseStructuredLog(logString: string): BaseLog | null {
    try {
      // 尝试解析JSON格式
      const parsed = JSON.parse(logString);
      return this.validateAndConvertToBaseLog(parsed);
    } catch (error) {
      // 尝试解析其他格式（如syslog）
      return this.parsePlainTextLog(logString);
    }
  }

  /**
   * 解析纯文本日志
   */
  private parsePlainTextLog(logString: string): BaseLog | null {
    try {
      // 1. 尝试使用 Grok 解析器
      const grokResult = grokParser.parse(logString);
      if (grokResult) {
        return {
          level: (grokResult.level?.toLowerCase() as LogLevel) || LogLevel.INFO,
          timestamp: grokResult.timestamp || new Date().toISOString(),
          message: grokResult.message || logString,
          service: grokResult.service,
          traceId: grokResult.traceId,
          metadata: grokResult.metadata,
        };
      }

      // 2. 简单的日志格式解析：[LEVEL] TIMESTAMP MESSAGE
      const match = logString.match(/^\[([A-Z]+)\]\s+(\S+)\s+(.+)$/);

      if (match) {
        const [, level, timestamp, message] = match;
        return {
          level: level.toLowerCase() as LogLevel,
          timestamp: timestamp,
          message: message.trim(),
        };
      }

      // 3. 如果无法解析，创建一个基本的日志条目
      return {
        level: LogLevel.INFO,
        timestamp: new Date().toISOString(),
        message: logString,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * 验证并转换为BaseLog格式
   */
  private validateAndConvertToBaseLog(obj: any): BaseLog | null {
    if (!obj || typeof obj !== 'object') {
      return null;
    }

    const baseLog: BaseLog = {
      level: obj.level || 'info',
      timestamp: obj.timestamp || new Date().toISOString(),
      message: obj.message || obj.msg || '',
    };

    // 可选字段
    if (obj.service) baseLog.service = obj.service;
    if (obj.source) baseLog.source = obj.source;
    if (obj.userId) baseLog.userId = obj.userId;
    if (obj.sessionId) baseLog.sessionId = obj.sessionId;
    if (obj.traceId) baseLog.traceId = obj.traceId;
    if (obj.metadata) baseLog.metadata = obj.metadata;

    return baseLog;
  }

  /**
   * 计算日志统计信息
   */
  calculateLogStats(logs: StoredLog[]): {
    total: number;
    byLevel: Record<LogLevel, number>;
    byService: Record<string, number>;
    bySource: Record<LogSource, number>;
    timeRange: { start: string; end: string } | null;
  } {
    const stats = {
      total: logs.length,
      byLevel: {} as Record<LogLevel, number>,
      byService: {} as Record<string, number>,
      bySource: {} as Record<LogSource, number>,
      timeRange: null as { start: string; end: string } | null,
    };

    if (logs.length === 0) {
      return stats;
    }

    // 初始化计数器
    LOG_LEVELS.forEach((level) => {
      stats.byLevel[level] = 0;
    });

    LOG_SOURCES.forEach((source) => {
      stats.bySource[source] = 0;
    });

    // 计算统计信息
    let minTime = logs[0].timestamp;
    let maxTime = logs[0].timestamp;

    logs.forEach((log) => {
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

    return stats;
  }

  /**
   * 格式化日志用于显示
   */
  formatLogForDisplay(log: StoredLog, format: 'json' | 'text' = 'json'): string {
    if (format === 'text') {
      return `[${log.level.toUpperCase()}] ${log.timestamp} ${log.service || 'unknown'}: ${log.message}`;
    }

    return JSON.stringify(
      {
        id: log.id,
        timestamp: log.timestamp,
        level: log.level,
        service: log.service,
        message: log.message,
        metadata: log.metadata,
      },
      null,
      2,
    );
  }
}

// 导出单例实例
export const logProcessor = new LogProcessor();
