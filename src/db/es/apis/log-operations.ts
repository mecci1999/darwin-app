/**
 * Elasticsearch日志操作API
 * 专门处理日志相关的索引、搜索和管理操作
 */
import { esConnection } from '../index';
import { 
  createIndex, 
  deleteIndex, 
  indexExists, 
  getIndexStats, 
  optimizeIndex, 
  createIndexTemplate, 
  reindexData 
} from './index-management';
import { 
  bulkIndexDocuments, 
  deleteByQuery 
} from './document-operations';
import { 
  searchDocuments, 
  searchWithAggregations, 
  scrollSearch, 
  continueScroll, 
  clearScroll, 
  getFieldMappings 
} from './search-operations';

// 日志相关的类型定义
export interface LogEntry {
  id: string;
  timestamp: Date;
  level: string;
  message: string;
  source: string;
  tenantId: string;
  metadata?: Record<string, any>;
}

export interface SearchParams {
  query?: string;
  levels?: string[];
  sources?: string[];
  timeRange?: string;
  startTime?: Date;
  endTime?: Date;
  size?: number;
  from?: number;
  filters?: Record<string, any>;
  sort?: Array<{ field: string; order: 'asc' | 'desc' }>;
}

export interface SearchResult {
  logs: LogEntry[];
  total: number;
  took: number;
  aggregations?: any;
  searchParams: SearchParams;
}

// 常量定义
const ES_INDEX_PREFIX = process.env.ES_INDEX_PREFIX || 'logs';
const ES_QUERY_TIMEOUT = process.env.ES_QUERY_TIMEOUT || '30s';

// 默认索引设置
const ES_INDEX_SETTINGS = {
  number_of_shards: 1,
  number_of_replicas: 0,
  refresh_interval: '5s',
  'index.mapping.total_fields.limit': 2000,
};

// 默认映射模板
const ES_MAPPING_TEMPLATE = {
  properties: {
    timestamp: {
      type: 'date',
      format: 'strict_date_optional_time||epoch_millis',
    },
    '@timestamp': {
      type: 'date',
      format: 'strict_date_optional_time||epoch_millis',
    },
    level: {
      type: 'keyword',
    },
    message: {
      type: 'text',
      analyzer: 'standard',
      fields: {
        keyword: {
          type: 'keyword',
          ignore_above: 256,
        },
      },
    },
    source: {
      type: 'keyword',
    },
    tenantId: {
      type: 'keyword',
    },
    metadata: {
      type: 'object',
      dynamic: true,
    },
  },
};

/**
 * 创建日志索引
 */
export async function createLogIndex(
  tenantId: string,
  indexSuffix?: string,
  settings?: any,
  mappings?: any
): Promise<{
  success: boolean;
  indexName: string;
  error?: string;
}> {
  const indexName = generateIndexName(tenantId, indexSuffix);
  
  const result = await createIndex(
    indexName,
    settings || ES_INDEX_SETTINGS,
    mappings || ES_MAPPING_TEMPLATE
  );
  
  return {
    ...result,
    indexName,
  };
}

/**
 * 删除日志索引
 */
export async function deleteLogIndex(
  tenantId: string,
  indexSuffix?: string,
  force: boolean = false
): Promise<{
  success: boolean;
  error?: string;
}> {
  const indexName = generateIndexName(tenantId, indexSuffix);
  
  // 安全检查：确保不是在删除重要索引
  if (!force && !indexName.includes(tenantId)) {
    return {
      success: false,
      error: 'Invalid index name for deletion',
    };
  }
  
  return await deleteIndex(indexName);
}

/**
 * 批量索引日志
 */
export async function bulkIndexLogs(
  logs: LogEntry[],
  tenantId: string,
  indexSuffix?: string,
  refresh: boolean = false
): Promise<{
  success: boolean;
  indexed: number;
  failed: number;
  errors?: Array<{ id: string; error: string }>;
}> {
  if (logs.length === 0) {
    return {
      success: true,
      indexed: 0,
      failed: 0,
    };
  }
  
  const indexName = generateIndexName(tenantId, indexSuffix);
  
  // 确保索引存在
  await createLogIndex(tenantId, indexSuffix);
  
  // 转换日志格式
  const documents = logs.map(log => ({
    index: indexName,
    id: log.id,
    document: {
      ...log,
      timestamp: log.timestamp.toISOString(),
      '@timestamp': log.timestamp.toISOString(),
      tenantId,
    },
  }));
  
  return await bulkIndexDocuments(documents, refresh, ES_QUERY_TIMEOUT);
}

/**
 * 搜索日志
 */
export async function searchLogs(
  tenantId: string,
  searchParams: SearchParams,
  indexPattern?: string
): Promise<SearchResult> {
  const indexName = indexPattern || generateIndexPattern(tenantId);
  
  // 构建查询
  const query = buildElasticsearchQuery(searchParams, tenantId);
  
  // 执行搜索
  const response = await searchDocuments(indexName, query.query, {
    size: query.size,
    from: query.from,
    sort: query.sort,
    timeout: ES_QUERY_TIMEOUT,
  });
  
  // 转换结果
  const logs = response.hits.map((hit: any) => ({
    ...hit,
    timestamp: new Date(hit.timestamp),
  }));
  
  return {
    logs,
    total: response.total,
    took: response.took,
    aggregations: response.aggregations,
    searchParams,
  };
}

/**
 * 获取日志统计
 */
export async function getLogAggregations(
  tenantId: string,
  searchParams: SearchParams,
  aggregations: any,
  indexPattern?: string
): Promise<{
  aggregations: any;
  took: number;
}> {
  const indexName = indexPattern || generateIndexPattern(tenantId);
  
  // 构建查询
  const query = buildElasticsearchQuery(searchParams, tenantId);
  
  // 执行聚合查询
  const response = await searchWithAggregations(
    indexName,
    query.query,
    aggregations,
    {
      size: 0,
      timeout: ES_QUERY_TIMEOUT,
    }
  );
  
  return {
    aggregations: response.aggregations,
    took: response.took,
  };
}

/**
 * 删除日志
 */
export async function deleteLogs(
  tenantId: string,
  query?: any,
  logIds?: string[],
  indexPattern?: string
): Promise<{
  success: boolean;
  deleted: number;
  error?: string;
}> {
  const indexName = indexPattern || generateIndexPattern(tenantId);
  
  let deleteQuery: any;
  
  if (logIds && logIds.length > 0) {
    // 按ID删除
    deleteQuery = {
      bool: {
        must: [
          { term: { tenantId } },
          { terms: { _id: logIds } },
        ],
      },
    };
  } else if (query) {
    // 按查询删除
    deleteQuery = {
      bool: {
        must: [
          { term: { tenantId } },
          query,
        ],
      },
    };
  } else {
    return {
      success: false,
      deleted: 0,
      error: 'Either query or logIds must be provided',
    };
  }
  
  return await deleteByQuery(indexName, deleteQuery, ES_QUERY_TIMEOUT);
}

/**
 * 滚动搜索日志
 */
export async function scrollSearchLogs(
  tenantId: string,
  searchParams: SearchParams,
  scrollSize: number = 1000,
  scrollTimeout: string = '1m',
  indexPattern?: string
): Promise<{
  scrollId: string;
  logs: LogEntry[];
  total: number;
  hasMore: boolean;
}> {
  const indexName = indexPattern || generateIndexPattern(tenantId);
  
  // 构建查询
  const query = buildElasticsearchQuery(searchParams, tenantId);
  
  // 执行滚动搜索
  const response = await scrollSearch(indexName, query.query, {
    size: scrollSize,
    scroll: scrollTimeout,
    sort: query.sort,
  });
  
  const logs = response.hits.map((hit: any) => ({
    ...hit,
    timestamp: new Date(hit.timestamp),
  }));
  
  return {
    scrollId: response.scrollId,
    logs,
    total: response.total,
    hasMore: response.hasMore,
  };
}

/**
 * 继续滚动搜索
 */
export async function continueScrollLogs(
  scrollId: string,
  scrollTimeout: string = '1m'
): Promise<{
  scrollId: string;
  logs: LogEntry[];
  hasMore: boolean;
}> {
  const response = await continueScroll(scrollId, scrollTimeout);
  
  const logs = response.hits.map((hit: any) => ({
    ...hit,
    timestamp: new Date(hit.timestamp),
  }));
  
  return {
    scrollId: response.scrollId,
    logs,
    hasMore: response.hasMore,
  };
}

/**
 * 清除滚动上下文
 */
export async function clearScrollLogs(scrollId: string) {
  return await clearScroll(scrollId);
}

/**
 * 获取日志字段映射
 */
export async function getLogFieldMappings(
  tenantId: string,
  indexPattern?: string
) {
  const pattern = indexPattern || generateIndexPattern(tenantId);
  return await getFieldMappings(pattern);
}

/**
 * 获取日志索引统计
 */
export async function getLogIndexStats(
  tenantId: string,
  indexPattern?: string
) {
  const pattern = indexPattern || generateIndexPattern(tenantId);
  return await getIndexStats(pattern);
}

/**
 * 优化日志索引
 */
export async function optimizeLogIndex(
  tenantId: string,
  indexPattern?: string,
  maxNumSegments: number = 1
) {
  const pattern = indexPattern || generateIndexPattern(tenantId);
  return await optimizeIndex(pattern, maxNumSegments);
}

/**
 * 创建日志索引模板
 */
export async function createLogIndexTemplate(
  templateName: string,
  indexPatterns: string[],
  settings?: any,
  mappings?: any,
  priority: number = 100
) {
  return await createIndexTemplate(
    templateName,
    indexPatterns,
    settings || ES_INDEX_SETTINGS,
    mappings || ES_MAPPING_TEMPLATE,
    priority
  );
}

/**
 * 重建日志索引
 */
export async function reindexLogs(
  tenantId: string,
  sourceIndex: string,
  targetIndex: string,
  query?: any,
  batchSize: number = 1000
) {
  // 确保目标索引存在
  await createLogIndex(tenantId, targetIndex.split('-').pop());
  
  // 构建查询过滤
  let reindexQuery = { term: { tenantId } };
  if (query) {
    reindexQuery = {
      bool: {
        must: [
          { term: { tenantId } },
          query,
        ],
      },
    } as any;
  }
  
  return await reindexData(sourceIndex, targetIndex, reindexQuery, batchSize);
}

/**
 * 生成索引名称
 */
function generateIndexName(tenantId: string, suffix?: string): string {
  const dateSuffix = suffix || new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${ES_INDEX_PREFIX}-${tenantId}-${dateSuffix}`;
}

/**
 * 生成索引模式
 */
function generateIndexPattern(tenantId: string): string {
  return `${ES_INDEX_PREFIX}-${tenantId}-*`;
}

/**
 * 构建Elasticsearch查询
 */
function buildElasticsearchQuery(searchParams: SearchParams, tenantId: string): any {
  const query: any = {
    query: {
      bool: {
        must: [
          { term: { tenantId } },
        ],
        filter: [],
      },
    },
    sort: [],
    size: searchParams.size || 100,
    from: searchParams.from || 0,
  };
  
  // 添加时间范围过滤
  if (searchParams.timeRange) {
    const timeFilter = parseTimeRange(searchParams.timeRange);
    query.query.bool.filter.push({
      range: {
        timestamp: {
          gte: new Date(Date.now() - timeFilter).toISOString(),
          lte: new Date().toISOString(),
        },
      },
    });
  } else if (searchParams.startTime || searchParams.endTime) {
    const rangeFilter: any = {};
    if (searchParams.startTime) {
      rangeFilter.gte = searchParams.startTime.toISOString();
    }
    if (searchParams.endTime) {
      rangeFilter.lte = searchParams.endTime.toISOString();
    }
    query.query.bool.filter.push({
      range: { timestamp: rangeFilter },
    });
  }
  
  // 添加日志级别过滤
  if (searchParams.levels && searchParams.levels.length > 0) {
    query.query.bool.filter.push({
      terms: { level: searchParams.levels },
    });
  }
  
  // 添加来源过滤
  if (searchParams.sources && searchParams.sources.length > 0) {
    query.query.bool.filter.push({
      terms: { source: searchParams.sources },
    });
  }
  
  // 添加搜索查询
  if (searchParams.query) {
    if (searchParams.query.startsWith('/') && searchParams.query.endsWith('/')) {
      // 正则表达式查询
      const regex = searchParams.query.slice(1, -1);
      query.query.bool.must.push({
        regexp: {
          message: {
            value: regex,
            flags: 'ALL',
          },
        },
      });
    } else {
      // 全文搜索
      query.query.bool.must.push({
        multi_match: {
          query: searchParams.query,
          fields: ['message^2', 'source', 'metadata.*'],
          type: 'best_fields',
          fuzziness: 'AUTO',
        },
      });
    }
  }
  
  // 添加字段过滤
  if (searchParams.filters) {
    Object.entries(searchParams.filters).forEach(([field, value]) => {
      if (Array.isArray(value)) {
        query.query.bool.filter.push({
          terms: { [field]: value },
        });
      } else {
        query.query.bool.filter.push({
          term: { [field]: value },
        });
      }
    });
  }
  
  // 添加排序
  if (searchParams.sort && searchParams.sort.length > 0) {
    query.sort = searchParams.sort.map(sort => ({
      [sort.field]: { order: sort.order },
    }));
  } else {
    // 默认按时间倒序排列
    query.sort = [{ timestamp: { order: 'desc' } }];
  }
  
  return query;
}

/**
 * 解析时间范围
 */
function parseTimeRange(timeRange: string): number {
  const match = timeRange.match(/^(\d+)([smhd])$/);
  if (!match) {
    throw new Error('Invalid time range format');
  }
  
  const value = parseInt(match[1]);
  const unit = match[2];
  
  switch (unit) {
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    default:
      throw new Error('Invalid time range unit');
  }
}