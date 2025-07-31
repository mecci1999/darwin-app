/**
 * 用户注册接口
 */
import { PASSWORD_SECRET_KEY } from 'config';
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
          const isExist = await star.db.auth.findEmailIsExist(ctx.params.email);

          if (isExist) {
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

          // 验证邮箱验证码是否正确
          const verifyCode = await star.cacher.get(`verifyCode:${ctx.params.email};type:register`);

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

          // 调用user服务，新增用户动作
          const createUser = await ctx.call('user.v1.create', {
            userId,
            source: 'email',
          });

          if (createUser.status !== 201) {
            return {
              status: 200,
              data: {
                content: null,
                message: '注册账号失败，请稍后重试～',
                code: HttpResponseCode.ServiceActionFaild,
                success: false,
              },
            };
          }

          // 新增邮箱认证信息
          const isSuccess = await star.db.auth.saveOrUpdateEmailAuth({
            email: ctx.params.email,
            passwordHash: passwordHash,
            salt: salt,
            userId: userId,
          });

          if (isSuccess) {
            // 直接删除验证码对应的缓存
            await star.cacher.delete(`verifyCode:${ctx.params.email};type:register`);

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
          return {
            status: 500,
            data: {
              content: null,
              message: `${error}`,
              code: HttpResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        }
      },
    },
  };
}
