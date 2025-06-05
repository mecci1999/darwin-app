import { GATEWAY_PORT, pinoLoggerOptions } from 'config';
import { Context, Star } from 'node-universe';
import { UniverseWeb } from 'node-universe-gateway';
import * as dbConnections from '../db/mysql/index';
import { getAllIpBlackList, saveOrUpdateIpBlackList } from 'db/mysql/apis/ipBlackList';
import _ from 'lodash';
import { getAllConfigList } from 'db/mysql/apis/config';
import { IConfig } from 'typings/config';
import { IIPBlackListTableAttributes } from 'db/mysql/models/ipBlackList';
import { ConfigKeysMap, IPAddressBanStatus, ResponseCode } from 'typings/enum';
import {
  IPNotPermissionAccess,
  TokenExpiredError,
  UnAuthorizedError,
  UserNotLoginError,
} from 'error';
import { GatewayResponse, IncomingRequest, Route } from 'typings';
import gatewayMethods from './methods';

// 微服务名
const appName = 'gateway';

// ip地址黑名单，存储至内存中，每隔30分钟拉取本地数据库同步一次
let ips: string[] = [];
let ipBlackList: IIPBlackListTableAttributes[] = [];
let configs: IConfig[] = [];
let ipTimer: any; // ip同步更新定时器

pinoLoggerOptions(appName).then((pinoOptions) => {
  const star = new Star({
    namespace: 'darwin-app',
    // KAFKA通信模块
    transporter: {
      type: 'KAFKA',
      debug: true,
      host: 'localhost:9092',
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
        port: 6379, // Redis port
        host: 'localhost',
      },
    },
    metrics: {
      enabled: true,
      reporter: {
        type: 'Event',
        // options: {
        //   port: 3030,
        // },
      },
    },
  });

  // 创建网关服务
  star.createService({
    name: appName,
    mixins: UniverseWeb,
    settings: {
      port: Number(GATEWAY_PORT || 6666),
      ip: '0.0.0.0',
      // 全局跨域配置
      cors: {
        origin: '*',
        methods: ['GET', 'OPTIONS', 'POST', 'PUT', 'DELETE'],
        allowedHeaders: '*',
        // exposedHeaders: '*',
        credentials: true,
        maxAge: null,
      },
      rateLimit: {
        window: 30 * 1000,
        limit: 30,
        headers: true,
      },
      path: '/api',
      routes: [
        // 配置路由，将 REST 请求映射到对应的微服务
        {
          path: '/:service/:version/:action*',
          authorization: false,
          // whitelist: [], // 路由白名单
          // 路由跨域配置
          // cors: {
          //   origin: ["https://localhost:3000", "https://localhost:4000"],
          //  methods: ["GET", "OPTIONS", "POST"],
          // },
          aliases: {
            // 例如，将 /api/blog/v2/create 映射到 blog 服务的 v2 版本的 create 动作
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
            (ctx.meta as any).req = {
              userAgent: req.headers['user-agent'] || req.headers['User-Agent'],
            };

            if (req?.socket?.remoteAddress) {
              // 查看请求的ip地址是否被黑名单
              if (ips.includes(req.socket.remoteAddress)) {
                // 被黑名单禁用，直接返回404状态码
                throw new IPNotPermissionAccess();
              }

              (ctx.meta as any).req = { ...(ctx.meta as any).req, ip: req.socket.remoteAddress };
            }

            // 获取服务注册表信息，通过服务名获取到该服务是否需要token校验
            const actions = star.registry?.actions.list() || [];
            const action = actions.find(
              (item) =>
                item.name === `${req.$params.service}.${req.$params.version}.${req.$params.action}`,
            );

            // 需要token校验的接口
            if (!!action?.action?.metadata?.auth) {
              // 从cookie中获取token
              const cookie: any = req.headers['Cookie'] || req.headers['cookie'];
              const token1 = cookie
                ?.split(';')
                .find((item) => item.includes('ACCESS_TOKEN'))
                .split('=')[1];
              // 从cookie中获取refreshToken
              const refreshToken: any = cookie
                ?.split(';')
                .find((item) => item.includes('REFRESH_TOKEN'))
                .split('=')[1];
              // 直接从头部authorization中获取token
              const authorization: any =
                req.headers['Authorization'] || req.headers['authorization'] || '';
              const token2 = authorization?.split(' ')[1];

              if (!token1 && !token2) {
                // 直接返回没有登录的状态
                throw new UserNotLoginError();
              }

              // 将token传递到ctx.meta中，在微服务中获取
              (ctx.meta as any).authToken = token1 || token2;
              if (refreshToken) {
                // 将token传递到ctx.meta中，在微服务中获取
                (ctx.meta as any).refreshToken = refreshToken;
              }

              try {
                // 直接做token校验
                await (this as any).authorize(ctx, (ctx.meta as any).authToken);
              } catch (error) {
                // 抛出错误
                throw error;
              }
            }
          },
          // 请求成功后，对服务返回的数据进行二次处理
          // 在 onAfterCall 方法中添加清除cookie的逻辑
          onAfterCall(
            ctx: Context,
            route: Route,
            req: IncomingRequest,
            res: GatewayResponse,
            data: any,
          ) {
            // 判断是否触发身份验证，如果触发身份验证，则可以在请求响应头部中设置cookie
            if ((ctx.meta as any)?.token && (ctx.meta as any)?.refreshToken) {
              res.setHeader(
                'Set-Cookie',
                `ACCESS_TOKEN=${(ctx.meta as any)?.token}; REFRESH_TOKEN=${(ctx.meta as any)?.refreshToken}; HttpOnly; Path=/; SameSite=Strict;`,
              );
            }

            // 处理退出登录，清除cookies
            if ((ctx.meta as any)?.clearCookies) {
              res.setHeader('Set-Cookie', [
                'ACCESS_TOKEN=; HttpOnly; Path=/; SameSite=Strict; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
                'REFRESH_TOKEN=; HttpOnly; Path=/; SameSite=Strict; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
              ]);
            }

            return data;
          },
          // 请求错误处理
          onError(req: IncomingRequest, res: GatewayResponse, err: any) {
            // 如果触发了RateLimitExceeded报错，将该ip地址进行封禁，并将ip地址存储到数据库中，启动网关微服务的时候，从数据库中拉取ip地址封禁名单
            if (err.code === 429 && req?.socket?.remoteAddress) {
              if (!ips.includes(req.socket.remoteAddress)) {
                // 触发请求限制错误，直接封禁ip
                ips.push(req.socket.remoteAddress);
                ipBlackList.push({
                  ipv4: req.socket.remoteAddress,
                  reason: '频繁请求',
                  status: IPAddressBanStatus.active,
                  isArtificial: false,
                });
              }
            }
            res.setHeader('Content-Type', 'text/plain');
            res.writeHead(err.code || 500);
            res.end(
              JSON.stringify({
                status: err.code || 500,
                data: {
                  code: err?.data?.code || 0,
                  message: err.message,
                  content: err?.data?.content || null,
                },
              }),
            );
          },
        },
        // 日志服务
        {
          path: '/logs/:service/:action',
        },
        // 监控服务
        {
          path: '/metrics',
          authorization: false,
          // whitelist: [], // 路由白名单
          // 路由跨域配置
          // cors: {
          //   origin: ["https://localhost:3000", "https://localhost:4000"],
          //  methods: ["GET", "OPTIONS", "POST"],
          // },
          aliases: {
            '/': 'gateway.metrics',
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
            (ctx.meta as any).req = {
              userAgent: req.headers['user-agent'] || req.headers['User-Agent'],
            };

            if (req?.socket?.remoteAddress) {
              // 查看请求的ip地址是否被黑名单
              if (ips.includes(req.socket.remoteAddress)) {
                // 被黑名单禁用，直接返回404状态码
                throw new IPNotPermissionAccess();
              }

              (ctx.meta as any).req = { ...(ctx.meta as any).req, ip: req.socket.remoteAddress };
            }
          },
          // 请求成功后，对服务返回的数据进行二次处理
          // 在 onAfterCall 方法中添加清除cookie的逻辑
          onAfterCall(
            ctx: Context,
            route: Route,
            req: IncomingRequest,
            res: GatewayResponse,
            data: any,
          ) {
            return data;
          },
          // 请求错误处理
          onError(req: IncomingRequest, res: GatewayResponse, err: any) {
            // 如果触发了RateLimitExceeded报错，将该ip地址进行封禁，并将ip地址存储到数据库中，启动网关微服务的时候，从数据库中拉取ip地址封禁名单
            if (err.code === 429 && req?.socket?.remoteAddress) {
              if (!ips.includes(req.socket.remoteAddress)) {
                // 触发请求限制错误，直接封禁ip
                ips.push(req.socket.remoteAddress);
                ipBlackList.push({
                  ipv4: req.socket.remoteAddress,
                  reason: '频繁请求',
                  status: IPAddressBanStatus.active,
                  isArtificial: false,
                });
              }
            }
            res.setHeader('Content-Type', 'text/plain');
            res.writeHead(err.code || 500);
            res.end(
              JSON.stringify({
                status: err.code || 500,
                data: {
                  code: err?.data?.code || 0,
                  message: err.message,
                  content: err?.data?.content || null,
                },
              }),
            );
          },
        },
      ],
    },
    actions: {
      // 网关服务的 dispatch 动作将请求转发到相应的微服务
      dispatch: {
        // visibility: 'public',
        // tracing: {
        //   tags: {
        //     params: ['req.url', 'req.method'],
        //   },
        //   spanName: (ctx) => `${ctx.params.req.method} ${ctx.params.req.url}`,
        // },
        timeout: 0,
        handler(ctx: Context) {
          let { service, version, action } = ctx.params;
          const params = ctx.params || {};

          // 对action进行url处理
          if (action) {
            // 处理action可能是数组的情况（当使用*通配符时）
            if (Array.isArray(action)) {
              action = action.join('.');
            }

            // 处理action中包含斜杠的情况
            if (typeof action === 'string' && action.includes('/')) {
              action = action.split('/').join('.');
            }
          }

          if (params?.meta) {
            // 合并meta数据
            ctx.meta = { ...ctx.meta, ...params.meta };
          }

          // 转发请求到相应的微服务
          return ctx.call(`${service}.${version}.${action}`, params, { meta: ctx.meta });
        },
      },
      // 网关服务的 metrics 动作将请求转发到相应的微服务
      metrics: {
        // visibility: 'public',
        // tracing: {
        //   tags: {
        //     params: ['req.url','req.method'],
        //   },
        //   spanName: (ctx) => `${ctx.params.req.method} ${ctx.params.req.url}`,
        // },
        timeout: 0,
        handler(ctx: Context) {
          const metricsData = star.metrics?.list();

          // 通过 WebSocket 广播指标数据到订阅了 'metrics' 频道的客户端
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

          return {
            status: 200,
            data: {
              content: metricsData,
              message: 'success',
              code: ResponseCode.Success,
            },
          };
        },
      },

      // WebSocket 状态查询
      'websocket.status': {
        timeout: 0,
        handler(ctx: Context) {
          const status = (this as any).getWebSocketStatus?.() || {
            enabled: false,
            clients: 0,
            port: 6668,
          };

          return {
            status: 200,
            data: {
              content: status,
              message: 'WebSocket status retrieved successfully',
              code: ResponseCode.Success,
            },
          };
        },
      },

      // 触发 WebSocket 事件
      'websocket.trigger': {
        timeout: 0,
        handler(ctx: Context) {
          const { channel, data, clientId, userId } = ctx.params;

          try {
            if (clientId) {
              // 发送给特定客户端
              (this as any).sendToClient(clientId, {
                type: 'custom_event',
                channel,
                data,
              });
            } else if (userId) {
              // 发送给特定用户
              (this as any).sendToUser(userId, {
                type: 'custom_event',
                channel,
                data,
              });
            } else if (channel) {
              // 广播到频道
              (this as any).broadcastToChannel(channel, {
                type: 'channel_event',
                channel,
                data,
              });
            } else {
              // 广播给所有客户端
              (this as any).broadcastToClients({
                type: 'broadcast_event',
                data,
              });
            }

            return {
              status: 200,
              data: {
                content: { sent: true },
                message: 'WebSocket event triggered successfully',
                code: ResponseCode.Success,
              },
            };
          } catch (error) {
            star.logger?.error('Failed to trigger WebSocket event:', error);
            return {
              status: 500,
              data: {
                content: { sent: false },
                message: 'Failed to trigger WebSocket event',
                code: ResponseCode.ServiceActionFaild,
              },
            };
          }
        },
      },

      // 二维码更新推送
      'qrcode.update': {
        timeout: 0,
        handler(ctx: Context) {
          const { qrcode, userId, clientId } = ctx.params;

          try {
            const message = {
              type: 'qrcode_update',
              data: {
                qrcode,
                timestamp: Date.now(),
              },
            };

            if (clientId) {
              (this as any).sendToClient(clientId, message);
            } else if (userId) {
              (this as any).sendToUser(userId, message);
            } else {
              (this as any).broadcastToChannel('qrcode', message);
            }

            return {
              status: 200,
              data: {
                content: { sent: true },
                message: 'QR code update sent successfully',
                code: ResponseCode.Success,
              },
            };
          } catch (error) {
            star.logger?.error('Failed to send QR code update:', error);
            return {
              status: 500,
              data: {
                content: { sent: false },
                message: 'Failed to send QR code update',
                code: ResponseCode.ServiceActionFaild,
              },
            };
          }
        },
      },

      // 告警推送
      'alert.send': {
        timeout: 0,
        handler(ctx: Context) {
          const { alert, level, userId, clientId } = ctx.params;

          try {
            const message = {
              type: 'alert',
              data: {
                alert,
                level: level || 'info',
                timestamp: Date.now(),
              },
            };

            if (clientId) {
              (this as any).sendToClient(clientId, message);
            } else if (userId) {
              (this as any).sendToUser(userId, message);
            } else {
              (this as any).broadcastToChannel('alert', message);
            }

            return {
              status: 200,
              data: {
                content: { sent: true },
                message: 'Alert sent successfully',
                code: ResponseCode.Success,
              },
            };
          } catch (error) {
            star.logger?.error('Failed to send alert:', error);
            return {
              status: 500,
              data: {
                content: { sent: false },
                message: 'Failed to send alert',
                code: ResponseCode.ServiceActionFaild,
              },
            };
          }
        },
      },

      // 消息推送
      'message.send': {
        timeout: 0,
        handler(ctx: Context) {
          const { message, userId, clientId } = ctx.params;

          try {
            const wsMessage = {
              type: 'message',
              data: {
                message,
                timestamp: Date.now(),
              },
            };

            if (clientId) {
              (this as any).sendToClient(clientId, wsMessage);
            } else if (userId) {
              (this as any).sendToUser(userId, wsMessage);
            } else {
              (this as any).broadcastToChannel('message', wsMessage);
            }

            return {
              status: 200,
              data: {
                content: { sent: true },
                message: 'Message sent successfully',
                code: ResponseCode.Success,
              },
            };
          } catch (error) {
            star.logger?.error('Failed to send message:', error);
            return {
              status: 500,
              data: {
                content: { sent: false },
                message: 'Failed to send message',
                code: ResponseCode.ServiceActionFaild,
              },
            };
          }
        },
      },
    },
    methods: gatewayMethods(star),
    // 创建时操作
    async created() {
      try {
        // 连接数据库
        await dbConnections.mainConnection.bindManinConnection({
          benchmark: true,
          logging(sql, timing) {
            if (timing && timing > 1000) {
              // 如果查询时间大于1s，将进行日志打印
              star.logger?.warn(`Mysql operation is timeout, sql: ${sql}, timing: ${timing}ms`);
            }
          },
        });
        star.logger?.info('Mysql connection is success!');
        // 拉取配置项
        configs = await getAllConfigList();
      } catch (error) {
        star.logger?.error('gateway_app is created fail~', 'error:', error);
      }
    },

    // 启动时操作
    async started() {
      // 获取到ip地址黑名单列表
      ipBlackList = (await getAllIpBlackList()) || [];

      if (ipBlackList.length > 0) {
        ips = _.compact(ipBlackList.map((ip) => ip?.ipv4 || ip?.ipv6 || ''));
      }
      // 获取IP地址黑名单相关配置
      const IPConfig = configs[ConfigKeysMap.IPAccessBlackList]
        ? JSON.parse(configs[ConfigKeysMap.IPAccessBlackList])
        : {};
      // 设置轮询
      ipTimer = setInterval(
        () =>
          // 定时更新ip黑名单数据库
          saveOrUpdateIpBlackList(ipBlackList),
        IPConfig?.updateTimer * 60 * 1000 || 30 * 60 * 1000,
      );

      // 初始化 WebSocket 服务器
      try {
        await (this as any).initWebSocketServer();
        star.logger?.info('WebSocket server initialized successfully');
      } catch (error) {
        star.logger?.error('Failed to initialize WebSocket server:', error);
      }
    },

    // 结束时操作
    async stopped() {
      // 清理 WebSocket 资源
      try {
        await (this as any).cleanupWebSocket();
        star.logger?.info('WebSocket server cleaned up successfully');
      } catch (error) {
        star.logger?.error('Failed to cleanup WebSocket server:', error);
      }

      // 断开数据库连接
      await dbConnections.mainConnection.destroy();

      // 清除定时器，避免内存泄漏
      clearInterval(ipTimer);
    },
  });

  // 启动网关微服务
  star.start().then(() => {
    star.logger?.info(`微服务 ${appName.toUpperCase()} 启动成功`);
  });
});
