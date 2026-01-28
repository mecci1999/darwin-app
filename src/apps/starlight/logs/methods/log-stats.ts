/**
 * 日志统计方法
 * 处理日志数据的统计分析和报告生成
 */

import { Context } from 'node-universe';
import { LogStatsParams, LogStatsResult, LogLevel, LogSource, ApiPermission } from '../types';
import { ElasticsearchClient } from '../utils/elasticsearch';
import { elasticsearchManager } from '../utils/elasticsearch-manager';
import { ApiKeyManager } from '../utils/api-key-manager';
import { QuotaChecker } from '../utils/quota-checker';
import { LogUtils } from '../utils/log-utils';
import { STATS_CACHE_TTL, DEFAULT_STATS_INTERVAL } from '../constants';

/**
 * 获取日志统计
 */
export async function getLogStats(
  ctx: Context,
  params: {
    apiKey: string;
    statsParams: LogStatsParams;
    tenantId: string;
    userId?: string;
  },
): Promise<LogStatsResult> {
  try {
    const { apiKey, statsParams, tenantId, userId } = params;

    // 验证API密钥
    const apiKeyManager = ApiKeyManager.getInstance();
    const validatedKey = await apiKeyManager.validateApiKey(apiKey);
    if (!validatedKey) {
      throw new Error('无效的API密钥');
    }
    if (validatedKey.tenantId !== tenantId) {
      throw new Error('API密钥与租户不匹配');
    }

    // 检查权限
    if (!apiKeyManager.hasPermission(validatedKey, ApiPermission.STATS)) {
      throw new Error('Insufficient permissions for log statistics');
    }

    // 检查配额
    const quotaChecker = QuotaChecker.getInstance();
    const quotaCheck = await quotaChecker.checkSearchQuota(tenantId);
    if (!quotaCheck.allowed) {
      throw new Error(`Stats quota exceeded: ${quotaCheck.reason}`);
    }

    // 标准化统计参数
    const normalizedParams = normalizeStatsParams(statsParams);

    // 检查缓存
    const cacheKey = generateStatsCacheKey(normalizedParams, tenantId, userId);
    const service = ctx.service as any;
    const cachedResult = await service.redis?.get(cacheKey);
    if (cachedResult) {
      service.logger?.debug('Returning cached stats result');
      return JSON.parse(cachedResult);
    }

    // 执行统计查询
    const esClient = elasticsearchManager.getClientFromContext(ctx, tenantId);
    const stats = await esClient.getLogStats(normalizedParams, tenantId, userId);

    // 构建 LogStatsResult
    const statsResult: LogStatsResult = {
      total: stats.total,
      timeRange: normalizedParams.timeRange,
      groupBy: normalizedParams.groupBy,
      data: Object.entries(stats.breakdown).map(([key, count]) => ({
        key,
        count,
        percentage: stats.total > 0 ? (count / stats.total) * 100 : 0,
      })),
      trends: {
        current: stats.total,
        previous: 0, // 需要额外查询或暂不计算
        change: 0,
        changePercent: 0,
      },
      topServices: [], // 需要额外查询
      errorRate: 0, // 需要额外查询
    };

    // 缓存结果
    await service.redis?.setex(cacheKey, STATS_CACHE_TTL, JSON.stringify(statsResult));

    // 记录统计事件
    await ctx.emit('logs.stats.generated', {
      tenantId,
      userId,
      timeRange: normalizedParams.timeRange,
      interval: normalizedParams.interval,
      timestamp: Date.now(),
    });

    service.logger?.debug('Log stats generated successfully');

    return statsResult;
  } catch (error) {
    (ctx.service as any)?.logger?.error('Failed to get log stats:', error);
    throw error;
  }
}

/**
 * 获取日志趋势
 */
export async function getLogTrends(
  ctx: Context,
  params: {
    apiKey: string;
    timeRange: string;
    interval?: string;
    tenantId: string;
    userId?: string;
    groupBy?: string[];
  },
): Promise<{
  trends: Array<{
    timestamp: number;
    count: number;
    groups?: Record<string, number>;
  }>;
  summary: {
    totalLogs: number;
    avgLogsPerInterval: number;
    peakTimestamp: number;
    peakCount: number;
  };
}> {
  try {
    const { apiKey, timeRange, interval = '1h', tenantId, userId, groupBy } = params;

    // 验证API密钥和权限
    const apiKeyManager = ApiKeyManager.getInstance();
    const validatedKey = await apiKeyManager.validateApiKey(apiKey);
    if (!validatedKey) {
      throw new Error('无效的API密钥');
    }
    if (validatedKey.tenantId !== tenantId) {
      throw new Error('API密钥与租户不匹配');
    }

    if (!apiKeyManager.hasPermission(validatedKey, ApiPermission.STATS)) {
      throw new Error('Insufficient permissions for log trends');
    }

    // 检查配额
    const quotaChecker = QuotaChecker.getInstance();
    const quotaCheck = await quotaChecker.checkSearchQuota(tenantId);
    if (!quotaCheck.allowed) {
      throw new Error(`Stats quota exceeded: ${quotaCheck.reason}`);
    }

    // 执行趋势查询
    const esClient = elasticsearchManager.getClientFromContext(ctx, tenantId);
    const trends = await esClient.getLogTrends(timeRange, interval, tenantId, userId, groupBy);

    // 计算摘要统计
    const totalLogs = trends.reduce((sum, trend) => sum + trend.count, 0);
    const avgLogsPerInterval = totalLogs / trends.length;
    if (trends.length === 0) {
      return {
        trends: [],
        summary: {
          totalLogs: 0,
          avgLogsPerInterval: 0,
          peakTimestamp: 0,
          peakCount: 0,
        },
      };
    }
    const peakTrend = trends.reduce(
      (max, trend) => (trend.count > max.count ? trend : max),
      trends[0],
    );

    return {
      trends,
      summary: {
        totalLogs,
        avgLogsPerInterval,
        peakTimestamp: peakTrend.timestamp,
        peakCount: peakTrend.count,
      },
    };
  } catch (error) {
    (ctx.service as any)?.logger?.error('Failed to get log trends:', error);
    throw error;
  }
}

/**
 * 获取错误率统计
 */
export async function getErrorRateStats(
  ctx: Context,
  params: {
    apiKey: string;
    timeRange: string;
    interval?: string;
    tenantId: string;
    userId?: string;
    groupBy?: string;
  },
): Promise<{
  errorRate: number;
  errorTrends: Array<{
    timestamp: number;
    errorCount: number;
    totalCount: number;
    errorRate: number;
  }>;
  topErrors: Array<{
    message: string;
    count: number;
    percentage: number;
  }>;
}> {
  try {
    const { apiKey, timeRange, interval = '1h', tenantId, userId, groupBy } = params;

    // 验证API密钥和权限
    const apiKeyManager = ApiKeyManager.getInstance();
    const validatedKey = await apiKeyManager.validateApiKey(apiKey);
    if (!validatedKey) {
      throw new Error('无效的API密钥');
    }
    if (validatedKey.tenantId !== tenantId) {
      throw new Error('API密钥与租户不匹配');
    }

    if (!apiKeyManager.hasPermission(validatedKey, ApiPermission.STATS)) {
      throw new Error('Insufficient permissions for error rate stats');
    }

    // 检查配额
    const quotaChecker = QuotaChecker.getInstance();
    const quotaCheck = await quotaChecker.checkSearchQuota(tenantId);
    if (!quotaCheck.allowed) {
      throw new Error(`Stats quota exceeded: ${quotaCheck.reason}`);
    }

    const esClient = elasticsearchManager.getClientFromContext(ctx, tenantId);
    const errorStats = await esClient.getErrorRateStats(
      timeRange,
      interval,
      tenantId,
      userId,
      groupBy,
    );

    return errorStats;
  } catch (error) {
    (ctx.service as any)?.logger?.error('Failed to get error rate stats:', error);
    throw error;
  }
}

/**
 * 获取热门服务统计
 */
export async function getTopServicesStats(
  ctx: Context,
  params: {
    apiKey: string;
    timeRange: string;
    tenantId: string;
    userId?: string;
    limit?: number;
  },
): Promise<{
  services: Array<{
    service: string;
    logCount: number;
    errorCount: number;
    errorRate: number;
    avgResponseTime?: number;
  }>;
}> {
  try {
    const { apiKey, timeRange, tenantId, userId, limit = 10 } = params;

    // 验证API密钥和权限
    const apiKeyManager = ApiKeyManager.getInstance();
    const validatedKey = await apiKeyManager.validateApiKey(apiKey);
    if (!validatedKey) {
      throw new Error('无效的API密钥');
    }
    if (validatedKey.tenantId !== tenantId) {
      throw new Error('API密钥与租户不匹配');
    }

    if (!apiKeyManager.hasPermission(validatedKey, ApiPermission.STATS)) {
      throw new Error('Insufficient permissions for top services stats');
    }

    // 检查配额
    const quotaChecker = QuotaChecker.getInstance();
    const quotaCheck = await quotaChecker.checkSearchQuota(tenantId);
    if (!quotaCheck.allowed) {
      throw new Error(`Stats quota exceeded: ${quotaCheck.reason}`);
    }

    const esClient = elasticsearchManager.getClientFromContext(ctx, tenantId);
    const services = await esClient.getTopServicesStats(timeRange, tenantId, userId, Number(limit));

    return { services };
  } catch (error) {
    (ctx.service as any)?.logger?.error('Failed to get top services stats:', error);
    throw error;
  }
}

/**
 * 获取日志级别分布
 */
export async function getLogLevelDistribution(
  ctx: Context,
  params: {
    apiKey: string;
    timeRange: string;
    tenantId: string;
    userId?: string;
  },
): Promise<{
  distribution: Array<{
    level: LogLevel;
    count: number;
    percentage: number;
  }>;
  total: number;
}> {
  try {
    const { apiKey, timeRange, tenantId, userId } = params;

    // 验证API密钥和权限
    const apiKeyManager = ApiKeyManager.getInstance();
    const validatedKey = await apiKeyManager.validateApiKey(apiKey);
    if (!validatedKey) {
      throw new Error('无效的API密钥');
    }
    if (validatedKey.tenantId !== tenantId) {
      throw new Error('API密钥与租户不匹配');
    }

    if (!apiKeyManager.hasPermission(validatedKey, ApiPermission.STATS)) {
      throw new Error('Insufficient permissions for log level distribution');
    }

    // 检查配额
    const quotaChecker = QuotaChecker.getInstance();
    const quotaCheck = await quotaChecker.checkSearchQuota(tenantId);
    if (!quotaCheck.allowed) {
      throw new Error(`Stats quota exceeded: ${quotaCheck.reason}`);
    }

    const esClient = elasticsearchManager.getClientFromContext(ctx, tenantId);
    const distribution = await esClient.getLogLevelDistribution(timeRange, tenantId, userId);

    const total = distribution.reduce((sum, item) => sum + item.count, 0);

    return {
      distribution: distribution.map((item) => ({
        ...item,
        percentage: total > 0 ? (item.count / total) * 100 : 0,
      })),
      total,
    };
  } catch (error) {
    (ctx.service as any)?.logger?.error('Failed to get log level distribution:', error);
    throw error;
  }
}

/**
 * 获取日志来源分布
 */
export async function getLogSourceDistribution(
  ctx: Context,
  params: {
    apiKey: string;
    timeRange: string;
    tenantId: string;
    userId?: string;
    limit?: number;
  },
): Promise<{
  distribution: Array<{
    source: LogSource;
    count: number;
    percentage: number;
  }>;
  total: number;
}> {
  try {
    const { apiKey, timeRange, tenantId, userId, limit = 20 } = params;

    // 验证API密钥和权限
    const apiKeyManager = ApiKeyManager.getInstance();
    const validatedKey = await apiKeyManager.validateApiKey(apiKey);
    if (!validatedKey) {
      throw new Error('无效的API密钥');
    }
    if (validatedKey.tenantId !== tenantId) {
      throw new Error('API密钥与租户不匹配');
    }

    if (!apiKeyManager.hasPermission(validatedKey, ApiPermission.STATS)) {
      throw new Error('Insufficient permissions for log source distribution');
    }

    // 检查配额
    const quotaChecker = QuotaChecker.getInstance();
    const quotaCheck = await quotaChecker.checkSearchQuota(tenantId);
    if (!quotaCheck.allowed) {
      throw new Error(`Stats quota exceeded: ${quotaCheck.reason}`);
    }

    const esClient = elasticsearchManager.getClientFromContext(ctx, tenantId);
    const distribution = await esClient.getLogSourceDistribution(
      timeRange,
      tenantId,
      userId,
      Number(limit),
    );

    const total = distribution.reduce((sum, item) => sum + item.count, 0);

    return {
      distribution: distribution.map((item) => ({
        ...item,
        percentage: total > 0 ? (item.count / total) * 100 : 0,
      })),
      total,
    };
  } catch (error) {
    (ctx.service as any)?.logger?.error('Failed to get log source distribution:', error);
    throw error;
  }
}

/**
 * 获取异常检测结果
 */
export async function getAnomalyDetection(
  ctx: Context,
  params: {
    apiKey: string;
    timeRange: string;
    tenantId: string;
    userId?: string;
    sensitivity?: 'low' | 'medium' | 'high';
  },
): Promise<{
  anomalies: Array<{
    timestamp: number;
    type: 'spike' | 'drop' | 'pattern';
    severity: 'low' | 'medium' | 'high';
    description: string;
    affectedServices?: string[];
    confidence: number;
  }>;
  summary: {
    totalAnomalies: number;
    highSeverityCount: number;
    affectedServicesCount: number;
  };
}> {
  try {
    const { apiKey, timeRange, tenantId, userId, sensitivity = 'medium' } = params;

    // 验证API密钥和权限
    const apiKeyManager = ApiKeyManager.getInstance();
    const validatedKey = await apiKeyManager.validateApiKey(apiKey);
    if (!validatedKey) {
      throw new Error('无效的API密钥');
    }
    if (validatedKey.tenantId !== tenantId) {
      throw new Error('API密钥与租户不匹配');
    }

    if (!apiKeyManager.hasPermission(validatedKey, ApiPermission.ANOMALY)) {
      throw new Error('Insufficient permissions for anomaly detection');
    }

    // 检查配额
    const quotaChecker = QuotaChecker.getInstance();
    const quotaCheck = await quotaChecker.checkSearchQuota(tenantId);
    if (!quotaCheck.allowed) {
      throw new Error(`Stats quota exceeded: ${quotaCheck.reason}`);
    }

    const esClient = elasticsearchManager.getClientFromContext(ctx, tenantId);
    const anomalies = await esClient.detectAnomalies(timeRange, tenantId, userId, sensitivity);

    const highSeverityCount = anomalies.filter((a) => a.severity === 'high').length;
    const affectedServices = new Set(anomalies.flatMap((a) => a.affectedServices || []));

    return {
      anomalies,
      summary: {
        totalAnomalies: anomalies.length,
        highSeverityCount,
        affectedServicesCount: affectedServices.size,
      },
    };
  } catch (error) {
    (ctx.service as any)?.logger?.error('Failed to detect anomalies:', error);
    throw error;
  }
}

/**
 * 生成日志报告
 */
export async function generateLogReport(
  ctx: Context,
  params: {
    apiKey: string;
    reportType: 'daily' | 'weekly' | 'monthly';
    tenantId: string;
    userId?: string;
    format?: 'json' | 'pdf' | 'csv';
    email?: string;
  },
): Promise<{
  success: boolean;
  reportId: string;
  downloadUrl?: string;
}> {
  try {
    const { apiKey, reportType, tenantId, userId, format = 'json', email } = params;

    // 验证API密钥和权限
    const apiKeyManager = ApiKeyManager.getInstance();
    const validatedKey = await apiKeyManager.validateApiKey(apiKey);
    if (!validatedKey) {
      throw new Error('无效的API密钥');
    }
    if (validatedKey.tenantId !== tenantId) {
      throw new Error('API密钥与租户不匹配');
    }

    if (!apiKeyManager.hasPermission(validatedKey, ApiPermission.REPORT)) {
      throw new Error('Insufficient permissions for report generation');
    }

    // 生成报告ID
    const reportId = `report_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 异步生成报告
    ctx.emit('logs.report.generate', {
      reportId,
      reportType,
      tenantId,
      userId,
      format,
      email,
      timestamp: Date.now(),
    });

    (ctx.service as any)?.logger?.info(`Report generation started: ${reportId}`);

    return {
      success: true,
      reportId,
    };
  } catch (error) {
    (ctx.service as any)?.logger?.error('Failed to generate report:', error);
    throw error;
  }
}

/**
 * 获取报告状态
 */
export async function getReportStatus(
  ctx: Context,
  params: {
    reportId: string;
    tenantId: string;
    userId?: string;
  },
): Promise<{
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress?: number;
  downloadUrl?: string;
  error?: string;
}> {
  try {
    const { reportId, tenantId, userId } = params;

    const report = await (ctx.service as any).db
      .collection('log_reports')
      .findOne({ reportId, tenantId, userId });

    if (!report) {
      throw new Error('Report not found');
    }

    return {
      status: report.status,
      progress: report.progress,
      downloadUrl: report.downloadUrl,
      error: report.error,
    };
  } catch (error) {
    (ctx.service as any)?.logger?.error('Failed to get report status:', error);
    throw error;
  }
}

/**
 * 标准化统计参数
 */
function normalizeStatsParams(params: LogStatsParams): LogStatsParams {
  const normalized: LogStatsParams = {
    ...params,
    interval: params.interval || DEFAULT_STATS_INTERVAL,
  };

  // 标准化时间范围
  // Removed unnecessary parsing to avoid type mismatch; parsing handled in ElasticsearchClient

  return normalized;
}

/**
 * 生成统计缓存键
 */
function generateStatsCacheKey(params: LogStatsParams, tenantId: string, userId?: string): string {
  const keyParts = [
    'log_stats',
    tenantId,
    userId || 'all',
    params.timeRange || 'default',
    params.interval || DEFAULT_STATS_INTERVAL,
    JSON.stringify((params as any).filters || {}),
  ];

  return keyParts.join(':');
}

/**
 * 清除统计缓存
 */
export async function clearStatsCache(
  ctx: Context,
  params: {
    tenantId: string;
    userId?: string;
  },
): Promise<{ success: boolean; clearedKeys: number }> {
  try {
    const { tenantId, userId } = params;

    const pattern = userId ? `log_stats:${tenantId}:${userId}:*` : `log_stats:${tenantId}:*`;

    const service = ctx.service as any;
    const keys = await service.redis?.keys(pattern);

    if (keys && keys.length > 0) {
      await service.redis?.del(...keys);
    }

    service.logger?.debug(`Cleared ${keys?.length || 0} stats cache keys`);

    return {
      success: true,
      clearedKeys: keys?.length || 0,
    };
  } catch (error) {
    (ctx.service as any)?.logger?.error('Failed to clear stats cache:', error);
    throw error;
  }
}
