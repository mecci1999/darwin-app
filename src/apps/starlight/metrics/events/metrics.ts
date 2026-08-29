/**
 * 指标数据相关事件处理器
 */
import { MetricsState } from '../types';
import {
  CANONICAL_SYSTEM_METRICS_EVENT,
  LEGACY_SYSTEM_METRICS_EVENTS,
  SYSTEM_APP_KEY_ID,
  SYSTEM_TENANT_ID,
  SYSTEM_VISIBILITY_SCOPE,
  buildSystemServiceId,
  resolveSystemServiceIdentity,
} from '../utils/system-telemetry';
import { enqueueMetricsBatch } from '../utils/processing-queue';

export const queueGatewayTopologyMetric = (ctx: any) => {
  const { metricsState } = ctx.service as { metricsState: MetricsState };
  const payload = ctx.params || {};
  const sourceService = String(payload.sourceService || 'gateway');
  const targetService = String(payload.targetService || '');
  const timestamp = payload.timestamp || Date.now();
  const requestUrl = String(payload.requestUrl || payload.url || payload.path || '').trim();
  const isStartPhase = payload.phase === 'start';

  if (!targetService || sourceService === targetService) {
    return;
  }

  const edgeKey = `${sourceService}=>${targetService}`;
  const observedEdges = metricsState.cache.topologyObservedEdges || new Map<string, any>();
  const existing = observedEdges.get(edgeKey) || {
    from: sourceService,
    to: targetService,
    protocol: 'http',
    callType: 'sync',
    count: 0,
    errors: 0,
    totalDurationMs: 0,
    source: 'gateway-routing',
  };
  if (!isStartPhase) {
    existing.count += 1;
    existing.errors += payload.status === 'error' ? 1 : 0;
    existing.totalDurationMs += Number(payload.durationMs || 0);
  }
  existing.lastSeenAt = timestamp;
  existing.action = payload.action;
  existing.qps = existing.count / 60;
  existing.errorRate = existing.count > 0 ? existing.errors / existing.count : 0;
  existing.p99 = existing.count > 0 ? Math.round(existing.totalDurationMs / existing.count) : 0;
  existing.successRate = Math.max(0, 1 - existing.errorRate);
  existing.status =
    existing.errorRate >= 0.05 || existing.p99 >= 1000
      ? 'critical'
      : existing.errorRate >= 0.01 || existing.p99 >= 500
        ? 'warning'
        : 'healthy';
  observedEdges.set(edgeKey, existing);
  metricsState.cache.topologyObservedEdges = observedEdges;

  if (isStartPhase) {
    return;
  }

  const baseTags = {
    tenantId: SYSTEM_TENANT_ID,
    appKeyId: SYSTEM_APP_KEY_ID,
    visibilityScope: SYSTEM_VISIBILITY_SCOPE,
    sourceType: 'darwin-system',
    source: 'gateway-routing',
    service: sourceService,
    serviceId: buildSystemServiceId(sourceService),
    source_service: sourceService,
    target_service: targetService,
    targetService,
    destination_service: targetService,
    peer_service: targetService,
    protocol: 'http',
    'rpc.system': 'http',
    env: 'prod',
    region: '华东-1',
    route: `${payload.version || 'v1'}.${payload.action || ''}`,
    action: String(payload.action || ''),
    url: requestUrl,
    path: requestUrl,
    method: String(payload.method || 'HTTP'),
    status: payload.status === 'error' ? '500' : '200',
  };

  const gatewayIngressTags = {
    ...baseTags,
    source: 'gateway-ingress',
    service: 'gateway',
    serviceId: buildSystemServiceId('gateway'),
    target_service: 'gateway',
    targetService: 'gateway',
    destination_service: 'gateway',
    peer_service: 'gateway',
    downstream_service: targetService,
  };

  const data = [
    {
      measurement: 'http_requests_total',
      tags: baseTags,
      fields: { value: 1, count: 1 },
      timestamp,
    },
    {
      measurement: 'http_request_duration_ms',
      tags: { ...baseTags, phase: 'finish', unit: 'ms' },
      fields: { value: Number(payload.durationMs || 0), duration: Number(payload.durationMs || 0) },
      timestamp,
    },
    {
      measurement: 'http_requests_total',
      tags: gatewayIngressTags,
      fields: { value: 1, count: 1 },
      timestamp,
    },
    {
      measurement: 'http_request_duration_ms',
      tags: { ...gatewayIngressTags, phase: 'finish', unit: 'ms' },
      fields: { value: Number(payload.durationMs || 0), duration: Number(payload.durationMs || 0) },
      timestamp,
    },
  ];

  enqueueMetricsBatch(metricsState, {
    id: `${SYSTEM_TENANT_ID}-gateway-topology-${targetService}-${timestamp}`,
    format: 'system',
    data,
    timestamp,
    retryCount: 0,
  });
};

const resolveServiceNameFromNodeId = (nodeID?: string) => {
  const normalized = String(nodeID || '').trim();
  if (!normalized) return 'unknown';
  const segments = normalized.split('-');
  if (segments.length <= 1) return normalized;
  return segments.slice(0, -1).join('-') || normalized;
};

const buildSystemMetricsPayload = (ctx: any) => {
  const payload = ctx.params || {};
  if (Array.isArray(payload)) {
    return {
      nodeID: ctx.nodeID || ctx.caller || 'unknown',
      metrics: payload,
      emittedAt: Date.now(),
    };
  }
  return {
    nodeID: payload.nodeID || payload.nodeId || ctx.nodeID || ctx.caller || 'unknown',
    metrics: Array.isArray(payload.metrics)
      ? payload.metrics
      : Array.isArray(payload.list)
        ? payload.list
        : [],
    emittedAt: payload.emittedAt || payload.timestamp || Date.now(),
  };
};

const queueSystemMetricsBatch = (ctx: any) => {
  const { metricsState } = ctx.service as { metricsState: MetricsState };
  const { nodeID, metrics, emittedAt } = buildSystemMetricsPayload(ctx);

  if (!Array.isArray(metrics) || metrics.length === 0) {
    return;
  }

  const serviceName = resolveServiceNameFromNodeId(nodeID);
  const identity = resolveSystemServiceIdentity(serviceName);

  const enrichedData = metrics.flatMap((metric: any) => {
    const values = Array.isArray(metric.values) ? metric.values : [];
    if (values.length === 0) return [];

    return values
      .map((entry: any) => {
        const entryValue =
          typeof entry?.value === 'number'
            ? entry.value
            : typeof entry?.lastValue === 'number'
              ? entry.lastValue
              : typeof entry?.count === 'number'
                ? entry.count
                : null;

        if (entryValue === null) return null;

        const fields: Record<string, number> = {
          value: entryValue,
        };
        if (typeof entry?.rate === 'number' && Number.isFinite(entry.rate)) {
          fields.rate = entry.rate;
        }

        return {
          measurement: metric.name,
          tags: {
            nodeID,
            nodeId: nodeID,
            type: metric.type,
            unit: metric.unit,
            tenantId: SYSTEM_TENANT_ID,
            appKeyId: SYSTEM_APP_KEY_ID,
            visibilityScope: SYSTEM_VISIBILITY_SCOPE,
            sourceType: 'darwin-system',
            source: 'darwin-system',
            service: identity.serviceName,
            serviceId: identity.serviceId,
            owner: identity.owner,
            team: identity.team,
            env: identity.env,
            region: identity.region,
            runtime: identity.runtime,
            tags: identity.tags.join(','),
            ...(entry?.labels || {}),
          },
          fields,
          timestamp: entry?.timestamp || emittedAt || Date.now(),
        };
      })
      .filter(Boolean);
  });

  if (enrichedData.length === 0) {
    return;
  }

  enqueueMetricsBatch(metricsState, {
    id: `${SYSTEM_TENANT_ID}-${identity.serviceId}-${emittedAt}`,
    format: 'system',
    data: enrichedData,
    timestamp: emittedAt || Date.now(),
    retryCount: 0,
  });

  ctx.service.logger.debug(`System metrics received from node: ${nodeID}`);
};

const createSystemMetricsHandler = (eventName: string) => ({
  async handler(ctx: any) {
    try {
      queueSystemMetricsBatch(ctx);
    } catch (error) {
      ctx.service.logger.error(`Failed to handle ${eventName} event:`, error);
    }
  },
});

const systemMetricsHandlers = Object.fromEntries(
  [CANONICAL_SYSTEM_METRICS_EVENT, ...LEGACY_SYSTEM_METRICS_EVENTS].map((eventName) => [
    eventName,
    createSystemMetricsHandler(eventName),
  ]),
);

export default {
  'metrics.topology.observed': {
    async handler(ctx: any) {
      try {
        queueGatewayTopologyMetric(ctx);
      } catch (error) {
        ctx.service.logger.error('Failed to handle metrics.topology.observed event:', error);
      }
    },
  },

  // 处理原始指标数据（支持多租户）
  'metrics.raw': {
    async handler(ctx: any) {
      try {
        const { tenantId, data } = ctx.params;
        const { metricsState } = ctx.service;

        const dataItems = Array.isArray(data) ? data : [data];
        const enrichedData = dataItems.filter(Boolean).map((item: any) => ({
          ...item,
          tenantId,
          timestamp: item?.timestamp || Date.now(),
          tags: {
            ...(item?.tags || {}),
            tenantId: item?.tags?.tenantId || tenantId,
          },
          serviceId: item?.serviceId || item?.tags?.serviceId || ctx.service.fullName,
        }));

        enqueueMetricsBatch(metricsState, {
          id: `${tenantId}-${Date.now()}`,
          format: Array.isArray(data) ? 'custom' : data.format || 'custom',
          data: enrichedData,
          timestamp: Date.now(),
          retryCount: 0,
        });

        ctx.service.logger.debug(`Raw metrics processed for tenant: ${tenantId}`);
      } catch (error) {
        ctx.service.logger.error('Failed to handle metrics.raw event:', error);
      }
    },
  },

  // 处理指标处理完成事件
  'metrics-processed': {
    async handler(ctx: any) {
      try {
        const { tenantId, batchId, count } = ctx.params;
        const { metricsState } = ctx.service;

        const tenantKey = `tenant:${tenantId}`;
        const currentStats = metricsState.cache.metrics.get(tenantKey) || { processed: 0 };
        currentStats.processed += count || 1;
        currentStats.lastProcessed = Date.now();
        metricsState.cache.metrics.set(tenantKey, currentStats);

        metricsState.stats.processed += count || 1;
        metricsState.stats.lastProcessed = Date.now();

        ctx.service.logger.debug(
          `Metrics batch processed for tenant: ${tenantId}, batch: ${batchId}`,
        );
      } catch (error) {
        ctx.service.logger.error('Failed to handle metrics.processed event:', error);
      }
    },
  },

  // 处理指标聚合事件
  'metrics.aggregate': {
    async handler(ctx: any) {
      try {
        const { tenantId, timeRange, aggregationType } = ctx.params;
        const { metricsState } = ctx.service;

        const aggregationKey = `agg:${tenantId}:${timeRange}:${aggregationType}`;
        const aggregationResult = {
          tenantId,
          timeRange,
          aggregationType,
          result: {},
          timestamp: Date.now(),
        };

        metricsState.cache.aggregations.set(aggregationKey, aggregationResult);

        ctx.service.logger.debug(
          `Metrics aggregated for tenant: ${tenantId}, type: ${aggregationType}`,
        );
      } catch (error) {
        ctx.service.logger.error('Failed to handle metrics.aggregate event:', error);
      }
    },
  },

  ...systemMetricsHandlers,
};
