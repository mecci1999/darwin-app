import { Star } from 'node-universe';
import { isTransportDebugEnabled } from 'config';
import { Starlight } from 'typings';
import { registerDarwinLogForwarding } from '../logs/utils/darwin-log-capture';
import alerts, { evaluateAlertRules } from '../metrics/actions/alerts';
import { buildServiceCatalogSnapshot } from '../metrics/utils/service-catalog';
import { InfluxDBHandler } from '../metrics/utils/influxdb-handler';
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

function createMetricsAlertsService() {
  const star = new Star({
    namespace: 'darwin-app',
    nodeID: `${APP_NAME}-${process.env.NODE_ENV || 'development'}`,
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
      this.logger.info('Metrics alerts service created');
      (this as any).redis = (star as any).cacher;
    },
    async started() {
      await InfluxDBHandler.initialize(this.settings.influxdb, star);
      const runEvaluation = async () => {
        try {
          this.logger.info('[AlertEval] ===== evaluation cycle starting =====');
          const results = await evaluateAlertRules(this as any, star);
          this.logger.info(
            `[AlertEval] ===== evaluation cycle done: ${results.length} rules evaluated =====`,
          );
        } catch (error) {
          this.logger.error('[AlertEval] Metrics alert rule evaluation failed:', error);
        }
      };
      await runEvaluation();
      (this as any).alertEvaluationTimer = setInterval(runEvaluation, ALERT_EVALUATION_INTERVAL_MS);
      this.logger.info('Metrics alerts service started successfully');
    },
    async stopped() {
      if ((this as any).alertEvaluationTimer) {
        clearInterval((this as any).alertEvaluationTimer);
        (this as any).alertEvaluationTimer = null;
      }
      this.logger.info('Metrics alerts service stopped successfully');
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
