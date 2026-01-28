/**
 * 日志搜索 Action
 * 提供日志搜索功能，支持复杂查询、过滤、分页和聚合
 */

import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, HttpStatusCode, Starlight } from 'typings';
import { searchLogs } from '../methods/log-search';
import { LogSearchParams } from '../types';
import { validateLogSearch } from '../validators';

export default function search(star: Starlight) {
  return {
    'v1.search': {
      metadata: {
        auth: true,
        roles: ['admin', 'user', 'viewer'],
      },

      async handler(ctx: Context): Promise<HttpResponseItem> {
        const {
          query,
          service,
          level,
          source,
          startTime,
          endTime,
          page = 1,
          limit = 50,
          sortBy = 'timestamp',
          sortOrder = 'desc',
          tags,
          environment,
          traceId,
          sessionId,
          apiKey,
        } = ctx.params;

        const tenantId = (ctx.meta as any)?.tenantId;
        const userId = (ctx.meta as any)?.userId;

        try {
          // 验证搜索参数
          const validation = validateLogSearch(ctx.params);
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

          // 验证分页参数
          const validatedPage = Math.max(1, page);
          const validatedLimit = Math.min(Math.max(1, limit), 1000);

          // 构建搜索参数
          const searchParams: LogSearchParams = {
            query,
            service,
            level,
            source,
            startTime,
            endTime,
            tags,
            environment,
            traceId,
            sessionId,
            tenantId,
            userId,
          };

          // 调用搜索方法
          const result = await searchLogs(ctx, {
            tenantId,
            apiKey,
            searchParams,
          });

          // 记录日志
          star.logger?.info('Log search completed', {
            tenantId,
            query,
            resultCount: result.logs?.length || 0,
            searchTime: Date.now(),
          });

          return {
            status: HttpStatusCode.OK,
            data: {
              content: {
                logs: result.logs || [],
                pagination: {
                  page: validatedPage,
                  limit: validatedLimit,
                  total: result.total || 0,
                  totalPages: Math.ceil((result.total || 0) / validatedLimit),
                  hasMore: validatedPage * validatedLimit < (result.total || 0),
                },
                searchParams: {
                  query,
                  service,
                  level,
                  source,
                  timeRange: {
                    start: startTime,
                    end: endTime,
                  },
                },
                timestamp: new Date().toISOString(),
              },
              message: 'Search completed successfully',
              code: HttpResponseCode.Success,
              success: true,
            },
          };
        } catch (error: any) {
          star.logger?.error('Log search failed', {
            error: error.message,
            tenantId,
            searchParams: { query, service, level, source },
          });

          return {
            status: HttpStatusCode.INTERNAL_SERVER_ERROR,
            data: {
              content: null,
              message: 'Search failed',
              code: HttpResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        }
      },
    },
  };
}
