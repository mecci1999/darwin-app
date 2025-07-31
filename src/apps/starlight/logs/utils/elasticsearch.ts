import { Client } from '@elastic/elasticsearch';
import {
  LogLevel,
  LogSource,
  StoredLog,
  BaseLog,
  LogSearchParams,
  LogStatsParams,
  LogExportParams,
  LogSearchResult,
} from '../types';
import { AggregationsCalendarInterval } from '@elastic/elasticsearch/lib/api/types';

export class ElasticsearchClient {
  private client: Client;
  private indexName: string;

  constructor(config: { node: string; password?: string; index: string }) {
    this.client = new Client({
      node: config.node,
      auth: config.password
        ? {
            username: 'elastic',
            password: config.password,
          }
        : undefined,
    });
    this.indexName = config.index;
  }

  // 初始化索引和映射
  async initializeIndex(): Promise<void> {
    try {
      const exists = await this.client.indices.exists({ index: this.indexName });

      if (!exists) {
        await this.client.indices.create({
          index: this.indexName,
          settings: {
            number_of_shards: 1,
            number_of_replicas: 0,
            'index.mapping.total_fields.limit': 2000,
          },
          mappings: {
            properties: {
              id: { type: 'keyword' },
              level: { type: 'keyword' },
              message: {
                type: 'text',
                analyzer: 'standard',
                fields: {
                  keyword: { type: 'keyword', ignore_above: 256 },
                },
              },
              timestamp: { type: 'date' },
              receivedAt: { type: 'date' },
              service: { type: 'keyword' },
              source: { type: 'keyword' },
              userId: { type: 'keyword' },
              sessionId: { type: 'keyword' },
              traceId: { type: 'keyword' },
              apiKeyId: { type: 'keyword' },
              tenantId: { type: 'keyword' },
              indexed: { type: 'boolean' },
              metadata: {
                type: 'object',
                dynamic: true,
              },
            },
          },
        });
        console.log(`索引 ${this.indexName} 创建成功`);
      }
    } catch (error) {
      console.error('初始化ES索引失败:', error);
      throw error;
    }
  }

  // 批量存储日志
  async bulkIndex(logs: StoredLog[]): Promise<void> {
    if (logs.length === 0) return;

    const body = logs.flatMap((log) => [{ index: { _index: this.indexName, _id: log.id } }, log]);

    try {
      const response = await this.client.bulk({
        index: this.indexName,
        body,
      });

      if (response.errors) {
        const errorItems = response.items?.filter((item: any) => item.index?.error);
        console.error('批量索引部分失败:', errorItems);
      }
    } catch (error) {
      console.error('批量索引失败:', error);
      throw error;
    }
  }

  // 搜索日志
  async searchLogs(params: LogSearchParams): Promise<{ logs: StoredLog[]; total: number }> {
    const query = this.buildSearchQuery(params);
    const from = ((params.page || 1) - 1) * (params.limit || 50);
    const size = params.limit || 50;

    try {
      const response = await this.client.search({
        index: this.indexName,
        query,
        from,
        size,
        sort: [
          {
            [params.sortBy || 'timestamp']: {
              order: params.sortOrder || 'desc',
            },
          },
        ],
      });

      const logs = response.hits.hits.map((hit: any) => hit._source as StoredLog);
      const total =
        typeof response.hits.total === 'number'
          ? response.hits.total
          : response.hits.total?.value || 0;

      return { logs, total };
    } catch (error) {
      console.error('搜索日志失败:', error);
      throw error;
    }
  }

  // 获取日志统计
  async getLogStats(
    params: LogStatsParams,
    tenantId: string,
    userId?: string,
  ): Promise<{ total: number; breakdown: Record<string, number> }> {
    const query = this.buildStatsQuery(params);
    query.query.bool.must.push({ term: { tenantId: tenantId } });
    if (userId) query.query.bool.must.push({ term: { userId: userId } });

    try {
      const response = await this.client.search({
        index: this.indexName,
        query: query.query,
        size: 0,
        aggs: {
          breakdown: {
            terms: {
              field: params.groupBy || 'level',
              size: 100,
            },
          },
        },
      });

      const total =
        typeof response.hits.total === 'number'
          ? response.hits.total
          : response.hits.total?.value || 0;

      const breakdown: Record<string, number> = {};
      const buckets = (response.aggregations?.breakdown as any)?.buckets || [];

      buckets.forEach((bucket: any) => {
        breakdown[bucket.key] = bucket.doc_count;
      });

      return { total, breakdown };
    } catch (error) {
      console.error('获取统计失败:', error);
      throw error;
    }
  }

  // 导出日志
  async exportLogs(params: LogExportParams): Promise<StoredLog[]> {
    const query = this.buildExportQuery(params);
    const size = Math.min(params.limit || 1000, 10000);

    try {
      const response = await this.client.search({
        index: this.indexName,
        query,
        size,
        sort: [{ timestamp: { order: 'desc' } }],
      });

      return response.hits.hits.map((hit: any) => hit._source as StoredLog);
    } catch (error) {
      console.error('导出日志失败:', error);
      throw error;
    }
  }

  // 构建搜索查询
  private buildSearchQuery(params: LogSearchParams): any {
    const must: any[] = [];

    // 文本搜索
    if (params.query) {
      must.push({
        multi_match: {
          query: params.query,
          fields: ['message^2', 'service', 'metadata.*'],
          type: 'best_fields',
          fuzziness: 'AUTO',
        },
      });
    }

    // 精确匹配过滤
    if (params.service) {
      must.push({ term: { service: params.service } });
    }
    if (params.level) {
      must.push({ term: { level: params.level } });
    }
    if (params.source) {
      must.push({ term: { source: params.source } });
    }

    // 时间范围过滤
    if (params.startTime || params.endTime) {
      const range: any = {};
      if (params.startTime) range.gte = params.startTime;
      if (params.endTime) range.lte = params.endTime;
      must.push({ range: { timestamp: range } });
    }

    return must.length > 0 ? { bool: { must } } : { match_all: {} };
  }

  // 构建统计查询
  private buildStatsQuery(params: LogStatsParams): any {
    const must: any[] = [];

    if (params.service) {
      must.push({ term: { service: params.service } });
    }
    if (params.level) {
      must.push({ term: { level: params.level } });
    }
    if (params.source) {
      must.push({ term: { source: params.source } });
    }
    if (params.environment) {
      must.push({ term: { environment: params.environment } });
    }
    if (params.tags && params.tags.length > 0) {
      must.push({ terms: { tags: params.tags } });
    }

    // 时间范围
    const timeRange = this.parseTimeRange(params.timeRange || '24h');
    must.push({
      range: {
        timestamp: {
          gte: timeRange.start,
          lte: timeRange.end,
        },
      },
    });

    return {
      query: { bool: { must } },
    };
  }

  // 构建导出查询
  private buildExportQuery(params: LogExportParams): any {
    const must: any[] = [];

    if (params.query) {
      must.push({
        multi_match: {
          query: params.query,
          fields: ['message', 'service', 'metadata.*'],
        },
      });
    }

    if (params.service) {
      must.push({ term: { service: params.service } });
    }

    if (params.startTime || params.endTime) {
      const range: any = {};
      if (params.startTime) range.gte = params.startTime;
      if (params.endTime) range.lte = params.endTime;
      must.push({ range: { timestamp: range } });
    }

    return must.length > 0 ? { bool: { must } } : { match_all: {} };
  }

  // 解析时间范围
  private parseTimeRange(timeRange: string): { start: number; end: number } {
    const now = new Date();
    const end = now.getTime();

    let start: number;

    if (timeRange.endsWith('h')) {
      const hours = parseInt(timeRange.slice(0, -1));
      start = now.getTime() - hours * 60 * 60 * 1000;
    } else if (timeRange.endsWith('d')) {
      const days = parseInt(timeRange.slice(0, -1));
      start = now.getTime() - days * 24 * 60 * 60 * 1000;
    } else {
      // 默认24小时
      start = now.getTime() - 24 * 60 * 60 * 1000;
    }

    return {
      start,
      end,
    };
  }

  // 健康检查
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.ping();
      return response; // ping方法直接返回布尔值
    } catch (error) {
      console.error('ES健康检查失败:', error);
      return false;
    }
  }

  // 高级搜索日志
  async advancedSearchLogs(
    params: LogSearchParams & {
      aggregations?: Record<string, any>;
      highlight?: boolean;
      explain?: boolean;
    },
  ): Promise<
    LogSearchResult & {
      aggregations?: Record<string, any>;
      highlights?: Record<string, string[]>;
      explanation?: any;
    }
  > {
    const query = this.buildSearchQuery(params);
    const from = ((params.page || 1) - 1) * (params.limit || 50);
    const size = params.limit || 50;

    const searchParams: any = {
      index: this.indexName,
      query,
      from,
      size,
      sort: [
        {
          [params.sortBy || 'timestamp']: {
            order: params.sortOrder || 'desc',
          },
        },
      ],
    };

    if (params.aggregations) {
      searchParams.aggs = params.aggregations;
    }

    if (params.highlight) {
      searchParams.highlight = {
        fields: {
          message: {},
          'metadata.*': {},
        },
      };
    }

    if (params.explain) {
      searchParams.explain = true;
    }

    try {
      const response = await this.client.search(searchParams);
      const logs = response.hits.hits.map((hit: any) => hit._source);
      const total =
        typeof response.hits.total === 'number'
          ? response.hits.total
          : response.hits.total?.value || 0;

      const result: any = {
        logs,
        total,
        page: params.page || 1,
        limit: params.limit || 50,
        took: response.took,
      };

      if (response.aggregations) {
        result.aggregations = response.aggregations;
      }

      if (params.highlight && response.hits.hits.some((hit: any) => hit.highlight)) {
        result.highlights = {};
        response.hits.hits.forEach((hit: any, index: number) => {
          if (hit.highlight) {
            result.highlights[hit._id] = hit.highlight;
          }
        });
      }

      if (params.explain) {
        result.explanation = response.hits.hits.map((hit: any) => hit._explanation);
      }

      return result;
    } catch (error) {
      console.error('高级搜索失败:', error);
      throw error;
    }
  }

  // 创建实时搜索
  async createRealtimeSearch(params: LogSearchParams): Promise<{ subscriptionId: string }> {
    // 实时搜索通常需要WebSocket或SSE实现
    // 这里返回一个模拟的订阅ID
    const subscriptionId = `realtime_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    return { subscriptionId };
  }

  // 停止实时搜索
  async stopRealtimeSearch(subscriptionId: string): Promise<{ success: boolean }> {
    // 实际实现中需要清理WebSocket连接或SSE流
    return { success: true };
  }

  // 获取搜索建议
  async getSearchSuggestions(params: {
    query: string;
    field?: string;
    size?: number;
  }): Promise<{ suggestions: string[] }> {
    try {
      const response = await this.client.search({
        index: this.indexName,
        size: 0,
        suggest: {
          text_suggest: {
            text: params.query,
            term: {
              field: params.field || 'message',
              size: params.size || 10,
            },
          },
        },
      });

      const textSuggest = response.suggest?.text_suggest as any;
      const suggestions =
        Array.isArray(textSuggest) && textSuggest[0]?.options
          ? textSuggest[0].options.map((option: any) => option.text)
          : [];

      return { suggestions };
    } catch (error) {
      console.error('获取搜索建议失败:', error);
      return { suggestions: [] };
    }
  }

  // 获取字段值
  async getFieldValues(params: {
    field: string;
    query?: string;
    size?: number;
  }): Promise<{ values: string[] }> {
    try {
      const searchQuery = params.query
        ? {
            bool: {
              must: [
                {
                  multi_match: {
                    query: params.query,
                    fields: ['message', 'service', 'metadata.*'],
                  },
                },
              ],
            },
          }
        : { match_all: {} };

      const response = await this.client.search({
        index: this.indexName,
        size: 0,
        query: searchQuery,
        aggs: {
          field_values: {
            terms: {
              field: params.field,
              size: params.size || 100,
            },
          },
        },
      });

      const fieldValues = response.aggregations?.field_values as any;
      const values =
        fieldValues?.buckets && Array.isArray(fieldValues.buckets)
          ? fieldValues.buckets.map((bucket: any) => bucket.key)
          : [];

      return { values };
    } catch (error) {
      console.error('获取字段值失败:', error);
      return { values: [] };
    }
  }

  // 关闭连接
  async getLogTrends(
    timeRange: string,
    interval: AggregationsCalendarInterval,
    tenantId: string,
    userId?: string,
    groupBy?: string[],
  ): Promise<Array<{ timestamp: number; count: number; groups?: Record<string, number> }>> {
    const { start, end } = this.parseTimeRange(timeRange);
    const must: Array<
      { term: Record<string, any> } | { range: { timestamp: { gte: number; lte: number } } }
    > = [{ range: { timestamp: { gte: start, lte: end } } }, { term: { tenantId: tenantId } }];
    if (userId) must.push({ term: { userId: userId } });
    const aggs: any = {
      trends: {
        date_histogram: {
          field: 'timestamp',
          calendar_interval: interval,
          format: 'epoch_millis',
        },
      },
    };
    if (groupBy && groupBy.length > 0) {
      aggs.trends.aggs = {
        groups: {
          terms: {
            field: groupBy[0],
            size: 100,
          },
        },
      };
    }
    try {
      const response = await this.client.search({
        index: this.indexName,
        query: { bool: { must } },
        size: 0,
        aggs,
      });
      const buckets = (response.aggregations?.trends as any)?.buckets || [];
      return buckets.map((bucket) => ({
        timestamp: bucket.key,
        count: bucket.doc_count,
        groups: bucket.groups
          ? bucket.groups.buckets.reduce((acc, b) => ({ ...acc, [b.key]: b.doc_count }), {})
          : undefined,
      }));
    } catch (error) {
      console.error('获取日志趋势失败:', error);
      throw error;
    }
  }

  async getErrorRateStats(
    timeRange: string,
    interval: AggregationsCalendarInterval,
    tenantId: string,
    groupBy?: string,
    userId?: string,
  ): Promise<{
    errorRate: number;
    errorTrends: Array<{
      timestamp: number;
      errorCount: number;
      totalCount: number;
      errorRate: number;
    }>;
    topErrors: Array<{ message: string; count: number }>;
  }> {
    const { start, end } = this.parseTimeRange(timeRange);
    const must: Array<{ range: { timestamp: { gte: number; lte: number } } } | { term: Record<string, any> }> = [{ range: { timestamp: { gte: start, lte: end } } }, { term: { tenantId: tenantId } }];
    if (userId) must.push({ term: { userId: userId } });
    const aggs = {
      error_trends: {
        date_histogram: {
          field: 'timestamp',
          calendar_interval: interval,
          format: 'epoch_millis',
        },
        aggs: {
          error_count: {
            filter: { term: { level: 'error' } },
          },
        },
      },
      top_errors: {
        terms: {
          field: 'message.keyword',
          size: 10,
        },
        query: { term: { level: 'error' } },
      },
    };
    const response = await this.client.search({
      index: this.indexName,
      query: { bool: { must } },
      size: 0,
      aggs,
    });
    const totalResponse = await this.client.count({
      index: this.indexName,
      query: { bool: { must } },
    });
    const total = totalResponse.count;
    const errorCountResponse = await this.client.count({
      index: this.indexName,
      query: { bool: { must: [...must, { term: { level: 'error' } }] } },
    });
    const errorCount = errorCountResponse.count;
    const errorRate = total > 0 ? errorCount / total : 0;
    const errorTrends =
      (response.aggregations?.error_trends as any)?.buckets.map((bucket) => ({
        timestamp: bucket.key,
        errorCount: bucket.error_count.doc_count,
        totalCount: bucket.doc_count,
        errorRate: bucket.doc_count > 0 ? bucket.error_count.doc_count / bucket.doc_count : 0,
      })) || [];
    const topErrors =
      (response.aggregations?.top_errors as any)?.buckets.map((bucket) => ({
        message: bucket.key,
        count: bucket.doc_count,
      })) || [];
    return { errorRate, errorTrends, topErrors };
  }

  async getTopServicesStats(
    timeRange: string,
    tenantId: string,
    limit: number,
    userId?: string,
  ): Promise<
    Array<{
      service: string;
      logCount: number;
      errorCount: number;
      errorRate: number;
      avgResponseTime?: number;
    }>
  > {
    const { start, end } = this.parseTimeRange(timeRange);
    const must: Array<{ range: { timestamp: { gte: number; lte: number } } } | { term: Record<string, any> }> = [{ range: { timestamp: { gte: start, lte: end } } }, { term: { tenantId: tenantId } }];
    if (userId) must.push({ term: { userId: userId } });
    const aggs = {
      top_services: {
        terms: {
          field: 'service',
          size: limit,
        },
        aggs: {
          error_count: {
            filter: { term: { level: 'error' } },
          },
          avg_response: {
            avg: { field: 'metadata.responseTime' },
          },
        },
      },
    };
    const response = await this.client.search({
      index: this.indexName,
      query: { bool: { must } },
      size: 0,
      aggs,
    });
    return (
      (response.aggregations?.top_services as any)?.buckets.map((bucket) => ({
        service: bucket.key,
        logCount: bucket.doc_count,
        errorCount: bucket.error_count.doc_count,
        errorRate: bucket.doc_count > 0 ? bucket.error_count.doc_count / bucket.doc_count : 0,
        avgResponseTime: bucket.avg_response.value,
      })) || []
    );
  }

  async getLogLevelDistribution(
    timeRange: string,
    tenantId: string,
    userId?: string,
  ): Promise<Array<{ level: LogLevel; count: number }>> {
    const { start, end } = this.parseTimeRange(timeRange);
    const must: Array<{ range: { timestamp: { gte: number; lte: number } } } | { term: Record<string, any> }> = [{ range: { timestamp: { gte: start, lte: end } } }, { term: { tenantId: tenantId } }];
    if (userId) must.push({ term: { userId: userId } });
    const aggs = {
      levels: {
        terms: {
          field: 'level',
          size: 10,
        },
      },
    };
    const response = await this.client.search({
      index: this.indexName,
      query: { bool: { must } },
      size: 0,
      aggs,
    });
    return (
      (response.aggregations?.levels as any)?.buckets.map((bucket) => ({
        level: bucket.key,
        count: bucket.doc_count,
      })) || []
    );
  }

  async getLogSourceDistribution(
    timeRange: string,
    tenantId: string,
    limit: number,
    userId?: string,
  ): Promise<Array<{ source: LogSource; count: number }>> {
    const { start, end } = this.parseTimeRange(timeRange);
    const must: Array<{ range: { timestamp: { gte: number; lte: number } } } | { term: Record<string, any> }> = [{ range: { timestamp: { gte: start, lte: end } } }, { term: { tenantId: tenantId } }];
    if (userId) must.push({ term: { userId: userId } });
    const aggs = {
      sources: {
        terms: {
          field: 'source',
          size: limit,
        },
      },
    };
    const response = await this.client.search({
      index: this.indexName,
      query: { bool: { must } },
      size: 0,
      aggs,
    });
    return (
      (response.aggregations?.sources as any)?.buckets.map((bucket) => ({
        source: bucket.key,
        count: bucket.doc_count,
      })) || []
    );
  }

  async detectAnomalies(
    timeRange: string,
    tenantId: string,
    sensitivity: 'low' | 'medium' | 'high',
    userId?: string,
  ): Promise<
    Array<{
      timestamp: number;
      type: 'spike' | 'drop' | 'pattern';
      severity: 'low' | 'medium' | 'high';
      description: string;
      affectedServices?: string[];
      confidence: number;
    }>
  > {
    const { start, end } = this.parseTimeRange(timeRange);
    const must: Array<{ range: { timestamp: { gte: number; lte: number } } } | { term: Record<string, any> }> = [
      { range: { timestamp: { gte: start, lte: end } } },
      { term: { tenantId: tenantId } },
      { term: { level: 'error' } },
    ];
    if (userId) must.push({ term: { userId: userId } });
    const aggs: Record<string, any> = {
      errors_per_hour: {
        date_histogram: {
          field: 'timestamp',
          calendar_interval: 'hour',
          format: 'epoch_millis',
        },
      },
    };
    const response = await this.client.search({
      index: this.indexName,
      query: { bool: { must } },
      size: 0,
      aggs,
    });
    const buckets = (response.aggregations?.errors_per_hour as any)?.buckets || [];
    const counts = buckets.map((b) => b.doc_count);
    const mean = counts.reduce((sum, c) => sum + c, 0) / counts.length;
    const variance = counts.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / counts.length;
    const std = Math.sqrt(variance);
    const threshold = mean + 3 * std;
    const anomalies = buckets
      .filter((b) => b.doc_count > threshold)
      .map((b) => ({
        timestamp: b.key,
        type: 'spike',
        severity: 'high',
        description: `Error count spike: ${b.doc_count}`,
        affectedServices: [],
        confidence: 0.9,
      }));
    return anomalies;
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
