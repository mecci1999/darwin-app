import { pinoLoggerOptions } from "config";
import Universe from "node-universe";
import { UniverseWeb } from "node-universe-gateway";
import * as dbConnections from "../db/mysql/index";
import { noAuthTokenWhiteList } from "./white";
import {
  getAllIpBlackList,
  saveOrUpdateIpBlackList,
} from "db/mysql/apis/ipBlackList";
import _ from "lodash";
import { getAllConfigList } from "db/mysql/apis/config";
import { ConfigKeysMap, IConfig } from "typings/config";
import { IIPBlackListTableAttributes } from "db/mysql/models/ipBlackList";
import { IPAddressBanStatus, ResponseErrorCode } from "typings/enum";
import { IPNotPermissionAccess } from "error";

// 微服务名
const appName = "gateway";

// ip地址黑名单，存储至内存中，每隔30分钟拉取本地数据库同步一次
let ips: string[] = [];
let ipBlackList: IIPBlackListTableAttributes[] = [];
let configs: IConfig[] = [];
let ipTimer: any; // ip同步更新定时器

pinoLoggerOptions(appName).then((pinoOptions) => {
  const star = new Universe.Star({
    namespace: "darwin-app",
    // KAFKA通信模块
    transporter: {
      type: "KAFKA",
      debug: true,
      host: "localhost:9092",
    },
    // 日志模块
    // logger: pinoOptions,
    // cacher: {
    //   type: "Redis",
    //   clone: true,
    //   options: {
    //     port: 6379, // Redis port
    //     host: "localhost",
    //   },
    // },
    metrics: {
      enabled: true,
      reporter: {
        type: "Prometheus",
        options: {
          port: 3030,
        },
      },
    },
  });

  // 创建网关服务
  star.createService({
    name: appName,
    mixins: UniverseWeb,
    settings: {
      port: 4000,
      ip: "0.0.0.0",
      // 全局跨域配置
      cors: {
        origin: "*",
        methods: ["GET", "OPTIONS", "POST", "PUT", "DELETE"],
        allowedHeaders: "*",
        //exposedHeaders: "*",
        credentials: true,
        maxAge: null,
      },
      rateLimit: {
        window: 30 * 1000,
        limit: 30,
        headers: true,
      },
      path: "/api",
      routes: [
        // 配置路由，将 REST 请求映射到对应的微服务
        {
          path: "/:service/:version/:action",
          authorization: false,
          // whitelist: [], // 路由白名单
          // 路由跨域配置
          // cors: {
          //   origin: ["https://localhost:3000", "https://localhost:4000"],
          //  methods: ["GET", "OPTIONS", "POST"],
          // },
          aliases: {
            // 例如，将 /api/blog/v2/create 映射到 blog 服务的 v2 版本的 create 动作
            "/": "gateway.dispatch",
          },
          bodyParsers: {
            json: true,
          },
          onBeforeCall(ctx, route, req, res) {
            if (req?.connection?.remoteAddress) {
              // 查看请求的ip地址是否被黑名单
              if (ips.includes(req.connection.remoteAddress)) {
                // 被黑名单禁用，直接返回404状态码
                throw new IPNotPermissionAccess();
              }
            }
            ctx.meta.authToken = req.headers["authorization"];
          },
          onAfterCall(ctx, route, req, res, data) {
            return data;
          },
          // Route error handler
          onError(req, res, err) {
            // 如果触发了RateLimitExceeded报错，将该ip地址进行封禁，并将ip地址存储到数据库中，启动网关微服务的时候，从数据库中拉取ip地址封禁名单
            if (err.code === 429 && req?.connection?.remoteAddress) {
              if (!ips.includes(req.connection.remoteAddress)) {
                // 触发请求限制错误，直接封禁ip
                ips.push(req.connection.remoteAddress);
                ipBlackList.push({
                  ipv4: req.connection.remoteAddress,
                  reason: "频繁请求",
                  status: IPAddressBanStatus.active,
                  isArtificial: false,
                });
              }
            }
            res.setHeader("Content-Type", "text/plain");
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
        // 日志下载服务
        {
          path: "/logs/download",
        },
      ],
    },
    actions: {
      // 网关服务的 dispatch 动作将请求转发到相应的微服务
      dispatch: {
        handler(ctx, route, req, res) {
          // 获取到不需要做token校验的动作白名单
          const { service, version, action } = ctx.params;
          const params = ctx.params || {};

          if (
            noAuthTokenWhiteList.includes(`${service}/${version}/${action}`)
          ) {
            // 转发请求到相应的微服务
            return ctx.call(`${service}.${version}.${action}`, params);
          }
          // 获取token
          // 转发请求到相应的微服务
          return ctx.call(`${service}.${version}.${action}`, params);
        },
      },
    },
    methods: {
      /**
       * token校验,判断是否是管理员，判断是否是用户
       */
      // authorize(ctx, route, req) {
      //  let token;
      //  if (req.headers.authorization) {
      //   let type = req.headers.authorization.split(" ")[0];
      //   if (type === "Token") {
      //    token = req.headers.authorization.split(" ")[1];
      //   }
      //  }
      //  if (!token) {
      //   return Promise.reject(new UnAuthorizedError(ERR_NO_TOKEN));
      //  }
      //  // Verify JWT token
      //  return ctx.call("auth.resolveToken", { token })
      //   .then(user => {
      //    if (!user)
      //     return Promise.reject(new UnAuthorizedError(ERR_INVALID_TOKEN));
      //    ctx.meta.user = user;
      //   });
      // }
    },
    // 创建时操作
    async created() {
      // 连接数据库
      await dbConnections.mainConnection.bindManinConnection({
        benchmark: true,
        logging(sql, timing) {
          if (timing && timing > 1000) {
            // 如果查询时间大于1s，将进行日志打印
            star.logger.warn(
              `mysql operation is timeout, sql: ${sql}, timing: ${timing}`,
            );
          }

          star.logger.info(`mysql connection is success!`);
        },
      });
      // 拉取配置项
      configs = await getAllConfigList();
    },

    // 启动时操作
    async started() {
      // 获取到ip地址黑名单列表
      ipBlackList = await getAllIpBlackList();
      ips = _.compact(ipBlackList.map((ip) => ip?.ipv4 || ip?.ipv6 || ""));
      // 获取IP地址黑名单相关配置
      const IPConfig = configs[ConfigKeysMap.IPAccessBlackList]
        ? JSON.parse(configs[ConfigKeysMap.IPAccessBlackList])
        : {};
      // 设置轮询
      ipTimer = setInterval(
        async () => {
          // 定时更新ip黑名单数据库
          await saveOrUpdateIpBlackList(ipBlackList);
        },
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
    console.log(`微服务 ${appName.toUpperCase()} 启动成功`);
  });
});
