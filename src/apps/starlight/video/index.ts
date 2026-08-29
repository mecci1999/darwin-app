import { DEFAULT_LOG_CATEGORY_ENABLED, isTransportDebugEnabled } from 'config';
import { Star } from 'node-universe';
import { Starlight } from 'typings';
import { registerDarwinLogForwarding } from 'apps/starlight/logs/utils/darwin-log-capture';
import { installDarwinKafkaRecoveryLifecycle } from 'core/kafka-recovery-lifecycle';
import { createKafkaConsumerOptions, createServiceMetricsOptions, stabilizeNodeUniverseInstanceId } from 'core/runtime-observability';
import '../../../utils/loadEnv';
import videoActions from './actions';
import {
  APP_NAME,
  KAFKA_BROKERS,
  KAFKA_CLIENT_ID,
  KAFKA_GROUP_ID,
  KAFKA_PASSWORD,
  KAFKA_USER,
  REDIS_DB,
  REDIS_HOST,
  REDIS_PASSWORD,
  REDIS_PORT,
} from './constants';
import { VideoState } from './types';

const videoState: VideoState = {
  tasks: new Map(),
};

export function createVideoService() {
  const star = new Star({
    namespace: 'darwin-app',
    nodeID: `${APP_NAME}-${process.env.NODE_ENV || 'development'}-${process.env.NODE_INSTANCE_ID || process.env.HOSTNAME || process.pid}`,
    transporter: {
      type: 'KAFKA',
      debug: isTransportDebugEnabled(),
      host: KAFKA_BROKERS,
      options: {
        producer: { 'linger.ms': 0, 'batch.size': 0, acks: 1 },
        consumer: createKafkaConsumerOptions(),
        sasl: KAFKA_USER && KAFKA_PASSWORD ? { mechanism: 'plain', username: KAFKA_USER, password: KAFKA_PASSWORD } : undefined,
        ssl: false,
        groupId: `${KAFKA_GROUP_ID}-${process.env.NODE_ENV === 'development' ? Math.floor(Math.random() * 100000) : 'prod'}`,
        clientId: KAFKA_CLIENT_ID,
        heartbeatInterval: 3000,
        sessionTimeout: 30000,
        requestTimeout: 60000,
        connectionTimeout: 10000,
      },
    },
    serializer: { type: 'NotePack' },
    cacher: {
      type: 'Redis',
      clone: true,
      options: { redis: { port: REDIS_PORT, host: REDIS_HOST, password: REDIS_PASSWORD, db: REDIS_DB } },
    },
    logger: { type: 'Console', options: { level: 'info', categories: DEFAULT_LOG_CATEGORY_ENABLED } },
    metrics: createServiceMetricsOptions(),
  }) as Starlight;
  stabilizeNodeUniverseInstanceId(star);
  registerDarwinLogForwarding(star);
    installDarwinKafkaRecoveryLifecycle(star);

  const service = star.createService({
    name: APP_NAME,
    actions: videoActions(star, videoState),
    methods: {},
    created() {
      this.logger.info('Video service created');
    },
    started() {
      this.logger.info('Video service started');
    },
    stopped() {
      videoState.tasks.clear();
      this.logger.info('Video service stopped');
    },
  });

  return { star, service };
}

export async function startVideoService() {
  try {
    const { star, service } = createVideoService();
    await star.start();
    star.logger?.info(`微服务 ${APP_NAME.toUpperCase()} 启动成功`);
    process.on('SIGINT', async () => {
      await star.stop();
      process.exit(0);
    });
    process.on('SIGTERM', async () => {
      await star.stop();
      process.exit(0);
    });
    return { star, service };
  } catch (error) {
    console.error('Failed to start video service:', error);
    process.exit(1);
  }
}

export default startVideoService;

if (require.main === module) {
  startVideoService();
}
