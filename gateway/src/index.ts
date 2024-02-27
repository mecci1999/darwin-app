import Universe from "node-universe";
import ApiGAteway from "node-universe-gateway";

const star = new Universe.Star({
  namespace: "gateway-demo",
  transporter: {
    type: "KAFKA",
    debug: true,
    host: "localhost:9092",
  },
});

// 创建网关服务
star.createService({
  name: "gateway",
  mixins: [ApiGAteway],
  settings: {
    routes: [
      // 配置路由，将 REST 请求映射到对应的微服务
      {
        path: "/api/:service/:version/:action",
        aliases: {
          // 例如，将 /api/blog/v2/create 映射到 blog 服务的 v2 版本的 create 动作
          "/": "gateway.dispatch",
        },
      },
    ],
  },
  actions: {
    // 网关服务的 dispatch 动作将请求转发到相应的微服务
    dispatch: {
      handler(ctx) {
        const { service, version, action } = ctx.params;
        const params = ctx.params || {};
        console.log(params);
        // 转发请求到相应的微服务
        return ctx.call(`${service}.${version}.${action}`, params);
      },
    },
  },
});

// 启动网关微服务
star.start();
