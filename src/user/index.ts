import Universe from "node-universe";

const star = new Universe.Star({
  namespace: "dawin-app",
  transporter: {
    type: "KAFKA",
    debug: true,
    host: "localhost:9092",
  },
  cacher: {
    type: 'Redis',
    clone: true,
    options: {
      port: 6379, // Redis port
      host: "localhost",
    }
  },
});

star.createService({
  name: "user",
  actions: {
    // 网关服务的 dispatch 动作将请求转发到相应的微服务
    "v1.create": {
        handler(ctx) {
            const params = ctx.params;
            // 在此处理 create 动作的逻辑
            // 例如，将接收到的参数存储到数据库中
            return { result: 'user is creating~' }
        }
    },
  },
});

// 启动网关微服务
star.start();
