/**
 * 异常分析 Action
 * 对日志中的异常进行智能分析
 */
import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, HttpStatusCode, Starlight } from 'typings';
import { elasticsearchManager } from '../utils/elasticsearch-manager';

export default function exceptionAnalysis(star: Starlight) {
  return {
    'v1.exception-analysis': {
      metadata: {
        auth: true,
        roles: ['admin', 'user'],
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { tenantId, timeRange } = ctx.params;

          // 获取 ES 客户端
          const esClient = elasticsearchManager.getClientFromContext(ctx);

          // 执行真实的异常分析
          const analysis = await esClient.analyzeExceptions(tenantId, timeRange || '24h');

          return {
            status: HttpStatusCode.OK,
            data: {
              content: {
                analysis,
                timestamp: new Date().toISOString(),
              },
              message: '异常分析完成',
              code: HttpResponseCode.Success,
              success: true,
            },
          };
        } catch (error: any) {
          star.logger?.error('Exception analysis failed', {
            error: error.message,
            tenantId: ctx.params.tenantId,
          });

          return {
            status: HttpStatusCode.INTERNAL_SERVER_ERROR,
            data: {
              content: null,
              message: '异常分析失败: ' + error.message,
              code: HttpResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        }
      },
    },
  };
}
