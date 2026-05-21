import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, HttpStatusCode, Starlight } from 'typings';
import { getLogStats } from '../methods/log-stats';
import { LogStatsParams } from '../types';
import { elasticsearchManager } from '../utils/elasticsearch-manager';
import { ElasticsearchClient } from '../utils/elasticsearch';
import { validateLogStats } from '../validators';
import { isAdminContext, isDarwinLogRequest, resolveLogTenantId } from '../utils/access-control';

export default function stats(star: Starlight) {
  return {
    'v1.stats': {
      metadata: {
        auth: true,
        roles: ['admin', 'user', 'viewer'],
      },

      async handler(ctx: Context): Promise<HttpResponseItem> {
        const { service, timeRange = '24h', groupBy = 'level', apiKey, originType } = ctx.params;

        const tenantId = resolveLogTenantId(ctx, originType);

        try {
          if (isDarwinLogRequest(originType) && !isAdminContext(ctx)) {
            return {
              status: HttpStatusCode.FORBIDDEN,
              data: {
                content: null,
                message: 'Only administrators can access Darwin logs',
                code: HttpResponseCode.NoPermissionError,
                success: false,
              },
            };
          }

          // 验证统计参数
          const effectiveApiKey = apiKey || (isDarwinLogRequest(originType) ? 'system-admin' : 'tenant-authenticated');
          const validation = validateLogStats({ ...ctx.params, tenantId, apiKey: effectiveApiKey });
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

          if (!tenantId) {
            return {
              status: HttpStatusCode.BAD_REQUEST,
              data: {
                content: null,
                message: 'tenantId is required',
                code: HttpResponseCode.ParamsError,
                success: false,
              },
            };
          }

          // 构建统计参数
          const statsParams: LogStatsParams = {
            service,
            timeRange,
            groupBy,
            tenantId,
            originType,
            visibility: originType === 'darwin-app' ? 'admin' : undefined,
          };

          // 调用统计方法
          const statsResult = await getLogStats(ctx, {
            tenantId,
            apiKey,
            statsParams,
          });

          // 记录日志
          star.logger?.info('Log stats completed', {
            tenantId,
            service,
            timeRange,
            groupBy,
          });

          return {
            status: HttpStatusCode.OK,
            data: {
              content: statsResult,
              message: 'Stats retrieved successfully',
              code: HttpResponseCode.Success,
              success: true,
            },
          };
        } catch (error: any) {
          star.logger?.error('Log stats failed', {
            error: error.message,
            tenantId,
            statsParams: { service, timeRange, groupBy },
          });

          return {
            status: HttpStatusCode.INTERNAL_SERVER_ERROR,
            data: {
              content: null,
              message: 'Stats retrieval failed',
              code: HttpResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        }
      },
    },

    'v1.config.testConnection': {
      metadata: {
        auth: true,
        roles: ['admin', 'user', 'viewer'],
      },

      async handler(ctx: Context): Promise<HttpResponseItem> {
        const {
          engine = 'elasticsearch',
          elasticsearch,
        } = ctx.params as {
          engine?: string;
          elasticsearch?: {
            hosts?: string[];
            username?: string;
            password?: string;
            indexPrefix?: string;
          };
        };
        const tenantId = ctx.meta?.tenantId as string | undefined;

        try {
          if (engine !== 'elasticsearch') {
            return {
              status: HttpStatusCode.BAD_REQUEST,
              data: {
                content: { connected: false, engine, reason: 'unsupported_engine' },
                message: `Current logs service only supports ${engine === 'elasticsearch' ? engine : 'elasticsearch'} connection checks`,
                code: HttpResponseCode.ParamsError,
                success: false,
              },
            };
          }

          const candidateHost = elasticsearch?.hosts?.find((host) => typeof host === 'string' && host.trim().length > 0);
          const esClient = candidateHost
            ? new ElasticsearchClient({
                node: candidateHost,
                username: elasticsearch?.username,
                password: elasticsearch?.password,
                index: elasticsearch?.indexPrefix || (tenantId ? `logs-${tenantId}` : 'logs'),
              })
            : elasticsearchManager.getClient(tenantId);
          const connected = await esClient.healthCheck();

          return {
            status: connected ? HttpStatusCode.OK : HttpStatusCode.SERVICE_UNAVAILABLE,
            data: {
              content: {
                connected,
                engine,
              },
              message: connected ? 'Connection test succeeded' : 'Connection test failed',
              code: connected ? HttpResponseCode.Success : HttpResponseCode.ServiceActionFaild,
              success: connected,
            },
          };
        } catch (error: any) {
          star.logger?.error('Log config connection test failed', {
            error: error.message,
            tenantId,
            engine,
          });

          return {
            status: HttpStatusCode.INTERNAL_SERVER_ERROR,
            data: {
              content: {
                connected: false,
                engine,
                reason: error.message,
              },
              message: 'Connection test failed',
              code: HttpResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        }
      },
    },
  };
}
