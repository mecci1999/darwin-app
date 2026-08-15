import { Star } from 'node-universe';
import { isTransportDebugEnabled } from 'config';
import { DatabaseService } from 'db/mysql/index';
import { Starlight } from 'typings';
import { registerDarwinLogForwarding } from '../logs/utils/darwin-log-capture';
import { installDarwinKafkaRecoveryLifecycle } from 'core/kafka-recovery-lifecycle';
import microAppActions, { requireMicroAppTicketSecret } from './actions';

const APP_NAME = 'micro-app';

async function initializeMicroAppService() {
  try {
    const star = new Star({
      namespace: 'darwin-app',
    nodeID: `${APP_NAME}-${process.env.NODE_ENV || 'development'}-${process.env.NODE_INSTANCE_ID || process.env.HOSTNAME || process.pid}`,
      transporter: {
        type: 'KAFKA',
        debug: isTransportDebugEnabled(),
        host: process.env.KAFKA_BROKERS || process.env.KAFKA_HOST || 'localhost:9092',
        options: {
          sasl:
            process.env.KAFKA_USER && process.env.KAFKA_PASSWORD
              ? {
                  mechanism: 'plain',
                  username: process.env.KAFKA_USER,
                  password: process.env.KAFKA_PASSWORD,
                }
              : undefined,
          ssl: false,
        },
      },
      serializer: { type: 'NotePack' },
      logger: true,
      cacher: {
        type: 'Redis',
        clone: true,
        options: {
          redis: {
            port: parseInt(process.env.REDIS_PORT || '6379'),
            host: process.env.REDIS_HOST || 'localhost',
            password: process.env.REDIS_PASSWORD || '',
          },
        },
      },
      metrics: { enabled: true, reporter: { type: 'Event' } },
      requestTimeout: 30 * 1000,
    }) as Starlight;

    registerDarwinLogForwarding(star);
      installDarwinKafkaRecoveryLifecycle(star);

    star.createService({
      name: APP_NAME,
      actions: microAppActions(star),
      created() {
        star.db = new DatabaseService(star, APP_NAME);
      },
      async started() {
        if (process.env.NODE_ENV === 'production') requireMicroAppTicketSecret();
        await star.db.simpleInitialize();
        star.logger?.info('Micro-app service started successfully');
      },
      async stopped() {
        await star.db.cleanup();
      },
    });

    await star.start();
    star.logger?.info(`微服务 ${APP_NAME} 启动成功`);
  } catch (error) {
    console.error('Failed to initialize micro-app service:', error);
    process.exit(1);
  }
}

initializeMicroAppService().catch((error) => {
  console.error('Failed to initialize micro-app service:', error);
  process.exit(1);
});
