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
import { HttpResponseItem } from 'typings/response';
import { verifyCodeOptions } from 'typings/auth';

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
    // logger: pinoOptions,
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
      sendVerifyCodeEmail(email: string, mode: string, options: verifyCodeOptions, code: string) {
        return new Promise((resolve, reject) => {
          // 创建邮箱发送对象
          const transporter = nodemailer.createTransport({
            service: '163',
            auth: {
              user: 'mecci1999@163.com',
              pass: 'YEVimrR6xg6pNYKK',
            },
          });

          star.cacher.get(`verifyCode:${email};mode:${mode}`).then((cacheCode: string) => {
            // 获取redis缓存
            if (cacheCode) {
              // 存在缓存
              // star.logger.info(`verifyCode:${email};mode:${mode}: ${cacheCode.toString()}`);
              resolve({ code: 200, message: '验证码已经发送至您的邮箱，请确认邮箱地址是否正确' });
            } else {
              // 缓存不存在或者已过期
              // 将邮箱作为redis的key存储验证码，并设置过期时间为5分钟
              star.cacher.set(`verifyCode:${email};mode:${mode}`, code, 5 * 60);

              transporter.sendMail(options as any, (error) => {
                if (error) {
                  star.logger.error('发送邮件失败', options, error);
                  reject(error);
                } else {
                  resolve({ code: 200, message: '验证码已发送' });
                }
              });
            }
          });
        });
      },
    },
    actions: {
      'v1.verifyCode': {
        // 获取验证码，需要将验证码存储到redis中
        async handler(ctx): Promise<HttpResponseItem> {
          // 排除极端情况
          if (!ctx.params.email)
            return { status: 401, data: { content: null, message: '请提供有效的邮箱', code: 401 } };

          // 随机生成6位验证码
          const generateCode = crypto.randomInt(100000, 999999).toString();

          const mailOptions = {
            from: 'mecci1999@163.com', // 发件人邮箱
            to: ctx.params.email, // 收件人邮箱
            subject: '这是一张飞往Darwin宇宙的飞船船票',
            html: `<p>您好，欢迎您来到Darwin的小宇宙</p>
              <span>您的船票验证码是</span><span style="font-size: 20px; font-weight: bold; margin-left: 8px; margin-right: 8px;">${generateCode}</span><span>，5分钟内有效，请勿向他人透露。</span>`,
          };

          // 发送邮件
          const res = await (this as any).sendVerifyCodeEmail(
            ctx.params.email,
            'login',
            mailOptions,
            generateCode,
          );

          return {
            status: 200,
            data: { content: null, message: res.message, code: res.code },
          };
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
          // 先判断验证码是否正确
          // 在判断数据库中是否存在该用户，调用user服务中的查询用户方法
          // 如果不存在该用户，返回对应的信息，并交给前端进行跳转

          // 密码登录接口，再进行密码验证
          return {
            status: 200,
            data: { message: '', content: null },
          };
        },
      },
      'v1.qrCode.login': {
        metadata: {
          auth: false,
        },
        async handler(ctx, route, req, res) {
          // 先判断验证码是否正确
          // 在判断数据库中是否存在该用户，调用user服务中的查询用户方法
          // 如果不存在该用户，返回对应的信息，并交给前端进行跳转

          // 密码登录接口，再进行密码验证
          return {
            status: 200,
            data: { message: '', content: null },
          };
        },
      },
      'v1.qrCode.getKey': {
        metadata: {
          auth: false,
        },
        async handler(ctx, route, req, res) {
          // 先判断验证码是否正确
          // 在判断数据库中是否存在该用户，调用user服务中的查询用户方法
          // 如果不存在该用户，返回对应的信息，并交给前端进行跳转

          // 密码登录接口，再进行密码验证
          return {
            status: 200,
            data: { message: '', content: null },
          };
        },
      },
      'v1.qrCode.getStatus': {
        metadata: {
          auth: false,
        },
        async handler(ctx, route, req, res) {
          // 先判断验证码是否正确
          // 在判断数据库中是否存在该用户，调用user服务中的查询用户方法
          // 如果不存在该用户，返回对应的信息，并交给前端进行跳转

          // 密码登录接口，再进行密码验证
          return {
            status: 200,
            data: { message: '', content: null },
          };
        },
      },
      // 'v1.publicKey': {
      //   // 获取公共key，用来将用户账号密码进行加密进行传输
      //   // 先生成keyId，再根据keyId生成对应的公钥和密钥，存储在redis中，并设置过期时间
      //   // 将keyId和公钥返回给客户端
      // },
      // 'v1.checkLogin': {
      //   // 将收到的keyId拿到，获取到对应的密钥
      //   // 使用密钥将用户传过来的密文解密，注意此时用户传过来的密码已经是做了加密的，不是明文。
      //   // 将账号、密码进行校验
      //   // 没有问题就下发token
      // },
    },
  });

  // 启动身份校验微服务
  star.start().then(() => {
    console.log(`微服务 ${appName.toUpperCase()} 启动成功`);
  });
});
