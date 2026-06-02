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
import type { MappingProperty } from '@elastic/elasticsearch/lib/api/types';

export class ElasticsearchClient {
  private client: Client;
  private indexName: string;
  private indexInitialized = false;

  constructor(config: { node: string; username?: string; password?: string; index: string }) {
    this.client = new Client({
      node: config.node,
      auth: config.username || config.password
        ? {
            username: config.username || 'elastic',
            password: config.password || '',
          }
        : undefined,
    });
    this.indexName = config.index;
  }

  // 初始化索引和映射
  async initializeIndex(): Promise<void> {
    try {
      // 尝试获取集群信息以验证连接
      try {
        const info = await this.client.info();
        console.log('Elasticsearch connected. Version:', info.version.number);
      } catch (e: any) {
        console.warn('Failed to get cluster info, proceeding anyway:', e.message);
      }

      // 检查索引是否存在
      // 使用 try-catch 包装 exists 调用，如果失败则尝试直接创建
      let exists = false;
      try {
        exists = await this.client.indices.exists({ index: this.indexName });
      } catch (error) {
        console.warn('Checking index existence failed, assuming not exists:', error);
      }

      const properties: Record<string, MappingProperty> = {
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
        hostname: { type: 'keyword' },
        containerId: { type: 'keyword' },
        originType: { type: 'keyword' },
        visibility: { type: 'keyword' },
        nodeID: { type: 'keyword' },
        namespace: { type: 'keyword' },
        mod: { type: 'keyword' },
        svc: { type: 'keyword' },
        version: { type: 'keyword' },
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
      };

      if (!exists) {
        // 如果索引不存在，尝试创建
        // 如果创建失败，可能是因为索引已经存在（竞态条件），忽略该错误
        try {
          await this.client.indices.create({
            index: this.indexName,
            settings: {
              number_of_shards: 1,
              number_of_replicas: 0,
              'index.mapping.total_fields.limit': 2000,
            },
            mappings: {
              properties,
            },
          });
          console.log(`索引 ${this.indexName} 创建成功`);
        } catch (createError: any) {
          if (createError.meta?.body?.error?.type === 'resource_already_exists_exception') {
            console.log(`索引 ${this.indexName} 已存在`);
          } else {
            throw createError;
          }
        }
      } else {
        const appendOnlyProperties = await this.getAppendOnlyProperties(properties);
        if (Object.keys(appendOnlyProperties).length > 0) {
          await this.client.indices.putMapping({
            index: this.indexName,
            properties: appendOnlyProperties,
          });
        }
      }
      this.indexInitialized = true;
    } catch (error) {
      console.error('初始化ES索引失败:', error);
      throw error;
    }
  }

  private async getAppendOnlyProperties(
    desiredProperties: Record<string, MappingProperty>,
  ): Promise<Record<string, MappingProperty>> {
    const mapping = await this.client.indices.getMapping({ index: this.indexName });
    const indexMapping = mapping[this.indexName];
    const existingProperties = indexMapping?.mappings?.properties || {};

    return Object.fromEntries(
      Object.entries(desiredProperties).filter(([field]) => !Object.prototype.hasOwnProperty.call(existingProperties, field)),
    );
  }

  private async ensureIndexInitialized(): Promise<void> {
    if (this.indexInitialized) return;
    await this.initializeIndex();
  }

  private isIndexNotFoundError(error: any): boolean {
    return error?.meta?.body?.error?.type === 'index_not_found_exception' || error?.meta?.statusCode === 404;
  }

  // 批量存储日志
  async bulkIndex(logs: StoredLog[]): Promise<{
    succeededLogs: StoredLog[];
    failedLogs: StoredLog[];
    errorItems: Array<Record<string, any>>;
  }> {
    if (logs.length === 0) {
      return {
        succeededLogs: [],
        failedLogs: [],
        errorItems: [],
      };
    }
    await this.ensureIndexInitialized();

    const body = logs.flatMap((log) => [{ index: { _index: this.indexName, _id: log.id } }, log]);

    try {
      const response = await this.client.bulk({
        index: this.indexName,
        body,
      });

      const failedLogIds = new Set<string>();
      const errorItems = (response.items || [])
        .map((item: any, index: number) => {
          const error = item?.index?.error;
          const log = logs[index];

          if (!error || !log) return null;
          failedLogIds.add(log.id);

          return {
            id: log.id,
            status: item.index?.status,
            errorType: error.type,
            reason: error.reason,
            causedBy: error.caused_by,
            service: log.service,
            level: log.level,
            timestamp: log.timestamp,
            message: log.message,
          };
        })
        .filter(Boolean) as Array<Record<string, any>>;

      const failedLogs = logs.filter((log) => failedLogIds.has(log.id));
      const succeededLogs = logs.filter((log) => !failedLogIds.has(log.id));

      if (response.errors) {
        console.error('批量索引部分失败:', errorItems);
      }

      return {
        succeededLogs,
        failedLogs,
        errorItems,
      };
    } catch (error) {
      console.error('批量索引失败:', error);
      throw error;
    }
  }

  // 搜索日志
  async searchLogs(params: LogSearchParams): Promise<{ logs: StoredLog[]; total: number }> {
    await this.ensureIndexInitialized();
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

  private resolveAggregationField(field?: string): string {
    const targetField = field || 'level';
    const keywordCompatibleFields = new Set([
      'id',
      'level',
      'service',
      'source',
      'hostname',
      'containerId',
      'originType',
      'visibility',
      'nodeID',
      'namespace',
      'mod',
      'svc',
      'version',
      'userId',
      'sessionId',
      'traceId',
      'apiKeyId',
      'tenantId',
      'message'
    ]);

    if (targetField.includes('.')) return targetField;
    if (keywordCompatibleFields.has(targetField)) return `${targetField}.keyword`;

    return targetField;
  }

  private resolveExactMatchField(field: string): string {
    const keywordCompatibleFields = new Set([
      'id',
      'level',
      'service',
      'source',
      'hostname',
      'containerId',
      'originType',
      'visibility',
      'nodeID',
      'namespace',
      'mod',
      'svc',
      'tenantId',
      'message',
    ]);

    if (field.includes('.')) return field;
    if (keywordCompatibleFields.has(field)) return `${field}.keyword`;

    return field;
  }

  // 获取日志统计
  async getLogStats(
    params: LogStatsParams,
    tenantId: string,
    userId?: string,
  ): Promise<{
    total: number;
    breakdown: Record<string, number>;
    levelBreakdown: Record<string, number>;
    serviceBreakdown: Record<string, number>;
  }> {
    await this.ensureIndexInitialized();
    const query = this.buildStatsQuery(params);
    query.query.bool.must.push({ term: { [this.resolveExactMatchField('tenantId')]: tenantId } });
    if (userId) query.query.bool.must.push({ term: { [this.resolveExactMatchField('userId')]: userId } });

    try {
      const response = await this.client.search({
        index: this.indexName,
        query: query.query,
        size: 0,
        aggs: {
          levels: {
            terms: {
              field: this.resolveAggregationField('level'),
              size: 20,
            },
          },
          services: {
            terms: {
              field: this.resolveAggregationField('service'),
              size: 10,
            },
          },
          breakdown: {
            terms: {
              field: this.resolveAggregationField(params.groupBy || 'level'),
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

      const levelBreakdown: Record<string, number> = {};
      const levelBuckets = (response.aggregations?.levels as any)?.buckets || [];
      levelBuckets.forEach((bucket: any) => {
        levelBreakdown[bucket.key] = bucket.doc_count;
      });

      const serviceBreakdown: Record<string, number> = {};
      const serviceBuckets = (response.aggregations?.services as any)?.buckets || [];
      serviceBuckets.forEach((bucket: any) => {
        serviceBreakdown[bucket.key] = bucket.doc_count;
      });

      return { total, breakdown, levelBreakdown, serviceBreakdown };
    } catch (error) {
      console.error('获取统计失败:', error);
      throw error;
    }
  }

  // 导出日志
  async exportLogs(params: LogExportParams): Promise<StoredLog[]> {
    await this.ensureIndexInitialized();
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

  // 获取日志趋势
  async getLogTrends(
    timeRange: string,
    interval: string,
    tenantId: string,
    userId?: string,
    groupBy?: string[],
  ): Promise<Array<{ timestamp: number; count: number; groups?: Record<string, number> }>> {
    const { start, end } = this.parseTimeRange(timeRange);
    const must: any[] = [
      { term: { [this.resolveExactMatchField('tenantId')]: tenantId } },
      { range: { timestamp: { gte: start, lte: end } } },
    ];
    if (userId) must.push({ term: { [this.resolveExactMatchField('userId')]: userId } });

    const query = { bool: { must } };

    try {
      const response = await this.client.search({
        index: this.indexName,
        query,
        size: 0,
        aggs: {
          trends: {
            date_histogram: {
              field: 'timestamp',
              fixed_interval:
                interval.endsWith('m') || interval.endsWith('h') || interval.endsWith('d')
                  ? interval
                  : '1h',
              min_doc_count: 0,
              extended_bounds: { min: start, max: end },
            },
          },
        },
      });

      const buckets = (response.aggregations?.trends as any)?.buckets || [];
      return buckets.map((b: any) => ({
        timestamp: b.key,
        count: b.doc_count,
      }));
    } catch (error) {
      console.error('获取日志趋势失败:', error);
      throw error;
    }
  }

  // 获取错误率统计
  async getErrorRateStats(
    timeRange: string,
    interval: string,
    tenantId: string,
    userId?: string,
    groupBy?: string,
  ): Promise<{
    errorRate: number;
    errorTrends: Array<{
      timestamp: number;
      errorCount: number;
      totalCount: number;
      errorRate: number;
    }>;
    topErrors: Array<{ message: string; count: number; percentage: number }>;
  }> {
    const { start, end } = this.parseTimeRange(timeRange);
    const baseMust: any[] = [
      { term: { [this.resolveExactMatchField('tenantId')]: tenantId } },
      { range: { timestamp: { gte: start, lte: end } } },
    ];
    if (userId) baseMust.push({ term: { [this.resolveExactMatchField('userId')]: userId } });

    try {
      const response = await this.client.search({
        index: this.indexName,
        query: { bool: { must: baseMust } },
        size: 0,
        aggs: {
          total_count: { value_count: { field: '_index' } },
          error_filter: {
            filter: { terms: { [this.resolveExactMatchField('level')]: ['error', 'fatal'] } },
            aggs: {
              error_trends: {
                date_histogram: {
                  field: 'timestamp',
                  fixed_interval:
                    interval.endsWith('m') || interval.endsWith('h') || interval.endsWith('d')
                      ? interval
                      : '1h',
                  min_doc_count: 0,
                },
              },
              top_messages: {
                terms: { field: 'message.keyword', size: 5 },
              },
            },
          },
          all_trends: {
            date_histogram: {
              field: 'timestamp',
              fixed_interval:
                interval.endsWith('m') || interval.endsWith('h') || interval.endsWith('d')
                  ? interval
                  : '1h',
              min_doc_count: 0,
            },
          },
        },
      });

      const totalLogs = (response.aggregations?.total_count as any)?.value || 0;
      const errorFilterAgg = response.aggregations?.error_filter as any;
      const totalErrors = errorFilterAgg?.doc_count || 0;

      const errorRate = totalLogs > 0 ? (totalErrors / totalLogs) * 100 : 0;

      const errorBuckets = errorFilterAgg?.error_trends?.buckets || [];
      const allBuckets = (response.aggregations?.all_trends as any)?.buckets || [];

      const errorTrends = allBuckets.map((bucket: any, index: number) => {
        const errorBucket = errorBuckets.find((b: any) => b.key === bucket.key);
        const errorCount = errorBucket ? errorBucket.doc_count : 0;
        const totalCount = bucket.doc_count;
        return {
          timestamp: bucket.key,
          errorCount,
          totalCount,
          errorRate: totalCount > 0 ? (errorCount / totalCount) * 100 : 0,
        };
      });

      const topErrors = (errorFilterAgg?.top_messages?.buckets || []).map((b: any) => ({
        message: b.key,
        count: b.doc_count,
        percentage: totalErrors > 0 ? (b.doc_count / totalErrors) * 100 : 0,
      }));

      return { errorRate, errorTrends, topErrors };
    } catch (error) {
      console.error('获取错误率统计失败:', error);
      throw error;
    }
  }

  // 获取热门服务统计
  async getTopServicesStats(
    timeRange: string,
    tenantId: string,
    userId?: string,
    limit: number = 10,
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
    const must: any[] = [
      { term: { [this.resolveExactMatchField('tenantId')]: tenantId } },
      { range: { timestamp: { gte: start, lte: end } } },
    ];
    if (userId) must.push({ term: { [this.resolveExactMatchField('userId')]: userId } });

    try {
      const response = await this.client.search({
        index: this.indexName,
        query: { bool: { must } },
        size: 0,
        aggs: {
          services: {
            terms: { field: this.resolveAggregationField('service'), size: limit },
            aggs: {
              errors: { filter: { terms: { [this.resolveExactMatchField('level')]: ['error', 'fatal'] } } },
              avg_duration: { avg: { field: 'metadata.duration' } },
            },
          },
        },
      });

      const buckets = (response.aggregations?.services as any)?.buckets || [];
      return buckets.map((b: any) => {
        const logCount = b.doc_count;
        const errorCount = b.errors?.doc_count || 0;
        return {
          service: b.key,
          logCount,
          errorCount,
          errorRate: logCount > 0 ? (errorCount / logCount) * 100 : 0,
          avgResponseTime: Number(b.avg_duration?.value || 0),
        };
      });
    } catch (error) {
      console.error('获取热门服务统计失败:', error);
      throw error;
    }
  }

  // 获取日志级别分布
  async getLogLevelDistribution(
    timeRange: string,
    tenantId: string,
    userId?: string,
  ): Promise<Array<{ level: LogLevel; count: number; percentage: number }>> {
    const { start, end } = this.parseTimeRange(timeRange);
    const must: any[] = [
      { term: { [this.resolveExactMatchField('tenantId')]: tenantId } },
      { range: { timestamp: { gte: start, lte: end } } },
    ];
    if (userId) must.push({ term: { [this.resolveExactMatchField('userId')]: userId } });

    try {
      const response = await this.client.search({
        index: this.indexName,
        query: { bool: { must } },
        size: 0,
        aggs: {
          levels: { terms: { field: this.resolveAggregationField('level'), size: 10 } },
        },
      });

      const total = (response.hits.total as any).value || 0;
      const buckets = (response.aggregations?.levels as any)?.buckets || [];

      return buckets.map((b: any) => ({
        level: b.key as LogLevel,
        count: b.doc_count,
        percentage: total > 0 ? (b.doc_count / total) * 100 : 0,
      }));
    } catch (error) {
      console.error('获取日志级别分布失败:', error);
      throw error;
    }
  }

  // 获取日志来源分布
  async getLogSourceDistribution(
    timeRange: string,
    tenantId: string,
    userId?: string,
    limit: number = 20,
  ): Promise<Array<{ source: LogSource; count: number; percentage: number }>> {
    const { start, end } = this.parseTimeRange(timeRange);
    const must: any[] = [
      { term: { [this.resolveExactMatchField('tenantId')]: tenantId } },
      { range: { timestamp: { gte: start, lte: end } } },
    ];
    if (userId) must.push({ term: { [this.resolveExactMatchField('userId')]: userId } });

    try {
      const response = await this.client.search({
        index: this.indexName,
        query: { bool: { must } },
        size: 0,
        aggs: {
          sources: { terms: { field: this.resolveAggregationField('source'), size: limit } },
        },
      });

      const total = (response.hits.total as any).value || 0;
      const buckets = (response.aggregations?.sources as any)?.buckets || [];

      return buckets.map((b: any) => ({
        source: b.key as LogSource,
        count: b.doc_count,
        percentage: total > 0 ? (b.doc_count / total) * 100 : 0,
      }));
    } catch (error) {
      console.error('获取日志来源分布失败:', error);
      throw error;
    }
  }

  // 异常检测
  async detectAnomalies(
    timeRange: string,
    tenantId: string,
    userId?: string,
    sensitivity?: 'low' | 'medium' | 'high',
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
    // 简单模拟异常检测，基于错误率飙升
    const stats = await this.getErrorRateStats(timeRange, '1h', tenantId, userId);
    const anomalies: any[] = [];

    const threshold = sensitivity === 'high' ? 1 : sensitivity === 'low' ? 10 : 5;

    stats.errorTrends.forEach((trend) => {
      if (trend.errorRate > threshold && trend.totalCount > 10) {
        anomalies.push({
          timestamp: trend.timestamp,
          type: 'spike',
          severity: trend.errorRate > 20 ? 'high' : 'medium',
          description: `Error rate spike detected: ${trend.errorRate.toFixed(2)}%`,
          confidence: 0.8,
        });
      }
    });

    return anomalies;
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
      must.push({ term: { [this.resolveExactMatchField('service')]: params.service } });
    }
    if (params.level) {
      must.push({ term: { [this.resolveExactMatchField('level')]: params.level } });
    }
    if (params.source) {
      must.push({ term: { [this.resolveExactMatchField('source')]: params.source } });
    }
    if (params.originType) {
      must.push({ term: { [this.resolveExactMatchField('originType')]: params.originType } });
    }
    if (params.visibility) {
      must.push({ term: { [this.resolveExactMatchField('visibility')]: params.visibility } });
    }
    if (params.hostname) {
      must.push({ term: { [this.resolveExactMatchField('hostname')]: params.hostname } });
    }
    if (params.filters) {
      Object.entries(params.filters).forEach(([field, value]) => {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          must.push({ term: { [this.resolveExactMatchField(field)]: value } });
        }
      });
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
      must.push({ term: { [this.resolveExactMatchField('service')]: params.service } });
    }
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
    if (params.level) {
      must.push({ term: { [this.resolveExactMatchField('level')]: params.level } });
    }
    if (params.source) {
      must.push({ term: { [this.resolveExactMatchField('source')]: params.source } });
    }
    if (params.originType) {
      must.push({ term: { [this.resolveExactMatchField('originType')]: params.originType } });
    }
    if (params.visibility) {
      must.push({ term: { [this.resolveExactMatchField('visibility')]: params.visibility } });
    }
    if (params.environment) {
      must.push({ term: { environment: params.environment } });
    }
    if (params.hostname) {
      must.push({ term: { [this.resolveExactMatchField('hostname')]: params.hostname } });
    }
    if (params.filters) {
      Object.entries(params.filters).forEach(([field, value]) => {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          must.push({ term: { [this.resolveExactMatchField(field)]: value } });
        }
      });
    }
    if (params.tags && params.tags.length > 0) {
      must.push({ terms: { tags: params.tags } });
    }

    // 时间范围
    const timeRange = params.startTime || params.endTime ? null : this.parseTimeRange(params.timeRange || '24h');
    const timestampRange: any = {};
    if (params.startTime) timestampRange.gte = params.startTime;
    if (params.endTime) timestampRange.lte = params.endTime;
    if (timeRange) {
      timestampRange.gte = timeRange.start;
      timestampRange.lte = timeRange.end;
    }
    must.push({
      range: {
        timestamp: timestampRange,
      },
    });

    return {
      query: { bool: { must } },
    };
  }

  // 异常分析
  async analyzeExceptions(
    tenantId: string,
    timeRange: string = '24h',
  ): Promise<{
    summary: string;
    possibleCauses: string[];
    recommendations: string[];
    confidence: number;
    topErrors: any[];
  }> {
    await this.ensureIndexInitialized();
    const { start, end } = this.parseTimeRange(timeRange);

    try {
      // 聚合查询常见的错误消息
      const response = await this.client.search({
        index: this.indexName,
        query: {
          bool: {
            must: [
              { term: { tenantId: tenantId } },
              { term: { [this.resolveExactMatchField('tenantId')]: tenantId } },
              { terms: { [this.resolveExactMatchField('level')]: ['error', 'fatal'] } },
              { range: { timestamp: { gte: start, lte: end } } },
            ],
          },
        },
        size: 0,
        aggs: {
          top_errors: {
            terms: {
              field: 'message.keyword', // 假设 message 有 keyword 子字段
              size: 5,
            },
          },
        },
      });

      const buckets = (response.aggregations?.top_errors as any)?.buckets || [];

      if (buckets.length === 0) {
        return {
          summary: '未检测到明显异常',
          possibleCauses: [],
          recommendations: [],
          confidence: 1.0,
          topErrors: [],
        };
      }

      // 基于最频繁的错误生成简报 (简单的规则引擎)
      const topError = buckets[0].key;
      let summary = `检测到高频异常: ${topError}`;
      let possibleCauses = ['代码逻辑错误', '配置错误', '外部依赖故障'];
      let recommendations = ['查看详细堆栈信息', '检查最近的代码部署', '检查系统负载'];

      if (topError.includes('NullPointer') || topError.includes('undefined')) {
        possibleCauses = ['变量未初始化', '对象属性访问前未检查空值'];
        recommendations = ['添加空值检查', '使用 Optional Chaining 操作符'];
      } else if (topError.includes('Timeout') || topError.includes('ECONNREFUSED')) {
        possibleCauses = ['网络连接超时', '目标服务不可用', '防火墙拦截'];
        recommendations = ['检查网络连接', '确认目标服务状态', '调整超时设置'];
      }

      return {
        summary,
        possibleCauses,
        recommendations,
        confidence: 0.85,
        topErrors: buckets.map((b: any) => ({ message: b.key, count: b.doc_count })),
      };
    } catch (error) {
      if (this.isIndexNotFoundError(error)) {
        return {
          summary: '未检测到明显异常',
          possibleCauses: [],
          recommendations: [],
          confidence: 1.0,
          topErrors: [],
        };
      }
      console.error('异常分析失败:', error);
      throw error;
    }
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
  async close(): Promise<void> {
    await this.client.close();
  }
}
