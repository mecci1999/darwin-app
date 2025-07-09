/**
 * 登陆校验微服务
 * @author darwin
 * 关于登录验证服务
 * 本服务提供三种登录验证方式
 * 1、账号密码登录，需要验证码进行二次校验（验证码可以是邮箱验证或是短信验证）
 * 2、扫码登录，二维码key由服务端生成下发给客户端，客户端扫描后将二维码key传给服务端进行验证
 * 3、第三方登录验证，微信、QQ等第三方登录验证（需要结合客户端）也是二维码登录
 * 4、注册服务
 */
import { pinoLoggerOptions } from 'config';
import { Star } from 'node-universe';
import authActions from './actions/index';
import authMethods from './methods/index';
// import authEvent from './events/index';

// 导入模块化的工具类和类型
import { DatabaseInitializer } from '../db/mysql';
import { APP_NAME, DB_CONFIG, CACHE_CONFIG, MQ_CONFIG } from './constants';
import { AuthState } from './types';
import { AuthUtils } from './utils';

// 全局状态管理
const state: AuthState = {
  ips: [],
  ipBlackList: [],
  configs: [],
  ipTimer: null,
  loginAttempts: new Map(),
  verificationCodes: new Map(),
  qrCodes: new Map(),
};

// 主应用初始化
async function initializeAuthService() {
  // const pinoOptions = await pinoLoggerOptions(APP_NAME);

  const star = new Star({
    namespace: 'darwin-app',
    // 通信模块使用kafka
    transporter: {
      type: 'KAFKA',
      debug: MQ_CONFIG.kafka.debug,
      host: MQ_CONFIG.kafka.host,
    },
    serializer: {
      type: 'NotePack',
    },
    // 日志模块
    // logger: pinoOptions,
    cacher: {
      type: 'Redis',
      clone: true,
      options: CACHE_CONFIG.redis,
    },
    metrics: {
      enabled: true,
      reporter: {
        type: 'Event',
      },
    },
  });

  // 创建认证服务
  star.createService({
    name: APP_NAME,
    methods: authMethods(star, state),
    actions: authActions(star),

    async created() {
      // 使用公共数据库初始化器进行完整初始化
      await DatabaseInitializer.fullInitialize(star.logger, state, {
        enableSlowQueryLog: DB_CONFIG.enableSlowQueryLog,
        slowQueryThreshold: DB_CONFIG.slowQueryThreshold,
        enableIpBlacklist: false, // 认证服务通常不需要IP黑名单
        enableIpSyncTimer: false,
      });
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
        state.verificationCodes.clear();
        state.qrCodes.clear();

        star.logger?.info('Auth service stopped successfully');
      } catch (error) {
        star.logger?.error('Failed to stop auth service:', error);
      }

      await DatabaseInitializer.cleanup(state);
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
