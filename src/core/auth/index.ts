/**
 * 登陆校验微服务
 * @author darwin
 *
 * 关于登录验证服务
 * 本服务提供三种登录验证方式
 * 1、账号密码登录，需要验证码进行二次校验（验证码可以是邮箱验证或是短信验证）
 * 2、扫码登录，二维码key由服务端生成下发给客户端，客户端扫描后将二维码key传给服务端进行验证
 * 3、第三方登录验证，微信、QQ等第三方登录验证（需要结合客户端）也是二维码登录
 * 4、注册服务
 *
 * 数据库架构说明：
 * - 使用独立的数据库连接实例，与其他微服务完全隔离
 * - 启用IP黑名单功能，防止暴力破解攻击
 * - 配置较低的慢查询阈值，确保认证服务的高性能
 * - 支持独立的连接监控和日志追踪
 */

import { Star } from 'node-universe';
import { DatabaseService } from 'db/mysql';
import { Starlight } from 'typings';
import { registerDarwinLogForwarding } from 'apps/starlight/logs/utils/darwin-log-capture';
import authActions from './actions/index';
import authEvents from './events';
import authMethods from './methods/index';

// 导入基础工具类和类型
import { AuthState } from './types';
import { AuthUtils } from './utils';

// 应用名称
const APP_NAME = 'auth';

// 全局状态管理
const state: AuthState = {
  ips: [],
  ipBlackList: [],
  configs: [],
  ipTimer: null,
  loginAttempts: new Map(),
};

// 主应用初始化
async function initializeAuthService() {
  // const pinoOptions = await pinoLoggerOptions(APP_NAME);

  // 创建Star实例
  const star = new Star({
    namespace: 'darwin-app',
    nodeID: `${APP_NAME}-${process.env.NODE_ENV || 'development'}`,
    // 通信模块使用kafka
    transporter: {
      type: 'KAFKA',
      debug: process.env.NODE_ENV !== 'production',
      host: process.env.KAFKA_HOST || '127.0.0.1:9092',
      options: {
        producer: {
          'linger.ms': 0, // 立即发送，禁用缓冲延迟
          'batch.size': 0, // 禁用批处理
          acks: 1,
        },
        consumer: {
          'fetch.min.bytes': 1, // 有数据立即拉取
          'fetch.wait.max.ms': 100, // 最多等待100ms
        },
        sasl: {
          mechanism: 'plain',
          username: process.env.KAFKA_USER || 'darwin_app',
          password: process.env.KAFKA_PASSWORD || 'K@fk@_S3cur3_P@ssw0rd_2025!',
        },
        ssl: false,
        groupId: `auth-group-${process.env.NODE_ENV === 'development' ? Math.floor(Math.random() * 100000) : 'prod'}`,
        heartbeatInterval: 3000,
        sessionTimeout: 30000,
        requestTimeout: 60000,
        connectionTimeout: 10000,
      },
    },
    serializer: {
      type: 'NotePack',
    },
    // 日志模块
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

  // 创建认证服务
  star.createService({
    name: APP_NAME,
    methods: authMethods(star, state),
    actions: authActions(star),
    events: authEvents(star),

    async created() {
      // 在 created 生命周期中手动初始化数据库连接
      const databaseService = new DatabaseService(star, 'auth-service');
      star.db = databaseService;

      // 初始化独立的数据库连接
      // 认证服务使用完整初始化，包含IP黑名单功能
      await star.db.initialize(state, {
        enableSlowQueryLog: true,
        slowQueryThreshold: 800, // 认证服务对响应时间要求较高
        enableIpBlacklist: false, // 启用IP黑名单，防止暴力破解
        enableIpSyncTimer: true, // 启用IP同步定时器
      });

      star.logger?.info('Auth service created with independent database connection');
    },

    async started() {
      try {
        // 检查并生成RSA密钥对
        AuthUtils.checkAndGenerateRSA(state, star.logger);

        // 启动定期清理任务
        setInterval(() => {
          AuthUtils.cleanupExpiredData(state);
        }, 60000); // 每分钟清理一次

        star.logger?.info('Auth service started successfully');
      } catch (error) {
        star.logger?.error('Failed to start auth service:', error);
        throw error;
      }
    },

    async stopped() {
      try {
        // 清理状态数据
        state.loginAttempts.clear();
        star.logger?.info('Auth service stopped successfully');
      } catch (error) {
        star.logger?.error('Failed to stop auth service:', error);
      }

      await star.db.cleanup(state);
    },
  });

  // 启动服务
  await star.start();
  star.logger?.info(`微服务 ${APP_NAME.toUpperCase()} 启动成功`);
}

// 启动应用
initializeAuthService().catch((error) => {
  console.error('Failed to initialize auth service:', error);
  process.exit(1);
});
