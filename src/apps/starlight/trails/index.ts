import { DEFAULT_LOG_CATEGORY_ENABLED, isTransportDebugEnabled } from 'config';
import { Star } from 'node-universe';
import { Starlight } from 'typings';
import { registerDarwinLogForwarding } from 'apps/starlight/logs/utils/darwin-log-capture';
import '../../../utils/loadEnv';
import trailsActions from './actions';
import { KAFKA_BROKERS, KAFKA_CLIENT_ID, KAFKA_GROUP_ID, KAFKA_PASSWORD, KAFKA_USER, REDIS_DB, REDIS_HOST, REDIS_PASSWORD, REDIS_PORT } from './constants';
import { InMemoryTrailsRepository } from './repository';
import { TrailsState } from './types';
import { durableTrailsPersistenceEnabled } from './durable-persistence';
import { DurableCategorySyncLifecycle } from './durable-category-sync-lifecycle';
import { isTrailsRuntime, selectTrailsShardActions, TrailsRuntime, trailsShardNamesForRuntime } from './shards';

export { durableTrailsPersistenceEnabled } from './durable-persistence';
export { durableCategorySyncEnabled } from './durable-category-sync';

/** Fail closed until a gateway/cache-backed abuse policy is supplied in a production composition root. */
const createTrailsState = (): TrailsState => ({
  repository: new InMemoryTrailsRepository(),
  antiAbuse: { async assessSubmission() { return { allowed: false, reason: 'anti-abuse service is not configured' }; } },
});

const trailsRuntimeFromEnvironment = (): TrailsRuntime => {
  const runtime = process.env.TRAILS_RUNTIME || 'all';
  if (!isTrailsRuntime(runtime)) throw new Error(`Invalid Trails runtime '${runtime}'`);
  return runtime;
};

export function createTrailsService(runtime = trailsRuntimeFromEnvironment()) {
  const durablePersistenceEnabled = durableTrailsPersistenceEnabled();
  const trailsState = createTrailsState();
  const durableCategorySyncLifecycle = runtime !== 'v1' && durablePersistenceEnabled
    ? new DurableCategorySyncLifecycle()
    : undefined;
  const star = new Star({
    namespace: 'darwin-app', nodeID: `trails-${runtime}-${process.env.NODE_ENV || 'development'}-${process.env.NODE_INSTANCE_ID || process.env.HOSTNAME || process.pid}`,
    transporter: {
      type: 'KAFKA', debug: isTransportDebugEnabled(), host: KAFKA_BROKERS,
      options: { producer: { 'linger.ms': 0, 'batch.size': 0, acks: 1 }, consumer: { 'fetch.min.bytes': 1, 'fetch.wait.max.ms': 100 }, sasl: KAFKA_USER && KAFKA_PASSWORD ? { mechanism: 'plain', username: KAFKA_USER, password: KAFKA_PASSWORD } : undefined, ssl: false, groupId: `${KAFKA_GROUP_ID}-${process.env.NODE_ENV === 'development' ? Math.floor(Math.random() * 100000) : 'prod'}`, clientId: KAFKA_CLIENT_ID, heartbeatInterval: 3000, sessionTimeout: 30000, requestTimeout: 60000, connectionTimeout: 10000 },
    },
    serializer: { type: 'NotePack' }, cacher: { type: 'Redis', clone: true, options: { redis: { port: REDIS_PORT, host: REDIS_HOST, password: REDIS_PASSWORD, db: REDIS_DB } } },
    logger: { type: 'Console', options: { level: 'info', categories: DEFAULT_LOG_CATEGORY_ENABLED } }, metrics: { enabled: true, reporter: { type: 'Event' } },
  }) as Starlight;
  registerDarwinLogForwarding(star);
  const actions = trailsActions(star, trailsState);
  const shardNames = trailsShardNamesForRuntime(runtime);
  const services = shardNames.map((shard, index) => star.createService({
    name: shard,
    actions: selectTrailsShardActions(actions, shard),
    methods: {},
    created() {
      if (index === 0 && durableCategorySyncLifecycle) this.logger.info('Trails durable MySQL persistence is enabled');
      this.logger.info(`Trails shard '${shard}' created${runtime === 'v1' ? ' with the shared development-only in-memory repository' : ''}`);
    },
    async started() {
      if (index === 0 && durableCategorySyncLifecycle) await durableCategorySyncLifecycle.start(trailsState);
      this.logger.info(`Trails shard '${shard}' started`);
    },
    async stopped() {
      if (index === 0 && durableCategorySyncLifecycle) await durableCategorySyncLifecycle.stop(trailsState);
      this.logger.info(`Trails shard '${shard}' stopped`);
    },
  }));
  return { star, service: services[0], services };
}

export async function startTrailsService() {
  try {
    const { star, service } = createTrailsService();
    await star.start();
    star.logger?.info(`微服务 TRAILS-${trailsRuntimeFromEnvironment().toUpperCase()} 启动成功`);
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
