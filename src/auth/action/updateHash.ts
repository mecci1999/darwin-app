/**
 * 更新密码接口
 * 该接口主要用于用户更新密码时，发送验证码到邮箱，重置密码
 * @param {string} email 用户邮箱
 * @param {string} code 邮箱验证码
 */
import { PASSWORD_SECRET_KEY } from 'config';
import crypto from 'crypto';
import { findEmailAuthByUserId, saveOrUpdateEmailAuth } from 'db/mysql/apis/auth';
import { RequestParamInvalidError } from 'error';
import { Context, Star } from 'node-universe';
import { ResponseCode } from 'typings/enum';
import { HttpResponseItem } from 'typings/response';
import { decryptPassword } from 'utils';

export default function updateHash(star: Star) {
  return {
    'v1.updateHash': {
      metadata: {
        auth: true,
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          // 排除极端情况
          if (!ctx.params.newHash || !ctx.params.code) {
            // 参数不通过
            throw new RequestParamInvalidError();
          }

          // 获取userId
          const userId = (ctx.meta as any).user.userId;

          if (!userId) {
            return {
              status: 200,
              data: {
                content: null,
                message: '身份校验失败，请重新登录～',
                code: ResponseCode.UserNotExist,
              },
            };
          }

          // 验证邮箱验证码是否正确
          const verifyCode = await star.cacher.get(`verifyCode:${ctx.params.email};type:update`);

          if (verifyCode !== ctx.params.code) {
            return {
              status: 200,
              data: {
                content: null,
                message: '邮箱验证码已失效，请重新生成～',
                code: ResponseCode.UserEmailCodeIsError,
              },
            };
          }

          // 获取用户原有的salt
          const { salt, email } = await findEmailAuthByUserId(userId);

          if (!salt) {
            return {
              status: 200,
              data: {
                content: null,
                message: '用户信息不存在，请重新登录～',
                code: ResponseCode.UserNotExist,
              },
            };
          }

          // 解密
          const decryptedPassword = decryptPassword(
            ctx.params.newHash,
            `${PASSWORD_SECRET_KEY}`,
          ).toString();

          // 生成最终的密码
          const passwordHash = crypto
            .pbkdf2Sync(decryptedPassword, salt, 1000, 64, 'sha512')
            .toString('hex');

          // 更新邮箱认证信息
          const isSuccess = await saveOrUpdateEmailAuth({
            email: email,
            passwordHash: passwordHash,
            salt: salt,
            userId: userId,
          });

          if (isSuccess) {
            // 直接删除验证码对应的缓存
            await star.cacher.delete(`verifyCode:${ctx.params.email};type:update`);

            return {
              status: 200,
              data: {
                content: { userId },
                message: '更新密码成功',
                code: ResponseCode.Success,
              },
            };
          }

          return {
            status: 200,
            data: {
              content: null,
              message: '更新密码失败，请稍后重试～',
              code: ResponseCode.ServiceActionFaild,
            },
          };
        } catch (error) {
          return {
            status: 500,
            data: {
              content: null,
              message: `${error}`,
              code: ResponseCode.ServiceActionFaild,
            },
          };
        }
      },
    },
  };
}
