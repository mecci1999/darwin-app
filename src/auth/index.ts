/**
 * 登陆校验微服务
 */
import { pinoLoggerOptions } from "config";
import Universe from "node-universe";

// 微服务名
const appName = "auth";

pinoLoggerOptions(appName).then((pinoOptions) => {
  const star = new Universe.Star({
    namespace: "darwin-app",
    transporter: {
      type: "KAFKA",
      debug: true,
      host: "localhost:9092",
    },
    logger: pinoOptions,
  });

  star.createService({
    name: appName,
    methods: {},
    actions: {
      // 网关服务的 dispatch 动作将请求转发到相应的微服务
      "v1.login": {},
      "v1.publicKey": {},
    },
  });

  // 启动身份校验微服务
  star.start().then(() => {
    console.log(`微服务 ${appName.toUpperCase()} 启动成功`);
  });
});
