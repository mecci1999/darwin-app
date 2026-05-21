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
import { ElasticsearchClient } from '../utils/elasticsearch';
import { elasticsearchManager } from '../utils/elasticsearch-manager';
import { ApiKeyManager } from '../utils/api-key-manager';
import { QuotaChecker } from '../utils/quota-checker';
import { LogUtils } from '../utils/log-utils';
import { SYSTEM_LOG_TENANT_ID } from '../utils/access-control';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  SEARCH_TIMEOUT,
  SUPPORTED_LOG_LEVELS,
  SUPPORTED_LOG_SOURCES,
} from '../constants';

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
        throw new Error('Insufficient permissions for log search');
      }

      // 检查搜索配额
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

    // 验证搜索参数
    const validationResult = LogUtils.validateSearchParams(searchParams);
    if (!validationResult.valid) {
      throw new Error(`Invalid search parameters: ${validationResult.errors.join(', ')}`);
    }

    // 标准化搜索参数
    const normalizedParams = normalizeSearchParams(searchParams);

    // 执行搜索
    const esClient = elasticsearchManager.getClientFromContext(ctx, tenantId);
    const searchResult = await esClient.searchLogs(normalizedParams);

    // 更新搜索配额使用量
    if (!isSystemDarwinSearch) {
      await quotaChecker.updateSearchUsage(tenantId);
    }

    // 记录搜索事件
    await ctx.emit('logs.searched', {
      tenantId,
      userId,
      query: normalizedParams.query,
      resultCount: searchResult.total,
      timestamp: Date.now(),
    });

    ctx.service?.logger?.debug(`Log search completed: ${searchResult.total} results found`);

    // 确保返回结果符合LogSearchResult接口
    const result: LogSearchResult = {
      logs: (searchResult.logs || []).map(
        (log: StoredLog): LogEntry => ({
          id: log.id,
          level: log.level,
          message: log.message,
          timestamp: log.timestamp,
          service: log.service,
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
      took: 0, // 默认值，实际应该从ES响应中获取
      aggregations: undefined,
      highlights: undefined,
      suggestions: undefined,
    };

    return result;
  } catch (error) {
    ctx.service?.logger?.error('Failed to search logs:', error);
    throw error;
  }
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
