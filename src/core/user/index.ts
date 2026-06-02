// User微服务主文件
import { Star } from 'node-universe';
import { isTransportDebugEnabled, pinoLoggerOptions } from 'config';
import { DatabaseService } from 'db/mysql/index';
import { Starlight } from 'typings';
import { registerDarwinLogForwarding } from 'apps/starlight/logs/utils/darwin-log-capture';
import { LogLevel } from 'apps/starlight/logs/types';
import userActions from './actions';

// 导入基本类型和常量
import { APP_NAME } from './constants';
import { EventHandler } from './utils';

async function initializeUserService() {
  // const pinoOptions = await pinoLoggerOptions(APP_NAME);

  const star = new Star({
    namespace: 'darwin-app',
    nodeID: `${APP_NAME}-${process.env.NODE_ENV || 'development'}`,
    transporter: {
      type: 'KAFKA',
      debug: isTransportDebugEnabled(),
      host: process.env.KAFKA_HOST || '127.0.0.1:9092',
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
        sasl: {
          mechanism: 'plain',
          username: process.env.KAFKA_USER || 'darwin_app',
          password: process.env.KAFKA_PASSWORD || 'K@fk@_S3cur3_P@ssw0rd_2025!',
        },
        ssl: false,
        groupId: `user-group-${process.env.NODE_ENV === 'development' ? Math.floor(Math.random() * 100000) : 'prod'}`,
        heartbeatInterval: 3000,
        sessionTimeout: 30000,
        requestTimeout: 60000,
        connectionTimeout: 10000,
      },
    },
    serializer: {
      type: 'NotePack',
    },
    // logger: pinoOptions,
    logger: true,
    cacher: {
      type: 'Redis',
      clone: true,
      options: {
        redis: {
          port: parseInt(process.env.REDIS_PORT || '6379'),
          host: process.env.REDIS_HOST || 'localhost',
          password: process.env.REDIS_PASSWORD || 'R3d1s_S3cur3_P@ssw0rd_2024!@#',
        },
      },
    },
    metrics: {
      enabled: true,
      reporter: {
        type: 'Event',
      },
    },
  }) as Starlight;
  registerDarwinLogForwarding(star);

  star.createService({
    name: APP_NAME,
    methods: {},
    actions: userActions(star),

    created() {
      star.logger?.info('User service created');

      // 在 created 生命周期中手动初始化数据库连接
      const databaseService = new DatabaseService(star, APP_NAME);
      star.db = databaseService;
    },

    async started() {
      try {
        // 初始化数据库连接
        await star.db.simpleInitialize();

        // 初始化事件处理器
        const eventHandler = EventHandler.getInstance();
        eventHandler.initialize(star);

        star.logger?.info('User service started successfully');
      } catch (error) {
        star.logger?.error('Failed to start User service:', error);
        throw error;
      }
    },

    async stopped() {
      try {
        star.logger?.info('Stopping User service...');

        // 断开数据库连接
        await star.db.cleanup();

        star.logger?.info('User service stopped successfully');
      } catch (error) {
        star.logger?.error('Error stopping User service:', error);
        throw error;
      }
    },
  });

  // 启动微服务
  star.start().then(() => {
    star.logger?.info(`微服务 ${APP_NAME.toUpperCase()} 启动成功`);
  });
}

// 启动应用
initializeUserService().catch((error) => {
  console.error('Failed to initialize user service:', error);
  process.exit(1);
});
