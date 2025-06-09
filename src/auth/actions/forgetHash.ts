/**
 * 忘记密码接口
 * 该接口主要用于忘记密码时，发送验证码到邮箱，重置密码
 */
import { PASSWORD_SECRET_KEY } from 'config';
import crypto from 'crypto';
import { findEmailAuthByEmail, saveOrUpdateEmailAuth } from 'db/mysql/apis/auth';
import { RequestParamInvalidError } from 'error';
import { Context, Star } from 'node-universe';
import { ResponseCode } from 'typings/enum';
import { HttpResponseItem } from 'typings/response';
import { decryptPassword } from 'utils';

export default function forgetHash(star: Star) {
  return {
    'v1.forgetHash': {
      metadata: {
        auth: false,
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          // 排除极端情况
          if (!ctx.params.email || !ctx.params.hash || !ctx.params.code) {
            // 参数不通过
            throw new RequestParamInvalidError();
          }

          // 使用正则匹配验证邮箱是否有效
          const reg = /^[a-zA-Z0-9_-]+@[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)+$/;
          if (!reg.test(ctx.params.email)) {
            return {
              status: 200,
              data: {
                content: null,
                message: '邮箱格式不正确',
                code: 20004,
                success: false,
              },
            };
          }

          // 查询数据库判断邮箱是否已注册
          const { userId, salt } = await findEmailAuthByEmail(ctx.params.email);

          if (!userId) {
            return {
              status: 200,
              data: {
                content: null,
                message: '该邮箱未注册',
                code: ResponseCode.UserEmailNotExist,
                success: false,
              },
            };
          }

          // 验证邮箱验证码是否正确
          const verifyCode = await star.cacher.get(`verifyCode:${ctx.params.email};type:forget`);

          if (verifyCode !== ctx.params.code) {
            return {
              status: 200,
              data: {
                content: null,
                message: '邮箱验证码已失效，请重新生成～',
                code: ResponseCode.UserEmailCodeIsError,
                success: false,
              },
            };
          }

          // 解密
          const decryptedPassword = decryptPassword(
            ctx.params.hash,
            `${PASSWORD_SECRET_KEY}`,
          ).toString();

          // 生成最终的密码
          const passwordHash = crypto
            .pbkdf2Sync(decryptedPassword, salt, 1000, 64, 'sha512')
            .toString('hex');

          // 更新邮箱认证信息
          const isSuccess = await saveOrUpdateEmailAuth({
            email: ctx.params.email,
            passwordHash: passwordHash,
            salt: salt,
            userId: userId,
          });

          if (isSuccess) {
            // 直接删除验证码对应的缓存
            await star.cacher.delete(`verifyCode:${ctx.params.email};type:forget`);

            return {
              status: 200,
              data: {
                content: { userId },
                message: '重置密码成功',
                code: ResponseCode.Success,
                success: true,
              },
            };
          }

          return {
            status: 200,
            data: {
              content: null,
              message: '重置密码失败，请稍后重试～',
              code: ResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        } catch (error) {
          return {
            status: 500,
            data: {
              content: null,
              message: `${error}`,
              code: ResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        }
      },
    },
  };
}
