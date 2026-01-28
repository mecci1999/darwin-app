import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, Starlight } from 'typings';
import appkey from './appkey';
import ingest from './ingest';
import query from './query';
import realtime from './realtime';
import schema from './schema';
import topology from './topology';

const metricsActions = (star: Starlight) => {
  const ingestAction = ingest(star);
  const queryAction = query(star);
  const schemaAction = schema(star);
  const appkeyAction = appkey(star);
  const topologyAction = topology(star);
  const realtimeAction = realtime(star);

  return {
    ...ingestAction,
    ...queryAction,
    ...schemaAction,
    ...appkeyAction,
    ...topologyAction,
    ...realtimeAction,

    // 健康检查
    health: {
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          return {
            status: 200,
            data: {
              code: HttpResponseCode.Success,
              content: {
                service: 'metrics',
                status: 'healthy',
                timestamp: Date.now(),
                version: '1.0.0',
              },
              message: 'Metrics service is healthy',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Health check failed:', error);
          return {
            status: 500,
            data: {
              code: HttpResponseCode.ServiceActionFaild,
              content: null,
              message: 'Health check failed',
              success: false,
            },
          };
        }
      },
    },

    // 获取服务统计信息
    'v1.stats': {
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const stats = await (this as any).getServiceStats();

          return {
            status: 200,
            data: {
              code: HttpResponseCode.Success,
              content: stats,
              message: 'Service statistics retrieved successfully',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Get service stats failed:', error);
          return {
            status: 500,
            data: {
              code: HttpResponseCode.ServiceActionFaild,
              content: null,
              message: 'Failed to get service statistics',
              success: false,
            },
          };
        }
      },
    },
  };
};

export default metricsActions;
