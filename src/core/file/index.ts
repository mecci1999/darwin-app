/**
 * File微服务主入口文件
 * 负责文件上传、处理、存储等功能
 */
import { Star } from 'node-universe';
import { isTransportDebugEnabled, pinoLoggerOptions } from 'config';
import { DatabaseService } from 'db/mysql/index';
import { Starlight } from 'typings';
import { registerDarwinLogForwarding } from 'apps/starlight/logs/utils/darwin-log-capture';
import fileActions from './actions';

// 导入基本类型和常量
import { APP_NAME, SERVICE_CONFIG } from './constants';
import { FileEventHandler } from './utils';

/**
 * 初始化文件微服务
 * 遵循node-universe框架的标准微服务模版
 */
async function initializeFileService() {
  try {
    // 启用日志配置
    // const pinoOptions = await pinoLoggerOptions(APP_NAME);

    const star = new Star({
      namespace: 'darwin-app',
      nodeID: `${APP_NAME}-${process.env.NODE_ENV || 'development'}`,
      transporter: {
        type: 'KAFKA',
        debug: isTransportDebugEnabled(),
        host: process.env.KAFKA_HOST || 'localhost:9092',
        options: {
          sasl: {
            mechanism: 'plain',
            username: process.env.KAFKA_USER || 'darwin_app',
            password: process.env.KAFKA_PASSWORD || 'K@fk@_S3cur3_P@ssw0rd_2025!',
          },
          ssl: false,
          // 心跳配置 - 解决节点超时警告
          heartbeatInterval: 3000, // 3秒发送一次心跳
          sessionTimeout: 30000, // 30秒会话超时
          requestTimeout: 25000, // 25秒请求超时
          connectionTimeout: 10000, // 10秒连接超时
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
      // 添加请求超时配置
      requestTimeout: SERVICE_CONFIG.REQUEST_TIMEOUT,
      retryPolicy: {
        enabled: true,
        retries: SERVICE_CONFIG.MAX_RETRIES,
        delay: SERVICE_CONFIG.RETRY_DELAY,
      },
    }) as Starlight;
    registerDarwinLogForwarding(star);

    star.createService({
      name: APP_NAME,
      methods: {},
      actions: fileActions(star),

      created() {
        star.logger?.info('File service created');

        // 在 created 生命周期中手动初始化数据库连接
        const databaseService = new DatabaseService(star, APP_NAME);
        star.db = databaseService;
      },

      async started() {
        try {
          // 初始化数据库连接
          await star.db.simpleInitialize();

          // 初始化事件处理器
          const eventHandler = FileEventHandler.getInstance();
          eventHandler.initialize(star);

          star.logger?.info('File service started successfully');
        } catch (error) {
          star.logger?.error('Failed to start File service:', error);
          throw error;
        }
      },

      async stopped() {
        try {
          star.logger?.info('Stopping File service...');

          // 断开数据库连接
          await star.db.cleanup();

          star.logger?.info('File service stopped successfully');
        } catch (error) {
          star.logger?.error('Error stopping File service:', error);
          throw error;
        }
      },
    });

    // 启动微服务
    await star.start();
    star.logger?.info(`微服务 ${APP_NAME.toUpperCase()} 启动成功`);
  } catch (error) {
    console.error('Failed to initialize file service:', error);
    process.exit(1);
  }
}

// 启动应用
initializeFileService().catch((error) => {
  console.error('Failed to initialize file service:', error);
  process.exit(1);
});
