import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, Starlight } from 'typings';
import { InfluxDBHandler } from '../utils/influxdb-handler';
import {
  RESPONSE_DURATION_COMPLETED_REQUEST_FILTER,
  RESPONSE_DURATION_FIELD_FILTER,
  RESPONSE_DURATION_MEASUREMENT_FILTER,
  RESPONSE_DURATION_MS_NORMALIZATION_FLUX,
} from '../utils/duration-metrics';
import { normalizeRssMemoryValue } from '../utils/memory-units';
import { assertSystemScopeAllowed, normalizeMetricsScope } from '../utils/system-telemetry';
import { buildAlerts } from './alerts';

const toFixed = (value: number, digits = 2) => Number(value.toFixed(digits));
const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const buildSeries = (points: number, intervalMs: number, min: number, max: number) => {
  const data: { timestamp: number; value: number }[] = [];
  const now = Date.now();
  let current = randomBetween(min, max);
  const delta = (max - min) * 0.08;
  for (let i = points - 1; i >= 0; i -= 1) {
    current = clamp(current + randomBetween(-delta, delta), min, max);
    data.push({ timestamp: now - i * intervalMs, value: toFixed(current, 2) });
  }
  return data;
};

const parseRangeSeconds = (range: string) => {
  const value = range?.toString().trim() || '-1h';
  const match = value.match(/-?(\d+)([smhdw])/);
  if (!match) return 3600;
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier =
    unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : unit === 'd' ? 86400 : 604800;
  return amount * multiplier;
};

const formatInterval = (seconds: number) => {
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
};

const resolveInterval = (timeRange: string, buckets: number) => {
  const seconds = parseRangeSeconds(timeRange);
  const intervalSeconds = Math.max(60, Math.floor(seconds / buckets));
  return formatInterval(intervalSeconds);
};

const getIntervalSeconds = (every: string) => Math.max(1, parseRangeSeconds(every));

const createSystemScopeForbidden = (): HttpResponseItem => ({
  status: 403,
  data: {
    code: HttpResponseCode.NoPermissionError,
    content: null,
    message: 'System metrics are admin only',
    success: false,
  },
});

const normalizeServiceId = (serviceId?: string) =>
  serviceId?.startsWith('system:') ? serviceId.slice('system:'.length) : serviceId;

const escapeFluxRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildServiceFilter = (serviceId?: string) => {
  const normalized = normalizeServiceId(serviceId);
  if (!normalized) return '';
  const systemId = `system:${normalized}`;
  const nodePrefix = escapeFluxRegex(normalized);
  return `|> filter(fn: (r) => (exists r.target_service and r.target_service == "${normalized}") or (exists r.targetService and r.targetService == "${normalized}") or (exists r.destination_service and r.destination_service == "${normalized}") or (exists r.peer_service and r.peer_service == "${normalized}") or (exists r.service and r.service == "${normalized}") or (exists r.serviceId and (r.serviceId == "${normalized}" or r.serviceId == "${systemId}")) or (exists r["service.name"] and r["service.name"] == "${normalized}") or (exists r["service.id"] and (r["service.id"] == "${normalized}" or r["service.id"] == "${systemId}")) or (exists r.nodeID and string(v: r.nodeID) =~ /^${nodePrefix}/) or (exists r.nodeId and string(v: r.nodeId) =~ /^${nodePrefix}/))`;
};

const normalizeSeries = (rows: any[], normalizeValue: (value: unknown) => number = (value) => toFixed(Number(value || 0), 2)) =>
  rows
    .filter((row) => row?._time && row?._value !== undefined && row?._value !== null)
    .map((row) => ({
      timestamp: new Date(row._time).getTime(),
      value: normalizeValue(row._value),
    }))
    .sort((a, b) => a.timestamp - b.timestamp);

const getSeriesAverage = (series: Array<{ value: number }>) => {
  if (!series.length) return null;
  return toFixed(
    series.reduce((sum, point) => sum + Number(point.value || 0), 0) / series.length,
    2,
  );
};

const numberOrNull = (value: unknown, digits = 2) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return toFixed(value, digits);
};

const roundedNumberOrNull = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value);
};

const qpsNumberOrNull = (value: unknown) => numberOrNull(value, 2);

const buildSystemSeries = async (
  field: string,
  timeRange: string,
  every: string,
  serviceId: string | undefined,
  star: Starlight,
  normalizeValue?: (value: unknown) => number,
) => {
  const bucket = InfluxDBHandler.getBucketName();
  if (!bucket) return [];
  const filter = buildServiceFilter(serviceId);
  const measurementFilter =
    field === 'cpu_usage'
      ? 'r["_measurement"] == "os.cpu.utilization"'
      : field === 'memory_usage'
        ? 'r["_measurement"] == "process.memory.rss"'
        : 'r["_measurement"] == "system_metrics"';
  const fluxQuery = `
    from(bucket: "${bucket}")
      |> range(start: ${timeRange})
      |> filter(fn: (r) => ${measurementFilter})
      ${filter}
      |> filter(fn: (r) => r["_field"] == "${field}" or r["_field"] == "value")
      |> aggregateWindow(every: ${every}, fn: mean, createEmpty: false)
  `;
  const rows = await InfluxDBHandler.queryMetrics(fluxQuery, star);
  return normalizeSeries(rows, normalizeValue);
};

const buildDurationSeries = async (
  timeRange: string,
  every: string,
  serviceId: string | undefined,
  star: Starlight,
) => {
  const bucket = InfluxDBHandler.getBucketName();
  if (!bucket) return [];
  const filter = buildServiceFilter(serviceId);
  const fluxQuery = `
    from(bucket: "${bucket}")
      |> range(start: ${timeRange})
      |> filter(fn: (r) => ${RESPONSE_DURATION_MEASUREMENT_FILTER})
      ${filter}
      |> filter(fn: (r) => ${RESPONSE_DURATION_FIELD_FILTER})
      ${RESPONSE_DURATION_MS_NORMALIZATION_FLUX}
      ${RESPONSE_DURATION_COMPLETED_REQUEST_FILTER}
      |> aggregateWindow(every: ${every}, fn: mean, createEmpty: false)
  `;
  const rows = await InfluxDBHandler.queryMetrics(fluxQuery, star);
  return normalizeSeries(rows);
};

const buildRequestCountSeries = async (
  timeRange: string,
  every: string,
  serviceId: string | undefined,
  star: Starlight,
) => {
  const bucket = InfluxDBHandler.getBucketName();
  if (!bucket) return [];
  const filter = buildServiceFilter(serviceId);
  const fluxQuery = `
    from(bucket: "${bucket}")
      |> range(start: ${timeRange})
      |> filter(fn: (r) => r["_measurement"] == "universe.request.total" or r["_measurement"] == "http_requests_total" or r["_measurement"] == "rpc_requests_total" or r["_measurement"] == "messaging_requests_total")
      ${filter}
      |> filter(fn: (r) => r["_field"] == "value" or r["_field"] == "count" or r["_field"] == "total")
      |> aggregateWindow(every: ${every}, fn: sum, createEmpty: false)
  `;
  const rows = await InfluxDBHandler.queryMetrics(fluxQuery, star);
  return normalizeSeries(rows);
};

const buildErrorCountSeries = async (
  timeRange: string,
  every: string,
  serviceId: string | undefined,
  star: Starlight,
) => {
  const bucket = InfluxDBHandler.getBucketName();
  if (!bucket) return [];
  const filter = buildServiceFilter(serviceId);
  const fluxQuery = `
    from(bucket: "${bucket}")
      |> range(start: ${timeRange})
      |> filter(fn: (r) => r["_measurement"] == "universe.request.error.total" or r["_measurement"] == "http_requests_total" or r["_measurement"] == "rpc_requests_total" or r["_measurement"] == "messaging_requests_total")
      ${filter}
      |> filter(fn: (r) => r["_measurement"] == "universe.request.error.total" or (exists r.status and string(v: r.status) =~ /5../) or (exists r.status_code and string(v: r.status_code) =~ /5../) or (exists r.http_status_code and string(v: r.http_status_code) =~ /5../) or (exists r.code and string(v: r.code) =~ /5../))
      |> filter(fn: (r) => r["_field"] == "value" or r["_field"] == "count" or r["_field"] == "total")
      |> aggregateWindow(every: ${every}, fn: sum, createEmpty: false)
  `;
  const rows = await InfluxDBHandler.queryMetrics(fluxQuery, star);
  return normalizeSeries(rows);
};

const buildQpsSeries = async (
  timeRange: string,
  every: string,
  serviceId: string | undefined,
  star: Starlight,
) => {
  const bucket = InfluxDBHandler.getBucketName();
  if (!bucket) return [];
  const filter = buildServiceFilter(serviceId);
  const fluxQuery = `
    from(bucket: "${bucket}")
      |> range(start: ${timeRange})
      |> filter(fn: (r) => r["_measurement"] == "http_requests_total" or r["_measurement"] == "rpc_requests_total" or r["_measurement"] == "messaging_requests_total")
      ${filter}
      |> filter(fn: (r) => r["_field"] == "value" or r["_field"] == "count" or r["_field"] == "total")
      |> aggregateWindow(every: ${every}, fn: sum, createEmpty: false)
  `;
  const rows = await InfluxDBHandler.queryMetrics(fluxQuery, star);
  const intervalSeconds = getIntervalSeconds(every);
  return rows
    .filter((row) => row?._time && row?._value !== undefined && row?._value !== null)
    .map((row) => ({
      timestamp: new Date(row._time).getTime(),
      value: toFixed(Number(row._value || 0) / intervalSeconds, 2),
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
};

const buildActiveRequestSeries = async (
  timeRange: string,
  every: string,
  serviceId: string | undefined,
  star: Starlight,
) => {
  const bucket = InfluxDBHandler.getBucketName();
  if (!bucket) return [];
  const filter = buildServiceFilter(serviceId);
  const fluxQuery = `
    from(bucket: "${bucket}")
      |> range(start: ${timeRange})
      |> filter(fn: (r) => r["_measurement"] == "universe.request.active")
      ${filter}
      |> filter(fn: (r) => r["_field"] == "value")
      |> aggregateWindow(every: ${every}, fn: mean, createEmpty: false)
  `;
  const rows = await InfluxDBHandler.queryMetrics(fluxQuery, star);
  return normalizeSeries(rows);
};

const getAvgResponseTime = async (timeRange: string, star: Starlight) => {
  const bucket = InfluxDBHandler.getBucketName();
  if (!bucket) return 0;
  const fluxQuery = `
    from(bucket: "${bucket}")
      |> range(start: ${timeRange})
      |> filter(fn: (r) => ${RESPONSE_DURATION_MEASUREMENT_FILTER})
      |> filter(fn: (r) => ${RESPONSE_DURATION_FIELD_FILTER})
      ${RESPONSE_DURATION_MS_NORMALIZATION_FLUX}
      ${RESPONSE_DURATION_COMPLETED_REQUEST_FILTER}
      |> mean()
  `;
  const rows = await InfluxDBHandler.queryMetrics(fluxQuery, star);
  return Math.round(Number(rows[0]?._value || 0));
};

const buildRequestStats = async (timeRange: string, star: Starlight) => {
  const bucket = InfluxDBHandler.getBucketName();
  if (!bucket) return [];
  const fluxQuery = `
    from(bucket: "${bucket}")
      |> range(start: ${timeRange})
      |> filter(fn: (r) => r["_measurement"] == "universe.request.total" or r["_measurement"] == "http_requests_total" or r["_measurement"] == "rpc_requests_total" or r["_measurement"] == "messaging_requests_total")
      |> filter(fn: (r) => r["_field"] == "value" or r["_field"] == "count" or r["_field"] == "total")
      |> aggregateWindow(every: 1d, fn: sum, createEmpty: false)
  `;
  const rows = await InfluxDBHandler.queryMetrics(fluxQuery, star);
  const map = new Map<string, number>();
  rows.forEach((row: any) => {
    if (!row?._time) return;
    const date = new Date(row._time);
    const label = `${date.getMonth() + 1}/${date.getDate()}`;
    const value = Number(row._value || 0);
    map.set(label, (map.get(label) || 0) + value);
  });
  return Array.from(map.entries()).map(([name, value]) => ({
    name,
    value: Math.round(value),
  }));
};

const buildOverviewSummaryContent = async (
  timeRange: string,
  star: Starlight,
  serviceContext: any,
  scope: 'tenant' | 'system',
) => {
  const servicesResult = await serviceContext.getServicesList({ page: 1, pageSize: 100, scope });
  const services = Array.isArray(servicesResult?.services) ? servicesResult.services : [];
  const alerts = await buildAlerts(serviceContext, { scope, timeRange });
  const activeIncidentMap = new Map<string, number>();
  alerts
    .filter((alert: any) => alert.status === 'active')
    .forEach((alert: any) => {
      const serviceKey = String(alert.serviceId || '');
      if (!serviceKey) return;
      activeIncidentMap.set(serviceKey, (activeIncidentMap.get(serviceKey) || 0) + 1);
    });
  const requestStats = scope === 'system' ? await buildRequestStats(timeRange, star) : [];
  const totalRequests = requestStats.reduce((sum, item) => sum + item.value, 0);

  const errorRateSource = services.filter((item: any) => typeof item.errorRate === 'number');
  const latencySource = services.filter((item: any) => typeof item.latency === 'number');
  const topRiskServices = [...services]
    .sort((a: any, b: any) => {
      const aScore =
        (a.status === 'error' ? 100 : 0) +
        Number(a.errorRate || 0) * 100 +
        Number(a.latency || 0) / 10;
      const bScore =
        (b.status === 'error' ? 100 : 0) +
        Number(b.errorRate || 0) * 100 +
        Number(b.latency || 0) / 10;
      return bScore - aScore;
    })
    .filter(
      (service: any) =>
        service.status === 'error' ||
        Number(service.errorRate || 0) > 0 ||
        Number(service.latency || 0) > 0,
    )
    .slice(0, 6)
    .map((service: any) => ({
      serviceId: service.id,
      service: service.name,
      healthStatus: service.health,
      errorRate: Number(service.errorRate || 0),
      p95Latency: Number(service.latency || 0),
      activeIncidentCount: activeIncidentMap.get(service.id) || 0,
    }));

  return {
    totals: {
      serviceCount: servicesResult?.total || services.length,
      healthyServiceCount: services.filter((item: any) => item.health === 'healthy').length,
      activeIncidents: alerts.filter((alert: any) => alert.status === 'active').length,
      totalQps: Math.round(
        services.reduce((sum: number, item: any) => sum + Number(item.qps || 0), 0),
      ),
      errorRate: errorRateSource.length
        ? toFixed(
            errorRateSource.reduce(
              (sum: number, item: any) => sum + Number(item.errorRate || 0),
              0,
            ) / errorRateSource.length,
            2,
          )
        : 0,
      p95Latency: latencySource.length
        ? Math.max(...latencySource.map((item: any) => Number(item.latency || 0)))
        : 0,
      ingestSuccessRate: 0,
      quotaBurnRate: 0,
      totalRequests,
    },
    topRiskServices,
  };
};

const buildOverviewRiskServicesContent = async (
  serviceContext: any,
  scope: 'tenant' | 'system',
) => {
  const firstPage = await serviceContext.getServicesList({ page: 1, pageSize: 1, scope });
  const total = Number(firstPage?.total || 0);
  const fullResult = await serviceContext.getServicesList({
    page: 1,
    pageSize: Math.max(total, 1),
    scope,
  });
  const services = Array.isArray(fullResult?.services) ? fullResult.services : [];

  const ranked = [...services].sort((a: any, b: any) => {
    const aScore =
      (a.status === 'error' ? 100 : 0) +
      Number(a.errorRate || 0) * 100 +
      Number(a.latency || 0) / 10;
    const bScore =
      (b.status === 'error' ? 100 : 0) +
      Number(b.errorRate || 0) * 100 +
      Number(b.latency || 0) / 10;
    return bScore - aScore;
  });

  const averageLatency = services.length
    ? services.reduce((sum: number, service: any) => sum + Number(service.latency || 0), 0) /
      services.length
    : 0;
  const alerts = await buildAlerts(serviceContext, { scope });
  const activeIncidentMap = new Map<string, number>();
  alerts
    .filter((alert: any) => alert.status === 'active')
    .forEach((alert: any) => {
      const serviceKey = String(alert.serviceId || '');
      if (!serviceKey) return;
      activeIncidentMap.set(serviceKey, (activeIncidentMap.get(serviceKey) || 0) + 1);
    });

  const toItem = (service: any) => ({
    serviceId: service.id,
    service: service.name,
    healthStatus: service.health,
    errorRate: Number(service.errorRate || 0),
    p95Latency: Number(service.latency || 0),
    latencyDelta: toFixed(Number(service.latency || 0) - averageLatency, 1),
    activeIncidentCount: activeIncidentMap.get(service.id) || 0,
    lastAbnormalAt: service.lastUpdate || service.lastDeploy || null,
  });

  return {
    highRiskServices: ranked
      .filter(
        (service: any) =>
          service.status === 'error' ||
          Number(service.errorRate || 0) > 0 ||
          Number(service.latency || 0) > 0,
      )
      .slice(0, 6)
      .map(toItem),
    recentDegradedServices: [...services]
      .filter((service: any) => service.health === 'degraded')
      .sort((a: any, b: any) => {
        const aTime = a.lastUpdate || a.lastDeploy || '';
        const bTime = b.lastUpdate || b.lastDeploy || '';
        return String(bTime).localeCompare(String(aTime));
      })
      .slice(0, 6)
      .map(toItem),
  };
};

const buildServiceDetailContent = async (
  serviceId: string,
  timeRange: string,
  star: Starlight,
  serviceContext: any,
  scope: 'tenant' | 'system',
) => {
  const interval = resolveInterval(timeRange || '-1h', 12);
  const [
    servicesResult,
    instances,
    alerts,
    cpuSeries,
    memorySeries,
    qpsSeries,
    durationSeries,
    activeRequestSeries,
  ] = await Promise.all([
    serviceContext.getServicesList({ page: 1, pageSize: 200, scope }),
    serviceContext.getInstancesList({ serviceId, scope }),
    buildAlerts(serviceContext, { scope, serviceId }),
    buildSystemSeries('cpu_usage', timeRange || '-1h', interval, serviceId, star),
    buildSystemSeries('memory_usage', timeRange || '-1h', interval, serviceId, star, normalizeRssMemoryValue),
    buildQpsSeries(timeRange || '-1h', interval, serviceId, star),
    buildDurationSeries(timeRange || '-1h', interval, serviceId, star),
    buildActiveRequestSeries(timeRange || '-1h', interval, serviceId, star),
  ]);

  const services = Array.isArray(servicesResult?.services) ? servicesResult.services : [];
  const service = services.find((item: any) => item.id === serviceId);
  if (!service) {
    return null;
  }

  const cpuAverage = getSeriesAverage(cpuSeries as any);
  const memoryAverage = getSeriesAverage(memorySeries as any);
  const qpsAverage = getSeriesAverage(qpsSeries as any);
  const durationAverage = getSeriesAverage(durationSeries as any);
  const activeAverage = getSeriesAverage(activeRequestSeries as any);
  const activeIncidentCount = Array.isArray(alerts)
    ? alerts.filter((alert: any) => alert.status === 'active').length
    : 0;

  return {
    identity: {
      id: service.id,
      name: service.name,
      displayName: service.name,
      owner: service.owner || '',
      region: service.region || '',
      runtime: service.version || '',
      tags: service.tags || [],
      healthStatus: service.health,
    },
    summary: {
      instances: Array.isArray(instances) ? instances.length : Number(service.instances || 0),
      qps: qpsAverage ?? numberOrNull(service.qps, 4),
      responseTime:
        durationAverage !== null || typeof service.latency === 'number'
          ? Math.round(Number(durationAverage ?? service.latency))
          : null,
      p95Latency: typeof service.latency === 'number' ? Math.round(Number(service.latency)) : null,
      errorRate: numberOrNull(service.errorRate, 2),
      activeIncidentCount,
      cpu: cpuAverage,
      memory: memoryAverage,
      activeConnections: activeAverage === null ? null : Math.round(Number(activeAverage)),
      version: service.version || '',
    },
  };
};

const buildCatalogServicesContent = async (
  params: any,
  serviceContext: any,
  scope: 'tenant' | 'system',
) => {
  serviceContext.logger?.info?.('metrics.catalog.services:build:start', {
    nodeID: serviceContext.star?.nodeID,
    scope,
    params,
  });

  const servicesResult = await serviceContext.getServicesList({
    page: Number(params?.page || 1),
    pageSize: Number(params?.pageSize || 20),
    status: params?.status,
    keyword: params?.keyword,
    scope,
  });
  const services = Array.isArray(servicesResult?.services) ? servicesResult.services : [];
  const alerts = await buildAlerts(serviceContext, { scope, keyword: params?.keyword });
  const activeIncidentMap = new Map<string, number>();
  alerts
    .filter((alert: any) => alert.status === 'active')
    .forEach((alert: any) => {
      const serviceKey = String(alert.serviceId || '');
      if (!serviceKey) return;
      activeIncidentMap.set(serviceKey, (activeIncidentMap.get(serviceKey) || 0) + 1);
    });

  serviceContext.logger?.info?.('metrics.catalog.services:build:services-result', {
    nodeID: serviceContext.star?.nodeID,
    scope,
    total: servicesResult?.total,
    page: servicesResult?.page,
    items: services.slice(0, 8).map((service: any) => ({
      id: service.id,
      name: service.name,
      qps: service.qps,
      p95Latency: service.latency,
      errorRate: service.errorRate,
      activeIncidentCount: activeIncidentMap.get(service.id) || 0,
    })),
  });

  const items = services.map((service: any) => ({
      identity: {
        id: service.id,
        name: service.name,
        displayName: service.name,
        owner: service.owner || '',
        team: service.team || '',
        env: service.env || '',
        region: service.region || '',
        runtime: service.version || '',
        tags: service.tags || [],
        healthStatus: service.health,
      },
      instanceCount: Number(service.instances || 0),
      qps: qpsNumberOrNull(service.qps),
      errorRate: numberOrNull(service.errorRate, 2),
      p95Latency: roundedNumberOrNull(service.latency),
      activeIncidentCount: activeIncidentMap.get(service.id) || 0,
      metricStatus: service.metricStatus,
      runtimeMetrics: service.runtimeMetrics,
      lastDeployAt: service.lastDeploy || null,
    }));

  serviceContext.logger?.info?.('metrics.catalog.services:response-items', {
    scope,
    items: items.slice(0, 8).map((item: any) => ({
      id: item.identity?.id,
      name: item.identity?.name,
      qps: item.qps,
      p95Latency: item.p95Latency,
      errorRate: item.errorRate,
      activeIncidentCount: item.activeIncidentCount,
    })),
  });

  return {
    items,
    pagination: {
      page: Number(servicesResult?.page || params?.page || 1),
      pageSize: Number(params?.pageSize || 20),
      total: Number(servicesResult?.total || services.length),
    },
  };
};

const buildCatalogServiceDetailContent = async (
  serviceId: string,
  serviceContext: any,
  scope: 'tenant' | 'system',
) => {
  const servicesResult = await serviceContext.getServicesList({ page: 1, pageSize: 200, scope });
  const services = Array.isArray(servicesResult?.services) ? servicesResult.services : [];
  const service = services.find((item: any) => item.id === serviceId);
  if (!service) {
    return null;
  }

  const alerts = await buildAlerts(serviceContext, { scope, serviceId });

  return {
    identity: {
      id: service.id,
      name: service.name,
      displayName: service.name,
      owner: service.owner || '',
      region: service.region || '',
      runtime: service.version || '',
      tags: service.tags || [],
      healthStatus: service.health,
    },
    deployment: {
      lastDeployAt: service.lastDeploy || null,
      version: service.version || '',
    },
    metadata: {
      description: `${service.name} service`,
      language: 'node',
      repoUrl: '',
      runbookUrl: '',
    },
  };
};

const buildCatalogServicesSummaryContent = async (
  serviceContext: any,
  scope: 'tenant' | 'system',
) => {
  const firstPage = await serviceContext.getServicesList({ page: 1, pageSize: 1, scope });
  const total = Number(firstPage?.total || 0);
  const servicesResult = await serviceContext.getServicesList({
    page: 1,
    pageSize: Math.max(total, 1),
    scope,
  });
  const services = Array.isArray(servicesResult?.services) ? servicesResult.services : [];

  const toCatalogHealth = (service: any) => {
    if (service.health === 'healthy') return 'healthy';
    if (service.health === 'muted') return 'muted';
    if (service.health === 'critical' || service.status === 'error') return 'critical';
    if (
      service.health === 'degraded' ||
      service.health === 'warning' ||
      service.health === 'unhealthy'
    )
      return 'degraded';
    return 'unknown';
  };

  return {
    total,
    healthy: services.filter((service: any) => toCatalogHealth(service) === 'healthy').length,
    degraded: services.filter((service: any) => toCatalogHealth(service) === 'degraded').length,
    critical: services.filter((service: any) => toCatalogHealth(service) === 'critical').length,
    muted: services.filter((service: any) => toCatalogHealth(service) === 'muted').length,
  };
};

const buildCatalogServiceQuickViewContent = async (
  serviceId: string,
  serviceContext: any,
  scope: 'tenant' | 'system',
) => {
  const servicesResult = await serviceContext.getServicesList({ page: 1, pageSize: 200, scope });
  const services = Array.isArray(servicesResult?.services) ? servicesResult.services : [];
  const service = services.find((item: any) => item.id === serviceId);
  if (!service) {
    return null;
  }

  const alerts = await buildAlerts(serviceContext, { scope, serviceId });

  return {
    identity: {
      id: service.id,
      name: service.name,
      displayName: service.name,
      owner: service.owner || '',
      region: service.region || '',
      runtime: service.version || '',
      tags: service.tags || [],
      healthStatus: service.health,
    },
    redSummary: {
      qps: qpsNumberOrNull(service.qps),
      errorRate: numberOrNull(service.errorRate, 2),
      p95Latency: roundedNumberOrNull(service.latency),
    },
    metricStatus: service.metricStatus,
    runtimeMetrics: service.runtimeMetrics,
    activeIncidentCount: alerts.filter((alert: any) => alert.status === 'active').length,
    instanceCount: Number(service.instances || 0),
  };
};

const buildOverviewTrendsContent = async (
  timeRange: string,
  star: Starlight,
  scope: 'tenant' | 'system',
) => {
  if (scope !== 'system') {
    return {
      requests: [],
      errors: [],
      latency: [],
    };
  }
  const interval = resolveInterval(timeRange || '-24h', 24);
  const [requests, errors, latency] = await Promise.all([
    buildRequestCountSeries(timeRange || '-24h', interval, undefined, star),
    buildErrorCountSeries(timeRange || '-24h', interval, undefined, star),
    buildDurationSeries(timeRange || '-24h', interval, undefined, star),
  ]);

  return {
    requests,
    errors,
    latency,
  };
};

const buildOverviewIngestStatusContent = async (
  serviceContext: any,
  scope: 'tenant' | 'system',
) => {
  const servicesResult = await serviceContext.getServicesList({ page: 1, pageSize: 1, scope });
  const total = Number(servicesResult?.total || 0);
  const fullResult = await serviceContext.getServicesList({
    page: 1,
    pageSize: Math.max(total, 1),
    scope,
  });
  const services = Array.isArray(fullResult?.services) ? fullResult.services : [];

  const metricsOk = services.some(
    (service: any) => Number(service.instances || 0) > 0 || service.status === 'running',
  );
  const logsService = services.find((service: any) => String(service.name) === 'logs');
  const logsOk = Boolean(
    logsService && (Number(logsService.instances || 0) > 0 || logsService.status === 'running'),
  );
  const tracesOk = logsOk;

  return {
    metrics: { status: metricsOk ? 'healthy' : 'warning', value: metricsOk ? 1 : 0, unit: 'ok' },
    logs: { status: logsOk ? 'healthy' : 'warning', value: logsOk ? 1 : 0, unit: 'ok' },
    traces: { status: tracesOk ? 'healthy' : 'warning', value: tracesOk ? 1 : 0, unit: 'ok' },
    dropped: 0,
    delayed: 0,
    failed: Number(!metricsOk) + Number(!logsOk) + Number(!tracesOk),
  };
};

const buildOverviewIncidentsContent = async (
  timeRange: string,
  star: Starlight,
  serviceContext: any,
  scope: 'tenant' | 'system',
) => {
  const alerts = await buildAlerts(serviceContext, { scope, timeRange });
  return alerts.filter((alert: any) => alert.status === 'active');
};

const buildServiceRuntimeContent = async (
  serviceId: string,
  serviceContext: any,
  scope: 'tenant' | 'system',
) => {
  const [servicesResult, instances] = await Promise.all([
    serviceContext.getServicesList({ page: 1, pageSize: 200, scope }),
    serviceContext.getInstancesList({ serviceId, scope }),
  ]);

  const services = Array.isArray(servicesResult?.services) ? servicesResult.services : [];
  const service = services.find((item: any) => item.id === serviceId);
  if (!service) return null;

  const logsService = services.find((item: any) => String(item.name) === 'logs');
  const logsAvailable = Boolean(
    logsService && (Number(logsService.instances || 0) > 0 || logsService.status === 'running'),
  );

  return {
    instances: Array.isArray(instances) ? instances : [],
    appKey: service.id,
    env: service.env || '',
    region: service.region || '',
    ingestStatus: {
      metrics: Array.isArray(instances) ? instances.length > 0 : Number(service.instances || 0) > 0,
      logs: logsAvailable,
      traces: logsAvailable,
    },
  };
};

const buildMetricsExplorerContent = async (
  ctx: Context,
  star: Starlight,
  serviceContext: any,
  scope: 'tenant' | 'system',
) => {
  const servicesResult = await serviceContext.getServicesList({ page: 1, pageSize: 50, scope });
  const services = Array.isArray(servicesResult?.services) ? servicesResult.services : [];
  const timeRange = ctx.params?.timeRange || '-6h';
  if (scope !== 'system') {
    return {
      series: { cpu: [], memory: [], qps: [], responseTime: [] },
      requestStats: [],
      services: services.slice(0, 8).map((item: any) => ({ id: item.id, name: item.name })),
    };
  }
  const interval = resolveInterval(timeRange, 12);
  const selected = ctx.params?.serviceId;
  const candidates = selected
    ? services.filter((item: any) => item.id === selected)
    : services.slice(0, 3);
  const fallback = candidates;
  const colors = ['#3b82f6', '#22c55e', '#f97316', '#a855f7'];

  if (fallback.length === 0) {
    return {
      series: {
        cpu: [],
        memory: [],
        qps: [],
        responseTime: [],
      },
      requestStats: [],
      services: services.slice(0, 8).map((item: any) => ({ id: item.id, name: item.name })),
    };
  }

  const buildSeriesGroup = async (
    builder: (serviceId: string | undefined) => Promise<{ timestamp: number; value: number }[]>,
  ) =>
    Promise.all(
      fallback.map(async (service: any, index: number) => ({
        name: service.name,
        color: colors[index % colors.length],
        data: await builder(service.id),
      })),
    );

  const [cpuSeries, memorySeries, qpsSeries, responseSeries, requestStats] = await Promise.all([
    buildSeriesGroup((serviceId) =>
      buildSystemSeries('cpu_usage', timeRange, interval, serviceId, star),
    ),
    buildSeriesGroup((serviceId) =>
      buildSystemSeries('memory_usage', timeRange, interval, serviceId, star, normalizeRssMemoryValue),
    ),
    buildSeriesGroup((serviceId) => buildQpsSeries(timeRange, interval, serviceId, star)),
    buildSeriesGroup((serviceId) => buildDurationSeries(timeRange, interval, serviceId, star)),
    buildRequestStats(timeRange, star),
  ]);

  return {
    series: {
      cpu: cpuSeries,
      memory: memorySeries,
      qps: qpsSeries,
      responseTime: responseSeries,
    },
    requestStats,
    services: services.slice(0, 8).map((item: any) => ({ id: item.id, name: item.name })),
  };
};

const realtime = (star: Starlight) => ({
  'v1.dashboard': {
    metadata: {
      auth: true,
    },
    params: {
      timeRange: { type: 'string', optional: true, default: '-24h' },
    },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      try {
        const servicesResult = await (this as any).getServicesList({ page: 1, pageSize: 100 });
        const services = Array.isArray(servicesResult?.services) ? servicesResult.services : [];
        const timeRange = ctx.params?.timeRange || '-24h';
        const interval = resolveInterval(timeRange, 12);
        const [requestStats, cpuTrend, memoryTrend, avgResponseTime, incidents] = await Promise.all(
          [
            buildRequestStats(timeRange, star),
            buildSystemSeries('cpu_usage', timeRange, interval, undefined, star),
            buildSystemSeries('memory_usage', timeRange, interval, undefined, star, normalizeRssMemoryValue),
            getAvgResponseTime(timeRange, star),
            buildOverviewIncidentsContent(timeRange, star, this as any, 'tenant'),
          ],
        );
        const totalRequests = requestStats.reduce((sum, item) => sum + item.value, 0);

        const serviceStatus = services.slice(0, 6).map((service: any) => ({
          id: service.id,
          name: service.name,
          status: service.status,
          health: service.health,
          instances: service.instances,
          qps: Math.round(Number(service.qps || 0)),
          latency: Math.round(Number(service.latency || 0)),
          errorRate: toFixed(Number(service.errorRate || 0), 2),
        }));

        const trafficDistribution = [...services]
          .sort((a: any, b: any) => Number(b.qps || 0) - Number(a.qps || 0))
          .slice(0, 6)
          .map((service: any) => ({
            name: service.name,
            value: Math.round(Number(service.qps || 0)),
          }))
          .filter((item) => item.value > 0);

        return {
          status: 200,
          data: {
            code: HttpResponseCode.Success,
            content: {
              summary: {
                totalServices: servicesResult?.total || services.length,
                totalRequests,
                activeAlerts: incidents.length,
                avgResponseTime,
              },
              cpuTrend,
              memoryTrend,
              requestStats,
              trafficDistribution,
              serviceStatus,
              alerts: incidents,
              updatedAt: new Date().toISOString(),
            },
            message: '获取仪表板数据成功',
            success: true,
          },
        };
      } catch (error) {
        star.logger?.error('Get dashboard metrics failed:', error);
        return {
          status: 500,
          data: {
            code: HttpResponseCode.ServiceActionFaild,
            content: null,
            message: '获取仪表板数据失败',
            success: false,
          },
        };
      }
    },
  },
  'v1.overview.summary': {
    metadata: {
      auth: true,
    },
    params: {
      timeRange: { type: 'string', optional: true, default: '-24h' },
      scope: { type: 'string', optional: true, default: 'tenant' },
    },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      try {
        try {
          assertSystemScopeAllowed(ctx);
        } catch {
          return createSystemScopeForbidden();
        }
        const timeRange = ctx.params?.timeRange || '-24h';
        const scope = normalizeMetricsScope(ctx.params?.scope);
        const content = await buildOverviewSummaryContent(timeRange, star, this as any, scope);

        return {
          status: 200,
          data: {
            code: HttpResponseCode.Success,
            content,
            message: '获取总览摘要成功',
            success: true,
          },
        };
      } catch (error) {
        star.logger?.error('Get overview summary failed:', error);
        return {
          status: 500,
          data: {
            code: HttpResponseCode.ServiceActionFaild,
            content: null,
            message: '获取总览摘要失败',
            success: false,
          },
        };
      }
    },
  },
  'v1.overview.trends': {
    metadata: {
      auth: true,
    },
    params: {
      timeRange: { type: 'string', optional: true, default: '-24h' },
      groupBy: { type: 'string', optional: true, default: 'overall' },
      scope: { type: 'string', optional: true, default: 'tenant' },
    },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      try {
        try {
          assertSystemScopeAllowed(ctx);
        } catch {
          return createSystemScopeForbidden();
        }
        const timeRange = ctx.params?.timeRange || '-24h';
        const scope = normalizeMetricsScope(ctx.params?.scope);
        const content = await buildOverviewTrendsContent(timeRange, star, scope);

        return {
          status: 200,
          data: {
            code: HttpResponseCode.Success,
            content,
            message: '获取总览趋势成功',
            success: true,
          },
        };
      } catch (error) {
        star.logger?.error('Get overview trends failed:', error);
        return {
          status: 500,
          data: {
            code: HttpResponseCode.ServiceActionFaild,
            content: null,
            message: '获取总览趋势失败',
            success: false,
          },
        };
      }
    },
  },
  'v1.overview.ingest-status': {
    metadata: {
      auth: true,
    },
    params: {
      scope: { type: 'string', optional: true, default: 'tenant' },
    },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      try {
        try {
          assertSystemScopeAllowed(ctx);
        } catch {
          return createSystemScopeForbidden();
        }
        const scope = normalizeMetricsScope(ctx.params?.scope);
        const content = await buildOverviewIngestStatusContent(this as any, scope);

        return {
          status: 200,
          data: {
            code: HttpResponseCode.Success,
            content,
            message: '获取总览采集状态成功',
            success: true,
          },
        };
      } catch (error) {
        star.logger?.error('Get overview ingest status failed:', error);
        return {
          status: 500,
          data: {
            code: HttpResponseCode.ServiceActionFaild,
            content: null,
            message: '获取总览采集状态失败',
            success: false,
          },
        };
      }
    },
  },
  'v1.overview.incidents': {
    metadata: {
      auth: true,
    },
    params: {
      timeRange: { type: 'string', optional: true, default: '-24h' },
      scope: { type: 'string', optional: true, default: 'tenant' },
    },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      try {
        try {
          assertSystemScopeAllowed(ctx);
        } catch {
          return createSystemScopeForbidden();
        }
        const timeRange = ctx.params?.timeRange || '-24h';
        const scope = normalizeMetricsScope(ctx.params?.scope);
        const content = await buildOverviewIncidentsContent(timeRange, star, this as any, scope);

        return {
          status: 200,
          data: {
            code: HttpResponseCode.Success,
            content,
            message: '获取总览事件成功',
            success: true,
          },
        };
      } catch (error) {
        star.logger?.error('Get overview incidents failed:', error);
        return {
          status: 500,
          data: {
            code: HttpResponseCode.ServiceActionFaild,
            content: null,
            message: '获取总览事件失败',
            success: false,
          },
        };
      }
    },
  },
  'v1.overview.risk-services': {
    metadata: {
      auth: true,
    },
    params: {
      scope: { type: 'string', optional: true, default: 'tenant' },
    },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      try {
        try {
          assertSystemScopeAllowed(ctx);
        } catch {
          return createSystemScopeForbidden();
        }
        const scope = normalizeMetricsScope(ctx.params?.scope);
        const content = await buildOverviewRiskServicesContent(this as any, scope);

        return {
          status: 200,
          data: {
            code: HttpResponseCode.Success,
            content,
            message: '获取风险服务成功',
            success: true,
          },
        };
      } catch (error) {
        star.logger?.error('Get overview risk services failed:', error);
        return {
          status: 500,
          data: {
            code: HttpResponseCode.ServiceActionFaild,
            content: null,
            message: '获取风险服务失败',
            success: false,
          },
        };
      }
    },
  },
  'v1.service.detail': {
    metadata: {
      auth: true,
    },
    params: {
      serviceId: { type: 'string', required: true },
      timeRange: { type: 'string', optional: true, default: '-1h' },
      scope: { type: 'string', optional: true, default: 'tenant' },
    },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      try {
        try {
          assertSystemScopeAllowed(ctx);
        } catch {
          return createSystemScopeForbidden();
        }
        const { serviceId, timeRange } = ctx.params;
        const scope = normalizeMetricsScope(ctx.params?.scope);
        const content = await buildServiceDetailContent(
          serviceId,
          timeRange,
          star,
          this as any,
          scope,
        );

        if (!content) {
          return {
            status: 404,
            data: {
              code: HttpResponseCode.ServiceActionFaild,
              content: null,
              message: '服务不存在',
              success: false,
            },
          };
        }

        return {
          status: 200,
          data: {
            code: HttpResponseCode.Success,
            content,
            message: '获取服务详情摘要成功',
            success: true,
          },
        };
      } catch (error) {
        star.logger?.error('Get service detail summary failed:', error);
        return {
          status: 500,
          data: {
            code: HttpResponseCode.ServiceActionFaild,
            content: null,
            message: '获取服务详情摘要失败',
            success: false,
          },
        };
      }
    },
  },
  'v1.service.runtime': {
    metadata: {
      auth: true,
    },
    params: {
      serviceId: { type: 'string', required: true },
      scope: { type: 'string', optional: true, default: 'tenant' },
    },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      try {
        try {
          assertSystemScopeAllowed(ctx);
        } catch {
          return createSystemScopeForbidden();
        }
        const { serviceId } = ctx.params;
        const scope = normalizeMetricsScope(ctx.params?.scope);
        const content = await buildServiceRuntimeContent(serviceId, this as any, scope);

        if (!content) {
          return {
            status: 404,
            data: {
              code: HttpResponseCode.ServiceActionFaild,
              content: null,
              message: '服务不存在',
              success: false,
            },
          };
        }

        return {
          status: 200,
          data: {
            code: HttpResponseCode.Success,
            content,
            message: '获取服务运行时成功',
            success: true,
          },
        };
      } catch (error) {
        star.logger?.error('Get service runtime failed:', error);
        return {
          status: 500,
          data: {
            code: HttpResponseCode.ServiceActionFaild,
            content: null,
            message: '获取服务运行时失败',
            success: false,
          },
        };
      }
    },
  },
  'v1.catalog.services': {
    metadata: {
      auth: true,
    },
    params: {
      page: { type: 'any', optional: true, default: 1 },
      pageSize: { type: 'any', optional: true, default: 20 },
      status: { type: 'array', optional: true },
      keyword: { type: 'string', optional: true },
      env: { type: 'string', optional: true },
      region: { type: 'string', optional: true },
      scope: { type: 'string', optional: true, default: 'tenant' },
    },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      try {
        try {
          assertSystemScopeAllowed(ctx);
        } catch {
          return createSystemScopeForbidden();
        }
        const scope = normalizeMetricsScope(ctx.params?.scope);
        star.logger?.info('metrics.catalog.services:request', {
          nodeID: star.nodeID,
          scope,
          params: ctx.params,
          userId: (ctx.meta as any)?.user?.userId,
          isAdmin: Boolean((ctx.meta as any)?.user?.isAdmin || (ctx.meta as any)?.adminMetrics),
        });
        const content = await buildCatalogServicesContent(ctx.params || {}, this as any, scope);

        star.logger?.info('metrics.catalog.services:response', {
          nodeID: star.nodeID,
          scope,
          items: Array.isArray(content?.items) ? content.items.length : 0,
          ids: Array.isArray(content?.items)
            ? content.items.map((item: any) => item?.identity?.id)
            : [],
        });

        return {
          status: 200,
          data: {
            code: HttpResponseCode.Success,
            content,
            message: '获取服务目录成功',
            success: true,
          },
        };
      } catch (error) {
        star.logger?.error('metrics.catalog.services:failed', {
          nodeID: star.nodeID,
          params: ctx.params,
          message: (error as any)?.message,
          stack: (error as any)?.stack,
          code: (error as any)?.code,
          type: (error as any)?.type,
          data: (error as any)?.data,
        });
        return {
          status: 500,
          data: {
            code: HttpResponseCode.ServiceActionFaild,
            content: null,
            message: '获取服务目录失败',
            success: false,
          },
        };
      }
    },
  },
  'v1.catalog.services.summary': {
    metadata: {
      auth: true,
    },
    params: {
      scope: { type: 'string', optional: true, default: 'tenant' },
    },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      try {
        try {
          assertSystemScopeAllowed(ctx);
        } catch {
          return createSystemScopeForbidden();
        }
        const scope = normalizeMetricsScope(ctx.params?.scope);
        const content = await buildCatalogServicesSummaryContent(this as any, scope);

        return {
          status: 200,
          data: {
            code: HttpResponseCode.Success,
            content,
            message: '获取服务目录摘要成功',
            success: true,
          },
        };
      } catch (error) {
        star.logger?.error('Get catalog services summary failed:', error);
        return {
          status: 500,
          data: {
            code: HttpResponseCode.ServiceActionFaild,
            content: null,
            message: '获取服务目录摘要失败',
            success: false,
          },
        };
      }
    },
  },
  'v1.catalog.service.quick-view': {
    metadata: {
      auth: true,
    },
    params: {
      serviceId: { type: 'string', required: true },
      scope: { type: 'string', optional: true, default: 'tenant' },
    },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      try {
        try {
          assertSystemScopeAllowed(ctx);
        } catch {
          return createSystemScopeForbidden();
        }
        const { serviceId } = ctx.params;
        const scope = normalizeMetricsScope(ctx.params?.scope);
        const content = await buildCatalogServiceQuickViewContent(serviceId, this as any, scope);

        if (!content) {
          return {
            status: 404,
            data: {
              code: HttpResponseCode.ServiceActionFaild,
              content: null,
              message: '服务不存在',
              success: false,
            },
          };
        }

        return {
          status: 200,
          data: {
            code: HttpResponseCode.Success,
            content,
            message: '获取服务 quick view 成功',
            success: true,
          },
        };
      } catch (error) {
        star.logger?.error('Get catalog service quick view failed:', error);
        return {
          status: 500,
          data: {
            code: HttpResponseCode.ServiceActionFaild,
            content: null,
            message: '获取服务 quick view 失败',
            success: false,
          },
        };
      }
    },
  },
  'v1.metrics.explorer': {
    metadata: {
      auth: true,
    },
    params: {
      serviceId: { type: 'string', optional: true },
      timeRange: { type: 'string', optional: true, default: '-6h' },
      scope: { type: 'string', optional: true, default: 'tenant' },
    },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      try {
        try {
          assertSystemScopeAllowed(ctx);
        } catch {
          return createSystemScopeForbidden();
        }
        const scope = normalizeMetricsScope(ctx.params?.scope);
        const content = await buildMetricsExplorerContent(ctx, star, this as any, scope);

        return {
          status: 200,
          data: {
            code: HttpResponseCode.Success,
            content,
            message: '获取指标探索数据成功',
            success: true,
          },
        };
      } catch (error) {
        star.logger?.error('Get metrics explorer failed:', error);
        return {
          status: 500,
          data: {
            code: HttpResponseCode.ServiceActionFaild,
            content: null,
            message: '获取指标探索数据失败',
            success: false,
          },
        };
      }
    },
  },
});

export default realtime;
