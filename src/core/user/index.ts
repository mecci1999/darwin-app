// User微服务主文件
import { Star } from 'node-universe';
import { pinoLoggerOptions } from 'config';
import { DatabaseService } from 'db/mysql/index';
import { Starlight } from 'typings';
import userActions from './actions';

// 导入基本类型和常量
import { APP_NAME } from './constants';
import { EventHandler } from './utils';

async function initializeUserService() {
  // const pinoOptions = await pinoLoggerOptions(APP_NAME);

  const star = new Star({
    namespace: 'darwin-app',
    transporter: {
      type: 'KAFKA',
      debug: true,
      host: process.env.KAFKA_HOST || 'localhost:9092',
      options: {
        sasl: {
          mechanism: 'plain',
          username: process.env.KAFKA_USER || 'kafka_user',
          password: process.env.KAFKA_PASSWORD || 'K@fk@_S3cur3_P@ssw0rd_2024!$',
        },
        ssl: false,
      },
    },
    serializer: {
      type: 'NotePack',
    },
    // logger: pinoOptions,
    cacher: {
      type: 'Redis',
      clone: true,
      redis: {
        port: parseInt(process.env.REDIS_PORT || '6379'),
        host: process.env.REDIS_HOST || 'localhost',
        password: process.env.REDIS_PASSWORD || 'R3d1s_S3cur3_P@ssw0rd_2024!@#',
      },
    },
    // metrics: {
    //   enabled: true,
    //   reporter: {
    //     type: 'Event',
    //   },
    // },
  }) as Starlight;

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
