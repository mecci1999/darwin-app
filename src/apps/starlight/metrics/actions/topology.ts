import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, Starlight } from 'typings';
import { InfluxDBHandler } from '../utils/influxdb-handler';
import { queueGatewayTopologyMetric } from '../events/metrics';
import {
  assertSystemScopeAllowed,
  buildSystemServiceId,
  isDarwinSystemService,
  normalizeMetricsScope,
} from '../utils/system-telemetry';

const manualLayerCache = new Map<string, Record<string, number>>();
const manualTopologyCache = new Map<string, { nodes: any[]; edges: any[] }>();

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

const getManualTopology = async (star: Starlight, userId: string | undefined) => {
  const key = `topology:manual:${userId || 'system'}`;
  if (star.cacher?.get) {
    try {
      const cached = await star.cacher.get(key);
      if (cached) return cached as { nodes: any[]; edges: any[] };
    } catch (e) {}
  }
  return manualTopologyCache.get(key) || { nodes: [], edges: [] };
};

const setManualTopology = async (
  star: Starlight,
  userId: string | undefined,
  topology: { nodes?: any[]; edges?: any[] },
) => {
  const key = `topology:manual:${userId || 'system'}`;
  const value = {
    nodes: Array.isArray(topology.nodes) ? topology.nodes : [],
    edges: Array.isArray(topology.edges) ? topology.edges : [],
  };
  manualTopologyCache.set(key, value);
  if (star.cacher?.set) {
    try {
      await star.cacher.set(key, value);
    } catch (e) {}
  }
  return value;
};

const mapCatalogHealthToTopologyStatus = (health?: string, status?: string) => {
  if (health === 'critical' || health === 'unhealthy' || status === 'error') return 'critical';
  if (health === 'degraded' || health === 'warning') return 'warning';
  if (health === 'healthy' || status === 'running') return 'healthy';
  if (status === 'stopped') return 'stopped';
  return 'unknown';
};

const normalizeServiceName = (value?: string | null) =>
  String(value || '')
    .replace(/^system:/, '')
    .trim()
    .toLowerCase();

const buildServiceNodeFromCatalog = (service: any, manualLayers?: Record<string, number>) => {
  const id = String(service?.id || service?.name || '');
  if (!id) return null;
  return {
    id,
    name: service?.name || id,
    status: mapCatalogHealthToTopologyStatus(service?.health, service?.status),
    type: service?.sourceType === 'darwin-system' ? 'system' : 'service',
    layer: undefined,
    layerName: service?.sourceType === 'darwin-system' ? 'system' : 'service',
    app: service?.team || service?.owner || service?.name || id,
    cluster: service?.region,
    env: service?.env,
    protocol: undefined,
    instances: service?.instances,
    qps: service?.qps,
    latency: service?.latency,
    errorRate: service?.errorRate,
    version: service?.version,
    source: 'service-catalog-fallback',
    manualLayer: manualLayers?.[id] || manualLayers?.[service?.name],
  };
};

const isGatewayObservedEdge = (edge: any) => {
  const from = normalizeServiceName(edge?.from ?? edge?.source);
  return from === 'gateway' && edge?.source === 'gateway-routing';
};

const getEdgeEndpoint = (edge: any, primaryKey: 'from' | 'to', fallbackKey: 'source' | 'target') =>
  String(edge?.[primaryKey] ?? edge?.[fallbackKey] ?? '').trim();

const resolveScopedNodeId = (value: string, nodeIdByServiceName: Map<string, string>) => {
  if (!value) return '';
  const normalized = normalizeServiceName(value);
  return nodeIdByServiceName.get(normalized) || value;
};

const normalizeEdgeForNodes = (edge: any, nodeIdByServiceName: Map<string, string>) => {
  const from = resolveScopedNodeId(getEdgeEndpoint(edge, 'from', 'source'), nodeIdByServiceName);
  const to = resolveScopedNodeId(getEdgeEndpoint(edge, 'to', 'target'), nodeIdByServiceName);
  return { ...edge, from, to };
};

const buildNodeIdAliases = (node: any) => {
  const aliases = new Set<string>();
  const id = String(node?.id || '').trim();
  const name = String(node?.name || '').trim();
  [id, name].forEach((value) => {
    if (!value) return;
    aliases.add(value);
    aliases.add(normalizeServiceName(value));
  });
  const normalizedName = normalizeServiceName(name || id);
  if (normalizedName && isDarwinSystemService(normalizedName)) {
    aliases.add(buildSystemServiceId(normalizedName));
  }
  return aliases;
};

const buildFilteredNodeLookup = (nodes: any[]) => {
  const nodeIds = new Set<string>();
  const nodeIdByServiceName = new Map<string, string>();
  nodes.forEach((node: any) => {
    const canonicalId = String(node?.id || node?.name || '').trim();
    if (!canonicalId) return;
    nodeIds.add(canonicalId);
    buildNodeIdAliases(node).forEach((alias) => {
      if (alias) nodeIdByServiceName.set(alias, canonicalId);
    });
  });
  return { nodeIds, nodeIdByServiceName };
};

const normalizeNodeForScope = (node: any, scope: 'tenant' | 'system') => {
  const normalizedName = normalizeServiceName(node?.name || node?.id);
  if (scope !== 'system' || !normalizedName || !isDarwinSystemService(normalizedName)) return node;
  return {
    ...node,
    id: buildSystemServiceId(normalizedName),
    name: node?.name || normalizedName,
    type: 'system',
    layerName: node?.layerName || 'system',
  };
};

const mergeTopologyNodesForScope = (nodes: any[], scope: 'tenant' | 'system') => {
  const byId = new Map<string, any>();
  nodes.forEach((node: any) => {
    const normalized = normalizeNodeForScope(node, scope);
    const id = String(normalized?.id || normalized?.name || '').trim();
    if (!id) return;
    const existing = byId.get(id) || {};
    byId.set(id, { ...normalized, ...existing, ...normalized });
  });
  return Array.from(byId.values());
};

const getEdgeWeight = (edge: any) => Number(edge?.count || 0) + Number(edge?.totalDurationMs || 0);

const isTopologySelfQueryEdge = (edge: any) =>
  normalizeServiceName(getEdgeEndpoint(edge, 'from', 'source')) === 'gateway' &&
  normalizeServiceName(getEdgeEndpoint(edge, 'to', 'target')) === 'metrics' &&
  String(edge?.action || '').trim() === 'topology';

const mergeTopologyEdges = (edges: any[]) => {
  const byPair = new Map<string, any>();
  edges.forEach((edge: any) => {
    const from = getEdgeEndpoint(edge, 'from', 'source');
    const to = getEdgeEndpoint(edge, 'to', 'target');
    if (!from || !to || isTopologySelfQueryEdge(edge)) return;
    const key = `${from}=>${to}`;
    const existing = byPair.get(key);
    if (!existing || getEdgeWeight(edge) >= getEdgeWeight(existing)) {
      byPair.set(key, edge);
    }
  });
  return Array.from(byPair.values()).map((edge) => normalizeTopologyEdgeMetrics(edge));
};

const buildGatewayNode = () => ({
  id: 'gateway',
  name: 'gateway',
  status: 'healthy',
  type: 'gateway',
  layer: 0,
  layerName: 'gateway',
  app: 'platform',
  cluster: '华东-1',
  env: 'prod',
  protocol: 'http',
  source: 'gateway-routing',
});

const normalizeManualNode = (node: any) => {
  const id = String(node?.id || node?.name || '').trim();
  if (!id) return null;
  return {
    id,
    name: String(node?.name || id),
    status: mapCatalogHealthToTopologyStatus(node?.health, node?.status) || 'unknown',
    type: node?.type || 'infrastructure',
    layer: typeof node?.layer === 'number' ? node.layer : 3,
    layerName: node?.layerName || 'infrastructure',
    app: node?.app || 'platform',
    cluster: node?.cluster || 'default',
    env: node?.env || 'prod',
    protocol: node?.protocol,
    source: 'manual-topology',
    editable: true,
  };
};

const normalizeManualEdge = (edge: any) => {
  const from = String(edge?.from ?? edge?.source ?? '').trim();
  const to = String(edge?.to ?? edge?.target ?? '').trim();
  if (!from || !to) return null;
  return {
    from,
    to,
    protocol: edge?.protocol || 'manual',
    callType: edge?.callType || 'sync',
    count: Number(edge?.count || 0),
    qps: Number(edge?.qps || 0),
    successRate: typeof edge?.successRate === 'number' ? edge.successRate : 1,
    errorRate: Number(edge?.errorRate || 0),
    p50: Number(edge?.p50 || 0),
    p99: Number(edge?.p99 || 0),
    status: edge?.status || 'unknown',
    source: 'manual-topology',
    editable: true,
  };
};

const mergeCatalogNodes = async (
  ctx: any,
  nodes: any[],
  scope: 'tenant' | 'system',
  manualLayers?: Record<string, number>,
) => {
  const byId = new Map<string, any>();
  nodes.forEach((node) => {
    const id = String(node?.id || node?.name || '');
    if (id) byId.set(id, node);
  });

  const servicesSnapshot = await ctx.getServicesList({ page: 1, pageSize: 500, scope });
  (servicesSnapshot?.services || []).forEach((service: any) => {
    const node = buildServiceNodeFromCatalog(service, manualLayers);
    if (!node) return;
    byId.set(node.id, { ...(byId.get(node.id) || {}), ...node });
  });

  return Array.from(byId.values());
};

const parseTimeRangeSeconds = (range: unknown) => {
  const value = String(range || '-1h').trim();
  const match = value.match(/-?(\d+)([smhdw])/);
  if (!match) return 3600;
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier =
    unit === 's'
      ? 1
      : unit === 'm'
        ? 60
        : unit === 'h'
          ? 3600
          : unit === 'd'
            ? 86400
            : 604800;
  return Math.max(1, amount * multiplier);
};

const roundMetric = (value: unknown, digits = 4) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return Number(numeric.toFixed(digits));
};

const normalizeTopologyEdgeMetrics = (edge: any) => ({
  ...edge,
  qps: roundMetric(edge?.qps, 4),
  errorRate: roundMetric(edge?.errorRate, 4),
  successRate: roundMetric(edge?.successRate, 4),
  p50: Math.round(Number(edge?.p50 || 0)),
  p99: Math.round(Number(edge?.p99 || 0)),
});

const applyEdgeWindowMetrics = (edge: any, windowSeconds: number) =>
  normalizeTopologyEdgeMetrics({
    ...edge,
    qps: Number(edge?.count || 0) / windowSeconds,
  });

const getObservedGatewayEdges = (ctx: any, windowSeconds = 600) => {
  const observedEdges = ctx?.metricsState?.cache?.topologyObservedEdges;
  if (!observedEdges || typeof observedEdges.values !== 'function') return [];
  const cutoff = Date.now() - 10 * 60 * 1000;
  return Array.from(observedEdges.values())
    .filter((edge: any) => Number(edge.lastSeenAt || 0) >= cutoff)
    .map((edge: any) => applyEdgeWindowMetrics(edge, windowSeconds));
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
        enum: ['graph', 'services', 'instances', 'manual', 'observed'],
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

        if (type === 'observed') {
          queueGatewayTopologyMetric(ctx);
          return {
            status: 200,
            data: {
              code: HttpResponseCode.Success,
              content: { accepted: true },
              message: '记录拓扑观测成功',
              success: true,
            },
          };
        }

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
          const userId = (ctx.meta as any)?.user?.userId;
          const hasManualLayersParam = Boolean(ctx.params && Object.prototype.hasOwnProperty.call(ctx.params, 'manualLayers'));
          const manualLayers = hasManualLayersParam
            ? ((ctx.params?.manualLayers || {}) as Record<string, number>)
            : await getManualLayers(star, userId);
          const manualNodes = Array.isArray((ctx.params as any)?.nodes)
            ? ((ctx.params as any).nodes.map(normalizeManualNode).filter(Boolean) as any[])
            : undefined;
          const manualEdges = Array.isArray((ctx.params as any)?.edges)
            ? ((ctx.params as any).edges.map(normalizeManualEdge).filter(Boolean) as any[])
            : undefined;
          if (hasManualLayersParam) await setManualLayers(star, userId, manualLayers);
          const manualTopology =
            manualNodes || manualEdges
              ? await setManualTopology(star, userId, { nodes: manualNodes || [], edges: manualEdges || [] })
              : await getManualTopology(star, userId);
          return {
            status: 200,
            data: {
              code: HttpResponseCode.Success,
              content: { manualLayers, ...manualTopology },
              message: '更新拓扑画布成功',
              success: true,
            },
          };
        }

        // Default: graph
        const { timeRange } = ctx.params;

        const timeRangeSeconds = parseTimeRangeSeconds(timeRange);

        // 从 InfluxDB 获取真实拓扑数据
        const topologyData = await InfluxDBHandler.getTopologyData(star, timeRange);
        const isAdmin = Boolean(
          (ctx.meta as any)?.user?.isAdmin || (ctx.meta as any)?.adminMetrics,
        );
        const userId = (ctx.meta as any)?.user?.userId;
        const manualLayers = await getManualLayers(star, userId);
        const manualTopology = await getManualTopology(star, userId);
        const observedGatewayEdges = getObservedGatewayEdges(this as any, timeRangeSeconds);
        const filteredEdgesRaw = [
          ...(topologyData?.edges || []),
          ...observedGatewayEdges,
          ...(manualTopology.edges || []),
        ];
        const tenantGatewayEdges =
          scope === 'tenant' ? filteredEdgesRaw.filter((edge: any) => isGatewayObservedEdge(edge)) : [];
        const tenantGatewayNodeIds = new Set<string>();
        tenantGatewayEdges.forEach((edge: any) => {
          const from = String(edge?.from ?? edge?.source ?? '');
          const to = String(edge?.to ?? edge?.target ?? '');
          if (from) tenantGatewayNodeIds.add(from);
          if (to) tenantGatewayNodeIds.add(to);
        });

        const candidateNodesRaw = await mergeCatalogNodes(
          this as any,
          [...(topologyData?.nodes || []), ...(manualTopology.nodes || [])],
          scope,
          manualLayers,
        );
        const candidateNodes = mergeTopologyNodesForScope(candidateNodesRaw, scope);

        const filteredNodes = candidateNodes.filter((node: any) => {
          const isSystemNode = isDarwinSystemService(node?.id) || isDarwinSystemService(node?.name);
          if (scope === 'tenant' && tenantGatewayNodeIds.has(String(node?.id || node?.name))) return true;
          return scope === 'system' ? isSystemNode : !isSystemNode;
        });
        if (scope === 'tenant' && tenantGatewayNodeIds.has('gateway')) {
          const hasGatewayNode = filteredNodes.some(
            (node: any) => normalizeServiceName(node?.id || node?.name) === 'gateway',
          );
          if (!hasGatewayNode) filteredNodes.push(buildGatewayNode());
        }
        const { nodeIds: allowedNodeIds, nodeIdByServiceName } = buildFilteredNodeLookup(filteredNodes);
        const filteredEdges = mergeTopologyEdges(
          filteredEdgesRaw
            .map((edge: any) => normalizeEdgeForNodes(edge, nodeIdByServiceName))
            .filter((edge: any) => {
              const from = getEdgeEndpoint(edge, 'from', 'source');
              const to = getEdgeEndpoint(edge, 'to', 'target');
              return allowedNodeIds.has(from) && allowedNodeIds.has(to);
            }),
        );

        star.logger?.info('metrics.topology.result', {
          nodes: filteredNodes.length,
          edges: filteredEdges.length,
          rawEdges: filteredEdgesRaw.length,
          observedGatewayEdges: observedGatewayEdges.length,
          isAdmin,
          scope,
          timeRange,
        });

        if (filteredNodes.length === 0) {
          const fallbackNodes = await mergeCatalogNodes(this as any, [], scope, manualLayers);
          const registryFallback = {
            nodes: fallbackNodes,
            edges: [],
            meta: {
              source: 'service-catalog-fallback',
              reason: 'No topology dependency telemetry rows matched queries; nodes were built from service catalog only.',
            },
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
