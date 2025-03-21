import login from './login';
import register from './register';
import rsa from './rsa';
import verifyCode from './verifyCode';

/**
 * 验证微服务的动作
 */
const authAction = (star: any) => {
  const verifyCodeAction = verifyCode(star);
  const registerAction = register(star);
  const loginAction = login(star);
  const rsaAction = rsa(star);

  return {
    ...verifyCodeAction,
    ...registerAction,
    ...loginAction,
    ...rsaAction,
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
