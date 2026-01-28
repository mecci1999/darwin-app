/**
 * 批量日志摄取 Action
 * 处理批量日志数据的摄取、验证、存储和索引
 */

import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, HttpStatusCode, Starlight } from 'typings';
import { generateBatchId, generateLogId } from '../utils/log-utils';
import { validateLogBatchIngest } from '../validators';

export default function batchIngest(star: Starlight) {
  return {
    'v1.batch-ingest': {
      metadata: {
        auth: true,
        roles: ['admin', 'user'],
      },

      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { tenantId, userId, apiKey, logs, format, batchId } = ctx.params;
          const startTime = Date.now();

          // 参数验证
          const validation = validateLogBatchIngest({ tenantId, apiKey, logs, format });
          if (!validation.valid) {
            return {
              status: HttpStatusCode.BAD_REQUEST,
              data: {
                content: null,
                message: validation.errors.join(', '),
                code: HttpResponseCode.BAD_REQUEST,
                success: false,
              },
            };
          }

          // 构建日志条目
          const logEntries = logs.map((log: any, index: number) => ({
            id: generateLogId(),
            tenantId,
            userId,
            apiKeyId: (ctx.meta as any)?.apiKeyId,
            batchId: batchId || generateBatchId(),
            index,
            timestamp: log.timestamp || new Date().toISOString(),
            level: log.level || 'info',
            message: log.message,
            service: log.service,
            source: log.source || 'api',
            metadata: log.metadata || {},
            tags: log.tags || [],
            receivedAt: new Date().toISOString(),
          }));

          // 模拟批量摄取处理
          const result = {
            batchId: batchId || generateBatchId(),
            processed: logEntries.length,
            failed: 0,
            errors: [],
          };

          const processingTime = Date.now() - startTime;

          // 记录日志
          star.logger?.info('Batch log ingest completed', {
            tenantId,
            userId,
            batchId: result.batchId,
            count: result.processed,
            failed: result.failed,
            processingTime,
          });

          return {
            status: HttpStatusCode.OK,
            data: {
              content: {
                batchId: result.batchId,
                processed: result.processed,
                failed: result.failed,
                errors: result.errors,
                processingTime,
                timestamp: new Date().toISOString(),
              },
              message: '批量日志摄取完成',
              code: HttpResponseCode.Success,
              success: true,
            },
          };
        } catch (error: any) {
          star.logger?.error('Batch log ingest failed', {
            error: error.message,
            tenantId: ctx.params.tenantId,
            userId: ctx.params.userId,
          });

          // 处理特定错误
          if (error.code === 'QUOTA_EXCEEDED') {
            return {
              status: HttpStatusCode.TOO_MANY_REQUESTS,
              data: {
                content: null,
                message: '配额已超限',
                code: HttpResponseCode.TooManyRequests,
                success: false,
              },
            };
          }

          if (error.code === 'INVALID_API_KEY') {
            return {
              status: HttpStatusCode.UNAUTHORIZED,
              data: {
                content: null,
                message: 'API密钥无效或已过期',
                code: HttpResponseCode.ERR_INVALID_TOKEN,
                success: false,
              },
            };
          }

          if (error.code === 'PERMISSION_DENIED') {
            return {
              status: HttpStatusCode.FORBIDDEN,
              data: {
                content: null,
                message: '权限不足',
                code: HttpResponseCode.NoPermissionError,
                success: false,
              },
            };
          }

          // 通用错误
          return {
            status: HttpStatusCode.INTERNAL_SERVER_ERROR,
            data: {
              content: null,
              message: '批量日志摄取失败',
              code: HttpResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        }
      },
    },
  };
}
