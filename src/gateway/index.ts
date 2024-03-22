import Universe from "node-universe/dist";
import { UniverseWeb } from "node-universe-gateway/dist";
import { rotate } from "pino-rotate-file/dist";
import moment from "moment-timezone";

// 微服务名
const appName = "gateway";

// 文件日志流
rotate({
  maxAgeDays: 1, // 按照1天的作为分割，分别存储目录
  path: `./logs/${appName}`, // 日志文件存储目录
  mkdir: true,
  prettyOptions: {
    colorize: true,
    // [2019-08-31 08:40:53.481] INFO STAR: Universe is creating...
    customPrettifiers: {
      time: () =>
        `[${moment().tz("Asia/Shanghai").format("YYYY-MM-DD HH:mm:ss:SSS")}]`,
      level: (inputData, key, log, extras) => `${extras.labelColorized}`,
      name: (value) => `${value}`,
      pid: (value) => `PID-${value}`,
      mod: (value, key, log, extras) =>
        `${extras.colors ? extras.colors.green(value.toLocaleUpperCase()) : value.toLocaleUpperCase()}`,
      nodeID: (value, key, log, extras) =>
        `${extras.colors ? extras.colors.green(value) : value}`,
      namespace: (value, key, log, extras) =>
        `${extras.colors ? extras.colors.green(value) : value}`,
      svc: (value, key, log, extras) =>
        `${extras.colors ? extras.colors.green(value) : value}`,
      version: (value, key, log, extras) =>
        `${extras.colors ? extras.colors.green(value) : value}`,
      messageKey: (inputData, key, log, extras) => `${inputData}`,
    } as any,
  },
}).then((_destination) => {
  const star = new Universe.Star({
    namespace: "darwin-app",
    transporter: {
      type: "KAFKA",
      debug: true,
      host: "localhost:9092",
    },
    // 日志模块
    logger: {
      name: "gateway",
      type: "pino",
      options: {
        pino: {
          options: {
            name: appName.toLocaleUpperCase(),
            level: "info", // 日志级别
            timestamp: () =>
              `,"time": "${moment().tz("Asia/Shanghai").format("YYYY-MM-DD HH:mm:ss:SSS")}"`, // 日志时间展示
            flushInterval: 10 * 1000,
            useLevelLabels: true,
            formatters: {
              level(lable: string, number: number) {
                return { level: lable };
              },
            },
          },
          destination: _destination,
        },
      },
    },
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
      // rateLimit: {
      //  window: 10 * 1000,
      //  limit: 10,
      //  headers: true
      // },
      path: "/api",
      routes: [
        // 配置路由，将 REST 请求映射到对应的微服务
        {
          path: "/:service/version/:action",
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
          //  this.logger.info("onBeforeCall in protected route");
          //  ctx.meta.authToken = req.headers["authorization"];
          // },

          // onAfterCall(ctx, route, req, res, data) {
          //  this.logger.info("onAfterCall in protected route");
          //  res.setHeader("X-Custom-Header", "Authorized path");
          //  return data;
          // },
          // Route error handler
          // onError(req, res, err) {
          //   res.setHeader("Content-Type", "text/plain");
          //   res.writeHead(err.code || 500);
          //   res.end({ result: "Route error: " + err.message });
          // },
        },
      ],
    },
    actions: {
      // 网关服务的 dispatch 动作将请求转发到相应的微服务
      dispatch: {
        handler(ctx) {
          const { service, version, action } = ctx.params;
          const params = ctx.params || {};
          // 转发请求到相应的微服务
          return ctx.call(`${service}.${version}.${action}`, params);
        },
      },
    },
    methods: {
      /**
       * Authorize the request
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
    console.log("微服务启动成功");
  });
});
