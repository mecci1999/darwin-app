import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, HttpStatusCode, Starlight } from 'typings';
import { getLogStats } from '../methods/log-stats';
import { LogStatsParams } from '../types';
import { validateLogStats } from '../validators';

export default function stats(star: Starlight) {
  return {
    'v1.stats': {
      metadata: {
        auth: true,
        roles: ['admin', 'user', 'viewer'],
      },

      async handler(ctx: Context): Promise<HttpResponseItem> {
        const { service, timeRange = '24h', groupBy = 'level', apiKey } = ctx.params;

        const tenantId = ctx.meta?.tenantId;

        try {
          // 验证统计参数
          const validation = validateLogStats(ctx.params);
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

          // 构建统计参数
          const statsParams: LogStatsParams = {
            service,
            timeRange,
            groupBy,
            tenantId,
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
  };
}
