import '../../../utils/loadEnv';
import { Context, Star } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, Starlight } from 'typings';
import { registerDarwinLogForwarding } from '../logs/utils/darwin-log-capture';
import {
  INFLUXDB_BUCKET,
  INFLUXDB_ORG,
  INFLUXDB_TOKEN,
  INFLUXDB_URL,
  KAFKA_BROKERS,
  KAFKA_PASSWORD,
  KAFKA_USER,
  REDIS_DB,
  REDIS_HOST,
  REDIS_PASSWORD,
  REDIS_PORT,
} from '../metrics/constants';
import { InfluxDBHandler } from '../metrics/utils/influxdb-handler';
import { calculateMemoryUsagePercent, MEMORY_USAGE_PERCENT_UNIT, MEMORY_USAGE_UNIT, normalizeRssMemoryValue } from '../metrics/utils/memory-units';
import { assertSystemScopeAllowed, normalizeMetricsScope } from '../metrics/utils/system-telemetry';
import { buildServiceCatalogSnapshot } from '../metrics/utils/service-catalog';
import { buildSupportedMetricSchema, parseRangeSeconds, resolveInterval, validateQuerySpec } from './utils/query-contract';

const APP_NAME = 'metrics-query';

const toFixed = (value: number, digits = 2) => Number(value.toFixed(digits));

const formatInterval = (seconds: number) => {
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
};

const normalizeSeries = (rows: any[], normalizeValue: (value: unknown) => number = (value) => toFixed(Number(value || 0), 2)) =>
  rows
    .filter((row) => row?._time && row?._value !== undefined && row?._value !== null)
    .map((row) => ({
      timestamp: new Date(row._time).getTime(),
      value: normalizeValue(row._value),
    }))
    .sort((a, b) => a.timestamp - b.timestamp);

const getBucketNameOrThrow = () => {
  const bucket = InfluxDBHandler.getBucketName();
  if (!bucket) {
    throw new Error('influx_bucket_not_initialized');
  }
  return bucket;
};

const normalizeServiceId = (serviceId?: string) =>
  serviceId?.startsWith('system:') ? serviceId.slice('system:'.length) : serviceId;

const buildServiceFilter = (serviceId?: string) => {
  const normalizedServiceId = normalizeServiceId(serviceId);
  return normalizedServiceId ? `|> filter(fn: (r) => r["service"] == "${normalizedServiceId}")` : '';
};

const queryTimeseries = async (params: {
  measurementFilter: string;
  fieldFilter: string;
  aggregateFn: 'mean' | 'sum' | 'max' | 'last';
  timeRange: string;
  serviceId?: string;
  every?: string;
  star: Starlight;
  normalizeValue?: (value: unknown) => number;
}) => {
  const bucket = getBucketNameOrThrow();
  const fluxQuery = `
    from(bucket: "${bucket}")
      |> range(start: ${params.timeRange})
      |> filter(fn: (r) => ${params.measurementFilter})
      ${buildServiceFilter(params.serviceId)}
      |> filter(fn: (r) => ${params.fieldFilter})
      |> aggregateWindow(every: ${params.every || resolveInterval(params.timeRange)}, fn: ${params.aggregateFn}, createEmpty: false)
  `;
  const rows = await InfluxDBHandler.queryMetrics(fluxQuery, params.star);
  return normalizeSeries(rows, params.normalizeValue);
};

const queryMemoryUsagePercentSeries = async (params: { timeRange: string; serviceId?: string; star: Starlight; aggregateFn: 'mean' | 'max' | 'last' }) => {
  const every = resolveInterval(params.timeRange);
  const bucket = getBucketNameOrThrow();
  const rssServiceFilter = buildServiceFilter(params.serviceId);
  const aggregateExpression = params.aggregateFn === 'last' ? 'last()' : `aggregateWindow(every: ${every}, fn: ${params.aggregateFn}, createEmpty: false)`;
  const rssQuery = `
    from(bucket: "${bucket}")
      |> range(start: ${params.timeRange})
      |> filter(fn: (r) => r["_measurement"] == "process.memory.rss")
      ${rssServiceFilter}
      |> filter(fn: (r) => r["_field"] == "memory_usage" or r["_field"] == "value")
      |> ${aggregateExpression}
      |> group(columns: ["_time"])
      |> sum(column: "_value")
      |> sort(columns: ["_time"])
  `;
  const totalQuery = `
    from(bucket: "${bucket}")
      |> range(start: ${params.timeRange})
      |> filter(fn: (r) => r["_measurement"] == "os.memory.total")
      |> filter(fn: (r) => r["_field"] == "memory_total" or r["_field"] == "total" or r["_field"] == "value")
      |> ${aggregateExpression}
      |> group(columns: ["_time"])
      |> max(column: "_value")
      |> sort(columns: ["_time"])
  `;
  const [rssRows, totalRows] = await Promise.all([
    InfluxDBHandler.queryMetrics(rssQuery, params.star),
    InfluxDBHandler.queryMetrics(totalQuery, params.star),
  ]);
  const rssSeries = normalizeSeries(rssRows);
  const totalSeries = normalizeSeries(totalRows);
  return rssSeries
    .map((point, index) => ({
      timestamp: point.timestamp,
      value: calculateMemoryUsagePercent(point.value, totalSeries[index]?.value, 2),
    }))
    .filter((point) => point.value > 0);
};

const buildMetricSeriesForCalculation = async (params: {
  metricRef: string;
  aggregation?: string;
  timeRange: string;
  serviceId?: string;
  star: Starlight;
}) => {
  const aggregateFn = params.aggregation === 'latest' ? 'last' : params.aggregation === 'max' ? 'max' : params.aggregation === 'sum' ? 'sum' : 'mean';
  if (params.metricRef === 'process.memory.rss' || params.metricRef === 'service.memory.usage') {
    return queryTimeseries({
      measurementFilter: 'r["_measurement"] == "process.memory.rss"',
      fieldFilter: 'r["_field"] == "memory_usage" or r["_field"] == "value"',
      aggregateFn,
      timeRange: params.timeRange,
      serviceId: params.serviceId,
      star: params.star,
    });
  }

  if (params.metricRef === 'os.memory.total') {
    return queryTimeseries({
      measurementFilter: 'r["_measurement"] == "os.memory.total"',
      fieldFilter: 'r["_field"] == "memory_total" or r["_field"] == "total" or r["_field"] == "value"',
      aggregateFn: params.aggregation === 'max' ? 'max' : 'last',
      timeRange: params.timeRange,
      star: params.star,
    });
  }

  return [];
};

const queryRatioCalculationSeries = async (params: { query: any; timeRange: string; serviceId?: string; star: Starlight }) => {
  const calculation = params.query?.calculation;
  const [numeratorSeries, denominatorSeries] = await Promise.all([
    buildMetricSeriesForCalculation({
      metricRef: String(calculation?.numerator?.metricRef || ''),
      aggregation: calculation?.numerator?.aggregation || params.query?.aggregation,
      timeRange: params.timeRange,
      serviceId: params.serviceId,
      star: params.star,
    }),
    buildMetricSeriesForCalculation({
      metricRef: String(calculation?.denominator?.metricRef || ''),
      aggregation: calculation?.denominator?.aggregation || params.query?.aggregation,
      timeRange: params.timeRange,
      serviceId: params.serviceId,
      star: params.star,
    }),
  ]);
  const scale = Number(calculation?.scale || 1);
  return numeratorSeries
    .map((point, index) => {
      const denominator = Number(denominatorSeries[index]?.value || 0);
      const numerator = Number(point.value || 0);
      return {
        timestamp: point.timestamp,
        value: denominator > 0 ? toFixed((numerator / denominator) * scale, 2) : 0,
      };
    })
    .filter((point) => Number.isFinite(point.value));
};

const queryErrorRateSeries = async (params: { timeRange: string; serviceId?: string; star: Starlight }) => {
  const bucket = getBucketNameOrThrow();
  const serviceFilter = buildServiceFilter(params.serviceId);
  const every = resolveInterval(params.timeRange);
  const totalQuery = `
    from(bucket: "${bucket}")
      |> range(start: ${params.timeRange})
      |> filter(fn: (r) => r["_measurement"] == "universe.request.total" or r["_measurement"] == "http_requests_total" or r["_measurement"] == "rpc_requests_total" or r["_measurement"] == "messaging_requests_total")
      ${serviceFilter}
      |> filter(fn: (r) => r["_field"] == "value" or r["_field"] == "count" or r["_field"] == "total")
      |> aggregateWindow(every: ${every}, fn: sum, createEmpty: false)
  `;
  const errorQuery = `
    from(bucket: "${bucket}")
      |> range(start: ${params.timeRange})
      |> filter(fn: (r) => r["_measurement"] == "universe.request.error.total" or r["_measurement"] == "http_requests_total" or r["_measurement"] == "rpc_requests_total" or r["_measurement"] == "messaging_requests_total")
      ${serviceFilter}
      |> filter(fn: (r) => r["_measurement"] == "universe.request.error.total" or (exists r.status and string(v: r.status) =~ /5../) or (exists r.status_code and string(v: r.status_code) =~ /5../) or (exists r.http_status_code and string(v: r.http_status_code) =~ /5../) or (exists r.code and string(v: r.code) =~ /5../))
      |> filter(fn: (r) => r["_field"] == "value" or r["_field"] == "count" or r["_field"] == "total")
      |> aggregateWindow(every: ${every}, fn: sum, createEmpty: false)
  `;
  const [totalRows, errorRows] = await Promise.all([
    InfluxDBHandler.queryMetrics(totalQuery, params.star),
    InfluxDBHandler.queryMetrics(errorQuery, params.star).catch(() => []),
  ]);
  const totalSeries = normalizeSeries(totalRows);
  const errorSeries = normalizeSeries(errorRows);
  return totalSeries.map((point, index) => {
    const total = Number(point.value || 0);
    const errors = Number(errorSeries[index]?.value || 0);
    return {
      timestamp: point.timestamp,
      value: total > 0 ? toFixed((errors / total) * 100, 2) : 0,
    };
  });
};

const getLatestPoint = (series: Array<{ timestamp: number; value: number }>) =>
  series.length ? series[series.length - 1] : null;

const buildCardDataFromQuery = async (query: any, star: Starlight, serviceContext: any) => {
  const metricRef = String(query?.metricRef || '').trim();
  const timeRange = String(query?.timeRange || '-1h');
  const serviceId = query?.subject?.type === 'service' ? String(query?.subject?.id || '') : undefined;
  const visualizationHint = query?.visualizationHint;
  const isSingleValueVisualization = visualizationHint === 'number' || visualizationHint === 'donut';

  if (query?.calculation?.type === 'ratio') {
    const series = await queryRatioCalculationSeries({ query, timeRange, serviceId, star });
    const unit = typeof query.calculation.unit === 'string' ? query.calculation.unit : '';
    if (isSingleValueVisualization) {
      return { kind: 'number', value: series.length ? series[series.length - 1].value : null, unit };
    }
    return { kind: 'timeseries', unit, series: [{ name: metricRef || 'Calculated ratio', points: series }] };
  }

  if (metricRef === 'service.cpu.usage') {
    const series = await queryTimeseries({
      measurementFilter: 'r["_measurement"] == "os.cpu.utilization"',
      fieldFilter: 'r["_field"] == "cpu_usage" or r["_field"] == "value"',
      aggregateFn: query?.aggregation === 'latest' ? 'last' : query?.aggregation === 'max' ? 'max' : 'mean',
      timeRange,
      serviceId,
      star,
    });
    if (isSingleValueVisualization) {
      return { kind: 'number', value: series.length ? series[series.length - 1].value : null, unit: '%' };
    }
    return { kind: 'timeseries', unit: '%', series: [{ name: 'CPU', points: series }] };
  }

  if (metricRef === 'service.memory.usage') {
    const series = await queryTimeseries({
      measurementFilter: 'r["_measurement"] == "process.memory.rss"',
      fieldFilter: 'r["_field"] == "memory_usage" or r["_field"] == "value"',
      aggregateFn: query?.aggregation === 'latest' ? 'last' : query?.aggregation === 'max' ? 'max' : 'mean',
      timeRange,
      serviceId,
      star,
      normalizeValue: normalizeRssMemoryValue,
    });
    if (isSingleValueVisualization) {
      return { kind: 'number', value: series.length ? series[series.length - 1].value : null, unit: MEMORY_USAGE_UNIT };
    }
    return { kind: 'timeseries', unit: MEMORY_USAGE_UNIT, series: [{ name: 'Memory', points: series }] };
  }

  if (metricRef === 'service.memory.usage.percent') {
    const series = await queryMemoryUsagePercentSeries({
      aggregateFn: query?.aggregation === 'latest' ? 'last' : query?.aggregation === 'max' ? 'max' : 'mean',
      timeRange,
      serviceId,
      star,
    });
    if (isSingleValueVisualization) {
      return { kind: 'number', value: series.length ? series[series.length - 1].value : null, unit: MEMORY_USAGE_PERCENT_UNIT };
    }
    return { kind: 'timeseries', unit: MEMORY_USAGE_PERCENT_UNIT, series: [{ name: 'Memory Usage', points: series }] };
  }

  if (metricRef === 'service.qps') {
    const aggregateFn = query?.aggregation === 'latest' ? 'last' : 'sum';
    const series = await queryTimeseries({
      measurementFilter: 'r["_measurement"] == "universe.request.total" or r["_measurement"] == "http_requests_total" or r["_measurement"] == "rpc_requests_total" or r["_measurement"] == "messaging_requests_total"',
      fieldFilter: 'r["_field"] == "value" or r["_field"] == "count" or r["_field"] == "total"',
      aggregateFn,
      timeRange,
      serviceId,
      star,
    });
    const intervalSeconds = Math.max(1, parseRangeSeconds(resolveInterval(timeRange)));
    const qpsSeries = series.map((point) => ({ timestamp: point.timestamp, value: toFixed(Number(point.value || 0) / intervalSeconds, 2) }));
    if (isSingleValueVisualization) {
      return { kind: 'number', value: qpsSeries.length ? qpsSeries[qpsSeries.length - 1].value : null };
    }
    return { kind: 'timeseries', series: [{ name: 'QPS', points: qpsSeries }] };
  }

  if (metricRef === 'service.response.time') {
    const aggregateFn = query?.aggregation === 'latest' ? 'last' : 'mean';
    const series = await queryTimeseries({
      measurementFilter: 'r["_measurement"] == "universe.request.time" or r["_measurement"] == "http_request_duration_ms" or r["_measurement"] == "http_request_duration" or r["_measurement"] == "rpc_duration_ms" or r["_measurement"] == "db_query_duration_ms"',
      fieldFilter: 'r["_field"] == "value" or r["_field"] == "duration" or r["_field"] == "latency" or r["_field"] == "response_time" or r["_field"] == "time"',
      aggregateFn,
      timeRange,
      serviceId,
      star,
    });
    if (isSingleValueVisualization) {
      return { kind: 'number', value: series.length ? series[series.length - 1].value : null, unit: 'ms' };
    }
    return { kind: 'timeseries', unit: 'ms', series: [{ name: 'Latency', points: series }] };
  }

  if (metricRef === 'service.error.rate') {
    const series = await queryErrorRateSeries({ timeRange, serviceId, star });
    if (isSingleValueVisualization) {
      const latest = getLatestPoint(series);
      return { kind: 'number', value: latest ? latest.value : null, unit: '%' };
    }
    return { kind: 'timeseries', unit: '%', series: [{ name: 'Error Rate', points: series }] };
  }

  if (metricRef === 'instance.cpu.usage' || metricRef === 'instance.memory.usage') {
    const rows = await serviceContext.getInstancesList({ serviceId: serviceId || '', scope: query?.scope });
    return {
      kind: 'table',
      columns: [
        { key: 'id', label: '实例' },
        { key: 'node', label: '节点' },
        { key: 'cpu', label: 'CPU' },
        { key: 'memory', label: '内存' },
        { key: 'status', label: '状态' },
      ],
      rows: Array.isArray(rows) ? rows.slice(0, Number(query?.limit || 6)) : [],
    };
  }

  if (metricRef === 'service.request.stats') {
    const bucket = getBucketNameOrThrow();
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
      map.set(label, (map.get(label) || 0) + Number(row._value || 0));
    });
    return {
      kind: 'distribution',
      items: Array.from(map.entries()).map(([name, value]) => ({ name, value: Math.round(value) })),
    };
  }

  return null;
};

function createMetricsQueryService() {
  const star = new Star({
    namespace: 'darwin-app',
    nodeID: `${APP_NAME}-${process.env.NODE_ENV || 'development'}-${Date.now()}`,
    transporter: {
      type: 'KAFKA',
      debug: true,
      host: KAFKA_BROKERS,
      options: {
        producer: { 'linger.ms': 0, 'batch.size': 0, acks: 1 },
        consumer: { 'fetch.min.bytes': 1, 'fetch.wait.max.ms': 100 },
        sasl:
          KAFKA_USER && KAFKA_PASSWORD
            ? { mechanism: 'plain', username: KAFKA_USER, password: KAFKA_PASSWORD }
            : undefined,
        ssl: false,
        groupId: `metrics-query-group-${process.env.NODE_ENV === 'development' ? Math.floor(Math.random() * 100000) : 'prod'}`,
        clientId: 'metrics-query-service',
        heartbeatInterval: 3000,
        sessionTimeout: 30000,
        requestTimeout: 60000,
        connectionTimeout: 10000,
      },
    },
    serializer: { type: 'NotePack' },
    cacher: {
      type: 'Redis',
      options: {
        redis: {
          host: REDIS_HOST,
          port: REDIS_PORT,
          password: REDIS_PASSWORD,
          db: REDIS_DB,
          retryDelayOnFailover: 100,
          maxRetriesPerRequest: 3,
        },
        prefix: 'metrics-query:',
        ttl: 3600,
      },
    },
    logger: true,
    metrics: {
      enabled: true,
      reporter: { type: 'Event' },
    },
  }) as Starlight;
  registerDarwinLogForwarding(star);

  const queryService = star.createService({
    name: APP_NAME,
    settings: {
      multiTenant: true,
      tenantIdField: 'tenantId',
      influxdb: {
        url: INFLUXDB_URL,
        token: INFLUXDB_TOKEN,
        org: INFLUXDB_ORG,
        bucket: INFLUXDB_BUCKET,
        timeout: 10000,
        retries: 3,
      },
    },
    async created() {
      this.logger.info('Metrics query service created');
    },
    async started() {
      await InfluxDBHandler.initialize(this.settings.influxdb, star);
      this.logger.info('InfluxDB connection initialized');
      this.logger.info('Metrics query service started successfully');
    },
    async stopped() {
      this.logger.info('Metrics query service stopped successfully');
    },
    methods: {
      async getInstancesList(params: { serviceId: string; scope?: 'tenant' | 'system' }) {
        const rawServiceId = String(params?.serviceId || '').trim();
        const scope = normalizeMetricsScope(params?.scope);
        const serviceId = rawServiceId.startsWith('system:') ? rawServiceId.slice('system:'.length) : rawServiceId;
        if (!serviceId || serviceId.startsWith('$')) return [];
        const nodes = star.registry?.getNodeList({ onlyAvaiable: true, withServices: true }) || [];
        const instances: any[] = [];
        nodes.forEach((node: any) => {
          const services = Array.isArray(node.services)
            ? node.services
                .map((item: any) => item?.name)
                .filter((name: string) => Boolean(name) && !String(name).startsWith('$'))
            : [];
          if (services.includes(serviceId)) {
            instances.push({
              id: `${node.id}-${serviceId}`,
              serviceId: scope === 'system' ? `system:${serviceId}` : serviceId,
              node: node.hostname || node.id,
              status: node.available ? 'running' : 'error',
              cpu: typeof node.cpu === 'number' ? Math.min(100, Math.max(0, Number(node.cpu))) : 0,
              memory: null,
              startTime: null,
            });
          }
        });
        return instances;
      },
      async getServicesList(params: { page?: number; pageSize?: number; status?: string | string[]; keyword?: string; scope?: 'tenant' | 'system' }) {
        return await buildServiceCatalogSnapshot(
          {
            page: Number(params?.page || 1),
            pageSize: Number(params?.pageSize || 10),
            status: params?.status,
            keyword: params?.keyword,
            scope: normalizeMetricsScope(params?.scope),
          },
          star,
        );
      },
    },
    actions: {
      'v2.schema': {
        metadata: { auth: true },
        params: {
          scope: { type: 'string', optional: true },
          sourceKind: { type: 'string', optional: true },
          serviceId: { type: 'string', optional: true },
        },
        async handler(ctx: Context): Promise<HttpResponseItem> {
          try {
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
            const sourceKind = ['auto', 'sdk', 'darwin-event', 'mixed'].includes(String(ctx.params?.sourceKind || ''))
              ? (ctx.params?.sourceKind as 'auto' | 'sdk' | 'darwin-event' | 'mixed')
              : undefined;
            const serviceId = String(ctx.params?.serviceId || '').trim() || undefined;

            return {
              status: 200,
              data: {
                code: HttpResponseCode.Success,
                content: {
                  items: buildSupportedMetricSchema({ scope, sourceKind, serviceId }),
                },
                message: '获取指标 schema 成功',
                success: true,
              },
            };
          } catch (error) {
            star.logger?.error('Get metrics schema failed:', error);
            return {
              status: 500,
              data: {
                code: HttpResponseCode.ServiceActionFaild,
                content: null,
                message: '获取指标 schema 失败',
                success: false,
              },
            };
          }
        },
      },
      'v2.query.cards': {
        metadata: { auth: true },
        params: {
          refreshGenerationId: { type: 'string', required: true },
          context: { type: 'object', required: true },
          cards: { type: 'array', required: true },
        },
        async handler(ctx: Context): Promise<HttpResponseItem> {
          const startedAt = Date.now();
          try {
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

            const scope = normalizeMetricsScope(ctx.params?.context?.scope || ctx.params?.scope);
            const cards = Array.isArray(ctx.params?.cards) ? ctx.params.cards : [];
            const items = await Promise.all(
              cards.map(async (card: any) => {
                const cardStartedAt = Date.now();
                try {
                  const validation = validateQuerySpec(
                    { ...(card?.query || {}), scope: card?.query?.scope || scope },
                    normalizeMetricsScope
                  );
                  if (!validation.valid) {
                    return {
                      cardId: String(card?.cardId || ''),
                      status: 'error',
                      startedAt: cardStartedAt,
                      finishedAt: Date.now(),
                      error: { code: 'INVALID_QUERY_SPEC', message: validation.issues.join('; ') },
                    };
                  }
                  const data = await buildCardDataFromQuery(validation.normalizedQuery, star, this as any);
                  if (!data) {
                    return {
                      cardId: String(card?.cardId || ''),
                      status: 'error',
                      startedAt: cardStartedAt,
                      finishedAt: Date.now(),
                      error: { code: 'UNSUPPORTED_METRIC_REF', message: `Unsupported metricRef: ${validation.normalizedQuery.metricRef || 'unknown'}` },
                    };
                  }
                  return {
                    cardId: String(card?.cardId || ''),
                    status: 'success',
                    startedAt: cardStartedAt,
                    finishedAt: Date.now(),
                    data,
                    cache: { hit: false },
                  };
                } catch (error: any) {
                  return {
                    cardId: String(card?.cardId || ''),
                    status: 'error',
                    startedAt: cardStartedAt,
                    finishedAt: Date.now(),
                    error: { code: 'QUERY_EXECUTION_FAILED', message: error?.message || 'Query execution failed' },
                  };
                }
              }),
            );

            return {
              status: 200,
              data: {
                code: HttpResponseCode.Success,
                content: {
                  refreshGenerationId: String(ctx.params.refreshGenerationId),
                  items,
                  startedAt,
                  finishedAt: Date.now(),
                },
                message: '查询卡片数据成功',
                success: true,
              },
            };
          } catch (error) {
            star.logger?.error('Query metric cards failed:', error);
            return {
              status: 500,
              data: {
                code: HttpResponseCode.ServiceActionFaild,
                content: null,
                message: '查询卡片数据失败',
                success: false,
              },
            };
          }
        },
      },
      'v2.query.preview': {
        metadata: { auth: true },
        params: {
          scope: { type: 'string', required: true },
          query: { type: 'object', required: true },
        },
        async handler(ctx: Context): Promise<HttpResponseItem> {
          try {
            assertSystemScopeAllowed(ctx);
            const validation = validateQuerySpec(
              { ...(ctx.params?.query || {}), scope: ctx.params?.query?.scope || ctx.params?.scope },
              normalizeMetricsScope
            );
            if (!validation.valid) {
              return {
                status: 200,
                data: {
                  code: HttpResponseCode.Success,
                  content: { supported: true, data: null, issues: validation.issues },
                  message: '查询预览校验失败',
                  success: true,
                },
              };
            }
            const data = await buildCardDataFromQuery(validation.normalizedQuery, star, this as any);
            return {
              status: 200,
              data: {
                code: HttpResponseCode.Success,
                content: { supported: true, data },
                message: '查询预览成功',
                success: true,
              },
            };
          } catch (error) {
            return {
              status: 200,
              data: {
                code: HttpResponseCode.Success,
                content: { supported: false, data: null },
                message: '查询预览暂不可用',
                success: true,
              },
            };
          }
        },
      },
      'v2.query.validate': {
        metadata: { auth: true },
        params: {
          scope: { type: 'string', required: true },
          query: { type: 'object', required: true },
        },
        async handler(ctx: Context): Promise<HttpResponseItem> {
          try {
            assertSystemScopeAllowed(ctx);
            const validation = validateQuerySpec(
              { ...(ctx.params?.query || {}), scope: ctx.params?.query?.scope || ctx.params?.scope },
              normalizeMetricsScope
            );
            return {
              status: 200,
              data: {
                code: HttpResponseCode.Success,
                content: { supported: true, valid: validation.valid, issues: validation.issues },
                message: '查询校验成功',
                success: true,
              },
            };
          } catch (error: any) {
            return {
              status: 200,
              data: {
                code: HttpResponseCode.Success,
                content: { supported: true, valid: false, issues: [error?.message || '查询校验失败'] },
                message: '查询校验失败',
                success: true,
              },
            };
          }
        },
      },
      'v2.query.compile': {
        metadata: { auth: true },
        params: {
          scope: { type: 'string', required: true },
          query: { type: 'object', required: true },
        },
        async handler(ctx: Context): Promise<HttpResponseItem> {
          assertSystemScopeAllowed(ctx);
          const validation = validateQuerySpec(
            { ...(ctx.params?.query || {}), scope: ctx.params?.query?.scope || ctx.params?.scope },
            normalizeMetricsScope
          );
          return {
            status: 200,
            data: {
              code: HttpResponseCode.Success,
              content: {
                supported: validation.valid,
                script: JSON.stringify({ type: 'queryspec', query: validation.normalizedQuery }, null, 2),
                language: 'queryspec-json',
                issues: validation.issues,
              },
              message: validation.valid ? '查询编译成功' : '查询编译校验失败',
              success: true,
            },
          };
        },
      },
    },
  });

  return { star, queryService };
}

async function startMetricsQueryService() {
  try {
    const { star } = createMetricsQueryService();
    await star.start();
    star.logger?.info(`微服务 ${APP_NAME.toUpperCase()} 启动成功`);
    process.on('SIGINT', async () => {
      star.logger?.info('Received SIGINT, shutting down gracefully...');
      await star.stop();
      process.exit(0);
    });
    return { star };
  } catch (error) {
    console.error('Failed to start metrics query service:', error);
    process.exit(1);
  }
}

export { createMetricsQueryService, startMetricsQueryService };
export default startMetricsQueryService;

if (require.main === module) {
  startMetricsQueryService();
}
