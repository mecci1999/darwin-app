/**
 * Elasticsearch搜索操作API
 */
import { SearchTotalHits } from '@elastic/elasticsearch/lib/api/types';
import { esConnection } from '../index';

/**
 * 搜索操作相关的数据库操作
 */

/**
 * 基础搜索
 */
export async function searchDocuments(
  index: string,
  query: any,
  options?: {
    size?: number;
    from?: number;
    sort?: any[];
    _source?: string[] | boolean;
    timeout?: string;
  },
): Promise<{
  hits: any[];
  total: number;
  took: number;
  aggregations?: any;
}> {
  try {
    const client = await esConnection.getConnection();

    const searchParams: any = {
      index,
      body: {
        query,
        size: options?.size || 100,
        from: options?.from || 0,
      },
    };

    if (options?.sort) {
      searchParams.body.sort = options.sort;
    }

    if (options?._source !== undefined) {
      searchParams.body._source = options._source;
    }

    if (options?.timeout) {
      searchParams.timeout = options.timeout;
    }

    const response = await client.search(searchParams);

    const hits = response.hits.hits.map((hit: any) => ({
      ...hit._source,
      _id: hit._id,
      _score: hit._score,
    }));

    return {
      hits,
      total:
        (response.hits.total as SearchTotalHits)?.value || (response.hits.total as number) || 0,
      took: response.took,
      aggregations: response.aggregations,
    };
  } catch (error) {
    throw error;
  }
}

/**
 * 聚合查询
 */
export async function searchWithAggregations(
  index: string,
  query: any,
  aggregations: any,
  options?: {
    size?: number;
    timeout?: string;
  },
): Promise<{
  aggregations: any;
  took: number;
  hits?: any[];
  total?: number;
}> {
  try {
    const client = await esConnection.getConnection();

    const searchParams: any = {
      index,
      body: {
        query,
        size: options?.size || 0, // 默认不返回文档，只返回聚合结果
        aggs: aggregations,
      },
    };

    if (options?.timeout) {
      searchParams.timeout = options.timeout;
    }

    const response = await client.search(searchParams);

    const result: any = {
      aggregations: response.aggregations,
      took: response.took,
    };

    // 如果请求了文档，则包含文档结果
    if (options?.size && options.size > 0) {
      result.hits = response.hits.hits.map((hit: any) => ({
        ...hit._source,
        _id: hit._id,
        _score: hit._score,
      }));
      result.total =
        (response.hits.total as SearchTotalHits)?.value || (response.hits.total as number) || 0;
    }

    return result;
  } catch (error) {
    throw error;
  }
}

/**
 * 滚动搜索
 */
export async function scrollSearch(
  index: string,
  query: any,
  options?: {
    size?: number;
    scroll?: string;
    sort?: any[];
    _source?: string[] | boolean;
  },
): Promise<{
  scrollId: string;
  hits: any[];
  total: number;
  hasMore: boolean;
}> {
  try {
    const client = await esConnection.getConnection();

    const searchParams: any = {
      index,
      body: {
        query,
        size: options?.size || 1000,
      },
      scroll: options?.scroll || '1m',
    };

    if (options?.sort) {
      searchParams.body.sort = options.sort;
    }

    if (options?._source !== undefined) {
      searchParams.body._source = options._source;
    }

    const response = await client.search(searchParams);

    const hits = response.hits.hits.map((hit: any) => ({
      ...hit._source,
      _id: hit._id,
    }));

    const total =
      (response.hits.total as SearchTotalHits)?.value || (response.hits.total as number) || 0;
    const hasMore = hits.length === (options?.size || 1000) && hits.length < total;

    return {
      scrollId: response._scroll_id || '',
      hits,
      total,
      hasMore,
    };
  } catch (error) {
    throw error;
  }
}

/**
 * 继续滚动搜索
 */
export async function continueScroll(
  scrollId: string,
  scroll: string = '1m',
): Promise<{
  scrollId: string;
  hits: any[];
  hasMore: boolean;
}> {
  try {
    const client = await esConnection.getConnection();

    const response = await client.scroll({
      scroll_id: scrollId,
      scroll,
    });

    const hits = response.hits.hits.map((hit: any) => ({
      ...hit._source,
      _id: hit._id,
    }));

    const hasMore = hits.length > 0;

    return {
      scrollId: response._scroll_id || '',
      hits,
      hasMore,
    };
  } catch (error) {
    throw error;
  }
}

/**
 * 清除滚动上下文
 */
export async function clearScroll(scrollId: string): Promise<{
  success: boolean;
}> {
  try {
    const client = await esConnection.getConnection();

    await client.clearScroll({
      scroll_id: scrollId,
    });

    return { success: true };
  } catch (error) {
    return { success: false };
  }
}

/**
 * 多重搜索
 */
export async function multiSearch(
  searches: Array<{
    index: string;
    query: any;
    size?: number;
    from?: number;
  }>,
): Promise<{
  responses: Array<{
    hits: any[];
    total: number;
    took: number;
    error?: string;
  }>;
}> {
  try {
    const client = await esConnection.getConnection();

    const body: any[] = [];

    searches.forEach((search) => {
      body.push({ index: search.index });
      body.push({
        query: search.query,
        size: search.size || 100,
        from: search.from || 0,
      });
    });

    const response = await client.msearch({ body });

    const responses = response.responses.map((resp: any) => {
      if (resp.error) {
        return {
          hits: [],
          total: 0,
          took: 0,
          error: resp.error.reason || 'Unknown error',
        };
      }

      const hits = resp.hits.hits.map((hit: any) => ({
        ...hit._source,
        _id: hit._id,
        _score: hit._score,
      }));

      return {
        hits,
        total: resp.hits.total.value || resp.hits.total,
        took: resp.took,
      };
    });

    return { responses };
  } catch (error) {
    throw error;
  }
}

/**
 * 计数查询
 */
export async function countDocuments(
  index: string,
  query: any,
): Promise<{
  count: number;
}> {
  try {
    const client = await esConnection.getConnection();

    const response = await client.count({
      index,
      body: {
        query,
      },
    });

    return {
      count: response.count,
    };
  } catch (error) {
    throw error;
  }
}

/**
 * 获取字段映射
 */
export async function getFieldMappings(index: string): Promise<{
  fields: Array<{
    name: string;
    type: string;
    searchable: boolean;
    aggregatable: boolean;
  }>;
}> {
  try {
    const client = await esConnection.getConnection();

    const mappings = await client.indices.getMapping({
      index,
    });

    const fields: Array<{
      name: string;
      type: string;
      searchable: boolean;
      aggregatable: boolean;
    }> = [];

    // 解析映射
    Object.values(mappings).forEach((indexMapping: any) => {
      const properties = indexMapping.mappings.properties || {};
      extractFields(properties, '', fields);
    });

    // 去重并排序
    const uniqueFields = Array.from(
      new Map(fields.map((field) => [field.name, field])).values(),
    ).sort((a, b) => a.name.localeCompare(b.name));

    return { fields: uniqueFields };
  } catch (error) {
    throw error;
  }
}

/**
 * 提取字段信息的辅助函数
 */
function extractFields(
  properties: any,
  prefix: string,
  fields: Array<{
    name: string;
    type: string;
    searchable: boolean;
    aggregatable: boolean;
  }>,
) {
  Object.entries(properties).forEach(([fieldName, fieldConfig]: [string, any]) => {
    const fullFieldName = prefix ? `${prefix}.${fieldName}` : fieldName;

    if (fieldConfig.type) {
      fields.push({
        name: fullFieldName,
        type: fieldConfig.type,
        searchable: fieldConfig.index !== false,
        aggregatable:
          fieldConfig.type === 'keyword' ||
          fieldConfig.type === 'long' ||
          fieldConfig.type === 'integer' ||
          fieldConfig.type === 'date',
      });
    }

    // 递归处理嵌套字段
    if (fieldConfig.properties) {
      extractFields(fieldConfig.properties, fullFieldName, fields);
    }

    // 处理多字段映射
    if (fieldConfig.fields) {
      Object.entries(fieldConfig.fields).forEach(
        ([subFieldName, subFieldConfig]: [string, any]) => {
          fields.push({
            name: `${fullFieldName}.${subFieldName}`,
            type: (subFieldConfig as any).type,
            searchable: (subFieldConfig as any).index !== false,
            aggregatable: (subFieldConfig as any).type === 'keyword',
          });
        },
      );
    }
  });
}
