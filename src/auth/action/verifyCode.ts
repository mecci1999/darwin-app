import { RequestParamInvalidError } from 'error';
import { customAlphabet } from 'nanoid';
import { ResponseCode } from 'typings/enum';
import { HttpResponseItem } from 'typings/response';
import { Context, Star } from 'node-universe';
import { GatewayResponse, IncomingRequest, Route } from 'typings';

/**
 * 通过邮箱发送验证码，需要区分验证码的类型，例如：登录、注册、找回密码等。
 */
export default function verifyCode(star: Star) {
  return {
    'v1.verifyCode': {
      metadata: {
        auth: false,
      },
      // 获取验证码，需要将验证码存储到redis中
      async handler(
        ctx: Context,
        route: Route,
        req: IncomingRequest,
        res: GatewayResponse,
        data: any,
      ): Promise<HttpResponseItem> {
        try {
          // 排除极端情况
          if (!ctx.params.email || !ctx.params.type) {
            // 参数不通过
            throw new RequestParamInvalidError();
          }

          // 随机生成6位验证码
          const generateCode = customAlphabet('0123456789', 6)(6);

          const mailOptions = {
            from: 'mecci1999@163.com', // 发件人邮箱
            to: ctx.params.email, // 收件人邮箱
            subject: '这是一张飞往Darwin宇宙的飞船船票',
            html: `<p>您好，欢迎来到Darwin的小宇宙</p>
                  <span>您的验证码是</span><span style="font-size: 20px; font-weight: bold; margin-left: 8px; margin-right: 8px;">${generateCode}</span><span>，5分钟内有效，请勿向他人透露。</span>`,
          };

          // 发送邮件
          const result = await (this as any).sendVerifyCodeEmail({
            email: ctx.params.email,
            type: ctx.params.type,
            options: mailOptions,
            code: generateCode,
          });

          return {
            status: 200,
            data: { content: null, message: result.message, code: result.code },
          };
        } catch (error) {
          star.logger?.error(error);
          return {
            status: 500,
            data: {
              content: null,
              message: '验证码发送失败，请重试～',
              code: ResponseCode.ServiceActionFaild,
            },
          };
        }
      },
    },
  };
}
