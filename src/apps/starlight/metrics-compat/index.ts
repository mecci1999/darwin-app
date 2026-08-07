import '../../../utils/loadEnv';
import { isTransportDebugEnabled } from 'config';
import { Context, Star } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, Starlight } from 'typings';
import { registerDarwinLogForwarding } from '../logs/utils/darwin-log-capture';
import { InfluxDBHandler } from '../metrics/utils/influxdb-handler';
import {
  RESPONSE_DURATION_COMPLETED_REQUEST_FILTER,
  RESPONSE_DURATION_FIELD_FILTER,
  RESPONSE_DURATION_MEASUREMENT_FILTER,
  RESPONSE_DURATION_MS_NORMALIZATION_FLUX,
} from '../metrics/utils/duration-metrics';
import { MEMORY_USAGE_UNIT, normalizeRssMemoryValue } from '../metrics/utils/memory-units';
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
import { assertSystemScopeAllowed, normalizeMetricsScope } from '../metrics/utils/system-telemetry';
import { buildServiceCatalogSnapshot } from '../metrics/utils/service-catalog';
import { instrumentServiceActions } from '../metrics/utils/action-metrics';

const APP_NAME = 'metrics-compat';

const createSystemScopeForbidden = (): HttpResponseItem => ({
  status: 403,
  data: {
    code: HttpResponseCode.NoPermissionError,
    content: null,
    message: 'System metrics are admin only',
    success: false,
  },
});

const toFixed = (value: number, digits = 2) => Number(value.toFixed(digits));

const normalizeSeries = (
  rows: any[],
  normalizeValue: (value: unknown) => number = (value) => toFixed(Number(value || 0), 2),
) =>
  rows
    .filter((row) => row?._time && row?._value !== undefined && row?._value !== null)
    .map((row) => ({
      timestamp: new Date(row._time).getTime(),
      value: normalizeValue(row._value),
    }))
    .sort((a, b) => a.timestamp - b.timestamp);

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
  const normalizedServiceId = serviceId?.startsWith('system:')
    ? serviceId.slice('system:'.length)
    : serviceId;
  const filter = normalizedServiceId
    ? `|> filter(fn: (r) => r["service"] == "${normalizedServiceId}")`
    : '';
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
  const normalizedServiceId = serviceId?.startsWith('system:')
    ? serviceId.slice('system:'.length)
    : serviceId;
  const filter = normalizedServiceId
    ? `|> filter(fn: (r) => r["service"] == "${normalizedServiceId}")`
    : '';
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

const buildCatalogServiceDetailContent = async (
  serviceId: string,
  serviceContext: any,
  scope: 'tenant' | 'system',
) => {
  const servicesResult = await serviceContext.getServicesList({ page: 1, pageSize: 200, scope });
  const services = Array.isArray(servicesResult?.services) ? servicesResult.services : [];
  const service = services.find((item: any) => item.id === serviceId);
  if (!service) return null;

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

function createMetricsCompatService() {
  const star = new Star({
    namespace: 'darwin-app',
    nodeID: `${APP_NAME}-${process.env.NODE_ENV || 'development'}-${process.env.NODE_INSTANCE_ID || process.env.HOSTNAME || process.pid}`,
    transporter: {
      type: 'KAFKA',
      debug: isTransportDebugEnabled(),
      host: KAFKA_BROKERS,
      options: {
        producer: { 'linger.ms': 0, 'batch.size': 0, acks: 1 },
        consumer: { 'fetch.min.bytes': 1, 'fetch.wait.max.ms': 100 },
        sasl:
          KAFKA_USER && KAFKA_PASSWORD
            ? { mechanism: 'plain', username: KAFKA_USER, password: KAFKA_PASSWORD }
            : undefined,
        ssl: false,
        groupId: `metrics-compat-group-${process.env.NODE_ENV === 'development' ? Math.floor(Math.random() * 100000) : 'prod'}`,
        clientId: 'metrics-compat-service',
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
        prefix: 'metrics-compat:',
        ttl: 3600,
      },
    },
    logger: true,
    metrics: {
      enabled: true,
      reporter: {
        type: 'Event',
      },
    },
  }) as Starlight;
  registerDarwinLogForwarding(star);

  const compatService = star.createService({
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
      this.logger.info('Metrics compat service created');
    },
    async started() {
      await InfluxDBHandler.initialize(this.settings.influxdb, star);
      this.logger.info('InfluxDB connection initialized');
      this.logger.info('Metrics compat service started successfully');
    },
    async stopped() {
      this.logger.info('Metrics compat service stopped successfully');
    },
    methods: {
      async getServicesList(params: {
        page?: number;
        pageSize?: number;
        status?: string;
        keyword?: string;
        scope?: 'tenant' | 'system';
      }) {
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
    actions: instrumentServiceActions(star, APP_NAME, {
      'v1.realtime': {
        metadata: { auth: true },
        params: {
          serviceId: { type: 'string', optional: true },
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
            const data = await InfluxDBHandler.getRealtimeStats(serviceId, star);
            const cpu = Number(data?.cpu || 0);
            const memory = Number(data?.memory || 0);
            const responseTime = Number(data?.responseTime || 0);
            const errorRate = Number(data?.errorRate || 0);
            const qps = Number(data?.qps || 0);
            const activeConnections = Number(data?.activeConnections || 0);
            const [cpuSeries, memorySeries, responseSeries] = await Promise.all([
              buildSystemSeries('cpu_usage', '-12m', '1m', serviceId, star),
              buildSystemSeries('memory_usage', '-12m', '1m', serviceId, star, normalizeRssMemoryValue),
              buildDurationSeries('-12m', '1m', serviceId, star),
            ]);
            const systemStatus = [
              {
                name: '节点负载',
                status: cpu > 0 ? (cpu > 80 ? 'warning' : 'healthy') : 'warning',
                value: toFixed(cpu, 1),
                unit: '%',
              },
              {
                name: '内存压力',
                status: memory > 0 ? 'healthy' : 'warning',
                value: toFixed(memory, 1),
                unit: MEMORY_USAGE_UNIT,
              },
              {
                name: '请求延迟',
                status: responseTime > 0 ? (responseTime > 150 ? 'warning' : 'healthy') : 'warning',
                value: Math.round(responseTime),
                unit: 'ms',
              },
              {
                name: '错误率',
                status: qps > 0 ? (errorRate > 0.02 ? 'critical' : 'healthy') : 'warning',
                value: toFixed(errorRate * 100, 2),
                unit: '%',
              },
            ];
            return {
              status: 200,
              data: {
                code: HttpResponseCode.Success,
                content: {
                  summary: {
                    cpu: toFixed(cpu, 1),
                    memory: toFixed(memory, 1),
                    qps: Math.round(qps),
                    responseTime: Math.round(responseTime),
                    errorRate: toFixed(errorRate * 100, 2),
                    activeConnections: Math.round(activeConnections),
                  },
                  series: { cpu: cpuSeries, memory: memorySeries, responseTime: responseSeries },
                  systemStatus,
                },
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
      'v1.catalog.service.detail': {
        metadata: { auth: true },
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
            const content = await buildCatalogServiceDetailContent(serviceId, this as any, scope);
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
                message: '获取服务目录详情成功',
                success: true,
              },
            };
          } catch (error) {
            star.logger?.error('Get catalog service detail failed:', error);
            return {
              status: 500,
              data: {
                code: HttpResponseCode.ServiceActionFaild,
                content: null,
                message: '获取服务目录详情失败',
                success: false,
              },
            };
          }
        },
      },
    }),
  });

  return { star, compatService };
}

async function startMetricsCompatService() {
  try {
    const { star } = createMetricsCompatService();
    await star.start();
    star.logger?.info(`微服务 ${APP_NAME.toUpperCase()} 启动成功`);
    process.on('SIGINT', async () => {
      star.logger?.info('Received SIGINT, shutting down gracefully...');
      await star.stop();
      process.exit(0);
    });
    return { star };
  } catch (error) {
    console.error('Failed to start metrics compat service:', error);
    process.exit(1);
  }
}

export { createMetricsCompatService, startMetricsCompatService };
export default startMetricsCompatService;

if (require.main === module) {
  startMetricsCompatService();
}
