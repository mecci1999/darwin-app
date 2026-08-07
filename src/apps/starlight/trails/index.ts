import { DEFAULT_LOG_CATEGORY_ENABLED, isTransportDebugEnabled } from 'config';
import { Star } from 'node-universe';
import { Starlight } from 'typings';
import { registerDarwinLogForwarding } from 'apps/starlight/logs/utils/darwin-log-capture';
import '../../../utils/loadEnv';
import trailsActions from './actions';
import { APP_NAME, KAFKA_BROKERS, KAFKA_CLIENT_ID, KAFKA_GROUP_ID, KAFKA_PASSWORD, KAFKA_USER, REDIS_DB, REDIS_HOST, REDIS_PASSWORD, REDIS_PORT } from './constants';
import { InMemoryTrailsRepository } from './repository';
import { TrailsState } from './types';
import { durableTrailsPersistenceEnabled } from './durable-persistence';
import { DurableCategorySyncLifecycle } from './durable-category-sync-lifecycle';

export { durableTrailsPersistenceEnabled } from './durable-persistence';
export { durableCategorySyncEnabled } from './durable-category-sync';

/** Fail closed until a gateway/cache-backed abuse policy is supplied in a production composition root. */
const createTrailsState = (): TrailsState => ({
  repository: new InMemoryTrailsRepository(),
  antiAbuse: { async assessSubmission() { return { allowed: false, reason: 'anti-abuse service is not configured' }; } },
});

export function createTrailsService() {
  const durablePersistenceEnabled = durableTrailsPersistenceEnabled();
  const trailsState = createTrailsState();
  const durableCategorySyncLifecycle = durablePersistenceEnabled ? new DurableCategorySyncLifecycle() : undefined;
  const star = new Star({
    namespace: 'darwin-app', nodeID: `${APP_NAME}-${process.env.NODE_ENV || 'development'}-${process.env.NODE_INSTANCE_ID || process.env.HOSTNAME || process.pid}`,
    transporter: {
      type: 'KAFKA', debug: isTransportDebugEnabled(), host: KAFKA_BROKERS,
      options: { producer: { 'linger.ms': 0, 'batch.size': 0, acks: 1 }, consumer: { 'fetch.min.bytes': 1, 'fetch.wait.max.ms': 100 }, sasl: KAFKA_USER && KAFKA_PASSWORD ? { mechanism: 'plain', username: KAFKA_USER, password: KAFKA_PASSWORD } : undefined, ssl: false, groupId: `${KAFKA_GROUP_ID}-${process.env.NODE_ENV === 'development' ? Math.floor(Math.random() * 100000) : 'prod'}`, clientId: KAFKA_CLIENT_ID, heartbeatInterval: 3000, sessionTimeout: 30000, requestTimeout: 60000, connectionTimeout: 10000 },
    },
    serializer: { type: 'NotePack' }, cacher: { type: 'Redis', clone: true, options: { redis: { port: REDIS_PORT, host: REDIS_HOST, password: REDIS_PASSWORD, db: REDIS_DB } } },
    logger: { type: 'Console', options: { level: 'info', categories: DEFAULT_LOG_CATEGORY_ENABLED } }, metrics: { enabled: true, reporter: { type: 'Event' } },
  }) as Starlight;
  registerDarwinLogForwarding(star);
  const service = star.createService({
    name: APP_NAME, actions: trailsActions(star, trailsState), methods: {},
    created() {
      if (durablePersistenceEnabled) {
        this.logger.info('Trails durable MySQL persistence is enabled');
      }
      this.logger.info('Trails service created with development-only in-memory repository for v1');
    },
    async started() {
      if (durableCategorySyncLifecycle) await durableCategorySyncLifecycle.start(trailsState);
      this.logger.info('Trails service started');
    },
    async stopped() {
      if (durableCategorySyncLifecycle) await durableCategorySyncLifecycle.stop(trailsState);
      this.logger.info('Trails service stopped');
    },
  });
  return { star, service };
}

export async function startTrailsService() {
  try {
    const { star, service } = createTrailsService();
    await star.start();
    star.logger?.info(`微服务 ${APP_NAME.toUpperCase()} 启动成功`);
    process.on('SIGINT', async () => { await star.stop(); process.exit(0); });
    process.on('SIGTERM', async () => { await star.stop(); process.exit(0); });
    return { star, service };
  } catch (error: unknown) {
    console.error('Failed to start trails service:', error);
    process.exit(1);
  }
}

export default startTrailsService;
if (require.main === module) startTrailsService();
