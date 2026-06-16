/**
 * 日志搜索方法
 * 处理日志查询、过滤、排序和分页
 */

import { Context } from 'node-universe';
import {
  LogSearchParams,
  LogSearchResult,
  LogEntry,
  LogLevel,
  LogSource,
  ApiPermission,
  StoredLog,
} from '../types';
import { ElasticsearchClient, summarizeElasticsearchError } from '../utils/elasticsearch';
import { elasticsearchManager } from '../utils/elasticsearch-manager';
import { ApiKeyManager } from '../utils/api-key-manager';
import { QuotaChecker } from '../utils/quota-checker';
import { LogUtils } from '../utils/log-utils';
import { SYSTEM_LOG_TENANT_ID } from '../utils/access-control';
import { searchDarwinFallbackLogs } from '../utils/darwin-log-capture';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  SEARCH_TIMEOUT,
  SUPPORTED_LOG_LEVELS,
  SUPPORTED_LOG_SOURCES,
} from '../constants';

const DARWIN_FRAMEWORK_SERVICES = new Set(['star', 'transit', 'transporter', 'registry', 'cacher']);

function getServiceNameFromNodeID(nodeID?: string): string | undefined {
  const normalizedNodeID = String(nodeID || '').trim();
  if (!normalizedNodeID) return undefined;

  const environmentSuffix = `-${process.env.NODE_ENV || 'development'}`;
  if (normalizedNodeID.endsWith(environmentSuffix)) {
    return normalizedNodeID.slice(0, -environmentSuffix.length);
  }

  return normalizedNodeID;
}

function getDisplayService(log: StoredLog): string | undefined {
  const service = String(log.service || '').trim();
  if (service && !DARWIN_FRAMEWORK_SERVICES.has(service.toLowerCase())) return service;

  if (log.originType === 'darwin-app') {
    return getServiceNameFromNodeID(log.nodeID) || service || log.svc || log.mod;
  }

  return service || log.svc || log.mod;
}

/**
 * 搜索日志
 */
export async function searchLogs(
  ctx: Context,
  params: {
    apiKey: string;
    searchParams: LogSearchParams;
    tenantId: string;
    userId?: string;
  },
): Promise<LogSearchResult> {
  try {
    const { apiKey, searchParams, tenantId, userId } = params;

    const isSystemDarwinSearch = tenantId === SYSTEM_LOG_TENANT_ID && searchParams.originType === 'darwin-app';
    const quotaChecker = new QuotaChecker();

    if (!isSystemDarwinSearch && apiKey) {
      const validatedKey = await ApiKeyManager.getInstance().validateApiKey(apiKey);
      if (!validatedKey) {
        throw new Error('Invalid API key');
      }

      if (validatedKey.tenantId !== tenantId) {
        throw new Error('API key does not belong to the specified tenant');
      }

      const hasSearchPermission = ApiKeyManager.getInstance().hasPermission(
        validatedKey,
        ApiPermission.SEARCH,
      );
      if (!hasSearchPermission) {
        throw new Error('Insufficient permissions for log search');
      }

      const quotaCheck = await quotaChecker.checkSearchQuota(tenantId);
      if (!quotaCheck.allowed) {
        throw new Error(`Search quota exceeded: ${quotaCheck.reason || 'Quota limit reached'}`);
      }
    } else if (!isSystemDarwinSearch) {
      const quotaCheck = await quotaChecker.checkSearchQuota(tenantId);
      if (!quotaCheck.allowed) {
        throw new Error(`Search quota exceeded: ${quotaCheck.reason || 'Quota limit reached'}`);
      }
    }

    const validationResult = LogUtils.validateSearchParams(searchParams);
    if (!validationResult.valid) {
      throw new Error(`Invalid search parameters: ${validationResult.errors.join(', ')}`);
    }

    const normalizedParams = normalizeSearchParams(searchParams);

    let searchResult: { logs: StoredLog[]; total: number } | undefined;
    let searchLayer: 'elasticsearch' | 'fallback' | 'merged' = 'elasticsearch';
    try {
      if (!elasticsearchManager.isConnected()) {
        const connected = await elasticsearchManager.ensureConnected();
        if (!connected && isSystemDarwinSearch) {
          searchResult = await searchDarwinFallbackLogs(normalizedParams);
          searchLayer = 'fallback';
        } else if (!connected) {
          throw new Error('Elasticsearch client not initialized. Call initialize() first.');
        }
      }

      if (!searchResult) {
        const esClient = elasticsearchManager.getClientFromContext(ctx, tenantId);
        const esResult = await esClient.searchLogs(normalizedParams);
        if (isSystemDarwinSearch) {
          const fallbackResult = await searchDarwinFallbackLogs(buildFallbackMergeParams(normalizedParams));
          ctx.service?.logger?.info('Darwin log search storage checkpoint', {
            tenantId,
            index: typeof (esClient as any).getIndexName === 'function' ? (esClient as any).getIndexName() : undefined,
            normalizedParams: {
              page: normalizedParams.page,
              pageSize: normalizedParams.pageSize,
              limit: normalizedParams.limit,
              sortBy: normalizedParams.sortBy,
              sortOrder: normalizedParams.sortOrder,
              originType: normalizedParams.originType,
              visibility: normalizedParams.visibility,
              service: normalizedParams.service,
              level: normalizedParams.level,
              levels: normalizedParams.levels,
              excludeServices: normalizedParams.excludeServices,
              excludeNodeIDs: normalizedParams.excludeNodeIDs,
              startTime: normalizedParams.startTime,
              endTime: normalizedParams.endTime,
              query: normalizedParams.query,
            },
            esTotal: esResult.total,
            esReturned: esResult.logs.length,
            esServices: summarizeStoredLogServices(esResult.logs),
            fallbackTotal: fallbackResult.total,
            fallbackReturned: fallbackResult.logs.length,
          });
          searchResult = mergeDarwinSearchResults(esResult, fallbackResult, normalizedParams);
          searchLayer = fallbackResult.total > 0 ? 'merged' : 'elasticsearch';
        } else {
          searchResult = esResult;
        }
      }
    } catch (error) {
      if (!isSystemDarwinSearch) throw error;
      ctx.service?.logger?.warn('Falling back to Darwin log capture file for search:', summarizeElasticsearchError(error));
      searchResult = await searchDarwinFallbackLogs(normalizedParams);
      searchLayer = 'fallback';
    }

    if (!searchResult) {
      searchResult = { logs: [], total: 0 };
    }

    if (!isSystemDarwinSearch) {
      await quotaChecker.updateSearchUsage(tenantId);
    }

    await ctx.emit('logs.searched', {
      tenantId,
      userId,
      query: normalizedParams.query,
      resultCount: searchResult.total,
      timestamp: Date.now(),
    });

    const result: LogSearchResult = {
      logs: (searchResult.logs || []).map(
        (log: StoredLog): LogEntry => ({
          id: log.id,
          level: log.level,
          message: log.message,
          timestamp: log.timestamp,
          service: getDisplayService(log),
          hostname: log.hostname,
          containerId: log.containerId,
          source: log.source || LogSource.SERVER,
          originType: log.originType,
          visibility: log.visibility,
          nodeID: log.nodeID,
          namespace: log.namespace,
          mod: log.mod,
          svc: log.svc,
          metadata: log.metadata,
          tenantId: log.tenantId,
          userId: log.userId,
          sessionId: log.sessionId,
          traceId: log.traceId,
          tags: log.tags,
        }),
      ),
      total: searchResult.total || 0,
      page: normalizedParams.page || 1,
      limit: normalizedParams.pageSize || normalizedParams.limit || 50,
      took: 0,
      aggregations: undefined,
      highlights: undefined,
      suggestions: undefined,
    };

    return result;
  } catch (error) {
    ctx.service?.logger?.error('Failed to search logs:', summarizeElasticsearchError(error));
    throw error;
  }
}

function summarizeStoredLogServices(logs: StoredLog[]): Record<string, number> {
  return logs.reduce<Record<string, number>>((acc, log) => {
    const service = String(getDisplayService(log) || log.service || 'unknown');
    acc[service] = (acc[service] || 0) + 1;
    return acc;
  }, {});
}

function getSearchLimit(params: LogSearchParams): number {
  return Math.max(1, Number(params.limit || params.pageSize || DEFAULT_PAGE_SIZE));
}

function getSearchPage(params: LogSearchParams): number {
  return Math.max(1, Number(params.page || 1));
}

function buildFallbackMergeParams(params: LogSearchParams): LogSearchParams {
  const page = getSearchPage(params);
  const limit = getSearchLimit(params);

  return {
    ...params,
    page: 1,
    pageSize: page * limit,
    limit: page * limit,
  };
}

function getStoredLogTimestamp(log: StoredLog): number {
  const timestamp = new Date(log.timestamp).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sortStoredLogs(logs: StoredLog[], sortBy = 'timestamp', sortOrder: 'asc' | 'desc' = 'desc'): StoredLog[] {
  return [...logs].sort((left, right) => {
    const leftValue = sortBy === 'timestamp' ? getStoredLogTimestamp(left) : String(left[sortBy as keyof StoredLog] || '');
    const rightValue = sortBy === 'timestamp' ? getStoredLogTimestamp(right) : String(right[sortBy as keyof StoredLog] || '');

    if (leftValue < rightValue) return sortOrder === 'asc' ? -1 : 1;
    if (leftValue > rightValue) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });
}

function mergeDarwinSearchResults(
  esResult: { logs: StoredLog[]; total: number },
  fallbackResult: { logs: StoredLog[]; total: number },
  params: LogSearchParams,
): { logs: StoredLog[]; total: number } {
  if (fallbackResult.logs.length === 0) return esResult;

  const byId = new Map<string, StoredLog>();
  for (const log of esResult.logs) byId.set(log.id, log);
  for (const log of fallbackResult.logs) byId.set(log.id, log);

  const page = getSearchPage(params);
  const limit = getSearchLimit(params);
  const offset = (page - 1) * limit;
  const sortedLogs = sortStoredLogs(Array.from(byId.values()), params.sortBy || 'timestamp', params.sortOrder || 'desc');

  return {
    logs: sortedLogs.slice(offset, offset + limit),
    total: Math.max(esResult.total, esResult.logs.length) + fallbackResult.logs.filter((log) => !esResult.logs.some((esLog) => esLog.id === log.id)).length,
  };
}

/**
 * 高级搜索日志
 */
export async function advancedSearchLogs(
  ctx: Context,
  params: {
    apiKey: string;
    searchParams: LogSearchParams & {
      aggregations?: Record<string, any>;
      highlight?: boolean;
      explain?: boolean;
    };
    tenantId: string;
    userId?: string;
  },
): Promise<
  LogSearchResult & {
    aggregations?: Record<string, any>;
    highlights?: Record<string, string[]>;
    explanations?: Record<string, any>;
  }
> {
  try {
    const { apiKey, searchParams, tenantId, userId } = params;

    // 验证API密钥和权限
    const validatedKey = await ApiKeyManager.getInstance().validateApiKey(apiKey);
    if (!validatedKey) {
      throw new Error('Invalid API key');
    }

    // 检查租户匹配
    if (validatedKey.tenantId !== tenantId) {
      throw new Error('API key does not belong to the specified tenant');
    }

    // 检查权限
    const hasAdvancedSearchPermission = ApiKeyManager.getInstance().hasPermission(
      validatedKey,
      ApiPermission.SEARCH,
    );
    if (!hasAdvancedSearchPermission) {
      throw new Error('Insufficient permissions for advanced log search');
    }

    // 检查配额
    const quotaChecker = new QuotaChecker();
    const quotaCheck = await quotaChecker.checkSearchQuota(tenantId);
    if (!quotaCheck.allowed) {
      throw new Error(`Search quota exceeded: ${quotaCheck.reason || 'Quota limit reached'}`);
    }

    // 执行高级搜索
    const esClient = elasticsearchManager.getClientFromContext(ctx, tenantId);
    const result = await esClient.advancedSearchLogs(searchParams);

    // 更新配额
    await quotaChecker.updateSearchUsage(tenantId);

    // 记录事件
    await ctx.emit('logs.advanced.searched', {
      tenantId,
      userId,
      query: searchParams.query,
      hasAggregations: !!searchParams.aggregations,
      resultCount: result.total,
      timestamp: Date.now(),
    });

    return result;
  } catch (error) {
    ctx.service?.logger?.error('Failed to perform advanced search:', error);
    throw error;
  }
}

/**
 * 实时搜索日志
 */
export async function realtimeSearchLogs(
  ctx: Context,
  params: {
    apiKey: string;
    searchParams: LogSearchParams;
    tenantId: string;
    userId?: string;
    callback: (logs: LogEntry[]) => void;
  },
): Promise<{ success: boolean; subscriptionId: string }> {
  try {
    const { apiKey, searchParams, tenantId, userId, callback } = params;

    // 验证API密钥和权限
    const validatedKey = await ApiKeyManager.getInstance().validateApiKey(apiKey);
    if (!validatedKey) {
      throw new Error('Invalid API key');
    }

    // 检查租户匹配
    if (validatedKey.tenantId !== tenantId) {
      throw new Error('API key does not belong to the specified tenant');
    }

    // 检查权限
    const hasRealtimeSearchPermission = ApiKeyManager.getInstance().hasPermission(
      validatedKey,
      ApiPermission.SEARCH,
    );
    if (!hasRealtimeSearchPermission) {
      throw new Error('Insufficient permissions for realtime log search');
    }

    // 创建实时搜索订阅
    const esClient = elasticsearchManager.getClientFromContext(ctx, tenantId);
    const data = await esClient.createRealtimeSearch(searchParams);

    // 记录事件
    await ctx.emit('logs.realtime.search.started', data.subscriptionId);

    return {
      success: true,
      subscriptionId: data.subscriptionId,
    };
  } catch (error) {
    ctx.service?.logger?.error('Failed to start realtime search:', error);
    throw error;
  }
}

/**
 * 停止实时搜索
 */
export async function stopRealtimeSearch(
  ctx: Context,
  params: {
    subscriptionId: string;
    tenantId: string;
    userId?: string;
  },
): Promise<{ success: boolean }> {
  try {
    const { subscriptionId, tenantId, userId } = params;

    const esClient = elasticsearchManager.getClientFromContext(ctx, tenantId);
    await esClient.stopRealtimeSearch(subscriptionId);

    // 记录事件
    await ctx.emit('logs.realtime.search.stopped', subscriptionId);

    return { success: true };
  } catch (error) {
    ctx.service?.logger?.error('Failed to stop realtime search:', error);
    throw error;
  }
}

/**
 * 搜索建议
 */
export async function getSearchSuggestions(
  ctx: Context,
  params: {
    apiKey: string;
    query: string;
    field?: string;
    tenantId: string;
    userId?: string;
  },
): Promise<{ suggestions: string[] }> {
  try {
    const { apiKey, query, field = 'message', tenantId, userId } = params;

    // 验证API密钥
    const validatedKey = await ApiKeyManager.getInstance().validateApiKey(apiKey);
    if (!validatedKey) {
      throw new Error('Invalid API key');
    }

    // 检查租户匹配
    if (validatedKey.tenantId !== tenantId) {
      throw new Error('API key does not belong to the specified tenant');
    }

    // 检查权限
    const hasSearchPermission = ApiKeyManager.getInstance().hasPermission(
      validatedKey,
      ApiPermission.SEARCH,
    );
    if (!hasSearchPermission) {
      throw new Error('Insufficient permissions for search suggestions');
    }

    const esClient = elasticsearchManager.getClientFromContext(ctx, tenantId);
    const suggestions = await esClient.getSearchSuggestions({ query, field });

    return { suggestions: suggestions.suggestions || [] };
  } catch (error) {
    ctx.service?.logger?.error('Failed to get search suggestions:', error);
    throw error;
  }
}

/**
 * 获取字段值
 */
export async function getFieldValues(
  ctx: Context,
  params: {
    apiKey: string;
    field: string;
    tenantId: string;
    userId?: string;
    limit?: number;
  },
): Promise<{ values: Array<{ value: string; count: number }> }> {
  try {
    const { apiKey, field, tenantId, userId, limit = 100 } = params;

    // 验证API密钥
    const validatedKey = await ApiKeyManager.getInstance().validateApiKey(apiKey);
    if (!validatedKey) {
      throw new Error('Invalid API key');
    }

    // 检查租户匹配
    if (validatedKey.tenantId !== tenantId) {
      throw new Error('API key does not belong to the specified tenant');
    }

    const esClient = elasticsearchManager.getClientFromContext(ctx, tenantId);
    const values = await esClient.getFieldValues({ field, size: limit });

    return { values: values.values?.map((v) => ({ value: v, count: 1 })) || [] };
  } catch (error) {
    ctx.service?.logger?.error('Failed to get field values:', error);
    throw error;
  }
}

/**
 * 保存搜索查询
 */
export async function saveSearchQuery(
  ctx: Context,
  params: {
    apiKey: string;
    name: string;
    searchParams: LogSearchParams;
    tenantId: string;
    userId: string;
    description?: string;
  },
): Promise<{ success: boolean; queryId: string }> {
  try {
    const { apiKey, name, searchParams, tenantId, userId, description } = params;

    // 验证API密钥
    const validatedKey = await ApiKeyManager.getInstance().validateApiKey(apiKey);
    if (!validatedKey) {
      throw new Error('Invalid API key');
    }

    // 检查租户匹配
    if (validatedKey.tenantId !== tenantId) {
      throw new Error('API key does not belong to the specified tenant');
    }

    // 保存查询
    const queryId = await (ctx.service as any)?.mongodb?.collection('saved_queries').insertOne({
      name,
      searchParams,
      tenantId,
      userId,
      description,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 记录事件
    await ctx.emit('logs.query.saved', {
      tenantId,
      userId,
      queryId: queryId.insertedId.toString(),
      name,
      timestamp: Date.now(),
    });

    return {
      success: true,
      queryId: queryId.insertedId.toString(),
    };
  } catch (error) {
    ctx.service?.logger?.error('Failed to save search query:', error);
    throw error;
  }
}

/**
 * 获取保存的搜索查询
 */
export async function getSavedSearchQueries(
  ctx: Context,
  params: {
    apiKey: string;
    tenantId: string;
    userId: string;
  },
): Promise<{
  queries: Array<{
    id: string;
    name: string;
    searchParams: LogSearchParams;
    description?: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
}> {
  try {
    const { apiKey, tenantId, userId } = params;

    // 验证API密钥
    const validatedKey = await ApiKeyManager.getInstance().validateApiKey(apiKey);
    if (!validatedKey) {
      throw new Error('Invalid API key');
    }

    // 检查租户匹配
    if (validatedKey.tenantId !== tenantId) {
      throw new Error('API key does not belong to the specified tenant');
    }

    const queries = await (ctx.service as any)?.mongodb
      ?.collection('saved_queries')
      ?.find({ tenantId, userId })
      ?.sort({ updatedAt: -1 })
      ?.toArray();

    return {
      queries: queries.map((q) => ({
        id: q._id.toString(),
        name: q.name,
        searchParams: q.searchParams,
        description: q.description,
        createdAt: q.createdAt,
        updatedAt: q.updatedAt,
      })),
    };
  } catch (error) {
    ctx.service?.logger?.error('Failed to get saved queries:', error);
    throw error;
  }
}

/**
 * 标准化搜索参数
 */
function normalizeSearchParams(params: LogSearchParams): LogSearchParams {
  const normalized: LogSearchParams = {
    ...params,
    page: Math.max(1, params.page || 1),
    pageSize: Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize || DEFAULT_PAGE_SIZE)),
    sortBy: params.sortBy || 'timestamp',
    sortOrder: params.sortOrder || 'desc',
  };

  const normalizedTimeRange = LogUtils.formatTimeRange(
    params.startTime ? String(params.startTime) : undefined,
    params.endTime ? String(params.endTime) : undefined,
  );

  if (normalizedTimeRange.gte) {
    normalized.startTime = normalizedTimeRange.gte;
  }

  if (normalizedTimeRange.lte) {
    normalized.endTime = normalizedTimeRange.lte;
  }

  // 标准化时间范围
  if (params.timeRange) {
    const timeRange = LogUtils.parseTimeRange(params.timeRange);
    normalized.startTime = timeRange.start;
    normalized.endTime = timeRange.end;
  }

  // 验证日志级别
  if (params.levels) {
    normalized.levels = params.levels.filter((level) =>
      SUPPORTED_LOG_LEVELS.includes(level as LogLevel),
    ) as LogLevel[];
  }

  // 验证日志来源
  if (params.sources) {
    normalized.sources = params.sources.filter((source) =>
      SUPPORTED_LOG_SOURCES.includes(source as LogSource),
    ) as LogSource[];
  }

  return normalized;
}

/**
 * 构建搜索查询
 */
export function buildSearchQuery(params: LogSearchParams): any {
  const query: any = {
    bool: {
      must: [],
      filter: [],
    },
  };

  // 文本搜索
  if (params.query) {
    query.bool.must.push({
      multi_match: {
        query: params.query,
        fields: ['message^2', 'source', 'hostname', 'metadata.*'],
        type: 'best_fields',
        fuzziness: 'AUTO',
      },
    });
  }

  // 时间范围过滤
  if (params.startTime || params.endTime) {
    const timeFilter: any = { range: { timestamp: {} } };
    if (params.startTime) {
      timeFilter.range.timestamp.gte = params.startTime;
    }
    if (params.endTime) {
      timeFilter.range.timestamp.lte = params.endTime;
    }
    query.bool.filter.push(timeFilter);
  }

  // 日志级别过滤
  if (params.levels && params.levels.length > 0) {
    query.bool.filter.push({
      terms: { level: params.levels },
    });
  }

  // 日志来源过滤
  if (params.sources && params.sources.length > 0) {
    query.bool.filter.push({
      terms: { source: params.sources },
    });
  }

  // 主机名过滤
  if (params.hostname) {
    query.bool.filter.push({
      term: { hostname: params.hostname },
    });
  }

  // 自定义过滤器
  if (params.filters) {
    Object.entries(params.filters).forEach(([field, value]) => {
      if (Array.isArray(value)) {
        query.bool.filter.push({
          terms: { [field]: value },
        });
      } else {
        query.bool.filter.push({
          term: { [field]: value },
        });
      }
    });
  }

  return query;
}
