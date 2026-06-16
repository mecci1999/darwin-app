/**
 * 批量日志摄取 Action
 * 处理批量日志数据的摄取、验证、存储和索引
 */

import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, HttpStatusCode, Starlight } from 'typings';
import { generateBatchId } from '../utils/log-utils';
import { validateLogBatchIngest } from '../validators';
import { ingestLogBatch } from '../methods/log-ingestion';
import { LogFormat } from '../types';
import { getDebugDiagnosticsState } from '../utils/debug-diagnostics';

function createBatchIngestFailureResponse(
  errorMessage: string,
  content: {
    batchId: string;
    processed: number;
    failed: number;
    errors: string[];
    processingTime: number;
    timestamp: string;
  },
): HttpResponseItem {
  const normalizedMessage = errorMessage.toLowerCase();

  if (errorMessage.includes('配额') || normalizedMessage.includes('quota')) {
    return {
      status: HttpStatusCode.TOO_MANY_REQUESTS,
      data: {
        content,
        message: '配额已超限',
        code: HttpResponseCode.TooManyRequests,
        success: false,
      },
    };
  }

  if (errorMessage.includes('权限') || normalizedMessage.includes('permission')) {
    return {
      status: HttpStatusCode.FORBIDDEN,
      data: {
        content,
        message: '权限不足',
        code: HttpResponseCode.NoPermissionError,
        success: false,
      },
    };
  }

  if (errorMessage.includes('API密钥') || normalizedMessage.includes('api key')) {
    return {
      status: HttpStatusCode.UNAUTHORIZED,
      data: {
        content,
        message: 'API密钥无效或已过期',
        code: HttpResponseCode.ERR_INVALID_TOKEN,
        success: false,
      },
    };
  }

  return {
    status: HttpStatusCode.BAD_REQUEST,
    data: {
      content,
      message: '批量日志摄取失败',
      code: HttpResponseCode.ServiceActionFaild,
      success: false,
    },
  };
}

export default function batchIngest(star: Starlight) {
  return {
    'v1.batch-ingest': {
      metadata: {
        auth: true,
        allowApiKeyAuth: true,
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

          const resolvedBatchId = batchId || generateBatchId();
          const debugDiagnosticsEnabled = getDebugDiagnosticsState().enabled;
          const filteredLogs = debugDiagnosticsEnabled ? logs : logs.filter((log: any) => log?.level !== 'debug');
          const ignoredDebugLogs = logs.length - filteredLogs.length;

          if (filteredLogs.length === 0) {
            const processingTime = Date.now() - startTime;
            return {
              status: HttpStatusCode.OK,
              data: {
                content: {
                  batchId: resolvedBatchId,
                  processed: 0,
                  failed: 0,
                  ignored: ignoredDebugLogs,
                  errors: [],
                  processingTime,
                  timestamp: new Date().toISOString(),
                },
                message: 'Debug logs ignored because diagnostics are disabled',
                code: HttpResponseCode.Success,
                success: true,
              },
            };
          }

          const result = await ingestLogBatch(ctx, {
            apiKey,
            tenantId,
            userId,
            batch: {
              logs: filteredLogs,
              batchId: resolvedBatchId,
              tenantId,
              timestamp: Date.now(),
              source: 'api',
              format: (format || 'json') as LogFormat,
            },
          });

          const processingTime = Date.now() - startTime;

          if (!result.success) {
            const errors = result.errors || [];
            return createBatchIngestFailureResponse(errors[0] || '批量日志摄取失败', {
              batchId: result.batchId || resolvedBatchId,
              processed: result.processed,
              failed: result.failed,
              errors,
              processingTime,
              timestamp: new Date().toISOString(),
            });
          }

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
                batchId: result.batchId || resolvedBatchId,
                processed: result.processed,
                failed: result.failed,
                ignored: ignoredDebugLogs,
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
