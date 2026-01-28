/**
 * 日志摄取方法
 * 处理日志数据的接收、验证、转换和存储
 */

import { Context } from 'node-universe';
import {
  LogEntry,
  LogBatch,
  LogFormat,
  LogErrorCode,
  ApiPermission,
  StoredLog,
  LogSource,
} from '../types';
import { elasticsearchManager } from '../utils/elasticsearch-manager';
import { LogProcessor } from '../utils/log-processor';
import { QuotaChecker } from '../utils/quota-checker';
import { ApiKeyManager } from '../utils/api-key-manager';
import { BATCH_SIZE, MAX_LOG_SIZE, LOG_LEVELS } from '../constants';

/**
 * 单条日志摄取
 */
export async function ingestSingleLog(
  ctx: Context,
  params: {
    apiKey: string;
    log: Partial<LogEntry>;
    tenantId: string;
    userId?: string;
  },
): Promise<{ success: boolean; logId?: string; error?: string }> {
  try {
    const { apiKey, log, tenantId, userId } = params;

    // 验证API密钥
    const apiKeyManager = ApiKeyManager.getInstance();
    const keyValidation = await apiKeyManager.validateApiKey(apiKey);
    if (!keyValidation) {
      throw new Error('无效的API密钥');
    }

    // 检查权限
    if (!apiKeyManager.hasPermission(keyValidation, ApiPermission.INGEST)) {
      throw new Error('API密钥缺少摄取权限');
    }

    // 检查配额
    const quotaChecker = new QuotaChecker();
    const quotaCheck = await quotaChecker.checkIngestQuota(tenantId, 1);
    if (!quotaCheck.allowed) {
      throw new Error('摄取配额已用完');
    }

    // 验证和处理日志
    const logProcessor = new LogProcessor();
    const validation = logProcessor.validateLog(log);
    if (!validation.valid) {
      throw new Error(`日志格式无效: ${validation.errors.join(', ')}`);
    }

    const processedLog = logProcessor.normalizeLog(
      {
        ...log,
        tenantId,
        userId,
        timestamp: log.timestamp || Date.now(),
      } as LogEntry,
      tenantId,
    );

    // 存储到Elasticsearch
    const esClient = elasticsearchManager.getClientFromContext(ctx, tenantId);
    await esClient.bulkIndex([processedLog]);

    // 配额使用量已在 checkIngestQuota 中更新

    // 发送事件
    await ctx.emit('logs.ingested', {
      tenantId,
      userId,
      logId: processedLog.id,
      timestamp: Date.now(),
    });

    ctx.service?.logger?.debug(`Log ingested successfully: ${processedLog.id}`);

    return {
      success: true,
      logId: processedLog.id,
    };
  } catch (error) {
    ctx.service?.logger?.error('Failed to ingest log:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 批量日志摄取
 */
export async function ingestLogBatch(
  ctx: Context,
  params: {
    apiKey: string;
    batch: LogBatch;
    tenantId: string;
    userId?: string;
  },
): Promise<{
  success: boolean;
  processed: number;
  failed: number;
  errors?: string[];
  batchId?: string;
}> {
  try {
    const { apiKey, batch, tenantId, userId } = params;

    // 验证批量大小
    if (batch.logs.length > BATCH_SIZE) {
      throw new Error(`批量大小超过最大限制: ${BATCH_SIZE}`);
    }

    // 验证API密钥
    const apiKeyManager = ApiKeyManager.getInstance();
    const keyValidation = await apiKeyManager.validateApiKey(apiKey);
    if (!keyValidation) {
      throw new Error('无效的API密钥');
    }

    // 检查权限
    if (!apiKeyManager.hasPermission(keyValidation, ApiPermission.INGEST)) {
      throw new Error('API密钥缺少批量摄取权限');
    }

    // 检查配额
    const quotaChecker = new QuotaChecker();
    const quotaCheck = await quotaChecker.checkIngestQuota(tenantId, batch.logs.length);
    if (!quotaCheck.allowed) {
      throw new Error('批量摄取配额已用完');
    }

    // 处理批量日志
    const logProcessor = new LogProcessor();
    const processedBatch = logProcessor.processBatch(batch.logs, tenantId);

    // 批量存储到Elasticsearch
    const esClient = elasticsearchManager.getClientFromContext(ctx, tenantId);
    await esClient.bulkIndex(processedBatch.processed);

    // 配额使用量已在 checkIngestQuota 中更新

    // 发送事件
    await ctx.emit('logs.batch.ingested', {
      tenantId,
      userId,
      batchId: batch.batchId || `batch_${Date.now()}`,
      processed: processedBatch.processed.length,
      failed: processedBatch.errors.length,
      timestamp: Date.now(),
    });

    ctx.service?.logger?.info(
      `Batch ingested: ${processedBatch.processed.length} successful, ${processedBatch.errors.length} failed`,
    );

    return {
      success: true,
      processed: processedBatch.processed.length,
      failed: processedBatch.errors.length,
      errors: processedBatch.errors.map((e) => e.error),
      batchId: batch.batchId || `batch_${Date.now()}`,
    };
  } catch (error) {
    ctx.service?.logger?.error('Failed to ingest batch:', error);
    return {
      success: false,
      processed: 0,
      failed: params.batch?.logs?.length || 0,
      errors: [error instanceof Error ? error.message : 'Unknown error'],
    };
  }
}

/**
 * 流式日志摄取
 */
export async function ingestLogStream(
  ctx: Context,
  params: {
    apiKey: string;
    stream: AsyncIterable<LogEntry>;
    tenantId: string;
    userId?: string;
    format?: LogFormat;
  },
): Promise<{
  success: boolean;
  processed: number;
  failed: number;
  errors?: string[];
}> {
  try {
    const { apiKey, stream, tenantId, userId, format = 'json' } = params;

    // 验证API密钥
    const apiKeyManager = ApiKeyManager.getInstance();
    const keyValidation = await apiKeyManager.validateApiKey(apiKey);
    if (!keyValidation) {
      throw new Error('无效的API密钥');
    }

    // 检查权限
    if (!apiKeyManager.hasPermission(keyValidation, ApiPermission.INGEST)) {
      throw new Error('API密钥缺少流式摄取权限');
    }

    const logProcessor = new LogProcessor();
    const esClient = elasticsearchManager.getClientFromContext(ctx, tenantId);
    const quotaChecker = new QuotaChecker();

    let processed = 0;
    let failed = 0;
    const errors: string[] = [];
    const batchBuffer: any[] = [];

    try {
      for await (const log of stream) {
        try {
          // 检查配额
          const quotaCheck = await quotaChecker.checkIngestQuota(tenantId, 1);
          if (!quotaCheck.allowed) {
            errors.push('摄取配额已用完');
            failed++;
            continue;
          }

          // 处理日志
          const validation = logProcessor.validateLog(log);
          if (!validation.valid) {
            errors.push(`日志格式无效: ${validation.errors.join(', ')}`);
            failed++;
            continue;
          }

          const processedLog = logProcessor.normalizeLog(
            {
              ...log,
              userId,
              timestamp: log.timestamp || Date.now(),
            },
            tenantId,
          );

          // 转换为 StoredLog 格式
          const storedLog: StoredLog = {
            ...processedLog,
            id: processedLog.id || `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            tenantId,
            apiKeyId: 'stream_api_key',
            timestamp: new Date(processedLog.timestamp).toISOString(),
            indexed: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            source: processedLog.source || LogSource.SYSTEM,
          };

          batchBuffer.push(storedLog as any);

          // 当缓冲区满时批量写入
          if (batchBuffer.length >= BATCH_SIZE) {
            try {
              await esClient.bulkIndex(batchBuffer as StoredLog[]);
              processed += batchBuffer.length;
            } catch (bulkError) {
              failed += batchBuffer.length;
              errors.push(bulkError instanceof Error ? bulkError.message : 'Bulk index error');
            }

            // 配额使用量已在 checkIngestQuota 中更新

            batchBuffer.length = 0; // 清空缓冲区
          }
        } catch (error) {
          failed++;
          errors.push(error instanceof Error ? error.message : 'Unknown error');
        }
      }

      // 处理剩余的日志
      if (batchBuffer.length > 0) {
        try {
          await esClient.bulkIndex(batchBuffer as StoredLog[]);
          processed += batchBuffer.length;
        } catch (bulkError) {
          failed += batchBuffer.length;
          errors.push(bulkError instanceof Error ? bulkError.message : 'Bulk index error');
        }

        // 配额使用量已在 checkIngestQuota 中更新
      }

      // 发送事件
      await ctx.emit('logs.stream.ingested', {
        tenantId,
        userId,
        processed,
        failed,
        format,
        timestamp: Date.now(),
      });

      ctx.service?.logger?.info(`Stream ingested: ${processed} successful, ${failed} failed`);

      return {
        success: true,
        processed,
        failed,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (streamError) {
      throw streamError;
    }
  } catch (error) {
    ctx.service?.logger?.error('Failed to ingest stream:', error);
    return {
      success: false,
      processed: 0,
      failed: 0,
      errors: [error instanceof Error ? error.message : 'Unknown error'],
    };
  }
}

/**
 * 验证日志格式
 */
export function validateLogFormat(
  log: Partial<LogEntry>,
  format: LogFormat = 'json',
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  // 基础字段验证
  if (!log.message || typeof log.message !== 'string') {
    errors.push('Message is required and must be a string');
  }

  if (log.message && log.message.length > MAX_LOG_SIZE) {
    errors.push(`Message exceeds maximum size: ${MAX_LOG_SIZE}`);
  }

  if (!log.level || !LOG_LEVELS.includes(log.level)) {
    errors.push(`Invalid log level: ${log.level}`);
  }

  if (!log.source) {
    errors.push('Source is required');
  }

  // 时间戳验证
  if (log.timestamp) {
    const timestamp =
      typeof log.timestamp === 'string' ? new Date(log.timestamp).getTime() : log.timestamp;

    if (isNaN(timestamp)) {
      errors.push('Invalid timestamp format');
    }
  }

  // 格式特定验证
  switch (format) {
    case 'json':
      if (log.metadata && typeof log.metadata !== 'object') {
        errors.push('Metadata must be an object for JSON format');
      }
      break;

    case 'syslog':
      if (!log.hostname) {
        errors.push('Hostname is required for syslog format');
      }
      break;
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * 获取摄取统计
 */
export async function getIngestionStats(
  ctx: Context,
  params: {
    tenantId: string;
    userId?: string;
    timeRange?: string;
  },
): Promise<{
  totalIngested: number;
  successRate: number;
  avgProcessingTime: number;
  topSources: Array<{ source: string; count: number }>;
  hourlyBreakdown: Array<{ hour: string; count: number }>;
}> {
  try {
    const { tenantId, userId, timeRange = '24h' } = params;

    const esClient = elasticsearchManager.getClientFromContext(ctx, tenantId);

    // 获取日志统计（使用现有的 getLogStats 方法）
    const stats = await esClient.getLogStats(
      {
        tenantId,
        userId,
        timeRange,
        groupBy: 'source',
      },
      tenantId,
      userId,
    );

    // 转换为期望的格式
    const result = {
      totalIngested: stats.total,
      successRate: 0.95, // 默认成功率
      avgProcessingTime: 100, // 默认处理时间
      topSources: Object.entries(stats.breakdown).map(([source, count]) => ({ source, count })),
      hourlyBreakdown: [] as Array<{ hour: string; count: number }>,
    };

    return result;
  } catch (error) {
    ctx.service?.logger?.error('Failed to get ingestion stats:', error);
    throw error;
  }
}
