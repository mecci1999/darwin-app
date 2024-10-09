/**
 * 登陆校验微服务
 * @author darwin
 * 关于登录验证服务
 * 本服务提供三种登录验证方式
 * 1、账号密码登录，需要验证码进行二次校验（验证码可以是邮箱验证或是短信验证）
 * 2、扫码登录，二维码key由服务端生成下发给客户端，客户端扫描后将二维码key传给服务端进行验证
 * 3、第三方登录验证，微信、QQ等第三方登录验证（需要结合客户端）也是二维码登录
 * 4、注册服务
 */
import { pinoLoggerOptions } from 'config';
import Universe from 'node-universe';

// 微服务名
const appName = 'auth';

pinoLoggerOptions(appName).then((pinoOptions) => {
  const star = new Universe.Star({
    namespace: 'darwin-app',
    transporter: {
      type: 'KAFKA',
      debug: true,
      host: 'localhost:9092',
    },
    logger: pinoOptions,
    // metrics: {
    //   enabled: true,
    //   reporter: {
    //     type: 'Prometheus',
    //     options: {},
    //   },
    // },
  });

  star.createService({
    name: appName,
    methods: {
      // 验证token是否有效
      resolveToken(ctx, route, req, res) {
        return new Promise((resolve, reject) => {

        })
      }
    },
    actions: {
      'v1.verifyCode': {
        // 获取验证码
        async handler(ctx, route, req, res) {
          return new Promise((resolve, reject) => {

          });
        },
        metadata: {
          auth: false,
        },
      },
      'v1.login': {
        metadata: {
          auth: false,
        },
        async handler(ctx, route, req, res) {
          // 密码登录接口，再进行密码验证

        },
      },
      'v1.publicKey': {
        // 获取公共key，用来将用户账号密码进行加密进行传输
        // 先生成keyId，再根据keyId生成对应的公钥和密钥，存储在redis中，并设置过期时间
        // 将keyId和公钥返回给客户端
      },
      'v1.checkLogin': {
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
