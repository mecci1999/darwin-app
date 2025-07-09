// User微服务主文件
import { Star } from 'node-universe';
import { pinoLoggerOptions } from 'config';
import * as dbConnections from '../db/mysql/index';
import userActions from './actions';

// 导入基本类型和常量
import { APP_NAME, REDIS_CONFIG, KAFKA_CONFIG } from './constants';

async function initializeUserService() {
  // const pinoOptions = await pinoLoggerOptions(APP_NAME);

  const star = new Star({
    namespace: 'darwin-app',
    transporter: {
      type: 'KAFKA',
      debug: true,
      host: KAFKA_CONFIG.BROKERS.join(','),
    },
    serializer: {
      type: 'NotePack',
    },
    // logger: pinoOptions,
    cacher: {
      type: 'Redis',
      clone: true,
      options: {
        port: REDIS_CONFIG.PORT,
        host: REDIS_CONFIG.HOST,
        password: REDIS_CONFIG.PASSWORD,
        db: REDIS_CONFIG.DB,
      },
    },
    // metrics: {
    //   enabled: true,
    //   reporter: {
    //     type: 'Event',
    //   },
    // },
  });

  star.createService({
    name: APP_NAME,
    methods: {},
    actions: userActions(star),

    created() {
      star.logger?.info('User service created');
    },

    async started() {
      try {
        // 初始化数据库连接
        await dbConnections.mainConnection.bindManinConnection({
          benchmark: true,
          logging(sql, timing) {
            if (timing && timing > 1000) {
              star.logger?.warn(`Slow query detected: ${sql}, timing: ${timing}ms`);
            }
          },
        });
        star.logger?.info('Database connection established');
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
        await dbConnections.mainConnection.destroy();

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
