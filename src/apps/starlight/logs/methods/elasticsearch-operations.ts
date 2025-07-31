/**
 * Elasticsearch操作方法
 * 处理与Elasticsearch相关的索引管理、查询优化和数据操作
 * 重构为使用统一的ES封装模块
 */

import { Context } from 'node-universe';
import {
  LogEntry,
  LogSearchParams as SearchParams,
  LogSearchResult as SearchResult,
  LogLevel,
  LogSource,
} from '../types';
import { LogUtils } from '../utils/log-utils';
import {
  createLogIndex as _createLogIndex,
  deleteLogIndex as _deleteLogIndex,
  bulkIndexLogs as _bulkIndexLogs,
  searchLogs as _searchLogs,
  getLogAggregations as _getLogAggregations,
  deleteLogs as _deleteLogs,
  scrollSearchLogs as _scrollSearchLogs,
  continueScrollLogs as _continueScrollLogs,
  clearScrollLogs as _clearScrollLogs,
  getLogFieldMappings as _getLogFieldMappings,
  getLogIndexStats as _getLogIndexStats,
  optimizeLogIndex as _optimizeLogIndex,
  createLogIndexTemplate as _createLogIndexTemplate,
  reindexLogs as _reindexLogs,
  updateIndexMapping,
} from 'db/es';
import { LogEntry as ESLogEntry, SearchParams as ESSearchParams } from 'db/es/apis/log-operations';

/**
 * 创建日志索引
 */
export async function createLogIndex(
  ctx: Context,
  params: {
    tenantId: string;
    indexSuffix?: string;
    settings?: any;
    mappings?: any;
  },
): Promise<{
  success: boolean;
  indexName: string;
  error?: string;
}> {
  try {
    const { tenantId, indexSuffix, settings, mappings } = params;

    const result = await _createLogIndex(tenantId, indexSuffix, settings, mappings);

    if (result.success) {
      ctx.service?.logger?.info(`Created Elasticsearch index: ${result.indexName}`);
    } else {
      ctx.service?.logger?.error('Failed to create log index:', result.error);
    }

    return result;
  } catch (error) {
    ctx.service?.logger?.error('Failed to create log index:', error);
    return {
      success: false,
      indexName: '',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 删除日志索引
 */
export async function deleteLogIndex(
  ctx: Context,
  params: {
    tenantId: string;
    indexSuffix?: string;
    force?: boolean;
  },
): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const { tenantId, indexSuffix, force = false } = params;

    const result = await _deleteLogIndex(tenantId, indexSuffix, force);

    if (result.success) {
      ctx.service?.logger?.info(`Deleted Elasticsearch index for tenant: ${tenantId}`);
    } else {
      ctx.service?.logger?.error('Failed to delete log index:', result.error);
    }

    return result;
  } catch (error) {
    ctx.service?.logger?.error('Failed to delete log index:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 批量索引日志
 */
export async function bulkIndexLogs(
  ctx: Context,
  params: {
    logs: LogEntry[];
    tenantId: string;
    indexSuffix?: string;
    refresh?: boolean;
  },
): Promise<{
  success: boolean;
  indexed: number;
  failed: number;
  errors?: Array<{ id: string; error: string }>;
}> {
  try {
    const { logs, tenantId, indexSuffix, refresh = false } = params;

    // 转换日志格式以匹配新的ES封装
    const convertedLogs: ESLogEntry[] = logs.map((log) => ({
      ...log,
      id: log.id || `${Date.now()}-${Math.random()}`,
      timestamp:
        typeof log.timestamp === 'string' || typeof log.timestamp === 'number'
          ? new Date(log.timestamp)
          : log.timestamp,
      level: typeof log.level === 'string' ? log.level : String(log.level),
      source: typeof log.source === 'string' ? log.source : (log.source as LogSource).toString(),
    }));

    const result = await _bulkIndexLogs(convertedLogs, tenantId, indexSuffix, refresh);

    if (result.success && result.indexed > 0) {
      ctx.service?.logger?.info(`Bulk indexed ${result.indexed} logs for tenant: ${tenantId}`);
    }

    if (result.errors && result.errors.length > 0) {
      ctx.service?.logger?.warn(`Bulk index completed with ${result.errors.length} errors`);
    }

    return result;
  } catch (error) {
    ctx.service?.logger?.error('Failed to bulk index logs:', error);
    return {
      success: false,
      indexed: 0,
      failed: params.logs.length,
      errors: [
        {
          id: 'bulk_operation',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      ],
    };
  }
}

/**
 * 搜索日志
 */
export async function searchLogs(
  ctx: Context,
  params: {
    tenantId: string;
    searchParams: SearchParams;
    indexPattern?: string;
  },
): Promise<SearchResult> {
  try {
    const { tenantId, searchParams, indexPattern } = params;

    // 转换搜索参数以匹配ES模块
    const esSearchParams: ESSearchParams = {
      ...searchParams,
      startTime: searchParams.startTime
        ? typeof searchParams.startTime === 'string' || typeof searchParams.startTime === 'number'
          ? new Date(searchParams.startTime)
          : searchParams.startTime
        : undefined,
      endTime: searchParams.endTime
        ? typeof searchParams.endTime === 'string' || typeof searchParams.endTime === 'number'
          ? new Date(searchParams.endTime)
          : searchParams.endTime
        : undefined,
    };

    const result = await _searchLogs(tenantId, esSearchParams, indexPattern);

    ctx.service?.logger?.debug(`Search completed: ${result.total} logs found in ${result.took}ms`);

    // 转换ES LogEntry到本地LogEntry类型
    const convertedLogs: LogEntry[] = result.logs.map(
      (log: ESLogEntry): LogEntry => ({
        ...log,
        level: log.level as LogLevel,
        source: log.source as LogSource,
        timestamp: typeof log.timestamp === 'string' ? log.timestamp : log.timestamp.toISOString(),
      }),
    );

    return {
      logs: convertedLogs,
      total: result.total,
      page: Math.floor((searchParams.from || 0) / (searchParams.size || 100)) + 1,
      limit: searchParams.size || 100,
      took: result.took,
      aggregations: result.aggregations,
    };
  } catch (error) {
    ctx.service?.logger?.error('Failed to search logs:', error);
    throw error;
  }
}

/**
 * 获取日志统计
 */
export async function getLogAggregations(
  ctx: Context,
  params: {
    tenantId: string;
    searchParams: SearchParams;
    aggregations: any;
    indexPattern?: string;
  },
): Promise<{
  aggregations: any;
  took: number;
}> {
  try {
    const { tenantId, searchParams, aggregations, indexPattern } = params;

    // 转换搜索参数以匹配ES模块
    const esSearchParams: ESSearchParams = {
      ...searchParams,
      startTime: searchParams.startTime
        ? typeof searchParams.startTime === 'string' || typeof searchParams.startTime === 'number'
          ? new Date(searchParams.startTime)
          : searchParams.startTime
        : undefined,
      endTime: searchParams.endTime
        ? typeof searchParams.endTime === 'string' || typeof searchParams.endTime === 'number'
          ? new Date(searchParams.endTime)
          : searchParams.endTime
        : undefined,
    };

    const result = await _getLogAggregations(tenantId, esSearchParams, aggregations, indexPattern);

    ctx.service?.logger?.debug(`Aggregations completed in ${result.took}ms`);

    return result;
  } catch (error) {
    ctx.service?.logger?.error('Failed to get log aggregations:', error);
    throw error;
  }
}

/**
 * 删除日志
 */
export async function deleteLogs(
  ctx: Context,
  params: {
    tenantId: string;
    query?: any;
    logIds?: string[];
    indexPattern?: string;
  },
): Promise<{
  success: boolean;
  deleted: number;
  error?: string;
}> {
  try {
    const { tenantId, query, logIds, indexPattern } = params;

    const result = await _deleteLogs(tenantId, query, logIds, indexPattern);

    if (result.success) {
      ctx.service?.logger?.info(`Deleted ${result.deleted} logs for tenant: ${tenantId}`);
    } else {
      ctx.service?.logger?.error('Failed to delete logs:', result.error);
    }

    return result;
  } catch (error) {
    ctx.service?.logger?.error('Failed to delete logs:', error);
    return {
      success: false,
      deleted: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 更新索引映射
 */
export async function updateLogIndexMapping(
  ctx: Context,
  params: {
    tenantId: string;
    mappings: any;
    indexSuffix?: string;
  },
): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const { tenantId, mappings, indexSuffix } = params;

    const result = await updateIndexMapping(tenantId, indexSuffix);

    if (result.success) {
      ctx.service?.logger?.info(`Updated mapping for tenant: ${tenantId}`);
    } else {
      ctx.service?.logger?.error('Failed to update index mapping:', result.error);
    }

    return result;
  } catch (error) {
    ctx.service?.logger?.error('Failed to update index mapping:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 获取索引统计
 */
export async function getIndexStats(
  ctx: Context,
  params: {
    tenantId: string;
    indexPattern?: string;
  },
): Promise<{
  indices: Array<{
    name: string;
    docCount: number;
    storeSize: string;
    health: string;
    status: string;
  }>;
}> {
  try {
    const { tenantId, indexPattern } = params;

    const result = await _getLogIndexStats(tenantId, indexPattern);

    ctx.service?.logger?.debug(`Retrieved stats for ${result.indices?.length || 0} indices`);

    return result;
  } catch (error) {
    ctx.service?.logger?.error('Failed to get index stats:', error);
    throw error;
  }
}

/**
 * 重建索引
 */
export async function reindexLogs(
  ctx: Context,
  params: {
    tenantId: string;
    sourceIndex: string;
    targetIndex: string;
    query?: any;
    batchSize?: number;
  },
): Promise<{
  success: boolean;
  reindexed: number;
  error?: string;
}> {
  try {
    const { tenantId, sourceIndex, targetIndex, query, batchSize = 1000 } = params;

    const result = await _reindexLogs(tenantId, sourceIndex, targetIndex, query, batchSize);

    if (result.success) {
      ctx.service?.logger?.info(
        `Reindexed ${result.reindexed} logs from ${sourceIndex} to ${targetIndex}`,
      );
    } else {
      ctx.service?.logger?.error('Failed to reindex logs:', result.error);
    }

    return result;
  } catch (error) {
    ctx.service?.logger?.error('Failed to reindex logs:', error);
    return {
      success: false,
      reindexed: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 优化索引
 */
export async function optimizeIndex(
  ctx: Context,
  params: {
    tenantId: string;
    indexPattern?: string;
    maxNumSegments?: number;
  },
): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const { tenantId, indexPattern, maxNumSegments = 1 } = params;

    const result = await _optimizeLogIndex(tenantId, indexPattern, maxNumSegments);

    if (result.success) {
      ctx.service?.logger?.info(`Optimized indices for tenant: ${tenantId}`);
    } else {
      ctx.service?.logger?.error('Failed to optimize index:', result.error);
    }

    return result;
  } catch (error) {
    ctx.service?.logger?.error('Failed to optimize index:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 创建索引模板
 */
export async function createIndexTemplate(
  ctx: Context,
  params: {
    templateName: string;
    indexPatterns: string[];
    settings?: any;
    mappings?: any;
    priority?: number;
  },
): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const { templateName, indexPatterns, settings, mappings, priority = 100 } = params;

    const result = await _createLogIndexTemplate(
      templateName,
      indexPatterns,
      settings,
      mappings,
      priority,
    );

    if (result.success) {
      ctx.service?.logger?.info(`Created index template: ${templateName}`);
    } else {
      ctx.service?.logger?.error('Failed to create index template:', result.error);
    }

    return result;
  } catch (error) {
    ctx.service?.logger?.error('Failed to create index template:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 滚动搜索
 */
export async function scrollSearch(
  ctx: Context,
  params: {
    tenantId: string;
    searchParams: SearchParams;
    scrollSize?: number;
    scrollTimeout?: string;
    indexPattern?: string;
  },
): Promise<{
  scrollId: string;
  logs: LogEntry[];
  total: number;
  hasMore: boolean;
}> {
  try {
    const {
      tenantId,
      searchParams,
      scrollSize = 1000,
      scrollTimeout = '1m',
      indexPattern,
    } = params;

    // 转换搜索参数以匹配ES模块
    const esSearchParams: ESSearchParams = {
      ...searchParams,
      startTime: searchParams.startTime
        ? typeof searchParams.startTime === 'string' || typeof searchParams.startTime === 'number'
          ? new Date(searchParams.startTime)
          : searchParams.startTime
        : undefined,
      endTime: searchParams.endTime
        ? typeof searchParams.endTime === 'string' || typeof searchParams.endTime === 'number'
          ? new Date(searchParams.endTime)
          : searchParams.endTime
        : undefined,
    };

    const result = await _scrollSearchLogs(
      tenantId,
      esSearchParams,
      scrollSize,
      scrollTimeout,
      indexPattern,
    );

    // 转换ES LogEntry到本地LogEntry类型
    const convertedResult = {
      ...result,
      logs:
        result.logs?.map(
          (log: ESLogEntry): LogEntry => ({
            ...log,
            level: log.level as LogLevel,
            source: log.source as LogSource,
            timestamp:
              typeof log.timestamp === 'string' ? log.timestamp : log.timestamp.toISOString(),
          }),
        ) || [],
    };

    ctx.service?.logger?.debug(
      `Started scroll search for tenant ${tenantId}, got ${convertedResult.logs?.length || 0} logs`,
    );

    return convertedResult;
  } catch (error) {
    ctx.service?.logger?.error('Failed to perform scroll search:', error);
    throw error;
  }
}

/**
 * 继续滚动搜索
 */
export async function continueScroll(
  ctx: Context,
  params: {
    scrollId: string;
    scrollTimeout?: string;
  },
): Promise<{
  scrollId: string;
  logs: LogEntry[];
  hasMore: boolean;
}> {
  try {
    const { scrollId, scrollTimeout = '1m' } = params;

    const result = await _continueScrollLogs(scrollId, scrollTimeout);

    // 转换ES LogEntry到本地LogEntry类型
    const convertedResult = {
      ...result,
      logs:
        result.logs?.map(
          (log: ESLogEntry): LogEntry => ({
            ...log,
            level: log.level as LogLevel,
            source: log.source as LogSource,
            timestamp:
              typeof log.timestamp === 'string' ? log.timestamp : log.timestamp.toISOString(),
          }),
        ) || [],
    };

    ctx.service?.logger?.debug(
      `Continued scroll search, got ${convertedResult.logs?.length || 0} logs`,
    );

    return convertedResult;
  } catch (error) {
    ctx.service?.logger?.error('Failed to continue scroll:', error);
    throw error;
  }
}

/**
 * 清除滚动上下文
 */
export async function clearScroll(
  ctx: Context,
  params: {
    scrollId: string;
  },
): Promise<{
  success: boolean;
}> {
  try {
    const { scrollId } = params;

    const result = await _clearScrollLogs(scrollId);

    if (result.success) {
      ctx.service?.logger?.debug('Cleared scroll context successfully');
    } else {
      ctx.service?.logger?.warn('Failed to clear scroll context');
    }

    return result;
  } catch (error) {
    ctx.service?.logger?.error('Failed to clear scroll:', error);
    return { success: false };
  }
}

/**
 * 获取字段映射
 */
export async function getFieldMappings(
  ctx: Context,
  params: {
    tenantId: string;
    indexPattern?: string;
  },
): Promise<{
  fields: Array<{
    name: string;
    type: string;
    searchable: boolean;
    aggregatable: boolean;
  }>;
}> {
  try {
    const { tenantId, indexPattern } = params;

    const result = await _getLogFieldMappings(tenantId, indexPattern);

    ctx.service?.logger?.debug(
      `Retrieved ${result.fields?.length || 0} field mappings for tenant ${tenantId}`,
    );

    return result;
  } catch (error) {
    ctx.service?.logger?.error('Failed to get field mappings:', error);
    throw error;
  }
}

// 注意：辅助函数已迁移到新的ES封装模块中
