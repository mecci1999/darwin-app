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

type MetricsDatasetScope = 'tenant' | 'system';

const toFixed = (value: number, digits = 2) => Number(value.toFixed(digits));

const queryServiceQpsMap = async (bucket: string, star: Star) => {
  const fluxQuery = `
    from(bucket: "${bucket}")
      |> range(start: -5m)
      |> filter(fn: (r) => r["_measurement"] == "universe.request.total" or r["_measurement"] == "http_requests_total" or r["_measurement"] == "rpc_requests_total" or r["_measurement"] == "messaging_requests_total")
      |> filter(fn: (r) => r["_field"] == "value" or r["_field"] == "count" or r["_field"] == "total")
      |> group(columns: ["service"])
      |> sum()
  `;
  const rows = await InfluxDBHandler.queryMetrics(fluxQuery, star);
  return new Map(
    rows
      .filter((row: any) => row?.service)
      .map((row: any) => [String(row.service), toFixed(Number(row._value || 0) / 300, 2)]),
  );
};

const queryServiceLatencyMap = async (bucket: string, star: Star) => {
  const fluxQuery = `
    from(bucket: "${bucket}")
      |> range(start: -5m)
      |> filter(fn: (r) => ${RESPONSE_DURATION_MEASUREMENT_FILTER})
      |> filter(fn: (r) => ${RESPONSE_DURATION_FIELD_FILTER})
      ${RESPONSE_DURATION_MS_NORMALIZATION_FLUX}
      ${RESPONSE_DURATION_COMPLETED_REQUEST_FILTER}
      |> group(columns: ["service"])
      |> mean()
  `;
  const rows = await InfluxDBHandler.queryMetrics(fluxQuery, star);
  return new Map(
    rows
      .filter((row: any) => row?.service)
      .map((row: any) => [String(row.service), Math.round(Number(row._value || 0))]),
  );
};

const queryServiceErrorRateMap = async (bucket: string, star: Star) => {
  const totalQuery = `
    from(bucket: "${bucket}")
      |> range(start: -5m)
      |> filter(fn: (r) => r["_measurement"] == "universe.request.total" or r["_measurement"] == "http_requests_total" or r["_measurement"] == "rpc_requests_total" or r["_measurement"] == "messaging_requests_total")
      |> filter(fn: (r) => r["_field"] == "value" or r["_field"] == "count" or r["_field"] == "total")
      |> group(columns: ["service"])
      |> sum()
  `;
  const errorQuery = `
    from(bucket: "${bucket}")
      |> range(start: -5m)
      |> filter(fn: (r) => r["_measurement"] == "universe.request.error.total" or r["_measurement"] == "http_requests_total" or r["_measurement"] == "rpc_requests_total" or r["_measurement"] == "messaging_requests_total")
      |> filter(fn: (r) => r["_measurement"] == "universe.request.error.total" or (exists r.status and string(v: r.status) =~ /5../) or (exists r.status_code and string(v: r.status_code) =~ /5../) or (exists r.http_status_code and string(v: r.http_status_code) =~ /5../) or (exists r.code and string(v: r.code) =~ /5../))
      |> filter(fn: (r) => r["_field"] == "value" or r["_field"] == "count" or r["_field"] == "total")
      |> group(columns: ["service"])
      |> sum()
  `;
  const [totalRows, errorRows] = await Promise.all([
    InfluxDBHandler.queryMetrics(totalQuery, star),
    InfluxDBHandler.queryMetrics(errorQuery, star).catch(() => []),
  ]);
  const totalMap = new Map(
    totalRows
      .filter((row: any) => row?.service)
      .map((row: any) => [String(row.service), Number(row._value || 0)]),
  );
  const errorMap = new Map(
    errorRows
      .filter((row: any) => row?.service)
      .map((row: any) => [String(row.service), Number(row._value || 0)]),
  );
  return new Map(
    Array.from(totalMap.entries()).map(([service, total]) => [
      service,
      total > 0 ? toFixed((errorMap.get(service) || 0) / total, 4) : 0,
    ]),
  );
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

  const [qpsMap, latencyMap, errorRateMap] = bucket
    ? await Promise.all([
        queryServiceQpsMap(bucket, star).catch(() => new Map()),
        queryServiceLatencyMap(bucket, star).catch(() => new Map()),
        queryServiceErrorRateMap(bucket, star).catch(() => new Map()),
      ])
    : [new Map(), new Map(), new Map()];

  const map = new Map<string, any>();
  nodes.forEach((node: any) => {
    const services = Array.isArray(node.services)
      ? node.services
          .map((item: any) => item?.name)
          .filter((name: string) => Boolean(name) && !String(name).startsWith('$'))
      : [];

    services.forEach((name: string) => {
      if (!map.has(name)) {
        const identity = resolveSystemServiceIdentity(name);
        const isSystemService = isDarwinSystemService(name);
        const qps = qpsMap.has(name) ? Number(qpsMap.get(name)) : null;
        const latency = latencyMap.has(name) ? Number(latencyMap.get(name)) : null;
        const errorRate = errorRateMap.has(name) ? Number(errorRateMap.get(name)) : null;
        map.set(name, {
          id: isSystemService ? buildSystemServiceId(name) : name,
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
  return { services: list.slice(start, end), total, page, scope };
};
