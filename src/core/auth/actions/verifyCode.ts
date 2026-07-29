import { RequestParamInvalidError } from 'error';
import { customAlphabet } from 'nanoid';
import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, Starlight } from 'typings';
import { buildVerifyCodeEmail } from './verifyCodeEmail';
import { resolveVerificationEmailConfig } from '../config/mail';

export interface VerifyCodeEmailSender {
  sendVerifyCodeEmail(params: {
    email: string;
    type: string;
    options: ReturnType<typeof buildVerifyCodeEmail>;
    code: string;
  }): Promise<{ code: number; message?: string }>;
}

/**
 * 通过邮箱发送验证码，需要区分验证码的类型，例如：登录、注册、找回密码等。
 */
export default function verifyCode(star: Starlight) {
  return {
    'v1.verifyCode': {
      metadata: {
        auth: false,
      },
      // 获取验证码，需要将验证码存储到redis中
      async handler(this: VerifyCodeEmailSender, ctx: Context): Promise<HttpResponseItem> {
        try {
          // 排除极端情况
          if (!ctx.params.email || !ctx.params.type) {
            // 参数不通过
            throw new RequestParamInvalidError();
          }

          const email = String(ctx.params.email).trim().toLowerCase();
          const emailConfig = resolveVerificationEmailConfig();
          if (!emailConfig.enabled) {
            return {
              status: 200,
              data: {
                content: null,
                message: '邮箱验证码服务暂未启用，请稍后重试～',
                code: HttpResponseCode.ServiceActionFaild,
                success: false,
              },
            };
          }

          // 随机生成6位验证码
          const generateCode = customAlphabet('0123456789', 6)(6);

          const mailOptions = {
            ...buildVerifyCodeEmail(generateCode, ctx.params.type, emailConfig.from),
            to: email,
          };

          // 发送邮件
          const res = await this.sendVerifyCodeEmail({
            email,
            type: ctx.params.type,
            options: mailOptions,
            code: generateCode,
          });

          if (res.code !== 200) {
            // 删除发送失败的验证码缓存
            await star.cacher.delete(`verifyCode:${email};type:${ctx.params.type}`);
            return {
              status: 200,
              data: {
                content: null,
                message: res.message || '验证码发送失败，请重试～',
                code: HttpResponseCode.ServiceActionFaild,
                success: false,
              },
            };
          }

          return {
            status: 200,
            data: {
              content: null,
              message: res.message || '验证码已发送，请注意邮箱～',
              code: HttpResponseCode.Success,
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error(error);
          // 删除发送失败的验证码缓存
          const email = ctx.params.email ? String(ctx.params.email).trim().toLowerCase() : '';
          await star.cacher.delete(`verifyCode:${email};type:${ctx.params.type}`);
          return {
            status: 500,
            data: {
              content: null,
              message: '验证码发送失败，请重试～',
              code: HttpResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        }
      },
    },
  };
}
