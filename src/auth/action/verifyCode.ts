import { HttpResponseItem } from 'typings/response';
import { customAlphabet } from 'nanoid';

/**
 * 通过邮箱发送验证码，需要区分验证码的类型，例如：登录、注册、找回密码等。
 */
export default function verifyCode(star: any) {
  return {
    v1: {
      name: 'verifyCode',
      action: {
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
          const res = await (star as any).sendVerifyCodeEmail({
            email: ctx.params.email,
            type: ctx.params.type,
            options: mailOptions,
            code: generateCode,
          });

          return {
            status: 200,
            data: { content: null, message: res.message, code: res.code },
          };
        },
      },
    },
  };
}
