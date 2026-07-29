/**
 * 用户注册接口
 */
import { ADMIN_EMAILS, PASSWORD_SECRET_KEY } from 'config';
import crypto from 'crypto';
// 移除直接数据库API导入，使用star.db接口
import { RequestParamInvalidError } from 'error';
import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, Starlight } from 'typings';
import { decryptPassword, generateUserId } from 'utils';

export default function register(star: Starlight) {
  return {
    'v1.register': {
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

          const email = String(ctx.params.email).trim().toLowerCase();

          // 使用正则匹配验证邮箱是否有效
          const reg = /^[a-zA-Z0-9_-]+@[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)+$/;
          if (!reg.test(email)) {
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

          // 验证邮箱验证码是否正确
          const verifyCode = await star.cacher.get(`verifyCode:${email};type:register`);

          if (verifyCode !== ctx.params.code) {
            return {
              status: 200,
              data: {
                content: null,
                message: '邮箱验证码已失效，请重新生成～',
                code: HttpResponseCode.UserEmailCodeIsError,
                success: false,
              },
            };
          }

          // 解密
          const decryptedPassword = decryptPassword(
            ctx.params.hash,
            `${PASSWORD_SECRET_KEY}`,
          ).toString();

          // 生成盐值
          const salt = crypto.randomBytes(16).toString('hex');

          // 生成最终的密码
          const passwordHash = crypto
            .pbkdf2Sync(decryptedPassword, salt, 1000, 64, 'sha512')
            .toString('hex');

          // 生成用户ID
          const userId = generateUserId();

          const registration = await star.db.auth.registerEmailUser({
            email,
            passwordHash: passwordHash,
            salt: salt,
            userId: userId,
          }, ADMIN_EMAILS || '');

          if (registration.status === 'created') {
            // 直接删除验证码对应的缓存
            await star.cacher.delete(`verifyCode:${email};type:register`);

            return {
              status: 200,
              data: {
                content: { userId },
                message: '注册账号成功',
                code: HttpResponseCode.Success,
                success: true,
              },
            };
          }

          if (registration.status === 'email_exists') {
            return {
              status: 200,
              data: {
                content: null,
                message: '该邮箱已注册',
                code: HttpResponseCode.UserEmailAlreadyExist,
                success: false,
              },
            };
          }

          return {
            status: 200,
            data: {
              content: null,
              message: '注册账号失败，请稍后重试～',
              code: HttpResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        } catch (error) {
          star.logger?.error('Email registration failed', error);
          return {
            status: 500,
            data: {
              content: null,
              message: '注册账号失败，请稍后重试～',
              code: HttpResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        }
      },
    },
  };
}
