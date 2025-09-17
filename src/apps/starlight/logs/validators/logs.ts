/**
 * 日志验证器
 * 定义日志相关的参数验证规则
 */

import { LOG_LEVELS, LOG_SOURCES, MAX_LOG_SIZE } from '../constants';
import { BaseLog, LogLevel, LogSource } from '../types';

// 验证结果接口
interface ValidationResult<T = any> {
  valid: boolean;
  data?: T;
  errors: string[];
}

// 验证日志级别
function isValidLogLevel(level: any): level is LogLevel {
  return typeof level === 'string' && LOG_LEVELS.includes(level as any);
}

// 验证日志来源
function isValidLogSource(source: any): source is LogSource {
  return typeof source === 'string' && LOG_SOURCES.includes(source as any);
}

// 验证基础日志
function validateBaseLog(log: any): ValidationResult<BaseLog> {
  const errors: string[] = [];

  if (!log || typeof log !== 'object') {
    return { valid: false, errors: ['日志必须是一个对象'] };
  }

  // 验证必需字段
  if (!log.message || typeof log.message !== 'string') {
    errors.push('message字段是必需的且必须是字符串');
  } else if (log.message.length === 0) {
    errors.push('日志消息不能为空');
  } else if (log.message.length > 10000) {
    errors.push('日志消息过长');
  }

  if (!log.level || !isValidLogLevel(log.level)) {
    errors.push(`level字段必须是以下值之一: ${LOG_LEVELS.join(', ')}`);
  }

  // 验证可选字段
  if (log.source && !isValidLogSource(log.source)) {
    errors.push(`source字段必须是以下值之一: ${LOG_SOURCES.join(', ')}`);
  }

  if (log.tags && !Array.isArray(log.tags)) {
    errors.push('tags字段必须是数组');
  }

  if (log.service && typeof log.service !== 'string') {
    errors.push('service字段必须是字符串');
  }

  if (log.userId && typeof log.userId !== 'string') {
    errors.push('userId字段必须是字符串');
  }

  if (log.sessionId && typeof log.sessionId !== 'string') {
    errors.push('sessionId字段必须是字符串');
  }

  if (log.traceId && typeof log.traceId !== 'string') {
    errors.push('traceId字段必须是字符串');
  }

  if (log.metadata && typeof log.metadata !== 'object') {
    errors.push('metadata字段必须是对象');
  }

  return {
    valid: errors.length === 0,
    data: errors.length === 0 ? log as BaseLog : undefined,
    errors
  };
}

// 验证日志摄取请求
function validateLogIngest(data: any): ValidationResult {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['请求数据必须是一个对象'] };
  }

  if (!data.tenantId || typeof data.tenantId !== 'string') {
    errors.push('tenantId是必需的且必须是字符串');
  }

  if (!data.apiKey || typeof data.apiKey !== 'string') {
    errors.push('apiKey是必需的且必须是字符串');
  }

  if (data.userId && typeof data.userId !== 'string') {
    errors.push('userId必须是字符串');
  }

  if (data.format && !['json', 'text', 'structured'].includes(data.format)) {
    errors.push('format必须是json、text或structured之一');
  }

  // 验证日志数据
  if (!data.log) {
    errors.push('log字段是必需的');
  } else {
    const logValidation = validateBaseLog(data.log);
    if (!logValidation.valid) {
      errors.push(...logValidation.errors.map(err => `log.${err}`));
    }
  }

  return {
    valid: errors.length === 0,
    data: errors.length === 0 ? data : undefined,
    errors
  };
}

// 验证批量日志摄取请求
function validateLogBatchIngest(data: any): ValidationResult {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['请求数据必须是一个对象'] };
  }

  if (!data.tenantId || typeof data.tenantId !== 'string') {
    errors.push('tenantId是必需的且必须是字符串');
  }

  if (!data.apiKey || typeof data.apiKey !== 'string') {
    errors.push('apiKey是必需的且必须是字符串');
  }

  if (data.userId && typeof data.userId !== 'string') {
    errors.push('userId必须是字符串');
  }

  if (data.format && !['json', 'text', 'structured'].includes(data.format)) {
    errors.push('format必须是json、text或structured之一');
  }

  if (data.batchId && typeof data.batchId !== 'string') {
    errors.push('batchId必须是字符串');
  }

  // 验证日志数组
  if (!data.logs || !Array.isArray(data.logs)) {
    errors.push('logs字段是必需的且必须是数组');
  } else {
    if (data.logs.length === 0) {
      errors.push('至少需要一条日志');
    } else if (data.logs.length > 1000) {
      errors.push('批量日志数量不能超过1000条');
    } else {
      data.logs.forEach((log: any, index: number) => {
        const logValidation = validateBaseLog(log);
        if (!logValidation.valid) {
          errors.push(...logValidation.errors.map(err => `logs[${index}].${err}`));
        }
      });
    }
  }

  return {
    valid: errors.length === 0,
    data: errors.length === 0 ? data : undefined,
    errors
  };
}

// 验证日志搜索请求
function validateLogSearch(data: any): ValidationResult {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['请求数据必须是一个对象'] };
  }

  if (!data.tenantId || typeof data.tenantId !== 'string') {
    errors.push('tenantId是必需的且必须是字符串');
  }

  if (!data.apiKey || typeof data.apiKey !== 'string') {
    errors.push('apiKey是必需的且必须是字符串');
  }

  if (data.query && typeof data.query !== 'string') {
    errors.push('query必须是字符串');
  }

  if (data.level) {
    if (Array.isArray(data.level)) {
      data.level.forEach((level: any, index: number) => {
        if (!isValidLogLevel(level)) {
          errors.push(`level[${index}]必须是有效的日志级别`);
        }
      });
    } else if (!isValidLogLevel(data.level)) {
      errors.push('level必须是有效的日志级别');
    }
  }

  if (data.source) {
    if (Array.isArray(data.source)) {
      data.source.forEach((source: any, index: number) => {
        if (!isValidLogSource(source)) {
          errors.push(`source[${index}]必须是有效的日志来源`);
        }
      });
    } else if (!isValidLogSource(data.source)) {
      errors.push('source必须是有效的日志来源');
    }
  }

  if (data.page && (!Number.isInteger(data.page) || data.page < 1)) {
    errors.push('page必须是大于0的整数');
  }

  if (data.pageSize && (!Number.isInteger(data.pageSize) || data.pageSize < 1 || data.pageSize > 1000)) {
    errors.push('pageSize必须是1-1000之间的整数');
  }

  if (data.sortBy && !['timestamp', 'level', 'service'].includes(data.sortBy)) {
    errors.push('sortBy必须是timestamp、level或service之一');
  }

  if (data.sortOrder && !['asc', 'desc'].includes(data.sortOrder)) {
    errors.push('sortOrder必须是asc或desc之一');
  }

  return {
    valid: errors.length === 0,
    data: errors.length === 0 ? data : undefined,
    errors
  };
}

// 验证日志统计请求
function validateLogStats(data: any): ValidationResult {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['请求数据必须是一个对象'] };
  }

  if (!data.tenantId || typeof data.tenantId !== 'string') {
    errors.push('tenantId是必需的且必须是字符串');
  }

  if (!data.apiKey || typeof data.apiKey !== 'string') {
    errors.push('apiKey是必需的且必须是字符串');
  }

  if (data.interval && !['minute', 'hour', 'day', 'week', 'month'].includes(data.interval)) {
    errors.push('interval必须是minute、hour、day、week或month之一');
  }

  if (data.groupBy && !Array.isArray(data.groupBy)) {
    errors.push('groupBy必须是数组');
  }

  return {
    valid: errors.length === 0,
    data: errors.length === 0 ? data : undefined,
    errors
  };
}

// 验证日志流请求
function validateLogStream(data: any): ValidationResult {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['请求数据必须是一个对象'] };
  }

  if (!data.tenantId || typeof data.tenantId !== 'string') {
    errors.push('tenantId是必需的且必须是字符串');
  }

  if (!data.apiKey || typeof data.apiKey !== 'string') {
    errors.push('apiKey是必需的且必须是字符串');
  }

  if (data.format && !['json', 'text'].includes(data.format)) {
    errors.push('format必须是json或text之一');
  }

  return {
    valid: errors.length === 0,
    data: errors.length === 0 ? data : undefined,
    errors
  };
}

// 导出验证器
export const logsValidators = {
  validateLogIngest,
  validateLogBatchIngest,
  validateLogSearch,
  validateLogStats,
  validateLogStream
};

// 导出验证函数
export {
  validateBaseLog,
  validateLogIngest,
  validateLogBatchIngest,
  validateLogSearch,
  validateLogStats,
  validateLogStream,
  isValidLogLevel,
  isValidLogSource
};