import { GATEWAY_PORT } from 'config';
import { Context, Star } from 'node-universe';
import { UniverseWeb } from 'node-universe-gateway';
import { GatewayResponse, IncomingRequest, Route } from 'typings';
import { ResponseCode } from 'typings/enum';
import gatewayMethods from './methods';

// 导入模块化的工具类和类型
import { ResponseUtils } from 'utils';
import { DatabaseInitializer } from 'db/mysql';
import { APP_NAME, DEFAULT_PORT, RATE_LIMIT_COUNT, RATE_LIMIT_WINDOW } from './constants';
import { GatewayState } from './types';
import { GatewayUtils, RouteHandlers, WebSocketHandler } from './utils';

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
    // 日志模块
    // logger: pinoOptions,
    cacher: {
      type: 'Redis',
      clone: true,
      options: {
        port: parseInt(process.env.REDIS_PORT || '6379'),
        host: process.env.REDIS_HOST || 'localhost',
        password: process.env.REDIS_PASSWORD || 'R3d1s_S3cur3_P@ssw0rd_2024!@#',
      },
    },
    metrics: {
      enabled: true,
      reporter: {
        type: 'Event',
      },
    },
  });

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
            await RouteHandlers.handleBeforeCall(ctx, route, req, res, star, state, true);
          },
          onAfterCall(
            ctx: Context,
            route: Route,
            req: IncomingRequest,
            res: GatewayResponse,
            data: any,
          ) {
            return RouteHandlers.handleAfterCall(ctx, route, req, res, data);
          },
          onError(req: IncomingRequest, res: GatewayResponse, err: any) {
            RouteHandlers.handleError(req, res, err, state);
          },
        },
        // 日志服务路由
        {
          path: '/logs/:service/:action',
        },
        // 监控服务路由
        {
          path: '/metrics',
          authorization: false,
          aliases: {
            '/': 'gateway.metrics',
          },
          bodyParsers: {
            json: true,
          },
          async onBeforeCall(
            ctx: Context,
            route: Route,
            req: IncomingRequest,
            res: GatewayResponse,
          ) {
            await RouteHandlers.handleBeforeCall(ctx, route, req, res, star, state, false);
          },
          onAfterCall(
            ctx: Context,
            route: Route,
            req: IncomingRequest,
            res: GatewayResponse,
            data: any,
          ) {
            return RouteHandlers.handleAfterCall(ctx, route, req, res, data);
          },
          onError(req: IncomingRequest, res: GatewayResponse, err: any) {
            RouteHandlers.handleError(req, res, err, state);
          },
        },
      ],
    },
    actions: {
      // 请求分发
      dispatch: {
        timeout: 0,
        handler(ctx: Context) {
          let { service, version, action } = ctx.params;
          const params = ctx.params || {};

          action = GatewayUtils.processActionPath(action);

          if (params?.meta) {
            ctx.meta = { ...ctx.meta, ...params.meta };
          }

          return ctx.call(`${service}.${version}.${action}`, params, { meta: ctx.meta });
        },
      },

      // 监控指标
      metrics: {
        timeout: 0,
        handler(ctx: Context) {
          const metricsData = star.metrics?.list();

          try {
            (this as any).broadcastToChannel('metrics', {
              type: 'metrics_update',
              data: {
                metrics: metricsData,
                timestamp: Date.now(),
                source: 'gateway',
              },
            });
          } catch (error) {
            star.logger?.error('Failed to broadcast metrics via WebSocket:', error);
          }

          return ResponseUtils.createResponse(200, metricsData, 'success', ResponseCode.Success);
        },
      },

      // WebSocket状态查询
      'websocket.status': {
        timeout: 0,
        handler(ctx: Context) {
          const status = (this as any).getWebSocketStatus?.() || {
            enabled: false,
            clients: 0,
            port: 6668,
          };

          return ResponseUtils.createResponse(
            200,
            status,
            'WebSocket status retrieved successfully',
            ResponseCode.Success,
          );
        },
      },

      // WebSocket事件触发
      'websocket.trigger': WebSocketHandler.createWebSocketAction(
        'custom_event',
        'WebSocket event triggered successfully',
      ),

      // 告警推送
      'alert.send': WebSocketHandler.createWebSocketAction('alert', 'Alert sent successfully'),

      // 消息推送
      'message.send': WebSocketHandler.createWebSocketAction(
        'message',
        'Message sent successfully',
      ),
    },

    methods: gatewayMethods(star),

    async created() {
      // 使用公共数据库初始化器进行完整初始化
      await DatabaseInitializer.fullInitialize(star.logger, state, {
        enableSlowQueryLog: true,
        slowQueryThreshold: 1000,
        enableIpBlacklist: true,
        enableIpSyncTimer: true,
      });
    },

    async started() {
      try {
        await (this as any).initWebSocketServer();
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

      await DatabaseInitializer.cleanup(state);
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
