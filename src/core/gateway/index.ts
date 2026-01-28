import { GATEWAY_PORT } from 'config';
import { Context, Star } from 'node-universe';
import { UniverseWeb } from 'node-universe-gateway';
import {
  GatewayResponse,
  HttpResponseCode,
  HttpStatusCode,
  IncomingRequest,
  Route,
  Starlight,
} from 'typings';
import gatewayMethods from './methods';

// 导入模块化的工具类和类型
import { DatabaseService } from 'db/mysql';
import {
  APP_NAME,
  DEFAULT_PORT,
  KAFKA_BROKERS,
  KAFKA_CLIENT_ID,
  KAFKA_GROUP_ID,
  KAFKA_PASSWORD,
  KAFKA_USER,
  RATE_LIMIT_COUNT,
  RATE_LIMIT_WINDOW,
  REDIS_DB,
  REDIS_HOST,
  REDIS_PASSWORD,
  REDIS_PORT,
} from './constants';
import { GatewayState } from './types';
import { GatewayHelper, WebSocketHandler } from './utils';

// 全局状态管理
const state: GatewayState = {
  ips: [],
  ipBlackList: [],
  configs: [],
  ipTimer: null,
};

// 主应用初始化
async function initializeGatewayService() {
  // const pinoOptions = await pinoLoggerOptions(APP_NAME);

  const star = new Star({
    namespace: 'darwin-app',
    // 通信模块使用kafka
    transporter: {
      type: 'KAFKA',
      debug: true,
      host: KAFKA_BROKERS,
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
        sasl:
          KAFKA_USER && KAFKA_PASSWORD
            ? {
                mechanism: 'plain',
                username: KAFKA_USER,
                password: KAFKA_PASSWORD,
              }
            : undefined,
        ssl: false,
        groupId: `${KAFKA_GROUP_ID}-${process.env.NODE_ENV === 'development' ? Math.floor(Math.random() * 100000) : 'prod'}`,
        clientId: KAFKA_CLIENT_ID,
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
    cacher: {
      type: 'Redis',
      clone: true,
      options: {
        redis: {
          port: REDIS_PORT,
          host: REDIS_HOST,
          password: REDIS_PASSWORD,
          db: REDIS_DB,
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

  // 创建网关服务
  star.createService({
    name: APP_NAME,
    mixins: UniverseWeb,
    settings: {
      port: Number(GATEWAY_PORT || DEFAULT_PORT),
      ip: '0.0.0.0',
      cors: {
        origin: '*',
        methods: ['GET', 'OPTIONS', 'POST', 'PUT', 'DELETE'],
        allowedHeaders: '*',
        // exposedHeaders: '*',
        credentials: true,
        maxAge: null,
      },
      rateLimit: {
        window: RATE_LIMIT_WINDOW,
        limit: RATE_LIMIT_COUNT,
        headers: true,
      },
      path: '/api',
      routes: [
        // 主要API路由
        {
          path: '/:service/:version/:action*',
          authorization: false,
          aliases: {
            '/': 'gateway.dispatch',
          },
          bodyParsers: {
            json: true,
          },
          // 请求发生前处理
          async onBeforeCall(
            ctx: Context,
            route: Route,
            req: IncomingRequest,
            res: GatewayResponse,
          ) {
            await GatewayHelper.handleBeforeCall(ctx, route, req, res, star, state, true);
          },
          onAfterCall(
            ctx: Context,
            route: Route,
            req: IncomingRequest,
            res: GatewayResponse,
            data: any,
          ) {
            return GatewayHelper.handleAfterCall(ctx, route, req, res, data);
          },
          onError(req: IncomingRequest, res: GatewayResponse, err: any) {
            GatewayHelper.handleError(req, res, err, state);
          },
        },
        // 日志服务路由
        {
          path: '/logs/:service/:action',
        },
        // 监控服务路由
        // {
        //   path: '/metrics',
        //   authorization: false,
        //   aliases: {
        //     '/': 'gateway.metrics',
        //   },
        //   bodyParsers: {
        //     json: true,
        //   },
        //   async onBeforeCall(
        //     ctx: Context,
        //     route: Route,
        //     req: IncomingRequest,
        //     res: GatewayResponse,
        //   ) {
        //     await GatewayHelper.handleBeforeCall(ctx, route, req, res, star, state, false);
        //   },
        //   onAfterCall(
        //     ctx: Context,
        //     route: Route,
        //     req: IncomingRequest,
        //     res: GatewayResponse,
        //     data: any,
        //   ) {
        //     return GatewayHelper.handleAfterCall(ctx, route, req, res, data);
        //   },
        //   onError(req: IncomingRequest, res: GatewayResponse, err: any) {
        //     GatewayHelper.handleError(req, res, err, state);
        //   },
        // },
      ],
    },
    actions: {
      // 请求分发
      dispatch: {
        timeout: 0,
        handler(ctx: Context) {
          let { service, version, action } = ctx.params;
          const params = ctx.params || {};

          action = GatewayHelper.processActionPath(action);

          if (params?.meta) {
            ctx.meta = { ...ctx.meta, ...params.meta };
          }

          return ctx.call(`${service}.${version}.${action}`, params, { meta: ctx.meta });
        },
      },
      // // WebSocket状态查询
      // 'websocket.status': {
      //   visibility: 'published',
      //   timeout: 0,
      //   handler(ctx: Context) {
      //     const status = (this as any).getWebSocketStatus?.() || {
      //       enabled: false,
      //       clients: 0,
      //       port: 6668,
      //     };

      //     return {
      //       status: HttpStatusCode.OK,
      //       data: {
      //         content: status,
      //         message: 'WebSocket status retrieved successfully',
      //         code: HttpResponseCode.Success,
      //         success: true,
      //       },
      //     };
      //   },
      // },

      // // WebSocket事件触发
      // 'websocket.trigger': WebSocketHandler.createWebSocketAction(
      //   'custom_event',
      //   'WebSocket event triggered successfully',
      // ),

      // // 告警推送
      // 'alert.send': WebSocketHandler.createWebSocketAction('alert', 'Alert sent successfully'),

      // // 消息推送
      // 'message.send': WebSocketHandler.createWebSocketAction(
      //   'message',
      //   'Message sent successfully',
      // ),
    },

    methods: gatewayMethods(star),

    async created() {
      // 在 created 生命周期中手动初始化数据库连接
      const databaseService = new DatabaseService(star, APP_NAME);
      star.db = databaseService;

      await star.db.initialize(state, {
        enableSlowQueryLog: true,
        slowQueryThreshold: 1000,
        enableIpBlacklist: true,
        enableIpSyncTimer: true,
      });

      star.logger?.info('Gateway service with database initialized successfully');
    },

    async started() {
      try {
        // await (this as any).initWebSocketServer();
        star.logger?.info('WebSocket server initialized successfully');
      } catch (error) {
        star.logger?.error('Failed to initialize WebSocket server:', error);
      }
    },

    async stopped() {
      try {
        await (this as any).cleanupWebSocket();
        star.logger?.info('WebSocket server cleaned up successfully');
      } catch (error) {
        star.logger?.error('Failed to cleanup WebSocket server:', error);
      }

      await star.db.cleanup(state);
      star.logger?.info('Gateway service cleanup completed');
    },
  });

  // 启动服务
  await star.start();
  star.logger?.info(`微服务 ${APP_NAME.toUpperCase()} 启动成功`);
}

// 启动应用
initializeGatewayService().catch((error) => {
  console.error('Failed to initialize gateway service:', error);
  process.exit(1);
});
