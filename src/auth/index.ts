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
import nodemailer from 'nodemailer';
import crypto from 'crypto';

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
    cacher: {
      type: 'Redis',
      clone: true,
      options: {
        port: 6379, // Redis port
        host: 'localhost',
      },
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
        return new Promise((resolve, reject) => {});
      },
      // 发送验证码
      sendVerifyCodeEmail(email: string) {
        return new Promise((resolve, reject) => {
          // 创建邮箱发送对象
          const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
              user: 'darwinandcc@gmail.com',
              pass: 'leo19870624',
            },
          });

          // 随机生成6位验证码
          const generateCode = crypto.randomInt(100000, 999999).toString();

          // 将邮箱作为redis的key存储验证码，并设置过期时间为5分钟
          star.cacher.set(`verifyCode:${email}`, generateCode, 5 * 60);

          const mailOptions = {
            from: 'darwinandcc@gmail.com', // 发件人邮箱
            to: email, // 收件人邮箱
            subject: '这是一张来自进入Darwin宇宙的飞船船票',
            html: `<p>您好，欢迎您来到Darwin的宇宙</p>
            <span>您的船票验证码是</span><span style="font-size: 20px; font-weight: bold; margin-left: 8px; margin-right: 8px;">${generateCode}</span><span>，5分钟内有效，请勿向他人透露。</span>`,
          };

          transporter.sendMail(mailOptions, (error) => {
            if (error) {
              console.log('发送失败', error);
              reject(error);
            } else {
              resolve({ code: 200, message: '验证码已发送' });
            }
          });
        });
      },
    },
    actions: {
      'v1.verifyCode': {
        // 获取验证码，需要将验证码存储到redis中
        async handler(ctx, route, req, res) {
          return new Promise((resolve, reject) => {
            // 发送验证码
            (this as any).sendVerifyCodeEmail(req.body.email).then((data) => {
              resolve({ code: 200, message: '验证码已发送', data });
            });
          });
        },
        metadata: {
          auth: false,
        },
        cache: {},
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
