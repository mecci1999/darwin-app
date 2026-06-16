/**
 * 日志摄取 Action
 * 单条日志摄取API接口
 */
import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, HttpStatusCode, Starlight } from 'typings';
import { ingestSingleLog } from '../methods/log-ingestion';
import { validateLogIngest } from '../validators';
import { getDebugDiagnosticsState } from '../utils/debug-diagnostics';

function createIngestFailureResponse(errorMessage: string): HttpResponseItem {
  const normalizedMessage = errorMessage.toLowerCase();

  if (errorMessage.includes('配额') || normalizedMessage.includes('quota')) {
    return {
      status: HttpStatusCode.TOO_MANY_REQUESTS,
      data: {
        content: null,
        message: 'Quota exceeded',
        code: HttpResponseCode.TooManyRequests,
        success: false,
      },
    };
  }

  if (errorMessage.includes('权限') || normalizedMessage.includes('permission')) {
    return {
      status: HttpStatusCode.FORBIDDEN,
      data: {
        content: null,
        message: 'API key does not have ingest permission',
        code: HttpResponseCode.NoPermissionError,
        success: false,
      },
    };
  }

  if (errorMessage.includes('API密钥') || normalizedMessage.includes('api key')) {
    return {
      status: HttpStatusCode.UNAUTHORIZED,
      data: {
        content: null,
        message: 'Invalid API key',
        code: HttpResponseCode.ERR_INVALID_TOKEN,
        success: false,
      },
    };
  }

  if (errorMessage.includes('格式') || normalizedMessage.includes('invalid')) {
    return {
      status: HttpStatusCode.BAD_REQUEST,
      data: {
        content: null,
        message: errorMessage,
        code: HttpResponseCode.ParamsError,
        success: false,
      },
    };
  }

  return {
    status: HttpStatusCode.INTERNAL_SERVER_ERROR,
    data: {
      content: null,
      message: 'Log ingestion failed',
      code: HttpResponseCode.ServiceActionFaild,
      success: false,
    },
  };
}

export default function ingest(star: Starlight) {
  return {
    'v1.ingest': {
      metadata: {
        auth: true,
        allowApiKeyAuth: true,
        roles: ['user', 'admin'],
      },

      async handler(ctx: Context): Promise<HttpResponseItem> {
        const { log, apiKey, tenantId } = ctx.params;
        const startTime = Date.now();

        try {
          // 验证请求参数
          const validation = validateLogIngest({ log, apiKey, tenantId });
          if (!validation.valid) {
            return {
              status: HttpStatusCode.BAD_REQUEST,
              data: {
                content: null,
                message: validation.errors.join(', '),
                code: HttpResponseCode.ParamsError,
                success: false,
              },
            };
          }

          if (log?.level === 'debug' && !getDebugDiagnosticsState().enabled) {
            return {
              status: HttpStatusCode.OK,
              data: {
                content: {
                  received: 1,
                  stored: 0,
                  ignored: 1,
                  reason: 'debug diagnostics disabled',
                  timestamp: new Date().toISOString(),
                },
                message: 'Debug log ignored because diagnostics are disabled',
                code: HttpResponseCode.Success,
                success: true,
              },
            };
          }

          // 调用日志摄取方法
          const result = await ingestSingleLog(ctx, {
            apiKey,
            log,
            tenantId,
            userId: (ctx.meta as any)?.userId,
          });

          if (!result.success) {
            return createIngestFailureResponse(result.error || 'Log ingestion failed');
          }

          // 记录处理时间
          const processingTime = Date.now() - startTime;

          // 记录日志
          star.logger?.info('Log ingested successfully', {
            tenantId,
            logId: result.logId,
            processingTime,
          });

          return {
            status: HttpStatusCode.OK,
            data: {
              content: {
                received: 1,
                stored: result.success ? 1 : 0,
                timestamp: new Date().toISOString(),
                logId: result.logId,
              },
              message: 'Log ingested successfully',
              code: HttpResponseCode.Success,
              success: true,
            },
          };
        } catch (error: any) {
          star.logger?.error('Log ingestion failed', { error: error.message, tenantId });

          // 根据错误类型返回不同响应
          if (error.message.includes('quota')) {
            return {
              status: HttpStatusCode.TOO_MANY_REQUESTS,
              data: {
                content: null,
                message: 'Quota exceeded',
                code: HttpResponseCode.TooManyRequests,
                success: false,
              },
            };
          }

          if (error.message.includes('API key')) {
            return {
              status: HttpStatusCode.UNAUTHORIZED,
              data: {
                content: null,
                message: 'Invalid API key',
                code: HttpResponseCode.ERR_INVALID_TOKEN,
                success: false,
              },
            };
          }

          return {
            status: HttpStatusCode.INTERNAL_SERVER_ERROR,
            data: {
              content: null,
              message: 'Internal server error',
              code: HttpResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        }
      },
    },
  };
}
