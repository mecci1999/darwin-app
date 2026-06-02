import { Star } from 'node-universe';
import { isTransportDebugEnabled } from 'config';
import { Starlight } from 'typings';
import { registerDarwinLogForwarding } from '../logs/utils/darwin-log-capture';
import alerts from '../metrics/actions/alerts';
import { buildServiceCatalogSnapshot } from '../metrics/utils/service-catalog';
import '../../../utils/loadEnv';
import {
  KAFKA_BROKERS,
  KAFKA_PASSWORD,
  KAFKA_USER,
  REDIS_DB,
  REDIS_HOST,
  REDIS_PASSWORD,
  REDIS_PORT,
} from '../metrics/constants';

const APP_NAME = 'metrics-alerts';

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
    },
    async created() {
      this.logger.info('Metrics alerts service created');
      (this as any).redis = (star as any).cacher;
    },
    async started() {
      this.logger.info('Metrics alerts service started successfully');
    },
    async stopped() {
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
    actions: alerts(star),
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
