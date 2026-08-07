import { Star } from 'node-universe';
import { InfluxDBHandler } from './influxdb-handler';
import {
  RESPONSE_DURATION_COMPLETED_REQUEST_FILTER,
  RESPONSE_DURATION_FIELD_FILTER,
  RESPONSE_DURATION_MEASUREMENT_FILTER,
  RESPONSE_DURATION_MS_NORMALIZATION_FLUX,
} from './duration-metrics';
import {
  buildSystemServiceId,
  isDarwinSystemService,
  normalizeMetricsScope,
  resolveSystemServiceIdentity,
} from './system-telemetry';
import { normalizeRssMemoryValue } from './memory-units';

type MetricsDatasetScope = 'tenant' | 'system';

type ServiceRuntimeMetrics = {
  cpu: number | null;
  memory: number | null;
  lastSampleAt: string | null;
};

type ServiceMetricMaps = {
  qpsMap: Map<string, number>;
  latencyMap: Map<string, number>;
  errorRateMap: Map<string, number>;
  runtimeMap: Map<string, ServiceRuntimeMetrics>;
};

type ServiceMetricMapCacheEntry = {
  expiresAt: number;
  value?: ServiceMetricMaps;
  inFlight?: Promise<ServiceMetricMaps>;
};

const SERVICE_METRIC_MAP_CACHE_TTL_MS = 10_000;
const serviceMetricMapCache = new WeakMap<object, Map<MetricsDatasetScope, ServiceMetricMapCacheEntry>>();

const toFixed = (value: number, digits = 2) => Number(value.toFixed(digits));

const normalizeServiceMetricKey = (value: unknown) => {
  const raw = String(value || '').trim();
  return raw.startsWith('system:') ? raw.slice('system:'.length) : raw;
};

const serviceMetricKeyFlux = `if exists r.source and string(v: r.source) == "gateway-ingress" and exists r.service then string(v: r.service) else if exists r.target_service then string(v: r.target_service) else if exists r.targetService then string(v: r.targetService) else if exists r.destination_service then string(v: r.destination_service) else if exists r.peer_service then string(v: r.peer_service) else if exists r.service then string(v: r.service) else if exists r.serviceId then string(v: r.serviceId) else if exists r["service.name"] then string(v: r["service.name"]) else if exists r["service.id"] then string(v: r["service.id"]) else if exists r.service_name then string(v: r.service_name) else ""`;

const withServiceMetricKey = `|> map(fn: (r) => ({ r with service_metric_key: ${serviceMetricKeyFlux} }))
      |> filter(fn: (r) => r.service_metric_key != "")`;

const addMetricValue = (map: Map<string, number>, key: unknown, value: unknown) => {
  const normalizedKey = normalizeServiceMetricKey(key);
  const numericValue = Number(value || 0);
  if (!normalizedKey || !Number.isFinite(numericValue)) return;
  map.set(normalizedKey, (map.get(normalizedKey) || 0) + numericValue);
};

const mergeMissingMetricValues = (target: Map<string, number>, fallback: Map<string, number>) => {
  fallback.forEach((value, key) => {
    if (!target.has(key)) target.set(key, value);
  });
};

const getMetricMapValue = (map: Map<string, number>, serviceName: string, serviceId: string) => {
  const keys = [serviceName, serviceId, normalizeServiceMetricKey(serviceId)];
  for (const key of keys) {
    const normalizedKey = normalizeServiceMetricKey(key);
    if (map.has(normalizedKey)) return Number(map.get(normalizedKey));
  }
  return null;
};

const getMapKeySample = (map: ReadonlyMap<string, unknown>, limit = 8) => Array.from(map.keys()).slice(0, limit);

const hasMissingSystemServiceMetric = (
  map: ReadonlyMap<string, unknown>,
  serviceNames: ReadonlySet<string>,
) => Array.from(serviceNames).some((serviceName) => !map.has(serviceName));

const getNodeServiceNames = (node: any) => Array.isArray(node.services)
  ? node.services
      .map((item: any) => item?.name)
      .filter((name: string) => Boolean(name) && !String(name).startsWith('$'))
  : [];

const metricSourceStatus = (value: number | null) => {
  if (value !== null) return 'observed';
  return 'unavailable';
};

const queryServiceQpsMap = async (bucket: string, star: Star) => {
  const fluxQuery = `
    from(bucket: "${bucket}")
      |> range(start: -5m)
      |> filter(fn: (r) => r["_measurement"] == "universe.request.total" or r["_measurement"] == "http_requests_total" or r["_measurement"] == "rpc_requests_total" or r["_measurement"] == "messaging_requests_total")
      |> filter(fn: (r) => r["_field"] == "value" or r["_field"] == "count" or r["_field"] == "total")
      ${withServiceMetricKey}
      |> group(columns: ["service_metric_key"])
      |> sum()
  `;
  const rows = await InfluxDBHandler.queryMetrics(fluxQuery, star);
  const map = new Map<string, number>();
  rows.forEach((row: any) => addMetricValue(map, row?.service_metric_key, Number(row?._value || 0) / 300));
  star.logger?.info('metrics.catalog.service-qps-map', {
    rowCount: rows.length,
    keySample: getMapKeySample(map),
  });
  return new Map(Array.from(map.entries()).map(([key, value]) => [key, toFixed(value, 2)]));
};

const queryServiceQpsFallbackMap = async (bucket: string, star: Star) => {
  const fluxQuery = `
    from(bucket: "${bucket}")
      |> range(start: -5m)
      |> filter(fn: (r) => ${RESPONSE_DURATION_MEASUREMENT_FILTER})
      |> filter(fn: (r) => ${RESPONSE_DURATION_FIELD_FILTER})
      ${RESPONSE_DURATION_COMPLETED_REQUEST_FILTER}
      ${withServiceMetricKey}
      |> group(columns: ["service_metric_key"])
      |> count()
  `;
  const rows = await InfluxDBHandler.queryMetrics(fluxQuery, star);
  const map = new Map<string, number>();
  rows.forEach((row: any) => addMetricValue(map, row?.service_metric_key, Number(row?._value || 0) / 300));
  star.logger?.info('metrics.catalog.service-qps-fallback-map', {
    rowCount: rows.length,
    keySample: getMapKeySample(map),
  });
  return new Map(Array.from(map.entries()).map(([key, value]) => [key, toFixed(value, 2)]));
};

const queryServiceLatencyMap = async (bucket: string, star: Star) => {
  const fluxQuery = `
    from(bucket: "${bucket}")
      |> range(start: -5m)
      |> filter(fn: (r) => ${RESPONSE_DURATION_MEASUREMENT_FILTER})
      |> filter(fn: (r) => ${RESPONSE_DURATION_FIELD_FILTER})
      ${RESPONSE_DURATION_MS_NORMALIZATION_FLUX}
      ${RESPONSE_DURATION_COMPLETED_REQUEST_FILTER}
      ${withServiceMetricKey}
      |> group(columns: ["service_metric_key"])
      |> quantile(q: 0.95, method: "estimate_tdigest")
  `;
  const rows = await InfluxDBHandler.queryMetrics(fluxQuery, star);
  const map = new Map<string, number>();
  rows.forEach((row: any) => addMetricValue(map, row?.service_metric_key, Math.round(Number(row?._value || 0))));
  star.logger?.info('metrics.catalog.service-p95-map', {
    rowCount: rows.length,
    keySample: getMapKeySample(map),
  });
  return map;
};

const queryServiceErrorRateMap = async (bucket: string, star: Star) => {
  const totalQuery = `
    from(bucket: "${bucket}")
      |> range(start: -5m)
      |> filter(fn: (r) => r["_measurement"] == "universe.request.total" or r["_measurement"] == "http_requests_total" or r["_measurement"] == "rpc_requests_total" or r["_measurement"] == "messaging_requests_total")
      |> filter(fn: (r) => r["_field"] == "value" or r["_field"] == "count" or r["_field"] == "total")
      ${withServiceMetricKey}
      |> group(columns: ["service_metric_key"])
      |> sum()
  `;
  const errorQuery = `
    from(bucket: "${bucket}")
      |> range(start: -5m)
      |> filter(fn: (r) => r["_measurement"] == "universe.request.error.total" or r["_measurement"] == "http_requests_total" or r["_measurement"] == "rpc_requests_total" or r["_measurement"] == "messaging_requests_total")
      |> filter(fn: (r) => r["_measurement"] == "universe.request.error.total" or (exists r.status and string(v: r.status) =~ /5../) or (exists r.status_code and string(v: r.status_code) =~ /5../) or (exists r.http_status_code and string(v: r.http_status_code) =~ /5../) or (exists r.code and string(v: r.code) =~ /5../))
      |> filter(fn: (r) => r["_field"] == "value" or r["_field"] == "count" or r["_field"] == "total")
      ${withServiceMetricKey}
      |> group(columns: ["service_metric_key"])
      |> sum()
  `;
  const [totalRows, errorRows] = await Promise.all([
    InfluxDBHandler.queryMetrics(totalQuery, star),
    InfluxDBHandler.queryMetrics(errorQuery, star).catch(() => []),
  ]);
  const totalMap = new Map<string, number>();
  totalRows.forEach((row: any) => addMetricValue(totalMap, row?.service_metric_key, row?._value));
  const errorMap = new Map<string, number>();
  errorRows.forEach((row: any) => addMetricValue(errorMap, row?.service_metric_key, row?._value));
  star.logger?.info('metrics.catalog.service-error-rate-map', {
    totalRowCount: totalRows.length,
    errorRowCount: errorRows.length,
    totalKeySample: getMapKeySample(totalMap),
    errorKeySample: getMapKeySample(errorMap),
  });
  return new Map(
    Array.from(totalMap.entries()).map(([service, total]) => [
      service,
      total > 0 ? toFixed((errorMap.get(service) || 0) / total, 4) : 0,
    ]),
  );
};

const queryServiceErrorRateFallbackMap = async (bucket: string, star: Star) => {
  const totalQuery = `
    from(bucket: "${bucket}")
      |> range(start: -5m)
      |> filter(fn: (r) => ${RESPONSE_DURATION_MEASUREMENT_FILTER})
      |> filter(fn: (r) => ${RESPONSE_DURATION_FIELD_FILTER})
      ${RESPONSE_DURATION_COMPLETED_REQUEST_FILTER}
      ${withServiceMetricKey}
      |> group(columns: ["service_metric_key"])
      |> count()
  `;
  const errorQuery = `
    from(bucket: "${bucket}")
      |> range(start: -5m)
      |> filter(fn: (r) => ${RESPONSE_DURATION_MEASUREMENT_FILTER})
      |> filter(fn: (r) => ${RESPONSE_DURATION_FIELD_FILTER})
      ${RESPONSE_DURATION_COMPLETED_REQUEST_FILTER}
      ${withServiceMetricKey}
      |> filter(fn: (r) => (exists r.status and string(v: r.status) =~ /5../) or (exists r.status_code and string(v: r.status_code) =~ /5../) or (exists r.http_status_code and string(v: r.http_status_code) =~ /5../) or (exists r.code and string(v: r.code) =~ /5../))
      |> group(columns: ["service_metric_key"])
      |> count()
  `;
  const [totalRows, errorRows] = await Promise.all([
    InfluxDBHandler.queryMetrics(totalQuery, star),
    InfluxDBHandler.queryMetrics(errorQuery, star).catch(() => []),
  ]);
  const totalMap = new Map<string, number>();
  totalRows.forEach((row: any) => addMetricValue(totalMap, row?.service_metric_key, row?._value));
  const errorMap = new Map<string, number>();
  errorRows.forEach((row: any) => addMetricValue(errorMap, row?.service_metric_key, row?._value));
  star.logger?.info('metrics.catalog.service-error-rate-fallback-map', {
    totalRowCount: totalRows.length,
    errorRowCount: errorRows.length,
    totalKeySample: getMapKeySample(totalMap),
    errorKeySample: getMapKeySample(errorMap),
  });
  return new Map(
    Array.from(totalMap.entries()).map(([service, total]) => [
      service,
      total > 0 ? toFixed((errorMap.get(service) || 0) / total, 4) : 0,
    ]),
  );
};

const queryServiceRuntimeMetricMap = async (bucket: string, star: Star) => {
  const fluxQuery = `
    from(bucket: "${bucket}")
      |> range(start: -5m)
      |> filter(fn: (r) => r["_measurement"] == "os.cpu.utilization" or r["_measurement"] == "process.memory.rss")
      |> filter(fn: (r) => r["_field"] == "value" or r["_field"] == "cpu_usage" or r["_field"] == "memory_usage")
      |> map(fn: (r) => ({ r with service_metric_key: if exists r.service then string(v: r.service) else if exists r.serviceId then string(v: r.serviceId) else if exists r["service.name"] then string(v: r["service.name"]) else if exists r["service.id"] then string(v: r["service.id"]) else if exists r.service_name then string(v: r.service_name) else if exists r.nodeID then string(v: r.nodeID) else if exists r.nodeId then string(v: r.nodeId) else "" }))
      |> filter(fn: (r) => r.service_metric_key != "")
      |> group(columns: ["service_metric_key", "_measurement"])
      |> last()
  `;
  const rows = await InfluxDBHandler.queryMetrics(fluxQuery, star);
  const map = new Map<string, ServiceRuntimeMetrics>();
  rows.forEach((row: any) => {
    const key = normalizeServiceMetricKey(row?.service_metric_key);
    if (!key) return;
    const current = map.get(key) || { cpu: null, memory: null, lastSampleAt: null };
    const value = Number(row?._value || 0);
    if (row?._measurement === 'os.cpu.utilization') current.cpu = toFixed(value, 2);
    if (row?._measurement === 'process.memory.rss') current.memory = normalizeRssMemoryValue(value, 2);
    current.lastSampleAt = row?._time || current.lastSampleAt;
    map.set(key, current);
  });
  star.logger?.info('metrics.catalog.service-runtime-map', {
    rowCount: rows.length,
    keySample: getMapKeySample(map),
  });
  return map;
};

const getRuntimeMetricMapValue = (
  map: Map<string, ServiceRuntimeMetrics>,
  serviceName: string,
  serviceId: string,
) => {
  const keys = [serviceName, serviceId, normalizeServiceMetricKey(serviceId)];
  for (const key of keys) {
    const normalizedKey = normalizeServiceMetricKey(key);
    const value = map.get(normalizedKey);
    if (value) return value;
  }
  return { cpu: null, memory: null, lastSampleAt: null };
};

const deriveHealth = (
  instances: number,
  latency: number | null,
  errorRate: number | null,
): 'healthy' | 'degraded' | 'critical' | 'unknown' => {
  if (instances <= 0) return 'critical';
  if (errorRate === null && latency === null) return 'healthy';
  if ((errorRate ?? 0) >= 0.05 || (latency ?? 0) >= 1000) return 'critical';
  if ((errorRate ?? 0) >= 0.01 || (latency ?? 0) >= 500) return 'degraded';
  return 'healthy';
};

const buildServiceMetricMaps = async (
  bucket: string,
  star: Star,
  serviceNames: ReadonlySet<string>,
): Promise<ServiceMetricMaps> => {
  const [qpsMap, latencyMap, errorRateMap, runtimeMap] = await Promise.all([
    queryServiceQpsMap(bucket, star)
      .then(async (map) => {
        if (map.size > 0 && !hasMissingSystemServiceMetric(map, serviceNames)) return map;
        const fallback = await queryServiceQpsFallbackMap(bucket, star).catch((error) => {
          star.logger?.error('metrics.catalog.service-qps-fallback-map-failed', {
            message: error?.message,
            stack: error?.stack,
          });
          return new Map();
        });
        mergeMissingMetricValues(map, fallback);
        return map;
      })
      .catch((error) => {
        star.logger?.error('metrics.catalog.service-qps-map-failed', {
          message: error?.message,
          stack: error?.stack,
        });
        return queryServiceQpsFallbackMap(bucket, star).catch(() => new Map());
      }),
    queryServiceLatencyMap(bucket, star).catch((error) => {
      star.logger?.error('metrics.catalog.service-p95-map-failed', {
        message: error?.message,
        stack: error?.stack,
      });
      return new Map();
    }),
    queryServiceErrorRateMap(bucket, star)
      .then(async (map) => {
        if (map.size > 0 && !hasMissingSystemServiceMetric(map, serviceNames)) return map;
        const fallback = await queryServiceErrorRateFallbackMap(bucket, star).catch((error) => {
          star.logger?.error('metrics.catalog.service-error-rate-fallback-map-failed', {
            message: error?.message,
            stack: error?.stack,
          });
          return new Map();
        });
        mergeMissingMetricValues(map, fallback);
        return map;
      })
      .catch((error) => {
        star.logger?.error('metrics.catalog.service-error-rate-map-failed', {
          message: error?.message,
          stack: error?.stack,
        });
        return queryServiceErrorRateFallbackMap(bucket, star).catch(() => new Map());
      }),
    queryServiceRuntimeMetricMap(bucket, star).catch((error) => {
      star.logger?.error('metrics.catalog.service-runtime-map-failed', {
        message: error?.message,
        stack: error?.stack,
      });
      return new Map();
    }),
  ]);
  return { qpsMap, latencyMap, errorRateMap, runtimeMap };
};

const getServiceMetricMaps = (
  bucket: string,
  star: Star,
  scope: MetricsDatasetScope,
  serviceNames: ReadonlySet<string>,
): Promise<ServiceMetricMaps> => {
  let scopeEntries = serviceMetricMapCache.get(star);
  if (!scopeEntries) {
    scopeEntries = new Map();
    serviceMetricMapCache.set(star, scopeEntries);
  }

  const existing = scopeEntries.get(scope);
  if (existing?.value && existing.expiresAt > Date.now()) return Promise.resolve(existing.value);
  if (existing?.inFlight) return existing.inFlight;

  const entry: ServiceMetricMapCacheEntry = { expiresAt: 0 };
  entry.inFlight = buildServiceMetricMaps(bucket, star, serviceNames)
    .then((value) => {
      entry.value = value;
      entry.expiresAt = Date.now() + SERVICE_METRIC_MAP_CACHE_TTL_MS;
      entry.inFlight = undefined;
      return value;
    })
    .catch((error) => {
      if (scopeEntries?.get(scope) === entry) scopeEntries.delete(scope);
      throw error;
    });
  scopeEntries.set(scope, entry);
  return entry.inFlight;
};

export const buildServiceCatalogSnapshot = async (
  params: {
    page?: number;
    pageSize?: number;
    status?: string[] | string;
    keyword?: string;
    scope?: MetricsDatasetScope;
  },
  star: Star,
) => {
  const page = Number(params?.page || 1);
  const pageSize = Number(params?.pageSize || 10);
  const statusFilter = Array.isArray(params?.status)
    ? params.status
    : typeof params?.status === 'string' && params.status.length > 0
      ? [params.status]
      : [];
  const keyword = String(params?.keyword || '').trim();
  const scope = normalizeMetricsScope(params?.scope);
  const nodes = star.registry?.getNodeList({ onlyAvaiable: true, withServices: true }) || [];
  const bucket = InfluxDBHandler.getBucketName();
  const serviceNames = new Set<string>();
  nodes.forEach((node: any) => {
    getNodeServiceNames(node).forEach((name: string) => serviceNames.add(name));
  });

  const { qpsMap, latencyMap, errorRateMap, runtimeMap } = bucket
    ? await getServiceMetricMaps(bucket, star, scope, serviceNames)
    : {
        qpsMap: new Map<string, number>(),
        latencyMap: new Map<string, number>(),
        errorRateMap: new Map<string, number>(),
        runtimeMap: new Map<string, ServiceRuntimeMetrics>(),
      };

  star.logger?.info('metrics.catalog.metric-map-summary', {
    bucketInitialized: Boolean(bucket),
    qpsKeys: getMapKeySample(qpsMap),
    p95Keys: getMapKeySample(latencyMap),
    errorRateKeys: getMapKeySample(errorRateMap),
    runtimeKeys: getMapKeySample(runtimeMap),
    gateway: {
      qps: getMetricMapValue(qpsMap, 'gateway', 'system:gateway'),
      p95Latency: getMetricMapValue(latencyMap, 'gateway', 'system:gateway'),
      errorRate: getMetricMapValue(errorRateMap, 'gateway', 'system:gateway'),
      runtime: getRuntimeMetricMapValue(runtimeMap, 'gateway', 'system:gateway'),
    },
  });

  const map = new Map<string, any>();
  nodes.forEach((node: any) => {
    getNodeServiceNames(node).forEach((name: string) => {
      if (!map.has(name)) {
        const identity = resolveSystemServiceIdentity(name);
        const isSystemService = isDarwinSystemService(name);
        const id = isSystemService ? buildSystemServiceId(name) : name;
        const qps = getMetricMapValue(qpsMap, name, id);
        const latency = getMetricMapValue(latencyMap, name, id);
        const errorRate = getMetricMapValue(errorRateMap, name, id);
        const runtimeMetrics = getRuntimeMetricMapValue(runtimeMap, name, id);
        map.set(name, {
          id,
          name,
          version: identity.runtime || '1.0.0',
          instances: 0,
          health: deriveHealth(0, latency, errorRate),
          status: 'running',
          env: identity.env,
          lastUpdate: new Date().toISOString(),
          owner: identity.owner,
          team: identity.team,
          region: identity.region,
          qps,
          latency,
          errorRate,
          runtimeMetrics,
          metricStatus: {
            qps: metricSourceStatus(qps),
            latency: metricSourceStatus(latency),
            errorRate: metricSourceStatus(errorRate),
            runtime: runtimeMetrics.cpu !== null || runtimeMetrics.memory !== null ? 'observed' : 'unavailable',
          },
          sla: errorRate !== null ? Math.max(0, toFixed(1 - errorRate, 4)) : null,
          tags: identity.tags,
          lastDeploy: null,
          visibilityScope: isSystemService ? 'system-admin' : 'tenant',
          sourceType: isSystemService ? 'darwin-system' : 'tenant',
        });
      }

      const item = map.get(name);
      item.instances += 1;
      item.health = deriveHealth(item.instances, item.latency ?? null, item.errorRate ?? null);
      item.status = node.available ? 'running' : 'error';
      item.lastUpdate = new Date().toISOString();
    });
  });

  let list = Array.from(map.values()).filter((service: any) =>
    scope === 'system' ? isDarwinSystemService(service.id) : !isDarwinSystemService(service.id),
  );

  if (keyword) {
    list = list.filter((item) => String(item.name).includes(keyword));
  }
  if (statusFilter.length > 0 && !statusFilter.includes('all')) {
    list = list.filter(
      (item) => statusFilter.includes(item.health) || statusFilter.includes(item.status),
    );
  }

  const total = list.length;
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  star.logger?.info('metrics.catalog.service-snapshot-summary', {
    scope,
    total,
    serviceSample: list.slice(0, 8).map((service: any) => ({
      id: service.id,
      name: service.name,
      qps: service.qps,
      p95Latency: service.latency,
      errorRate: service.errorRate,
      instances: service.instances,
    })),
  });
  return { services: list.slice(start, end), total, page, scope };
};
