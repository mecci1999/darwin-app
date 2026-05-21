import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, Starlight } from 'typings';
import { NodeMetricsTransformer } from '../utils/node-metrics-transformer';

const DEFAULT_ADMIN_METRICS_SERVICES = [
  'gateway',
  'auth',
  'user',
  'file',
  'metrics',
  'logs',
  'subscription',
];

const normalizeServiceList = (value?: any) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    const list = value.map((item) => String(item).trim()).filter(Boolean);
    // If 'system' is present, treat it as "all system services"
    if (list.includes('system')) {
      return [];
    }
    return list;
  }
  if (typeof value === 'string') {
    if (value === 'system') return [];
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const normalizeArray = (value?: any) => {
  if (!value) return undefined;
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return undefined;
};

const admin = (star: Starlight) => {
  const getAdminMetricNodes = async (services?: any) => {
    // If services param is not provided, fetch all nodes
    if (!services) {
      return star.registry?.getNodeList({ onlyAvaiable: true, withServices: true }) || [];
    }

    const serviceList = normalizeServiceList(services);
    // Access registry from star instance
    const nodes = star.registry?.getNodeList({ onlyAvaiable: true, withServices: true }) || [];
    if (!serviceList.length) return nodes;
    return nodes.filter((node: any) => {
      const nodeServices = Array.isArray(node.services)
        ? node.services.map((item: any) => item?.name).filter(Boolean)
        : [];
      return nodeServices.some((name: string) => serviceList.includes(name));
    });
  };

  const fetchNodeMetrics = async (ctx: Context, node: any, params: any) => {
    const payload = {
      types: normalizeArray(params?.types),
      includes: normalizeArray(params?.includes),
      excludes: normalizeArray(params?.excludes),
    };

    const metrics = await ctx.call('$node.metrics', payload, { nodeID: node.id });
    return Array.isArray(metrics) ? metrics : [];
  };

  return {
    'v1.admin.snapshot': {
      metadata: {
        auth: true, // Only admin should access
      },
      params: {
        services: { type: 'any', optional: true },
        metrics: { type: 'any', optional: true },
        maxMetrics: { type: 'number', optional: true },
        maskSensitive: { type: 'boolean', optional: true, default: true },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          // Check admin permission
          const { user } = ctx.meta as any;
          // Allow if admin or explicitly flagged as admin request (e.g. from gateway)
          if (!user?.isAdmin && !(ctx.meta as any).adminMetrics) {
            return {
              status: 403,
              data: {
                code: HttpResponseCode.NoPermissionError,
                content: null,
                message: 'Admin permission required',
                success: false,
              },
            };
          }

          const params = ctx.params || {};

          const nodes = await getAdminMetricNodes(params.services);
          const metricsFilter = normalizeArray(params.metrics);

          star.logger?.info('Admin Snapshot: nodes found', nodes.length);
          if (nodes.length > 0) {
            const sampleNode = nodes[0] as any;
            star.logger?.info('First node info:', {
              id: sampleNode.id,
              hostname: sampleNode.hostname,
              ipList: sampleNode.ipList,
              services: Array.isArray(sampleNode.services)
                ? sampleNode.services.map((s: any) => s.name)
                : sampleNode.services,
            });
          }

          const snapshots = await Promise.all(
            nodes.map(async (node: any) => {
              try {
                let rawMetrics = await fetchNodeMetrics(ctx, node, params);
                star.logger?.info(
                  `Admin Snapshot: fetched ${rawMetrics?.length} metrics from node ${node.id}`,
                );

                if (metricsFilter?.length) {
                  rawMetrics = rawMetrics.filter((item: any) => metricsFilter.includes(item.name));
                }

                // Transform to standard format
                const extraTags = {
                  node_id: node.id,
                  hostname: node.hostname,
                  service: Array.isArray(node.services)
                    ? node.services
                        .map((item: any) => item?.name)
                        .filter(Boolean)
                        .join(',')
                    : '',
                };

                let metrics = NodeMetricsTransformer.transform(rawMetrics, extraTags);

                // Apply masking if needed
                const maskSensitive = params?.maskSensitive !== false;
                if (maskSensitive) {
                  metrics = metrics.map((m) => ({
                    ...m,
                    tags: NodeMetricsTransformer.maskLabels(m.tags, true),
                  }));
                }

                if (Number(params.maxMetrics) > 0) {
                  metrics = metrics.slice(0, Number(params.maxMetrics));
                }

                return {
                  nodeID: node.id,
                  hostname: node.hostname,
                  ipList: node.ipList,
                  services: Array.isArray(node.services)
                    ? node.services.map((item: any) => item?.name).filter(Boolean)
                    : [],
                  metrics,
                };
              } catch (error: any) {
                return {
                  nodeID: node.id,
                  hostname: node.hostname,
                  ipList: node.ipList,
                  services: Array.isArray(node.services)
                    ? node.services.map((item: any) => item?.name).filter(Boolean)
                    : [],
                  metrics: [],
                  error: error?.message || 'metrics_fetch_failed',
                };
              }
            }),
          );

          // Flatten all metrics from all nodes for totals calculation only
          const totalMetrics = snapshots.reduce(
            (sum: number, item: any) => sum + (item.metrics?.length || 0),
            0,
          );

          return {
            status: 200,
            data: {
              code: HttpResponseCode.Success,
              success: true,
              message: 'Snapshot retrieved successfully',
              content: {
                requestedAt: Date.now(),
                services: normalizeServiceList(params.services),
                metrics: [], // Deprecated: Returning empty array to avoid breaking changes if any
                nodes: snapshots, // Keep full node objects including metrics
                totals: {
                  nodes: snapshots.length,
                  metrics: totalMetrics,
                },
              },
            },
          };
        } catch (error) {
          star.logger?.error('Admin metrics snapshot failed:', error);
          return {
            status: 500,
            data: {
              code: HttpResponseCode.ServiceActionFaild,
              content: null,
              message: 'Internal server error',
              success: false,
            },
          };
        }
      },
    },
  };
};

export default admin;
