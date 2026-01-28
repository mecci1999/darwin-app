import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, Starlight } from 'typings';
import { InfluxDBHandler } from '../utils/influxdb-handler';

const realtime = (star: Starlight) => {
  return {
    // 获取实时监控数据
    'v1.realtime': {
      metadata: {
        auth: true,
      },
      params: {
        serviceId: { type: 'string', optional: true },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { serviceId } = ctx.params;

          // 从 InfluxDB 获取实时数据
          // 如果数据库没有数据，Handler 内部目前会返回模拟数据以保证演示效果
          const data = await InfluxDBHandler.getRealtimeStats(serviceId, star);

          return {
            status: 200,
            data: {
              code: HttpResponseCode.Success,
              content: data || {},
              message: '获取实时监控数据成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Get realtime metrics failed:', error);
          return {
            status: 500,
            data: {
              code: HttpResponseCode.ServiceActionFaild,
              content: null,
              message: '获取实时监控数据失败',
              success: false,
            },
          };
        }
      },
    },
  };
};

export default realtime;
