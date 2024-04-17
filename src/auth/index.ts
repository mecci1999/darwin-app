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
      "v1.publicKey": {
        // 获取公共key，用来将用户账号密码进行加密进行传输
        // 先生成keyId，再根据keyId生成对应的公钥和密钥，存储在redis中，并设置过期时间
        // 将keyId和公钥返回给客户端
      },
      "v1.token": {
        // 将收到的keyId拿到，获取到对应的密钥
        // 使用密钥将用户传过来的密文解密，注意此时用户传过来的密码已经是做了加密的，不是明文。
        // 将账号、密码进行校验
        // 没有问题就下发token
      },
    },
  });

  // 启动身份校验微服务
  star.start().then(() => {
    console.log(`微服务 ${appName.toUpperCase()} 启动成功`);
  });
});
