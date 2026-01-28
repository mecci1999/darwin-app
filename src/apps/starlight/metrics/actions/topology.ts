import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, Starlight } from 'typings';
import { InfluxDBHandler } from '../utils/influxdb-handler';

const topology = (star: Starlight) => {
  return {
    // 获取服务拓扑图
    'v1.topology': {
      metadata: {
        auth: true,
      },
      params: {
        timeRange: { type: 'string', optional: true, default: '-1h' },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { timeRange } = ctx.params;

          // 从 InfluxDB 获取真实拓扑数据
          const topologyData = await InfluxDBHandler.getTopologyData(star, timeRange);

          // 如果没有数据，且环境为开发环境，返回一些默认数据以便展示
          if (topologyData.nodes.length === 0 && process.env.NODE_ENV === 'development') {
            // 保留部分 Mock 数据作为冷启动展示
            const nodes = [
              { id: 'svc-gateway', name: 'api-gateway', status: 'running', type: 'service' },
              { id: 'svc-auth', name: 'auth-service', status: 'running', type: 'service' },
              { id: 'svc-user', name: 'user-service', status: 'running', type: 'service' },
              { id: 'db-mysql', name: 'MySQL', status: 'running', type: 'database' },
            ];
            const edges = [
              { source: 'svc-gateway', target: 'svc-auth', value: 10 },
              { source: 'svc-gateway', target: 'svc-user', value: 5 },
              { source: 'svc-user', target: 'db-mysql', value: 15 },
            ];
            return {
              status: 200,
              data: {
                code: HttpResponseCode.Success,
                content: { nodes, edges },
                message: '获取服务拓扑成功 (Dev Default)',
                success: true,
              },
            };
          }

          return {
            status: 200,
            data: {
              code: HttpResponseCode.Success,
              content: topologyData,
              message: '获取服务拓扑成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Get topology failed:', error);
          return {
            status: 500,
            data: {
              code: HttpResponseCode.ServiceActionFaild,
              content: null,
              message: '获取服务拓扑失败',
              success: false,
            },
          };
        }
      },
    },

    // 获取服务列表
    'v1.services': {
      metadata: {
        auth: true,
      },
      params: {
        page: { type: 'number', optional: true, default: 1 },
        pageSize: { type: 'number', optional: true, default: 10 },
        status: { type: 'string', optional: true },
        keyword: { type: 'string', optional: true },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { page, pageSize, status, keyword } = ctx.params;

          // 模拟服务数据
          let services = [
            {
              id: 'svc-gateway',
              name: 'api-gateway',
              status: 'running',
              version: 'v2.0.1',
              instances: 4,
              health: 'healthy',
              lastUpdate: new Date().toISOString(),
            },
            {
              id: 'svc-auth',
              name: 'auth-service',
              status: 'running',
              version: 'v1.8.4',
              instances: 2,
              health: 'healthy',
              lastUpdate: new Date(Date.now() - 60000).toISOString(),
            },
            {
              id: 'svc-user',
              name: 'user-service',
              status: 'running',
              version: 'v1.2.3',
              instances: 3,
              health: 'healthy',
              lastUpdate: new Date(Date.now() - 300000).toISOString(),
            },
            {
              id: 'svc-order',
              name: 'order-service',
              status: 'running',
              version: 'v2.1.0',
              instances: 2,
              health: 'healthy',
              lastUpdate: new Date(Date.now() - 480000).toISOString(),
            },
            {
              id: 'svc-payment',
              name: 'payment-service',
              status: 'error',
              version: 'v1.5.2',
              instances: 1,
              health: 'unhealthy',
              lastUpdate: new Date(Date.now() - 720000).toISOString(),
            },
            {
              id: 'svc-product',
              name: 'product-service',
              status: 'running',
              version: 'v1.1.0',
              instances: 2,
              health: 'healthy',
              lastUpdate: new Date(Date.now() - 900000).toISOString(),
            },
            {
              id: 'svc-inventory',
              name: 'inventory-service',
              status: 'running',
              version: 'v1.0.9',
              instances: 1,
              health: 'warning',
              lastUpdate: new Date(Date.now() - 120000).toISOString(),
            },
            {
              id: 'svc-notify',
              name: 'notify-service',
              status: 'stopped',
              version: 'v1.0.0',
              instances: 0,
              health: 'unknown',
              lastUpdate: new Date(Date.now() - 86400000).toISOString(),
            },
          ];

          if (status && status !== 'all') {
            services = services.filter((s) => s.status === status);
          }

          if (keyword) {
            services = services.filter((s) => s.name.includes(keyword));
          }

          const total = services.length;
          const start = (page - 1) * pageSize;
          const list = services.slice(start, start + pageSize);

          return {
            status: 200,
            data: {
              code: HttpResponseCode.Success,
              content: { services: list, total, page },
              message: '获取服务列表成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Get services failed:', error);
          return {
            status: 500,
            data: {
              code: HttpResponseCode.ServiceActionFaild,
              content: null,
              message: '获取服务列表失败',
              success: false,
            },
          };
        }
      },
    },

    // 获取服务实例
    'v1.instances': {
      metadata: {
        auth: true,
      },
      params: {
        serviceId: { type: 'string', required: true },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { serviceId } = ctx.params;

          // 模拟实例数据
          const count = Math.floor(Math.random() * 3) + 1;
          const instances = Array.from({ length: count }).map((_, i) => ({
            id: `${serviceId}-${String(i + 1).padStart(3, '0')}`,
            serviceId,
            node: `node-${String(i + 1).padStart(2, '0')}`,
            status: Math.random() > 0.8 ? 'error' : 'running',
            cpu: Math.floor(Math.random() * 90) + 5,
            memory: Math.floor(Math.random() * 80) + 10,
            startTime: new Date(Date.now() - Math.floor(Math.random() * 86400000)).toISOString(),
          }));

          return {
            status: 200,
            data: {
              code: HttpResponseCode.Success,
              content: instances,
              message: '获取服务实例成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Get instances failed:', error);
          return {
            status: 500,
            data: {
              code: HttpResponseCode.ServiceActionFaild,
              content: null,
              message: '获取服务实例失败',
              success: false,
            },
          };
        }
      },
    },
  };
};

export default topology;
