import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, Starlight } from 'typings';
import { InfluxDBHandler } from '../utils/influxdb-handler';
import {
  assertSystemScopeAllowed,
  filterServicesByScope,
  isDarwinSystemService,
  normalizeMetricsScope,
} from '../utils/system-telemetry';

const manualLayerCache = new Map<string, Record<string, number>>();

const getManualLayers = async (star: Starlight, userId: string | undefined) => {
  const key = `topology:manualLayer:${userId || 'system'}`;
  if (star.cacher?.get) {
    try {
      const cached = await star.cacher.get(key);
      if (cached) return cached as Record<string, number>;
    } catch (e) {}
  }
  return manualLayerCache.get(key) || {};
};

const setManualLayers = async (
  star: Starlight,
  userId: string | undefined,
  layers: Record<string, number>,
) => {
  const key = `topology:manualLayer:${userId || 'system'}`;
  manualLayerCache.set(key, layers);
  if (star.cacher?.set) {
    try {
      await star.cacher.set(key, layers);
    } catch (e) {}
  }
};

const topology = (star: Starlight) => ({
  // 获取服务拓扑图
  // 合并 v1.services 和 v1.instances 接口，减少 Action 数量
  'v1.topology': {
    metadata: {
      auth: true,
    },
    params: {
      type: {
        type: 'string',
        optional: true,
        default: 'graph',
        enum: ['graph', 'services', 'instances', 'manual'],
      },
      // graph params
      timeRange: { type: 'string', optional: true, default: '-1h' },
      // services params
      page: { type: 'number', optional: true, default: 1 },
      pageSize: { type: 'number', optional: true, default: 10 },
      status: { type: 'string', optional: true },
      keyword: { type: 'string', optional: true },
      // instances params
      serviceId: { type: 'string', optional: true },
      // manual layer params
      manualLayers: { type: 'object', optional: true },
      scope: { type: 'string', optional: true, default: 'tenant' },
    },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      try {
        const { type } = ctx.params;
        try {
          assertSystemScopeAllowed(ctx);
        } catch {
          return {
            status: 403,
            data: {
              code: HttpResponseCode.NoPermissionError,
              content: null,
              message: 'System metrics are admin only',
              success: false,
            },
          };
        }
        const scope = normalizeMetricsScope(ctx.params?.scope);

        star.logger?.info('metrics.topology.request', {
          type,
          timeRange: ctx.params?.timeRange,
          serviceId: ctx.params?.serviceId,
          userId: (ctx.meta as any)?.user?.userId,
          isAdmin: Boolean((ctx.meta as any)?.user?.isAdmin || (ctx.meta as any)?.adminMetrics),
          scope,
        });

        if (type === 'services') {
          const content = await (this as any).getServicesList({ ...(ctx.params || {}), scope });
          return {
            status: 200,
            data: {
              code: HttpResponseCode.Success,
              content,
              message: '获取服务列表成功',
              success: true,
            },
          };
        }
        if (type === 'instances') {
          const content = await (this as any).getInstancesList({ ...(ctx.params || {}), scope });
          return {
            status: 200,
            data: {
              code: HttpResponseCode.Success,
              content,
              message: '获取实例列表成功',
              success: true,
            },
          };
        }

        if (type === 'manual') {
          const manualLayers = (ctx.params?.manualLayers || {}) as Record<string, number>;
          const userId = (ctx.meta as any)?.user?.userId;
          await setManualLayers(star, userId, manualLayers);
          return {
            status: 200,
            data: {
              code: HttpResponseCode.Success,
              content: { manualLayers },
              message: '更新拓扑层级成功',
              success: true,
            },
          };
        }

        // Default: graph
        const { timeRange } = ctx.params;

        // 从 InfluxDB 获取真实拓扑数据
        const topologyData = await InfluxDBHandler.getTopologyData(star, timeRange);
        const isAdmin = Boolean(
          (ctx.meta as any)?.user?.isAdmin || (ctx.meta as any)?.adminMetrics,
        );
        const userId = (ctx.meta as any)?.user?.userId;
        const manualLayers = await getManualLayers(star, userId);
        const filteredNodes = (topologyData?.nodes || []).filter((node: any) => {
          const isSystemNode = isDarwinSystemService(node?.id) || isDarwinSystemService(node?.name);
          return scope === 'system' ? isSystemNode : !isSystemNode;
        });
        const allowedNodeIds = new Set(
          filteredNodes.map((node: any) => String(node.id || node.name)),
        );
        const filteredEdges = (topologyData?.edges || []).filter((edge: any) => {
          const from = String(edge?.from ?? edge?.source ?? '');
          const to = String(edge?.to ?? edge?.target ?? '');
          return allowedNodeIds.has(from) && allowedNodeIds.has(to);
        });

        star.logger?.info('metrics.topology.result', {
          nodes: filteredNodes.length,
          edges: filteredEdges.length,
          isAdmin,
          scope,
          timeRange,
        });

        if (filteredNodes.length === 0) {
          const registryNodes =
            star.registry?.getNodeList({
              onlyAvaiable: true,
              withServices: true,
            }) || [];
          const serviceMap = new Map<string, any>();
          registryNodes.forEach((node: any) => {
            const services = Array.isArray(node.services)
              ? node.services
                  .map((s: any) => s?.name)
                  .filter((name: string) => Boolean(name) && !String(name).startsWith('$'))
              : [];
            services.forEach((name: string) => {
              const isSystemNode = isDarwinSystemService(name);
              if ((scope === 'system' && !isSystemNode) || (scope === 'tenant' && isSystemNode)) {
                return;
              }
              if (!serviceMap.has(name)) {
                serviceMap.set(name, {
                  id: name,
                  name,
                  status: 'unknown',
                  type: undefined,
                  layer: undefined,
                  layerName: undefined,
                  app: name,
                  cluster: undefined,
                  env: undefined,
                  protocol: undefined,
                  manualLayer: manualLayers?.[name],
                });
              }
            });
          });
          const registryFallback = {
            nodes: Array.from(serviceMap.values()),
            edges: [],
          };
          if (registryFallback.nodes.length > 0) {
            star.logger?.info('metrics.topology.registryFallback', {
              nodes: registryFallback.nodes.length,
              edges: 0,
              isAdmin,
            });
            return {
              status: 200,
              data: {
                code: HttpResponseCode.Success,
                content: registryFallback,
                message: '获取服务拓扑成功 (Registry Fallback)',
                success: true,
              },
            };
          }
        }

        if (filteredNodes.length === 0 && process.env.NODE_ENV === 'development' && !isAdmin) {
          return {
            status: 200,
            data: {
              code: HttpResponseCode.Success,
              content: { nodes: [], edges: [] },
              message: '当前暂无可展示的服务拓扑数据',
              success: true,
            },
          };
        }

        if (manualLayers && filteredNodes.length) {
          topologyData.nodes = filteredNodes.map((node: any) => ({
            ...node,
            manualLayer: manualLayers?.[node.id],
          }));
          topologyData.edges = filteredEdges;
        } else {
          topologyData.nodes = filteredNodes;
          topologyData.edges = filteredEdges;
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
});

export default topology;
