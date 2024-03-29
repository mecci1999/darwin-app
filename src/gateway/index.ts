import Universe from "node-universe";
import { UniverseWeb } from "node-universe-gateway";
import { noAuthTokenWhiteList } from "./white";
import { pinoLoggerOptions } from "config";

// 微服务名
const appName = "gateway";

// ip地址黑名单，存储至内存中，每隔30分钟拉取本地数据库同步一次

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
    logger: pinoOptions,
    // cacher: {
    //   type: "Redis",
    //   clone: true,
    //   options: {
    //     port: 6379, // Redis port
    //     host: "localhost",
    //   },
    // },
    // metric: {
    //   enabled: true,
    // },
  });

  // 创建网关服务
  star.createService({
    name: "gateway",
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
        window: 10 * 1000,
        limit: 10,
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
          // bodyParsers: {
          //   json: true,
          // },
          // onBeforeCall(ctx, route, req, res) {
          // console.log(
          //   "onBeforeCall in protected route",
          //   req.connection.remoteAddress,
          // );
          //  ctx.meta.authToken = req.headers["authorization"];
          // },

          // onAfterCall(ctx, route, req, res, data) {
          //  this.logger.info("onAfterCall in protected route");
          //  res.setHeader("X-Custom-Header", "Authorized path");
          //  return data;
          // },
          // Route error handler
          onError(req, res, err) {
            // 如果触发了RateLimitExceeded报错，将该ip地址进行封禁，并将ip地址存储到数据库中，启动网关微服务的时候，从数据库中拉取ip地址封禁名单

            res.setHeader("Content-Type", "text/plain");
            res.writeHead(err.code || 500);
            res.end({ result: "Route error: " + err.message });
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
          // 获取到ip地址黑名单，如果该ip地址存在于黑名单中，则不做请求

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
  });

  // 启动网关微服务
  star.start().then(() => {
    console.log(`微服务[${appName.toUpperCase()}]启动成功`);
  });
});
