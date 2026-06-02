import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, HttpStatusCode, Starlight } from 'typings';
import { searchLogs } from '../methods/log-search';
import { getLogStats } from '../methods/log-stats';
import { elasticsearchManager } from '../utils/elasticsearch-manager';
import { validateLogSearch, validateLogStats } from '../validators';
import {
  flushDarwinLogCaptureNow,
} from '../utils/darwin-log-capture';
import { isAdminContext, isDarwinLogRequest, resolveLogTenantId } from '../utils/access-control';

const toTraceSpan = (log: any) => ({
  id: log.id,
  traceId: log.traceId || log.metadata?.traceId || 'unknown',
  parentId: log.metadata?.parentId,
  name: log.message,
  service: log.service,
  startTime: new Date(log.timestamp).getTime(),
  duration: Number(log.metadata?.duration || 0),
  status: log.level === 'error' ? 'error' : 'ok',
  tags: (log.metadata || {}) as Record<string, string>,
});

export default function readModel(star: Starlight) {
  const deriveTimeRange = (params: any) => {
    if (params?.timeRange && typeof params.timeRange === 'string') return params.timeRange;
    const startTime = params?.startTime ? new Date(params.startTime).getTime() : 0;
    const endTime = params?.endTime ? new Date(params.endTime).getTime() : 0;
    if (!startTime || !endTime || endTime <= startTime) return '24h';
    const diffMinutes = Math.max(1, Math.round((endTime - startTime) / 60000));
    if (diffMinutes < 60) return `${diffMinutes}m`;
    const diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h`;
    const diffDays = Math.round(diffHours / 24);
    return `${diffDays}d`;
  };

  const normalizeDateParam = (value: unknown) => {
    if (!value) return undefined;

    const normalized = new Date(value as string | number | Date);
    if (Number.isNaN(normalized.getTime())) return undefined;

    return normalized.toISOString();
  };

  return {
    'v1.explorer.search': {
      metadata: {
        auth: true,
        roles: ['admin', 'user', 'viewer'],
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const originType = (ctx.params as any)?.originType;
          const tenantId = resolveLogTenantId(ctx, originType);
          const apiKey = (ctx.params as any)?.apiKey || (isDarwinLogRequest(originType) ? 'system-admin' : undefined);
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
          if (isDarwinLogRequest(originType)) {
            await flushDarwinLogCaptureNow();
          }
          const searchParams = {
            ...ctx.params,
            query: (ctx.params as any)?.query || (ctx.params as any)?.keyword,
            tenantId,
            apiKey: apiKey || 'tenant-authenticated',
            userId: (ctx.meta as any)?.userId,
            limit: Number((ctx.params as any)?.limit || (ctx.params as any)?.pageSize || 50),
            visibility: originType === 'darwin-app' ? 'admin' : undefined,
          };
          const validation = validateLogSearch(searchParams);
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
          const result = await searchLogs(ctx, {
            tenantId,
            apiKey,
            searchParams,
          });

          return {
            status: HttpStatusCode.OK,
            data: {
              content: {
                items: result.logs || [],
                pagination: {
                  page: Number((ctx.params as any)?.page || 1),
                  pageSize: Number((ctx.params as any)?.limit || (ctx.params as any)?.pageSize || 50),
                  total: result.total || 0,
                },
              },
              message: '获取日志浏览结果成功',
              code: HttpResponseCode.Success,
              success: true,
            },
          };
        } catch (error: any) {
          star.logger?.error('Log explorer search failed', { error: error.message });
          return {
            status: HttpStatusCode.INTERNAL_SERVER_ERROR,
            data: {
              content: null,
              message: '获取日志浏览结果失败',
              code: HttpResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        }
      },
    },

    'v1.explorer.stats': {
      metadata: {
        auth: true,
        roles: ['admin', 'user', 'viewer'],
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const originType = (ctx.params as any)?.originType;
          const tenantId = resolveLogTenantId(ctx, originType);
          const apiKey = (ctx.params as any)?.apiKey || (isDarwinLogRequest(originType) ? 'system-admin' : undefined);
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
          const statsParams = {
            ...ctx.params,
            startTime: normalizeDateParam((ctx.params as any)?.startTime),
            endTime: normalizeDateParam((ctx.params as any)?.endTime),
            timeRange: deriveTimeRange(ctx.params),
            tenantId,
            apiKey: apiKey || 'tenant-authenticated',
            originType,
            visibility: originType === 'darwin-app' ? 'admin' : undefined,
          } as any;
          const validation = validateLogStats(statsParams);
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
          const summary = await getLogStats(ctx, {
            tenantId,
            apiKey,
            statsParams,
          });

          const levelStats = summary.groupBy === 'level' ? summary.data.reduce<Record<string, number>>((acc, item) => {
            acc[item.key] = item.count;
            return acc;
          }, {}) : {};
          const serviceStats = summary.groupBy === 'service' ? summary.data.reduce<Record<string, number>>((acc, item) => {
            acc[item.key] = item.count;
            return acc;
          }, {}) : {};
          const topServices = summary.topServices || [];
          const avgResponseTime = Number(summary.avgResponseTime || 0);

          const content = {
            ...summary,
            totalLogs: summary.total,
            errorLogs: (levelStats.error || 0) + (levelStats.fatal || 0),
            warnLogs: levelStats.warn || 0,
            levelStats,
            serviceStats,
            topServices,
            errorRate: summary.errorRate,
            avgResponseTime,
          };

          return {
            status: HttpStatusCode.OK,
            data: {
              content,
              message: '获取日志统计摘要成功',
              code: HttpResponseCode.Success,
              success: true,
            },
          };
        } catch (error: any) {
          star.logger?.error('Log explorer stats failed', { error: error.message });
          return {
            status: HttpStatusCode.INTERNAL_SERVER_ERROR,
            data: {
              content: null,
              message: '获取日志统计摘要失败',
              code: HttpResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        }
      },
    },

    'v1.exceptions.list': {
      metadata: {
        auth: true,
        roles: ['admin', 'user'],
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const originType = (ctx.params as any)?.originType;
          const tenantId = resolveLogTenantId(ctx, originType);
          const timeRange = (ctx.params as any)?.timeRange || '24h';
          const service = String((ctx.params as any)?.service || 'unknown-service');
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
          const esClient = elasticsearchManager.getClientFromContext(ctx, tenantId);
          const analysis = await esClient.analyzeExceptions(tenantId, timeRange);
          const startTime = normalizeDateParam((ctx.params as any)?.startTime) || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          const endTime = normalizeDateParam((ctx.params as any)?.endTime) || new Date().toISOString();
          const items = (analysis?.topErrors || []).map((item: any, index: number) => ({
            id: `exception-${index}`,
            message: item.message,
            type: 'Error',
            service,
            count: Number(item.count || 0),
            affectedUsers: 0,
            trend: 0,
            firstOccurrence: startTime,
            lastOccurrence: endTime,
            stackTrace: '',
            sampleLogs: [],
            hourlyTrend: [],
          }));

          return {
            status: HttpStatusCode.OK,
            data: {
              content: {
                items,
                analysis,
              },
              message: '获取异常列表成功',
              code: HttpResponseCode.Success,
              success: true,
            },
          };
        } catch (error: any) {
          star.logger?.error('Exception list failed', { error: error.message });
          return {
            status: HttpStatusCode.INTERNAL_SERVER_ERROR,
            data: {
              content: null,
              message: '获取异常列表失败',
              code: HttpResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        }
      },
    },

    'v1.trace.search': {
      metadata: {
        auth: true,
        roles: ['admin', 'user', 'viewer'],
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const tenantId = (ctx.meta as any)?.tenantId;
          const apiKey = (ctx.params as any)?.apiKey;
          const queryParts = [] as string[];
          if ((ctx.params as any)?.service) queryParts.push(`service:"${(ctx.params as any).service}"`);
          if ((ctx.params as any)?.operation) queryParts.push(`message:"${(ctx.params as any).operation}"`);
          if ((ctx.params as any)?.traceId) queryParts.push(`traceId:"${(ctx.params as any).traceId}"`);
          const query = queryParts.join(' AND ') || '*';

          const result = await searchLogs(ctx, {
            tenantId,
            apiKey,
            searchParams: {
              query,
              service: (ctx.params as any)?.service,
              traceId: (ctx.params as any)?.traceId,
              startTime: (ctx.params as any)?.startTime
                ? new Date((ctx.params as any).startTime).toISOString()
                : undefined,
              endTime: (ctx.params as any)?.endTime
                ? new Date((ctx.params as any).endTime).toISOString()
                : undefined,
            } as any,
          });

          const logs = Array.isArray(result.logs) ? result.logs : [];
          const traceMap = new Map<string, any>();
          logs.forEach((log: any) => {
            const span = toTraceSpan(log);
            const existing = traceMap.get(span.traceId);
            if (!existing || (!span.parentId && existing.parentId)) {
              traceMap.set(span.traceId, span);
            }
          });

          return {
            status: HttpStatusCode.OK,
            data: {
              content: Array.from(traceMap.values()),
              message: '获取链路列表成功',
              code: HttpResponseCode.Success,
              success: true,
            },
          };
        } catch (error: any) {
          star.logger?.error('Trace search failed', { error: error.message });
          return {
            status: HttpStatusCode.INTERNAL_SERVER_ERROR,
            data: {
              content: null,
              message: '获取链路列表失败',
              code: HttpResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        }
      },
    },

    'v1.trace.detail': {
      metadata: {
        auth: true,
        roles: ['admin', 'user', 'viewer'],
      },
      params: {
        traceId: { type: 'string', required: true },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const tenantId = (ctx.meta as any)?.tenantId;
          const apiKey = (ctx.params as any)?.apiKey;
          const traceId = (ctx.params as any).traceId;

          const result = await searchLogs(ctx, {
            tenantId,
            apiKey,
            searchParams: {
              query: `traceId:"${traceId}"`,
              traceId,
              startTime: normalizeDateParam((ctx.params as any)?.startTime),
              endTime: normalizeDateParam((ctx.params as any)?.endTime),
            } as any,
          });

          const logs = Array.isArray(result.logs) ? result.logs : [];
          const spans = logs.map((log: any) => toTraceSpan(log)).sort((a: any, b: any) => a.startTime - b.startTime);

          return {
            status: HttpStatusCode.OK,
            data: {
              content: spans,
              message: '获取链路详情成功',
              code: HttpResponseCode.Success,
              success: true,
            },
          };
        } catch (error: any) {
          star.logger?.error('Trace detail failed', { error: error.message });
          return {
            status: HttpStatusCode.INTERNAL_SERVER_ERROR,
            data: {
              content: null,
              message: '获取链路详情失败',
              code: HttpResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        }
      },
    },
  };
}
