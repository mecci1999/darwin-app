/**
 * 日志摄取 Action
 * 单条日志摄取API接口
 */
import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, HttpStatusCode, Starlight } from 'typings';
import { ingestSingleLog } from '../methods/log-ingestion';
import { validateLogFormat } from '../utils/log-utils';

export default function ingest(star: Starlight) {
  return {
    'v1.ingest': {
      metadata: {
        auth: true,
        roles: ['user', 'admin'],
      },

      async handler(ctx: Context): Promise<HttpResponseItem> {
        const { log, apiKey, tenantId } = ctx.params;
        const startTime = Date.now();

        try {
          // 验证日志格式
          if (!validateLogFormat(log)) {
            return {
              status: HttpStatusCode.BAD_REQUEST,
              data: {
                content: null,
                message: 'Invalid log format',
                code: HttpResponseCode.ParamsError,
                success: false,
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
