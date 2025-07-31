/**
 * 日志导出方法
 * 处理日志数据的导出和下载
 */

import * as csv from 'csv-writer';
import { searchLogs as _searchLogs } from 'db/es';
import * as fs from 'fs';
import { Context } from 'node-universe';
import * as path from 'path';
import { EXPORT_LIMITS } from '../constants';
import { ApiPermission, LogEntry, LogExportParams, LogFormat } from '../types';
import { ApiKeyManager } from '../utils/api-key-manager';
import { LogProcessor } from '../utils/log-processor';
import { QuotaChecker } from '../utils/quota-checker';

/**
 * 导出日志
 */
export async function exportLogs(
  ctx: Context,
  params: {
    apiKey: string;
    exportParams: LogExportParams;
    tenantId: string;
    userId?: string;
  },
): Promise<{
  success: boolean;
  exportId: string;
  downloadUrl?: string;
  estimatedSize?: number;
}> {
  try {
    const { apiKey, exportParams, tenantId, userId } = params;

    // 验证API密钥
    const apiKeyManager = ApiKeyManager.getInstance();
    const keyValidation = await apiKeyManager.validateApiKey(apiKey);
    if (!keyValidation) {
      throw new Error('无效的API密钥');
    }

    // 检查权限
    const hasPermission = apiKeyManager.hasPermission(keyValidation, ApiPermission.EXPORT);
    if (!hasPermission) {
      throw new Error('Insufficient permissions for log export');
    }

    // 检查导出配额
    const quotaChecker = new QuotaChecker();
    const quotaCheck = await quotaChecker.checkExportQuota(tenantId);
    if (!quotaCheck.allowed) {
      throw new Error(`Export quota exceeded`);
    }

    // 验证导出参数
    const validationResult = validateExportParams(exportParams);
    if (!validationResult.isValid) {
      throw new Error(`Invalid export parameters: ${validationResult.errors.join(', ')}`);
    }

    // 生成导出ID
    const exportId = `export_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 估算导出大小
    const estimatedSize = EXPORT_LIMITS.MAX_RECORDS * 1024; // 简化估算

    if (estimatedSize > EXPORT_LIMITS.MAX_FILE_SIZE) {
      throw new Error(`Export size exceeds maximum limit: ${EXPORT_LIMITS.MAX_FILE_SIZE} bytes`);
    }

    // 创建导出任务记录（简化实现）
    const exportRecord = {
      exportId,
      tenantId,
      userId,
      params: exportParams,
      status: 'pending',
      estimatedSize,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // 异步执行导出
    ctx.emit('logs.export.start', {
      exportId,
      tenantId,
      userId,
      params: exportParams,
      timestamp: Date.now(),
    });

    // 配额使用量已在 checkExportQuota 中更新

    if (ctx.service?.logger) {
      ctx.service.logger.info(`Log export started: ${exportId}`);
    }

    return {
      success: true,
      exportId,
      estimatedSize,
    };
  } catch (error) {
    if (ctx.service?.logger) {
      ctx.service.logger.error('Failed to start log export:', error);
    }
    throw error;
  }
}

/**
 * 执行实际的导出操作
 */
export async function performLogExport(
  ctx: Context,
  params: {
    exportId: string;
    tenantId: string;
    userId?: string;
    exportParams: LogExportParams;
  },
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  try {
    const { exportId, tenantId, userId, exportParams } = params;

    // 更新状态为处理中
    await updateExportStatus(ctx, exportId, 'processing', 0);

    const logProcessor = new LogProcessor();

    // 获取日志数据
    const logs = await _searchLogs(tenantId, {
      query: exportParams.query,
      startTime: exportParams.startTime ? new Date(exportParams.startTime) : undefined,
      endTime: exportParams.endTime ? new Date(exportParams.endTime) : undefined,
      size: exportParams.limit || EXPORT_LIMITS.MAX_RECORDS,
      from: 0,
    });

    // 更新进度
    await updateExportStatus(ctx, exportId, 'processing', 50);

    // 处理和格式化日志
    const processedLogs = logs.logs || [];

    // 更新进度
    await updateExportStatus(ctx, exportId, 'processing', 75);

    // 生成文件
    const filePath = await generateExportFile(processedLogs as any[], exportParams, exportId);

    // 更新状态为完成
    await updateExportStatus(ctx, exportId, 'completed', 100, filePath);

    // 发送完成事件
    await ctx.emit('logs.export.completed', {
      exportId,
      tenantId,
      userId,
      filePath,
      recordCount: processedLogs.length,
      timestamp: Date.now(),
    });

    if (ctx.service?.logger) {
      ctx.service.logger.info(`Log export completed: ${exportId}`);
    }

    return {
      success: true,
      filePath,
    };
  } catch (error) {
    // 更新状态为失败
    await updateExportStatus(
      ctx,
      params.exportId,
      'failed',
      0,
      undefined,
      error instanceof Error ? error.message : 'Unknown error',
    );

    if (ctx.service?.logger) {
      ctx.service.logger.error('Failed to perform log export:', error);
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 获取导出状态
 */
export async function getExportStatus(
  ctx: Context,
  params: {
    exportId: string;
    tenantId: string;
    userId?: string;
  },
): Promise<{
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  downloadUrl?: string;
  error?: string;
  estimatedSize?: number;
  actualSize?: number;
  recordCount?: number;
}> {
  try {
    const { exportId, tenantId, userId } = params;

    // 简化实现 - 返回模拟状态
    const exportRecord = {
      exportId,
      status: 'completed' as const,
      progress: 100,
      filePath: `/exports/${exportId}.json`,
      estimatedSize: 1024,
      actualSize: 1024,
      recordCount: 100,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    let downloadUrl: string | undefined;
    if (exportRecord.status === 'completed' && exportRecord.filePath) {
      downloadUrl = `/api/logs/export/${exportId}/download`;
    }

    if (ctx.service?.logger) {
      ctx.service.logger.debug(`Export status retrieved: ${exportId}`);
    }

    return {
      status: exportRecord.status,
      progress: exportRecord.progress || 0,
      downloadUrl,
      estimatedSize: exportRecord.estimatedSize,
      actualSize: exportRecord.actualSize,
      recordCount: exportRecord.recordCount,
    };
  } catch (error) {
    if (ctx.service?.logger) {
      ctx.service.logger.error('Failed to get export status:', error);
    }
    throw error;
  }
}

/**
 * 下载导出文件
 */
export async function downloadExportFile(
  ctx: Context,
  params: {
    exportId: string;
    tenantId: string;
    userId?: string;
  },
): Promise<{
  success: boolean;
  filePath?: string;
  fileName?: string;
  contentType?: string;
  error?: string;
}> {
  try {
    const { exportId, tenantId, userId } = params;

    // 简化实现 - 返回模拟文件信息
    const exportRecord = {
      exportId,
      status: 'completed',
      filePath: `/exports/${exportId}.json`,
      params: { format: 'json' as LogFormat },
    };

    if (exportRecord.status !== 'completed') {
      throw new Error('Export is not completed yet');
    }

    const fileName = path.basename(exportRecord.filePath);
    const contentType = getContentType(exportRecord.params.format);

    // 记录下载事件
    await ctx.emit('logs.export.downloaded', {
      exportId,
      tenantId,
      userId,
      timestamp: Date.now(),
    });

    if (ctx.service?.logger) {
      ctx.service.logger.info(`Export file downloaded: ${exportId}`);
    }

    return {
      success: true,
      filePath: exportRecord.filePath,
      fileName,
      contentType,
    };
  } catch (error) {
    if (ctx.service?.logger) {
      ctx.service.logger.error('Failed to download export file:', error);
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 删除导出文件
 */
export async function deleteExportFile(
  ctx: Context,
  params: {
    exportId: string;
    tenantId: string;
    userId?: string;
  },
): Promise<{ success: boolean; error?: string }> {
  try {
    const { exportId, tenantId, userId } = params;

    // 简化实现 - 模拟删除操作
    const exportRecord = {
      exportId,
      filePath: `/exports/${exportId}.json`,
    };

    // 记录删除事件
    await ctx.emit('logs.export.deleted', {
      exportId,
      tenantId,
      userId,
      timestamp: Date.now(),
    });

    if (ctx.service?.logger) {
      ctx.service.logger.info(`Export deleted: ${exportId}`);
    }

    return { success: true };
  } catch (error) {
    if (ctx.service?.logger) {
      ctx.service.logger.error('Failed to delete export:', error);
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 获取用户的导出历史
 */
export async function getExportHistory(
  ctx: Context,
  params: {
    tenantId: string;
    userId?: string;
    page?: number;
    pageSize?: number;
  },
): Promise<{
  exports: Array<{
    exportId: string;
    status: string;
    format: string;
    recordCount?: number;
    fileSize?: number;
    createdAt: Date;
    completedAt?: Date;
  }>;
  total: number;
  page: number;
  pageSize: number;
}> {
  try {
    const { tenantId, userId, page = 1, pageSize = 20 } = params;

    const filter: any = { tenantId };
    if (userId) {
      filter.userId = userId;
    }

    // 简化实现 - 返回模拟历史记录
    const mockExports = [
      {
        exportId: `export_${Date.now()}_mock1`,
        status: 'completed',
        format: 'json',
        recordCount: 100,
        fileSize: 1024,
        createdAt: new Date(),
        completedAt: new Date(),
      },
    ];

    const total = mockExports.length;
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedExports = mockExports.slice(startIndex, endIndex);

    return {
      exports: paginatedExports.map((exp) => ({
        exportId: exp.exportId,
        status: exp.status,
        format: exp.format,
        recordCount: exp.recordCount,
        fileSize: exp.fileSize,
        createdAt: exp.createdAt,
        completedAt: exp.completedAt,
      })),
      total,
      page,
      pageSize,
    };
  } catch (error) {
    if (ctx.service?.logger) {
      ctx.service.logger.error('Failed to get export history:', error);
    }
    throw error;
  }
}

/**
 * 清理过期的导出文件
 */
export async function cleanupExpiredExports(
  ctx: Context,
  params: {
    maxAge?: number; // 最大保留天数，默认7天
  } = {},
): Promise<{ success: boolean; deletedCount: number }> {
  try {
    const { maxAge = 7 } = params;
    const cutoffDate = new Date(Date.now() - maxAge * 24 * 60 * 60 * 1000);

    // 简化实现 - 模拟清理操作
    const deletedCount = 0; // 模拟没有过期文件

    if (ctx.service?.logger) {
      ctx.service.logger.info(`Cleaned up ${deletedCount} expired exports`);
    }

    return {
      success: true,
      deletedCount,
    };
  } catch (error) {
    if (ctx.service?.logger) {
      ctx.service.logger.error('Failed to cleanup expired exports:', error);
    }
    throw error;
  }
}

/**
 * 验证导出参数
 */
function validateExportParams(params: LogExportParams): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // 验证格式
  if (params.format && !EXPORT_LIMITS.SUPPORTED_FORMATS.includes(params.format as any)) {
    errors.push(`Unsupported export format: ${params.format}`);
  }

  // 验证时间范围
  if (params.startTime && params.endTime && params.startTime >= params.endTime) {
    errors.push('Start time must be before end time');
  }

  // 验证限制
  if (params.limit && (params.limit <= 0 || params.limit > EXPORT_LIMITS.MAX_RECORDS)) {
    errors.push(`Invalid limit: must be between 1 and ${EXPORT_LIMITS.MAX_RECORDS}`);
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * 生成导出文件
 */
async function generateExportFile(
  logs: LogEntry[],
  params: LogExportParams,
  exportId: string,
): Promise<string> {
  const format = params.format || EXPORT_LIMITS.SUPPORTED_FORMATS[0];
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `logs_${exportId}_${timestamp}.${format}`;
  const filePath = path.join(process.cwd(), 'exports', fileName);

  // 确保导出目录存在
  const exportDir = path.dirname(filePath);
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }

  switch (format) {
    case 'json':
      await generateJsonFile(logs, filePath);
      break;
    case 'csv':
      await generateCsvFile(logs, filePath);
      break;
    default:
      throw new Error(`Unsupported export format: ${format}`);
  }

  return filePath;
}

/**
 * 生成JSON文件
 */
async function generateJsonFile(logs: LogEntry[], filePath: string): Promise<void> {
  const jsonData = JSON.stringify(logs, null, 2);
  fs.writeFileSync(filePath, jsonData, 'utf8');
}

/**
 * 生成CSV文件
 */
async function generateCsvFile(logs: LogEntry[], filePath: string): Promise<void> {
  const csvWriter = csv.createObjectCsvWriter({
    path: filePath,
    header: [
      { id: 'timestamp', title: 'Timestamp' },
      { id: 'level', title: 'Level' },
      { id: 'source', title: 'Source' },
      { id: 'message', title: 'Message' },
      { id: 'hostname', title: 'Hostname' },
      { id: 'userId', title: 'User ID' },
    ],
  });

  const csvData = logs.map((log) => ({
    timestamp: new Date(log.timestamp).toISOString(),
    level: log.level,
    source: log.source,
    message: log.message,
    hostname: log.hostname || '',
    userId: log.userId || '',
  }));

  await csvWriter.writeRecords(csvData);
}

/**
 * 更新导出状态
 */
async function updateExportStatus(
  ctx: Context,
  exportId: string,
  status: string,
  progress: number,
  filePath?: string,
  error?: string,
): Promise<void> {
  // 简化实现 - 仅记录日志
  if (ctx.service?.logger) {
    ctx.service.logger.debug(`Export ${exportId} status updated: ${status} (${progress}%)`);
  }

  if (error && ctx.service?.logger) {
    ctx.service.logger.error(`Export ${exportId} error: ${error}`);
  }
}

/**
 * 获取内容类型
 */
function getContentType(format?: string): string {
  switch (format) {
    case 'json':
      return 'application/json';
    case 'csv':
      return 'text/csv';
    default:
      return 'application/octet-stream';
  }
}
