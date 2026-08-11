import { Star } from 'node-universe';
import { isTransportDebugEnabled } from 'config';
import { Starlight } from 'typings';
import { registerDarwinLogForwarding } from '../logs/utils/darwin-log-capture';
import alerts, { evaluateAlertRules } from '../metrics/actions/alerts';
import { buildServiceCatalogSnapshot } from '../metrics/utils/service-catalog';
import { InfluxDBHandler } from '../metrics/utils/influxdb-handler';
import { AlertOutboxRepository, getAlertOutboxRepository, PendingAlertDelivery } from './alert-outbox';
import { instrumentServiceActions } from '../metrics/utils/action-metrics';
import '../../../utils/loadEnv';
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

const APP_NAME = 'metrics-alerts';
const ALERT_EVALUATION_INTERVAL_MS = 60 * 1000;
const DELIVERY_WORKER_INTERVAL_MS = 5_000;
const DELIVERY_BATCH_SIZE = 10;
const DELIVERY_TIMEOUT_MS = 10_000;
const EVALUATION_LEASE_SECONDS = 55;

type RedisLeaseClient = { set: (key: string, value: string, mode: 'EX', ttl: string, condition: 'NX') => Promise<'OK' | null> };
type RedisLeaseCacher = { client?: RedisLeaseClient; redis?: RedisLeaseClient; setIfNotExists?: (key: string, value: string, ttl: number) => Promise<boolean> };
type MetricsAlertsLifecycleService = {
  redis?: RedisLeaseCacher;
  alertOutboxRepository?: AlertOutboxRepository;
  alertEvaluationTimer?: NodeJS.Timeout;
  alertDeliveryTimer?: NodeJS.Timeout;
  settings: { influxdb: { url: string; token: string; org: string; bucket: string } };
  logger: { info: (message: string) => void; warn: (message: string, error?: unknown) => void; error: (message: string, error?: unknown) => void };
};

const acquireEvaluationLease = async (service: unknown): Promise<boolean> => {
  const redis = (service as { redis?: RedisLeaseCacher }).redis;
  if (!redis) return true;
  const token = `${process.pid}-${Date.now()}`;
  if (typeof redis.setIfNotExists === 'function') return redis.setIfNotExists('metrics:alerts:evaluation:lease', token, EVALUATION_LEASE_SECONDS);
  const client = redis.client || redis.redis;
  if (!client) return true;
  return (await client.set('metrics:alerts:evaluation:lease', token, 'EX', String(EVALUATION_LEASE_SECONDS), 'NX')) === 'OK';
};

const withTimeout = async <T>(operation: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('InApp delivery timed out')), timeoutMs); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
};

const deliverInApp = async (star: Starlight, delivery: PendingAlertDelivery) => {
  if (delivery.channel !== 'InApp') throw new Error(`No delivery transport configured for ${delivery.channel}`);
  if (typeof star.call !== 'function') throw new Error('Gateway WebSocket action is unavailable');
  await withTimeout(star.call('gateway.websocket.trigger', { eventName: 'alert', data: { ...delivery.payload, tenantId: delivery.tenantId, alertId: delivery.alertId, target: delivery.target } }), DELIVERY_TIMEOUT_MS);
};

function createMetricsAlertsService() {
  const star = new Star({
    namespace: 'darwin-app',
    nodeID: `${APP_NAME}-${process.env.NODE_ENV || 'development'}-${process.env.NODE_INSTANCE_ID || process.env.HOSTNAME || process.pid}`,
    transporter: {
      type: 'KAFKA',
      debug: isTransportDebugEnabled(),
      host: KAFKA_BROKERS,
      options: {
        producer: {
          'linger.ms': 0,
          'batch.size': 0,
          acks: 1,
        },
        consumer: {
          'fetch.min.bytes': 1,
          'fetch.wait.max.ms': 100,
        },
        sasl:
          KAFKA_USER && KAFKA_PASSWORD
            ? {
                mechanism: 'plain',
                username: KAFKA_USER,
                password: KAFKA_PASSWORD,
              }
            : undefined,
        ssl: false,
        groupId: `metrics-alerts-group-${process.env.NODE_ENV === 'development' ? Math.floor(Math.random() * 100000) : 'prod'}`,
        clientId: 'metrics-alerts-service',
        heartbeatInterval: 3000,
        sessionTimeout: 30000,
        requestTimeout: 60000,
        connectionTimeout: 10000,
      },
    },
    serializer: {
      type: 'NotePack',
    },
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
        prefix: 'metrics-alerts:',
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

  const alertsService = star.createService({
    name: APP_NAME,
    settings: {
      multiTenant: true,
      tenantIdField: 'tenantId',
      influxdb: {
        url: INFLUXDB_URL,
        token: INFLUXDB_TOKEN,
        org: INFLUXDB_ORG,
        bucket: INFLUXDB_BUCKET,
      },
    },
    async created() {
      const service = this as unknown as MetricsAlertsLifecycleService;
      service.logger.info('Metrics alerts service created');
      service.redis = star.cacher as unknown as RedisLeaseCacher;
    },
    async started() {
      const service = this as unknown as MetricsAlertsLifecycleService;
      await InfluxDBHandler.initialize(service.settings.influxdb, star);
      service.alertOutboxRepository = await getAlertOutboxRepository();
      let evaluationInFlight = false;
      let deliveryInFlight = false;
      const runEvaluation = async () => {
        if (evaluationInFlight) return;
        evaluationInFlight = true;
        try {
          if (!(await acquireEvaluationLease(service))) return;
          await evaluateAlertRules(service, star);
        } catch (error) {
          service.logger.error('[AlertEval] Metrics alert rule evaluation failed:', error);
        } finally {
          evaluationInFlight = false;
        }
      };
      const runDeliveryWorker = async () => {
        if (deliveryInFlight) return;
        deliveryInFlight = true;
        try {
          const repository = service.alertOutboxRepository;
          if (!repository) throw new Error('Alert outbox repository is not initialized');
          const claimed = await repository.claimPendingDeliveries(`${APP_NAME}-${process.pid}`, DELIVERY_BATCH_SIZE);
          for (const delivery of claimed) {
            try { await deliverInApp(star, delivery); await repository.completeDelivery(delivery); }
            catch (error) { await repository.failDelivery(delivery, error); service.logger.warn(`[AlertDelivery] delivery=${delivery.deliveryId} retry scheduled`, error); }
          }
        } catch (error) { service.logger.error('[AlertDelivery] worker run failed:', error); }
        finally { deliveryInFlight = false; }
      };
      await runEvaluation();
      await runDeliveryWorker();
      service.alertEvaluationTimer = setInterval(runEvaluation, ALERT_EVALUATION_INTERVAL_MS);
      service.alertDeliveryTimer = setInterval(runDeliveryWorker, DELIVERY_WORKER_INTERVAL_MS);
      service.logger.info('Metrics alerts service started successfully');
    },
    async stopped() {
      const service = this as unknown as MetricsAlertsLifecycleService;
      if (service.alertEvaluationTimer) {
        clearInterval(service.alertEvaluationTimer);
        service.alertEvaluationTimer = undefined;
      }
      if (service.alertDeliveryTimer) {
        clearInterval(service.alertDeliveryTimer);
        service.alertDeliveryTimer = undefined;
      }
      service.logger.info('Metrics alerts service stopped successfully');
    },
    methods: {
      async getServicesList(params: {
        page?: number;
        pageSize?: number;
        status?: string;
        keyword?: string;
      }) {
        return await buildServiceCatalogSnapshot(
          {
            page: Number(params?.page || 1),
            pageSize: Number(params?.pageSize || 10),
            status: params?.status,
            keyword: params?.keyword,
            scope: 'tenant',
          },
          star,
        );
      },
    },
    actions: instrumentServiceActions(star, APP_NAME, alerts(star)),
  });

  return { star, alertsService };
}

async function startMetricsAlertsService() {
  try {
    const { star } = createMetricsAlertsService();
    await star.start();
    star.logger?.info(`微服务 ${APP_NAME.toUpperCase()} 启动成功`);

    process.on('SIGINT', async () => {
      star.logger?.info('Received SIGINT, shutting down gracefully...');
      await star.stop();
      process.exit(0);
    });

    return { star };
  } catch (error) {
    console.error('Failed to start metrics alerts service:', error);
    process.exit(1);
  }
}

export { createMetricsAlertsService, startMetricsAlertsService };
export default startMetricsAlertsService;

if (require.main === module) {
  startMetricsAlertsService();
}
