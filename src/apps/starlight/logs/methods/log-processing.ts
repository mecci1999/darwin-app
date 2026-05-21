/**
 * 日志处理方法
 * 处理日志的解析、转换、增强和批处理
 */

import { Context } from 'node-universe';
import { LogEntry, LogFormat, StoredLog, LogLevel, LogSource } from '../types';
import { LogUtils } from '../utils/log-utils';
import { QuotaChecker } from '../utils/quota-checker';
import { LOG_LEVELS, LOG_SOURCES, MAX_LOG_SIZE, MAX_BATCH_SIZE } from '../constants';

/**
 * 处理单条日志
 */
export async function processSingleLog(
  ctx: Context,
  params: {
    log: LogEntry;
    tenantId: string;
    userId?: string;
    format?: LogFormat;
    enhance?: boolean;
  },
): Promise<{
  processedLog: LogEntry;
  processingTime: number;
  warnings?: string[];
}> {
  const startTime = Date.now();
  const warnings: string[] = [];

  try {
    const { log, tenantId, userId, format = 'json', enhance = true } = params;

    // 验证日志大小
    const logSize = JSON.stringify(log).length;
    if (logSize > MAX_LOG_SIZE) {
      throw new Error(`Log size ${logSize} exceeds maximum allowed size ${MAX_LOG_SIZE}`);
    }

    // 标准化日志格式
    let processedLog = await normalizeLogEntry(log, format, tenantId);

    // 验证必需字段
    const validationResult = validateLogEntry(processedLog);
    if (!validationResult.isValid) {
      throw new Error(`Invalid log entry: ${validationResult.errors.join(', ')}`);
    }

    // 增强日志信息
    if (enhance) {
      processedLog = await enhanceLogEntry(ctx, processedLog, tenantId, userId);
    }

    // 添加处理元数据
    processedLog.metadata = {
      ...processedLog.metadata,
      tenantId,
      userId,
      processedAt: new Date(),
      processingTime: Date.now() - startTime,
      format,
      enhanced: enhance,
    };

    const processingTime = Date.now() - startTime;

    return {
      processedLog,
      processingTime,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (error) {
    ctx.service?.logger?.error('Failed to process single log:', error);
    throw error;
  }
}

/**
 * 批量处理日志
 */
export async function processBatchLogs(
  ctx: Context,
  params: {
    logs: LogEntry[];
    tenantId: string;
    userId?: string;
    format?: LogFormat;
    enhance?: boolean;
    parallel?: boolean;
  },
): Promise<{
  processedLogs: LogEntry[];
  failedLogs: Array<{ log: LogEntry; error: string }>;
  processingTime: number;
  statistics: {
    total: number;
    processed: number;
    failed: number;
    warnings: number;
  };
}> {
  const startTime = Date.now();

  try {
    const { logs, tenantId, userId, format = 'json', enhance = true, parallel = true } = params;

    // 验证批次大小
    if (logs.length > MAX_BATCH_SIZE) {
      throw new Error(`Batch size ${logs.length} exceeds maximum allowed size ${MAX_BATCH_SIZE}`);
    }

    const processedLogs: LogEntry[] = [];
    const failedLogs: Array<{ log: LogEntry; error: string }> = [];
    let warningCount = 0;

    if (parallel) {
      // 并行处理
      const results = await Promise.allSettled(
        logs.map((log) =>
          processSingleLog(ctx, {
            log,
            tenantId,
            userId,
            format,
            enhance,
          }),
        ),
      );

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          processedLogs.push(result.value.processedLog);
          if (result.value.warnings) {
            warningCount += result.value.warnings.length;
          }
        } else {
          failedLogs.push({
            log: logs[index],
            error: result.reason?.message || 'Unknown error',
          });
        }
      });
    } else {
      // 串行处理
      for (const log of logs) {
        try {
          const result = await processSingleLog(ctx, {
            log,
            tenantId,
            userId,
            format,
            enhance,
          });
          processedLogs.push(result.processedLog);
          if (result.warnings) {
            warningCount += result.warnings.length;
          }
        } catch (error) {
          failedLogs.push({
            log,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    const processingTime = Date.now() - startTime;

    return {
      processedLogs,
      failedLogs,
      processingTime,
      statistics: {
        total: logs.length,
        processed: processedLogs.length,
        failed: failedLogs.length,
        warnings: warningCount,
      },
    };
  } catch (error) {
    ctx.service?.logger?.error('Failed to process batch logs:', error);
    throw error;
  }
}

/**
 * 解析日志内容
 */
export async function parseLogContent(
  ctx: Context,
  params: {
    content: string;
    format: LogFormat;
    source?: string;
    tenantId: string;
    userId?: string;
  },
): Promise<{
  logs: LogEntry[];
  parseErrors: Array<{ line: number; error: string; content: string }>;
  statistics: {
    totalLines: number;
    parsedLogs: number;
    errors: number;
  };
}> {
  try {
    const { content, format, source, tenantId, userId } = params;

    const logs: LogEntry[] = [];
    const parseErrors: Array<{ line: number; error: string; content: string }> = [];
    const lines = content.split('\n').filter((line) => line.trim());

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      try {
        const logEntry = await parseLogLine(line, format, source, tenantId, userId);
        if (logEntry) {
          logs.push(logEntry);
        }
      } catch (error) {
        parseErrors.push({
          line: i + 1,
          error: error instanceof Error ? error.message : 'Unknown error',
          content: line,
        });
      }
    }

    return {
      logs,
      parseErrors,
      statistics: {
        totalLines: lines.length,
        parsedLogs: logs.length,
        errors: parseErrors.length,
      },
    };
  } catch (error) {
    ctx.service?.logger?.error('Failed to parse log content:', error);
    throw error;
  }
}

/**
 * 转换日志格式
 */
export async function transformLogFormat(
  ctx: Context,
  params: {
    logs: LogEntry[];
    fromFormat: LogFormat;
    toFormat: LogFormat;
    options?: {
      includeMetadata?: boolean;
      customFields?: string[];
      excludeFields?: string[];
    };
  },
): Promise<{
  transformedLogs: any[];
  transformationTime: number;
}> {
  const startTime = Date.now();

  try {
    const { logs, fromFormat, toFormat, options = {} } = params;
    const { includeMetadata = true, customFields, excludeFields } = options;

    const transformedLogs = logs.map((log) => {
      let transformed: any;

      switch (toFormat) {
        case 'json':
          transformed = transformToJson(log, includeMetadata);
          break;
        case 'text':
          transformed = transformToText(log);
          break;
        case 'csv':
          transformed = transformToCsv(log);
          break;
        case 'syslog':
          transformed = transformToSyslog(log);
          break;
        case 'structured':
          transformed = transformToStructured(log);
          break;
        case 'clf':
          transformed = transformToClf(log);
          break;
        case 'combined':
          transformed = transformToCombined(log);
          break;
        default:
          throw new Error(`Unsupported format: ${toFormat}`);
      }

      // 应用字段过滤
      if (customFields && customFields.length > 0) {
        transformed = filterFields(transformed, customFields, true);
      }
      if (excludeFields && excludeFields.length > 0) {
        transformed = filterFields(transformed, excludeFields, false);
      }

      return transformed;
    });

    const transformationTime = Date.now() - startTime;

    return {
      transformedLogs,
      transformationTime,
    };
  } catch (error) {
    ctx.service?.logger?.error('Failed to transform log format:', error);
    throw error;
  }
}

/**
 * 聚合日志数据
 */
export async function aggregateLogs(
  ctx: Context,
  params: {
    logs: LogEntry[];
    aggregationType: 'count' | 'sum' | 'avg' | 'min' | 'max' | 'group';
    field?: string;
    groupBy?: string;
    timeInterval?: string;
  },
): Promise<{
  aggregatedData: any;
  aggregationTime: number;
}> {
  const startTime = Date.now();

  try {
    const { logs, aggregationType, field, groupBy, timeInterval } = params;

    let aggregatedData: any;

    switch (aggregationType) {
      case 'count':
        aggregatedData = logs.length;
        break;

      case 'sum':
        if (!field) throw new Error('Field is required for sum aggregation');
        aggregatedData = logs.reduce((sum, log) => {
          const value = getFieldValue(log, field);
          return sum + (typeof value === 'number' ? value : 0);
        }, 0);
        break;

      case 'avg':
        if (!field) throw new Error('Field is required for avg aggregation');
        const values = logs
          .map((log) => getFieldValue(log, field))
          .filter((value) => typeof value === 'number');
        aggregatedData =
          values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
        break;

      case 'min':
        if (!field) throw new Error('Field is required for min aggregation');
        const minValues = logs
          .map((log) => getFieldValue(log, field))
          .filter((value) => typeof value === 'number');
        aggregatedData = minValues.length > 0 ? Math.min(...minValues) : null;
        break;

      case 'max':
        if (!field) throw new Error('Field is required for max aggregation');
        const maxValues = logs
          .map((log) => getFieldValue(log, field))
          .filter((value) => typeof value === 'number');
        aggregatedData = maxValues.length > 0 ? Math.max(...maxValues) : null;
        break;

      case 'group':
        if (!groupBy) throw new Error('GroupBy field is required for group aggregation');
        aggregatedData = LogUtils.groupLogs(logs as StoredLog[], groupBy as keyof StoredLog);
        break;

      default:
        throw new Error(`Unsupported aggregation type: ${aggregationType}`);
    }

    // 如果指定了时间间隔，按时间分组
    if (timeInterval && aggregationType !== 'group') {
      aggregatedData = groupByTimeInterval(logs, timeInterval, aggregationType, field);
    }

    const aggregationTime = Date.now() - startTime;

    return {
      aggregatedData,
      aggregationTime,
    };
  } catch (error) {
    ctx.service?.logger?.error('Failed to aggregate logs:', error);
    throw error;
  }
}

/**
 * 清理和标准化日志
 */
export async function cleanupLogs(
  ctx: Context,
  params: {
    logs: LogEntry[];
    options: {
      removeDuplicates?: boolean;
      normalizeTimestamps?: boolean;
      validateFields?: boolean;
      sanitizeContent?: boolean;
      removeEmptyFields?: boolean;
    };
  },
): Promise<{
  cleanedLogs: LogEntry[];
  removedCount: number;
  cleanupTime: number;
}> {
  const startTime = Date.now();

  try {
    const { logs, options } = params;
    const {
      removeDuplicates = false,
      normalizeTimestamps = true,
      validateFields = true,
      sanitizeContent = true,
      removeEmptyFields = true,
    } = options;

    let cleanedLogs = [...logs];
    let removedCount = 0;

    // 移除重复日志
    if (removeDuplicates) {
      const originalLength = cleanedLogs.length;
      cleanedLogs = removeDuplicateLogs(cleanedLogs);
      removedCount += originalLength - cleanedLogs.length;
    }

    // 清理每条日志
    cleanedLogs = cleanedLogs.map((log) => {
      let cleanedLog = { ...log };

      // 标准化时间戳
      if (normalizeTimestamps) {
        cleanedLog = normalizeLogTimestamp(cleanedLog);
      }

      // 验证字段
      if (validateFields) {
        cleanedLog = validateAndFixLogFields(cleanedLog);
      }

      // 清理内容
      if (sanitizeContent) {
        cleanedLog = sanitizeLogContent(cleanedLog);
      }

      // 移除空字段
      if (removeEmptyFields) {
        cleanedLog = removeEmptyLogFields(cleanedLog);
      }

      return cleanedLog;
    });

    const cleanupTime = Date.now() - startTime;

    return {
      cleanedLogs,
      removedCount,
      cleanupTime,
    };
  } catch (error) {
    ctx.service?.logger?.error('Failed to cleanup logs:', error);
    throw error;
  }
}

/**
 * 获取日志处理统计
 */
export async function getProcessingStats(
  ctx: Context,
  params: {
    tenantId: string;
    userId?: string;
    timeRange?: string;
  },
): Promise<{
  stats: {
    totalProcessed: number;
    totalFailed: number;
    averageProcessingTime: number;
    peakProcessingTime: number;
    errorRate: number;
    throughput: number; // logs per second
  };
  trends: Array<{
    timestamp: Date;
    processed: number;
    failed: number;
    avgTime: number;
  }>;
}> {
  try {
    const { tenantId, userId, timeRange = '24h' } = params;

    // 从缓存或数据库获取处理统计
    const cacheKey = `processing_stats:${tenantId}${userId ? `:${userId}` : ''}:${timeRange}`;

    let stats = await (ctx.service as any)?.cache?.get(cacheKey);
    if (stats) {
      return JSON.parse(stats);
    }

    // 计算统计数据
    const { startTime: startTimeStr } = LogUtils.parseRelativeTime(timeRange);
    const startTime = new Date(startTimeStr);

    const filter: any = {
      tenantId,
      timestamp: { $gte: startTime },
    };
    if (userId) {
      filter.userId = userId;
    }

    const processingLogs = await (ctx.service as any)?.db
      .collection('log_processing_stats')
      .find(filter)
      .sort({ timestamp: 1 })
      .toArray();

    const totalProcessed = processingLogs.reduce((sum, log) => sum + log.processed, 0);
    const totalFailed = processingLogs.reduce((sum, log) => sum + log.failed, 0);
    const totalTime = processingLogs.reduce((sum, log) => sum + (log.processingTime || 0), 0);
    const averageProcessingTime = totalProcessed > 0 ? totalTime / totalProcessed : 0;
    const peakProcessingTime = Math.max(...processingLogs.map((log) => log.processingTime), 0);
    const errorRate = totalProcessed > 0 ? (totalFailed / (totalProcessed + totalFailed)) * 100 : 0;
    const throughput = totalProcessed / (24 * 60 * 60); // logs per second (default 24h)

    const result = {
      stats: {
        totalProcessed,
        totalFailed,
        averageProcessingTime,
        peakProcessingTime,
        errorRate,
        throughput,
      },
      trends: processingLogs.map((log) => ({
        timestamp: log.timestamp,
        processed: log.processed,
        failed: log.failed,
        avgTime: log.avgProcessingTime,
      })),
    };

    // 缓存结果
    await (ctx.service as any)?.cache?.setex(cacheKey, 300, JSON.stringify(result)); // 5分钟缓存

    return result;
  } catch (error) {
    ctx.service?.logger?.error('Failed to get processing stats:', error);
    throw error;
  }
}

/**
 * 标准化日志条目
 */
async function normalizeLogEntry(
  log: LogEntry,
  format: LogFormat,
  tenantId?: string,
): Promise<LogEntry> {
  const normalized: LogEntry = {
    id: log.id || generateLogId(),
    timestamp:
      typeof log.timestamp === 'string' || typeof log.timestamp === 'number'
        ? log.timestamp
        : new Date().toISOString(),
    level: LogUtils.isValidLogLevel(log.level) ? log.level : LogLevel.INFO,
    message: log.message || '',
    source: LogUtils.isValidLogSource(log.source) ? log.source : LogSource.SYSTEM,
    metadata: log.metadata || {},
    tenantId: log.tenantId || tenantId || '',
  };

  // 根据格式进行特定的标准化
  switch (format) {
    case 'syslog':
      if (normalized.metadata) {
        normalized.metadata.facility = log.metadata?.facility || 'user';
        normalized.metadata.severity =
          log.metadata?.severity || LogUtils.getLogLevelWeight(normalized.level);
      }
      break;
    case 'json':
      // JSON格式已经是标准格式
      break;
    case 'text':
      // 文本格式可能需要解析
      if (typeof log.message === 'string' && log.message.includes('|')) {
        const parts = log.message.split('|');
        if (parts.length >= 3) {
          const levelStr = parts[0].trim().toLowerCase();
          normalized.level = LogUtils.isValidLogLevel(levelStr)
            ? (levelStr as LogLevel)
            : LogLevel.INFO;
          const sourceStr = parts[1].trim();
          normalized.source = LogUtils.isValidLogSource(sourceStr)
            ? (sourceStr as LogSource)
            : LogSource.SYSTEM;
          normalized.message = parts.slice(2).join('|').trim();
        }
      }
      break;
  }

  return normalized;
}

/**
 * 验证日志条目
 */
function validateLogEntry(log: LogEntry): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!log.message || typeof log.message !== 'string') {
    errors.push('Message is required and must be a string');
  }

  if (!log.timestamp || (typeof log.timestamp !== 'string' && typeof log.timestamp !== 'number')) {
    errors.push('Timestamp is required and must be a string or number');
  }

  if (!LogUtils.isValidLogLevel(log.level)) {
    errors.push(`Invalid log level: ${log.level}`);
  }

  if (!LogUtils.isValidLogSource(log.source)) {
    errors.push(`Invalid log source: ${log.source}`);
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * 增强日志条目
 */
async function enhanceLogEntry(
  ctx: Context,
  log: LogEntry,
  tenantId: string,
  userId?: string,
): Promise<LogEntry> {
  const enhanced = { ...log };

  // 添加地理位置信息（如果有IP地址）
  if (enhanced.metadata?.ip) {
    try {
      // 这里可以集成地理位置服务
      if (enhanced.metadata) {
        enhanced.metadata.location = await getLocationFromIP(enhanced.metadata.ip as string);
      }
    } catch (error) {
      // 忽略地理位置错误
    }
  }

  // 添加用户代理解析（如果有）
  if (enhanced.metadata?.userAgent) {
    try {
      if (enhanced.metadata) {
        enhanced.metadata.parsedUserAgent = parseUserAgent(enhanced.metadata.userAgent as string);
      }
    } catch (error) {
      // 忽略用户代理解析错误
    }
  }

  // 添加关键词提取
  if (enhanced.metadata) {
    // 创建一个临时的 StoredLog 对象用于关键词提取
    const tempStoredLog: StoredLog = {
      ...enhanced,
      id: enhanced.id || generateLogId(),
      tenantId: enhanced.tenantId,
      apiKeyId: (ctx.meta as any)?.apiKey || '',
      timestamp:
        typeof enhanced.timestamp === 'string'
          ? enhanced.timestamp
          : new Date(enhanced.timestamp).toISOString(),
      indexed: false,
      originType: enhanced.originType || 'microservice',
      visibility: enhanced.visibility || 'tenant',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
    };

    enhanced.metadata.keywords = LogUtils.extractKeywords
      ? LogUtils.extractKeywords([tempStoredLog], 1).map((item) => item.keyword)
      : [];

    // 添加异常检测标记
    enhanced.metadata.anomalyScore = calculateAnomalyScore ? calculateAnomalyScore(enhanced) : 0;

    // 添加处理标记
    enhanced.metadata.enhanced = true;
    enhanced.metadata.enhancedAt = new Date();
  }

  return enhanced;
}

/**
 * 解析日志行
 */
async function parseLogLine(
  line: string,
  format: LogFormat,
  source?: string,
  tenantId?: string,
  userId?: string,
): Promise<LogEntry | null> {
  if (!line.trim()) return null;

  let logEntry: Partial<LogEntry> = {};

  switch (format) {
    case 'json':
      try {
        logEntry = JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSON: ${error}`);
      }
      break;

    case 'text':
      // 简单的文本解析：timestamp level source message
      const textMatch = line.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/);
      if (textMatch) {
        const levelStr = textMatch[2].toLowerCase();
        const sourceStr = textMatch[3];
        logEntry = {
          timestamp: new Date(textMatch[1]).toISOString(),
          level: LogUtils.isValidLogLevel(levelStr) ? (levelStr as LogLevel) : LogLevel.INFO,
          source: LogUtils.isValidLogSource(sourceStr)
            ? (sourceStr as LogSource)
            : LogSource.SYSTEM,
          message: textMatch[4],
        };
      } else {
        logEntry = {
          message: line,
          level: LogLevel.INFO,
          source: (source && LogUtils.isValidLogSource(source)) ? (source as LogSource) : LogSource.SYSTEM,
        };
      }
      break;

    case 'syslog':
      // 解析syslog格式
      const syslogMatch = line.match(/^<(\d+)>(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/);
      if (syslogMatch) {
        const priority = parseInt(syslogMatch[1]);
        const facility = Math.floor(priority / 8);
        const severity = priority % 8;

        const sourceStr = syslogMatch[3];
        logEntry = {
          timestamp: new Date(syslogMatch[2]).toISOString(),
          source: LogUtils.isValidLogSource(sourceStr)
            ? (sourceStr as LogSource)
            : LogSource.SYSTEM,
          message: syslogMatch[5] || '',
          level: severityToLevel ? severityToLevel(severity) : LogLevel.INFO,
          metadata: {
            facility,
            severity,
            hostname: syslogMatch[4],
          },
        };
      } else {
        throw new Error('Invalid syslog format');
      }
      break;

    default:
      throw new Error(`Unsupported format: ${format}`);
  }

  // 设置默认值
  return {
    id: generateLogId(),
    timestamp: logEntry.timestamp || new Date().toISOString(),
    level: logEntry.level || LogLevel.INFO,
    message: logEntry.message || '',
    source:
      logEntry.source || (source && LogUtils.isValidLogSource(source))
        ? (source as LogSource)
        : LogSource.SYSTEM,
    tenantId: tenantId || '',
    metadata: {
      ...logEntry.metadata,
      userId,
      originalFormat: format,
    },
  };
}

/**
 * 生成日志ID
 */
function generateLogId(): string {
  return `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 转换为JSON格式
 */
function transformToJson(log: LogEntry, includeMetadata: boolean): any {
  const result: any = {
    id: log.id,
    timestamp: new Date(log.timestamp).toISOString(),
    level: log.level,
    message: log.message,
    source: log.source,
  };

  if (includeMetadata && log.metadata) {
    result.metadata = log.metadata;
  }

  return result;
}

/**
 * 转换为文本格式
 */
function transformToText(log: LogEntry): string {
  return `${new Date(log.timestamp).toISOString()} ${log.level.toUpperCase()} ${log.source} ${log.message}`;
}

/**
 * 转换为CSV格式
 */
function transformToCsv(log: LogEntry): string {
  const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;

  return [
    log.id,
    new Date(log.timestamp).toISOString(),
    log.level,
    log.source,
    escapeCsv(log.message),
  ].join(',');
}

/**
 * 转换为Syslog格式
 */
function transformToSyslog(log: LogEntry): string {
  const facility = log.metadata?.facility || 16; // user facility
  const severity = levelToSeverity(log.level);
  const priority = facility * 8 + severity;
  const hostname = log.metadata?.hostname || 'localhost';

  return `<${priority}>${new Date(log.timestamp).toISOString()} ${hostname} ${log.source} ${log.message}`;
}

/**
 * 转换为结构化格式
 */
function transformToStructured(log: LogEntry): string {
  const structured = {
    timestamp: log.timestamp,
    level: log.level,
    source: log.source,
    message: log.message,
    metadata: log.metadata,
    id: log.id,
  };
  return JSON.stringify(structured, null, 2);
}

/**
 * 转换为CLF格式
 */
function transformToClf(log: LogEntry): string {
  // Common Log Format: remotehost rfc931 authuser [date] "request" status bytes
  const timestamp = new Date(log.timestamp).toISOString().replace('T', ' ').replace('Z', '');
  const remotehost = log.metadata?.remotehost || '-';
  const rfc931 = log.metadata?.rfc931 || '-';
  const authuser = log.metadata?.authuser || '-';
  const request = log.metadata?.request || log.message;
  const status = log.metadata?.status || '-';
  const bytes = log.metadata?.bytes || '-';

  return `${remotehost} ${rfc931} ${authuser} [${timestamp}] "${request}" ${status} ${bytes}`;
}

/**
 * 转换为Combined格式
 */
function transformToCombined(log: LogEntry): string {
  // Combined Log Format: CLF + "referer" "user-agent"
  const clfPart = transformToClf(log);
  const referer = log.metadata?.referer || '-';
  const userAgent = log.metadata?.userAgent || '-';

  return `${clfPart} "${referer}" "${userAgent}"`;
}

/**
 * 过滤字段
 */
function filterFields(obj: any, fields: string[], include: boolean): any {
  if (include) {
    const filtered: any = {};
    fields.forEach((field) => {
      if (obj.hasOwnProperty(field)) {
        filtered[field] = obj[field];
      }
    });
    return filtered;
  } else {
    const filtered = { ...obj };
    fields.forEach((field) => {
      delete filtered[field];
    });
    return filtered;
  }
}

/**
 * 获取字段值
 */
function getFieldValue(obj: any, field: string): any {
  const parts = field.split('.');
  let value = obj;

  for (const part of parts) {
    if (value && typeof value === 'object' && part in value) {
      value = value[part];
    } else {
      return undefined;
    }
  }

  return value;
}

/**
 * 按时间间隔分组
 */
function groupByTimeInterval(
  logs: LogEntry[],
  interval: string,
  aggregationType: string,
  field?: string,
): any {
  const groups: { [key: string]: LogEntry[] } = {};
  const intervalMs = 3600000; // 1 hour default

  logs.forEach((log) => {
    const timestamp =
      typeof log.timestamp === 'string' || typeof log.timestamp === 'number'
        ? new Date(log.timestamp).getTime()
        : Date.now();
    const groupKey = Math.floor(timestamp / intervalMs) * intervalMs;
    const groupKeyStr = new Date(groupKey).toISOString();

    if (!groups[groupKeyStr]) {
      groups[groupKeyStr] = [];
    }
    groups[groupKeyStr].push(log);
  });

  const result: any = {};
  Object.keys(groups).forEach((key) => {
    const groupLogs = groups[key];

    switch (aggregationType) {
      case 'count':
        result[key] = groupLogs.length;
        break;
      case 'sum':
        if (field) {
          result[key] = groupLogs.reduce((sum, log) => {
            const value = getFieldValue(log, field);
            return sum + (typeof value === 'number' ? value : 0);
          }, 0);
        }
        break;
      // 其他聚合类型...
    }
  });

  return result;
}

/**
 * 移除重复日志
 */
function removeDuplicateLogs(logs: LogEntry[]): LogEntry[] {
  const seen = new Set<string>();
  return logs.filter((log) => {
    const timestamp =
      typeof log.timestamp === 'string' || typeof log.timestamp === 'number'
        ? new Date(log.timestamp).getTime()
        : Date.now();
    const key = `${timestamp}_${log.level}_${log.source}_${log.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * 标准化日志时间戳
 */
function normalizeLogTimestamp(log: LogEntry): LogEntry {
  const normalized = { ...log };

  if (typeof normalized.timestamp === 'string' || typeof normalized.timestamp === 'number') {
    const dateValue = new Date(normalized.timestamp);
    if (!isNaN(dateValue.getTime())) {
      normalized.timestamp = dateValue.toISOString();
    } else {
      normalized.timestamp = new Date().toISOString();
    }
  } else {
    normalized.timestamp = new Date().toISOString();
  }

  return normalized;
}

/**
 * 验证和修复日志字段
 */
function validateAndFixLogFields(log: LogEntry): LogEntry {
  const fixed = { ...log };

  // 修复级别
  if (!LogUtils.isValidLogLevel(fixed.level)) {
    fixed.level = LogLevel.INFO;
  }

  // 修复来源
  if (!LogUtils.isValidLogSource(fixed.source)) {
    fixed.source = LogSource.SYSTEM;
  }

  // 确保消息是字符串
  if (typeof fixed.message !== 'string') {
    fixed.message = String(fixed.message || '');
  }

  return fixed;
}

/**
 * 清理日志内容
 */
function sanitizeLogContent(log: LogEntry): LogEntry {
  const sanitized = { ...log };

  // 移除敏感信息
  if (typeof sanitized.message === 'string') {
    sanitized.message = sanitized.message
      .replace(/password[=:]\s*\S+/gi, 'password=***')
      .replace(/token[=:]\s*\S+/gi, 'token=***')
      .replace(/key[=:]\s*\S+/gi, 'key=***')
      .replace(/secret[=:]\s*\S+/gi, 'secret=***');
  }

  return sanitized;
}

/**
 * 移除空字段
 */
function removeEmptyLogFields(log: LogEntry): LogEntry {
  const cleaned = { ...log };

  Object.keys(cleaned).forEach((key) => {
    const value = (cleaned as any)[key];
    if (value === null || value === undefined || value === '') {
      delete (cleaned as any)[key];
    }
  });

  return cleaned;
}

/**
 * Syslog严重性转换为日志级别
 */
function severityToLevel(severity: number): LogLevel {
  const mapping: { [key: number]: LogLevel } = {
    0: LogLevel.FATAL,
    1: LogLevel.FATAL,
    2: LogLevel.FATAL,
    3: LogLevel.ERROR,
    4: LogLevel.WARN,
    5: LogLevel.WARN,
    6: LogLevel.INFO,
    7: LogLevel.DEBUG,
  };
  return mapping[severity] || LogLevel.INFO;
}

/**
 * 日志级别转换为Syslog严重性
 */
function levelToSeverity(level: string): number {
  const mapping: { [key: string]: number } = {
    fatal: 0,
    error: 3,
    warn: 4,
    info: 6,
    debug: 7,
  };
  return mapping[level] || 6;
}

/**
 * 从IP获取地理位置（模拟）
 */
async function getLocationFromIP(ip: string): Promise<any> {
  // 这里应该集成真实的地理位置服务
  return {
    country: 'Unknown',
    city: 'Unknown',
    latitude: 0,
    longitude: 0,
  };
}

/**
 * 解析用户代理
 */
function parseUserAgent(userAgent: string): any {
  // 简单的用户代理解析
  return {
    browser: 'Unknown',
    version: 'Unknown',
    os: 'Unknown',
    device: 'Unknown',
  };
}

/**
 * 计算异常分数
 */
function calculateAnomalyScore(log: LogEntry): number {
  let score = 0;

  // 基于日志级别
  if (log.level === LogLevel.ERROR || log.level === LogLevel.FATAL) {
    score += 0.5;
  }

  // 基于消息长度
  if (log.message.length > 1000) {
    score += 0.2;
  }

  // 基于关键词
  const errorKeywords = ['exception', 'error', 'failed', 'timeout', 'crash'];
  const hasErrorKeywords = errorKeywords.some((keyword) =>
    log.message.toLowerCase().includes(keyword),
  );
  if (hasErrorKeywords) {
    score += 0.3;
  }

  return Math.min(score, 1.0);
}
