import { DEFAULT_LOG_CATEGORY_ENABLED, GATEWAY_PORT, isTransportDebugEnabled } from 'config';
import { Context, Star } from 'node-universe';
import { UniverseWeb } from 'node-universe-gateway';
import { IPNotPermissionAccess } from 'error';
import {
  GatewayResponse,
  HttpResponseCode,
  HttpStatusCode,
  IncomingRequest,
  Route,
  Starlight,
} from 'typings';
import { DatabaseService } from 'db/mysql';
import { registerDarwinLogForwarding } from 'apps/starlight/logs/utils/darwin-log-capture';
import gatewayMethods, { createWebSocketManager } from './methods';

// 导入模块化的工具类和类型
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

const GATEWAY_SERVICE_WAIT_TIMEOUT_MS = Number(process.env.GATEWAY_SERVICE_WAIT_TIMEOUT_MS || 20000);
const GATEWAY_SERVICE_WAIT_INTERVAL_MS = Number(process.env.GATEWAY_SERVICE_WAIT_INTERVAL_MS || 500);

const waitForRegisteredService = async (star: Starlight, service: string) => {
  const hasService = () => star.registry?.services?.list?.().some((item: any) => item.name === service);

  if (hasService()) return true;

  try {
    await star.waitForServices(service, GATEWAY_SERVICE_WAIT_TIMEOUT_MS, GATEWAY_SERVICE_WAIT_INTERVAL_MS);
  } catch (error) {
    star.logger?.warn('Gateway target service wait timed out', {
      service,
      timeoutMs: GATEWAY_SERVICE_WAIT_TIMEOUT_MS,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return hasService();
};

// 全局状态管理
const state: GatewayState = {
  ips: [],
  ipBlackList: [],
  configs: [],
  ipTimer: null,
};

const INTERNAL_ONLY_SERVICES = new Set([
  'metrics-alerts',
  'metrics-compat',
  'metrics-query',
  'subscription-billing',
]);

const INTERNAL_ONLY_ACTIONS = new Set(['logs.v1.capture-darwin']);

const createInternalServiceAccessError = (service: string) => ({
  code: 404,
  message: `Service '${service}' is not publicly accessible`,
  data: {
    status: 404,
    data: {
      content: null,
      message: `Service '${service}' is not publicly accessible`,
      code: HttpResponseCode.ParamsError,
      success: false,
    },
  },
});

const emitGatewayTopologyMetric = async (
  ctx: Context,
  star: Starlight,
  params: {
    service: string;
    version: string;
    action: string;
    status: 'success' | 'error';
    durationMs: number;
    userId?: string;
    method?: string;
    phase?: 'start' | 'finish';
  },
) => {
  const targetService = String(params.service || '').trim();
  if (!targetService || targetService === 'gateway') return;

  const payload = {
    type: 'observed',
    sourceService: 'gateway',
    targetService,
    version: params.version,
    action: params.action,
    status: params.status,
    durationMs: params.durationMs,
    phase: params.phase,
    userId: params.userId,
    method: params.method,
    timestamp: Date.now(),
  };

  try {
    if (typeof ctx.call !== 'function') {
      throw new Error('ctx.call unavailable');
    }
    const result = await ctx.call('metrics.v1.topology', {
      ...payload,
      scope: 'system',
    }, {
      meta: {
        ...ctx.meta,
        adminMetrics: true,
      },
    });
    if ((result as any)?.data?.success === false || (result as any)?.status >= 400) {
      throw new Error(`metrics.v1.topology rejected observed metric: ${JSON.stringify((result as any)?.data || result)}`);
    }
  } catch (error) {
    star.logger?.warn('Gateway topology metric rpc failed, falling back to event emit', {
      sourceService: payload.sourceService,
      targetService: payload.targetService,
      action: payload.action,
      status: payload.status,
      error: error instanceof Error ? error.message : String(error),
    });
    const emitTopologyObserved = typeof ctx.emit === 'function' ? ctx.emit.bind(ctx) : null;
    if (!emitTopologyObserved) {
      star.logger?.warn('Gateway topology metric emit unavailable', {
        sourceService: payload.sourceService,
        targetService: payload.targetService,
        action: payload.action,
        status: payload.status,
      });
      return;
    }

    try {
      await emitTopologyObserved('metrics.topology.observed', payload);
    } catch (emitError) {
      star.logger?.error('Gateway topology metric record failed', {
        sourceService: payload.sourceService,
        targetService: payload.targetService,
        action: payload.action,
        status: payload.status,
        error: emitError instanceof Error ? emitError.message : String(emitError),
      });
    }
  }
};

const shouldSkipTopologyObservation = (service: string, action: string, params: any) => {
  if (service === 'metrics' && action === 'topology') {
    return params?.type === 'graph' || !params?.type;
  }
  return false;
};

const shouldPreserveSlashActionPath = (service: string) => service === 'metrics-alerts';

const remapMetricsRoute = (rawService: string, rawVersion: string, rawAction: string, rawParams: any = {}) => {
  let service = rawService;
  let action = rawAction;
  const params = { ...rawParams };

  if (service === 'metrics') {
    if ((rawVersion === 'v2' || rawVersion === '2') && action === 'schema') {
      service = 'metrics-query';
      return { service, action, params };
    }

    if ((rawVersion === 'v2' || rawVersion === '2') && action.startsWith('query/')) {
      service = 'metrics-query';
      return { service, action, params };
    }

    const alertResolveMatch = action.match(/^alerts\/([^/]+)\/(resolve|suppress)$/);
    const alertAssignMatch = action.match(/^alerts\/([^/]+)\/assign$/);
    const notificationResendMatch = action.match(/^notifications\/([^/]+)\/resend$/);
    const alertRuleDeleteMatch = action.match(/^alert-rules\/([^/]+)\/delete$/);
    const alertRuleUpdateMatch = action.match(/^alert-rules\/([^/]+)$/);
    const staticMetricsAlertActions = new Set([
      'alerts',
      'alerts/assignees',
      'alert-rules',
      'alert-rules/create',
      'alert-rules/bulk-update',
      'alert-rules/export',
      'alert-rules/import',
      'notifications',
    ]);

    if (staticMetricsAlertActions.has(action)) {
      service = 'metrics-alerts';
    } else if (alertResolveMatch) {
      service = 'metrics-alerts';
      params.id = alertResolveMatch[1];
      action = `alerts/:id/${alertResolveMatch[2]}`;
    } else if (alertAssignMatch) {
      service = 'metrics-alerts';
      params.id = alertAssignMatch[1];
      action = 'alerts/:id/assign';
    } else if (notificationResendMatch) {
      service = 'metrics-alerts';
      params.id = notificationResendMatch[1];
      action = 'notifications/:id/resend';
    } else if (alertRuleDeleteMatch) {
      service = 'metrics-alerts';
      params.id = alertRuleDeleteMatch[1];
      action = 'alert-rules/:id/delete';
    } else if (alertRuleUpdateMatch) {
      service = 'metrics-alerts';
      params.id = alertRuleUpdateMatch[1];
      action = 'alert-rules/:id';
    } else if (
      action === 'alerts' ||
      action.startsWith('alerts/') ||
      action === 'alert-rules' ||
      action.startsWith('alert-rules/') ||
      action === 'notifications' ||
      action.startsWith('notifications/')
    ) {
      service = 'metrics-alerts';
    }

    if (action === 'services') {
      action = 'topology';
      params.type = 'services';
    } else if (action === 'instances') {
      action = 'topology';
      params.type = 'instances';
    } else if (action === 'metrics/analysis') {
      action = 'metrics/explorer';
    } else if (action === 'realtime' || action === 'catalog/service/detail') {
      service = 'metrics-compat';
    }
  }

  return { service, action, params };
};

const remapSubscriptionRoute = (rawService: string, rawAction: string, rawParams: any = {}) => {
  let service = rawService;
  let action = rawAction;
  const params = { ...rawParams };

  if (service === 'subscription' && (action === 'billing' || action.startsWith('billing/'))) {
    service = 'subscription-billing';
  }

  return { service, action, params };
};

const normalizeGatewayRouteParams = (req: IncomingRequest) => {
  const originalUrl = String(req.originalUrl || '');
  const rawPath = originalUrl.split('?')[0] || '';
  const apiPath = rawPath.startsWith('/api/') ? rawPath.slice('/api/'.length) : rawPath.replace(/^\//, '');
  const segments = apiPath.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));

  if (segments.length < 3) return req.$params;

  return {
    ...req.$params,
    routeService: segments[0],
    service: segments[0],
    version: segments[1],
    action: segments.slice(2).join('/'),
  };
};

let wsManager: ReturnType<typeof createWebSocketManager> | null = null;

// 主应用初始化
async function initializeGatewayService() {
  // const pinoOptions = await pinoLoggerOptions(APP_NAME);

  const star = new Star({
    namespace: 'darwin-app',
    nodeID: `${APP_NAME}-${process.env.NODE_ENV || 'development'}`,
    // 通信模块使用kafka
    transporter: {
      type: 'KAFKA',
      debug: isTransportDebugEnabled(),
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
    logger: {
      type: 'Console',
      options: {
        level: 'info',
        categories: DEFAULT_LOG_CATEGORY_ENABLED,
      },
    },
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
  registerDarwinLogForwarding(star);

  // 创建网关服务
  star.createService({
    name: APP_NAME,
    mixins: UniverseWeb,
    settings: {
      port: Number(GATEWAY_PORT || DEFAULT_PORT),
      ip: '0.0.0.0',
      cors: {
        origin: [
          'http://localhost:6130',
          'http://127.0.0.1:6130',
          'tauri://localhost',
          'http://tauri.localhost',
          'https://tauri.localhost',
          'asset://localhost',
        ],
        methods: ['GET', 'OPTIONS', 'POST', 'PUT', 'DELETE'],
        allowedHeaders: [
          'Content-Type',
          'Authorization',
          'Cache-Control',
          'X-Api-Key',
          'X-App-Key',
          'X-Tenant-Id',
          'X-Starlight-Tenant',
        ],
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
      requestTimeout: 0,
      httpServerTimeout: 0,
      routes: [
        // 健康检查路由
        {
          path: '/health',
          authorization: false,
          aliases: {
            'GET /': 'gateway.health',
            GET: 'gateway.health',
          },
        },
        // 单段 action 路由，优先处理 /api/:service/:version/:action
        {
          path: '/:service/:version/:action',
          authorization: false,
          aliases: {
            '/': 'gateway.dispatch',
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
            (ctx.meta as any).req = {
              userAgent: req.headers['user-agent'] || req.headers['User-Agent'],
              headers: req.headers,
              method: req.method,
            };

            if (req?.socket?.remoteAddress) {
              (ctx.meta as any).req = { ...(ctx.meta as any).req, ip: req.socket.remoteAddress };
            }

            const routeParams = normalizeGatewayRouteParams(req);
            req.$params = routeParams;

            if (INTERNAL_ONLY_SERVICES.has(String(routeParams.service || ''))) {
              throw createInternalServiceAccessError(String(routeParams.service));
            }

            const actions = star.registry?.actions.list() || [];
            const normalizedVersion =
              routeParams.version === '1' ? 'v1' : String(routeParams.version || '');
            const remappedMetrics = remapMetricsRoute(
              routeParams.service,
              routeParams.version,
              routeParams.action || '',
              routeParams || {},
            );
            const remapped = remapSubscriptionRoute(
              remappedMetrics.service,
              remappedMetrics.action || '',
              remappedMetrics.params || {},
            );
            const actionName = remapped.action
              ? shouldPreserveSlashActionPath(remapped.service)
                ? remapped.action
                : remapped.action.replace(/\//g, '.')
              : '';

            let targetActionName = `${remapped.service}.${normalizedVersion}.${actionName}`;
            let action = actions.find((item) => item.name === targetActionName);

            if (!action) {
              targetActionName = `${remapped.service}.${actionName}`;
              action = actions.find((item) => item.name === targetActionName);
            }

            if (INTERNAL_ONLY_ACTIONS.has(targetActionName)) {
              throw createInternalServiceAccessError(targetActionName);
            }

            await GatewayHelper.handleAuthentication(ctx, req, action, async (ctx, token) => {
              await (this as any).authorize(ctx, token);
            });
          },
          onAfterCall(
            ctx: Context,
            route: Route,
            req: IncomingRequest,
            res: GatewayResponse,
            data: any,
          ) {
            if ((ctx.meta as any)?.token && (ctx.meta as any)?.refreshToken) {
              GatewayHelper.setAuthCookies(
                res,
                (ctx.meta as any).token,
                (ctx.meta as any).refreshToken,
              );
            }

            if ((ctx.meta as any)?.clearCookies) {
              GatewayHelper.clearAuthCookies(res);
            }

            return data;
          },
          onError(req: IncomingRequest, res: GatewayResponse, err: any) {
            if (err.code === 429 && req?.socket?.remoteAddress) {
              GatewayHelper.addIpToBlacklist(req.socket.remoteAddress, state, '频繁请求');
            }

            res.setHeader('Content-Type', 'application/json');
            res.writeHead(err.code || 500);
            res.end(
              JSON.stringify({
                status: HttpStatusCode.BAD_REQUEST,
                data: {
                  content: err,
                  message: err.message || 'Bad request',
                  code: HttpResponseCode.BAD_REQUEST,
                  success: false,
                },
              }),
            );
          },
        },
        // 主要API路由（多段 action）
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
            // 设置请求元数据
            (ctx.meta as any).req = {
              userAgent: req.headers['user-agent'] || req.headers['User-Agent'],
              headers: req.headers,
              method: req.method,
            };

            // IP黑名单检查
            if (req?.socket?.remoteAddress) {
              // 强制禁用 IP 检查，解决重启后黑名单依然生效的问题
              // if (GatewayHelper.isIpBlocked(req.socket.remoteAddress, state)) {
              //   throw new IPNotPermissionAccess();
              // }
              (ctx.meta as any).req = { ...(ctx.meta as any).req, ip: req.socket.remoteAddress };
            }

            // 禁止直接通过公网访问内部拆分服务
            const routeParams = normalizeGatewayRouteParams(req);
            req.$params = routeParams;

            if (INTERNAL_ONLY_SERVICES.has(String(routeParams.service || ''))) {
              throw createInternalServiceAccessError(String(routeParams.service));
            }

            // 认证处理
            const actions = star.registry?.actions.list() || [];
            const normalizedVersion =
              routeParams.version === '1' ? 'v1' : String(routeParams.version || '');
            const remappedMetrics = remapMetricsRoute(
              routeParams.service,
              routeParams.version,
              routeParams.action || '',
              routeParams || {},
            );
            const remapped = remapSubscriptionRoute(
              remappedMetrics.service,
              remappedMetrics.action || '',
              remappedMetrics.params || {},
            );
            const actionName = remapped.action
              ? shouldPreserveSlashActionPath(remapped.service)
                ? remapped.action
                : remapped.action.replace(/\//g, '.')
              : '';

            let targetActionName = `${remapped.service}.${normalizedVersion}.${actionName}`;
            let action = actions.find((item) => item.name === targetActionName);

            if (!action) {
              targetActionName = `${remapped.service}.${actionName}`;
              action = actions.find((item) => item.name === targetActionName);
            }

            if (INTERNAL_ONLY_ACTIONS.has(targetActionName)) {
              throw createInternalServiceAccessError(targetActionName);
            }

            await GatewayHelper.handleAuthentication(ctx, req, action, async (ctx, token) => {
              await (this as any).authorize(ctx, token);
            });
          },
          onAfterCall(
            ctx: Context,
            route: Route,
            req: IncomingRequest,
            res: GatewayResponse,
            data: any,
          ) {
            // 设置认证cookie
            if ((ctx.meta as any)?.token && (ctx.meta as any)?.refreshToken) {
              GatewayHelper.setAuthCookies(
                res,
                (ctx.meta as any).token,
                (ctx.meta as any).refreshToken,
              );
            }

            // 清除cookie
            if ((ctx.meta as any)?.clearCookies) {
              GatewayHelper.clearAuthCookies(res);
            }

            return data;
          },
          onError(req: IncomingRequest, res: GatewayResponse, err: any) {
            // 处理频率限制错误
            if (err.code === 429 && req?.socket?.remoteAddress) {
              GatewayHelper.addIpToBlacklist(req.socket.remoteAddress, state, '频繁请求');
            }

            res.setHeader('Content-Type', 'application/json');
            res.writeHead(err.code || 500);
            res.end(
              JSON.stringify({
                status: HttpStatusCode.BAD_REQUEST,
                data: {
                  content: err,
                  message: err.message || 'Bad request',
                  code: HttpResponseCode.BAD_REQUEST,
                  success: false,
                },
              }),
            );
          },
        },
        // 日志服务路由
        {
          path: '/logs/:service/:action',
        },
      ],
    },
    actions: {
      // 健康检查
      health: {
        handler(ctx: Context) {
          return {
            status: 200,
            data: {
              code: HttpResponseCode.Success,
              content: {
                status: 'ok',
                timestamp: Date.now(),
                service: APP_NAME,
              },
              message: 'Gateway is healthy',
              success: true,
            },
          };
        },
      },
      // 请求分发
      dispatch: {
        timeout: 0,
        async handler(ctx: Context) {
          const rawService = String(ctx.params?.service || '');
          if (INTERNAL_ONLY_SERVICES.has(rawService)) {
            return createInternalServiceAccessError(rawService).data;
          }

          let { service, version, action } = ctx.params;
          let params = ctx.params || {};
          version = version === '1' ? 'v1' : version;

          const remappedMetrics = remapMetricsRoute(service, version, action || '', params);
          const remapped = remapSubscriptionRoute(
            remappedMetrics.service,
            remappedMetrics.action || '',
            remappedMetrics.params || {},
          );
          service = remapped.service;
          action = remapped.action;
          params = remapped.params;

          action = shouldPreserveSlashActionPath(service)
            ? action
            : GatewayHelper.processActionPath(action);

          const targetActionName = `${service}.${version}.${action}`;
          if (INTERNAL_ONLY_ACTIONS.has(targetActionName)) {
            return createInternalServiceAccessError(targetActionName).data;
          }

          if (service === 'metrics-query') {
            star.logger?.info('Gateway metrics-query dispatch target', {
              targetActionName,
              paramsKeys: Object.keys(params || {}),
              userId: (ctx.meta as any)?.user?.userId,
              scope: (params as any)?.scope || (params as any)?.context?.scope,
            });
          }

          const isTargetServiceReady = await waitForRegisteredService(star, service);
          if (!isTargetServiceReady) {
            return {
              status: HttpStatusCode.SERVICE_UNAVAILABLE,
              data: {
                content: null,
                message: `Service '${service}' is not registered yet`,
                code: HttpResponseCode.ServiceActionFaild,
                success: false,
              },
            };
          }

          if (params?.meta) {
            ctx.meta = { ...ctx.meta, ...params.meta };
          }

          // 确保 userId 被传递到 params 中，作为 ctx.meta 传递失败的兜底
          if ((ctx.meta as any).user?.userId) {
            params.userId = (ctx.meta as any).user.userId;
          }

          const dispatchStartedAt = Date.now();
          const userId = (ctx.meta as any)?.user?.userId;
          const method = (ctx.meta as any)?.req?.method;
          const isLogStreamDispatch = service === 'logs' && version === 'v1' && action === 'stream';
          if (isLogStreamDispatch) {
            star.logger?.info('Gateway log stream dispatch start', {
              streamTraceId: (params as any)?.streamTraceId,
              targetActionName,
              method,
              userId,
              originType: (params as any)?.originType,
              serviceFilter: (params as any)?.service,
              level: (params as any)?.level,
            });
          }
          const shouldRecordBeforeDispatch = !shouldSkipTopologyObservation(service, action, params);

          if (shouldRecordBeforeDispatch) {
            void emitGatewayTopologyMetric(ctx, star, {
              service,
              version,
              action,
              status: 'success',
              durationMs: 0,
              phase: 'start',
              userId,
              method,
            });
          }

          return ctx.call(`${service}.${version}.${action}`, params, { meta: ctx.meta })
            .then((result) => {
              if (isLogStreamDispatch) {
                star.logger?.info('Gateway log stream dispatch result', {
                  streamTraceId: (params as any)?.streamTraceId,
                  durationMs: Date.now() - dispatchStartedAt,
                  resultType: result?.constructor?.name || typeof result,
                  hasPipe: typeof (result as any)?.pipe === 'function',
                  readable: Boolean((result as any)?.readable),
                  destroyed: Boolean((result as any)?.destroyed),
                });
              }
              if (!shouldSkipTopologyObservation(service, action, params)) {
                void emitGatewayTopologyMetric(ctx, star, {
                  service,
                  version,
                  action,
                  status: 'success',
                  durationMs: Date.now() - dispatchStartedAt,
                  phase: 'finish',
                  userId,
                  method,
                });
              }
              if (service === 'metrics-query') {
                star.logger?.info('Gateway metrics-query dispatch completed', {
                  targetActionName: `${service}.${version}.${action}`,
                  durationMs: Date.now() - dispatchStartedAt,
                });
              }
              return result;
            })
            .catch((error) => {
              if (isLogStreamDispatch) {
                star.logger?.error('Gateway log stream dispatch failed', {
                  streamTraceId: (params as any)?.streamTraceId,
                  durationMs: Date.now() - dispatchStartedAt,
                  error: error?.message || String(error),
                });
              }
              if (!shouldSkipTopologyObservation(service, action, params)) {
                void emitGatewayTopologyMetric(ctx, star, {
                  service,
                  version,
                  action,
                  status: 'error',
                  durationMs: Date.now() - dispatchStartedAt,
                  phase: 'finish',
                  userId,
                  method,
                });
              }
              if (service === 'metrics-query') {
                star.logger?.error('Gateway metrics-query dispatch failed', {
                  targetActionName: `${service}.${version}.${action}`,
                  durationMs: Date.now() - dispatchStartedAt,
                  error: error?.message || String(error),
                });
              }
              throw error;
            });
        },
      },
      'websocket.trigger': {
        timeout: 0,
        async handler(ctx: Context) {
          const eventName = String(ctx.params?.eventName || '').trim();
          const data = ctx.params?.data;

          if (!eventName) {
            return {
              status: HttpStatusCode.BAD_REQUEST,
              data: {
                code: HttpResponseCode.ServiceActionFaild,
                content: null,
                message: 'eventName is required',
                success: false,
              },
            };
          }

          const result = (this as any).triggerWebSocketEvent(eventName, data);
          return {
            status: HttpStatusCode.OK,
            data: {
              code: HttpResponseCode.Success,
              content: result,
              message: 'WebSocket event triggered successfully',
              success: true,
            },
          };
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
        enableIpBlacklist: false,
        enableIpSyncTimer: true,
      });

      wsManager = createWebSocketManager(star, async (ctx, token) => {
        await (this as any).authorize(ctx, token);
      });

      star.logger?.info('Gateway service with database initialized successfully');
    },

    async started() {
      try {
        wsManager?.initWebSocketServer();
        star.logger?.info('WebSocket server initialized successfully');
      } catch (error) {
        star.logger?.error('Failed to initialize WebSocket server:', error);
      }
    },

    async stopped() {
      try {
        await wsManager?.cleanupWebSocket();
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
