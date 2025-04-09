import { pinoLoggerOptions } from 'config';
import { Context, Star } from 'node-universe';
import { UniverseWeb } from 'node-universe-gateway';
import * as dbConnections from '../db/mysql/index';
import { getAllIpBlackList, saveOrUpdateIpBlackList } from 'db/mysql/apis/ipBlackList';
import _ from 'lodash';
import { getAllConfigList } from 'db/mysql/apis/config';
import { IConfig } from 'typings/config';
import { IIPBlackListTableAttributes } from 'db/mysql/models/ipBlackList';
import { ConfigKeysMap, IPAddressBanStatus, ResponseCode } from 'typings/enum';
import { IPNotPermissionAccess, UnAuthorizedError, UserNotLoginError } from 'error';
import { GatewayResponse, IncomingRequest, Route } from 'typings';

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
    // metrics: {
    //   enabled: true,
    //   reporter: {
    //     type: 'Prometheus',
    //     options: {
    //       port: 3030,
    //     },
    //   },
    // },
  });

  // 创建网关服务
  star.createService({
    name: appName,
    mixins: UniverseWeb,
    settings: {
      port: 6666,
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
              try {
                // 直接做token校验
                await (this as any).authorize(ctx, (ctx.meta as any).authToken);
              } catch (error) {
                throw new UnAuthorizedError();
              }
            }
          },
          // 请求成功后，对服务返回的数据进行二次处理
          onAfterCall(
            ctx: Context,
            route: Route,
            req: IncomingRequest,
            res: GatewayResponse,
            data: any,
          ) {
            // 判断是否触发身份验证，如果触发身份验证，则可以在请求响应头部中设置cookie
            if ((ctx.meta as any)?.token) {
              res.setHeader(
                'Set-Cookie',
                `ACCESS_TOKEN=${(ctx.meta as any)?.token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=7200`,
              );
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

          // 转发请求到相应的微服务
          return ctx.call(`${service}.${version}.${action}`, params);
        },
      },
    },
    methods: {
      /**
       * token校验,判断是否是管理员，判断是否是用户
       * 1、判断token是否有效
       * 2、获取到token对应的user数据，并携带到其他服务中
       */
      async authorize(ctx: Context, token: string) {
        if (!token) {
          return Promise.reject(new UserNotLoginError());
        }

        // Verify JWT token
        return await ctx.call('auth.resolveToken', { token }).then((user) => {
          if (!user) {
            return Promise.reject(new UnAuthorizedError());
          } else {
            (ctx.meta as any).user = user;
          }
        });
      },
    },
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
    },

    // 结束时操作
    async stopped() {
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
