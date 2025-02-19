import { HttpResponseItem } from 'typings/response';
import { customAlphabet } from 'nanoid';

/**
 * 验证微服务的动作
 */
const authAction = (star: any) => {
  return {
    'v1.verifyCode': {
      metadata: {
        auth: false,
      },
      // 获取验证码，需要将验证码存储到redis中
      async handler(ctx: any): Promise<HttpResponseItem> {
        // 排除极端情况
        if (!ctx.params.email)
          return { status: 401, data: { content: null, message: '请提供有效的邮箱', code: 401 } };

        // 随机生成6位验证码
        const generateCode = customAlphabet('0123456789', 6).toString();

        const mailOptions = {
          from: 'mecci1999@163.com', // 发件人邮箱
          to: ctx.params.email, // 收件人邮箱
          subject: '这是一张飞往Darwin宇宙的飞船船票',
          html: `<p>您好，欢迎您来到Darwin的小宇宙</p>
              <span>您的船票验证码是</span><span style="font-size: 20px; font-weight: bold; margin-left: 8px; margin-right: 8px;">${generateCode}</span><span>，5分钟内有效，请勿向他人透露。</span>`,
        };

        // 发送邮件
        const res = await (star as any).sendVerifyCodeEmail(
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
    'v1.qrCode.changeStatus': {
      metadata: {
        auth: true,
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
  };
};

export default authAction;
