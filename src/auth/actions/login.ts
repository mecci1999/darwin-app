/**
 * 用户登录接口
 */
import { PASSWORD_SECRET_KEY } from 'config';
import crypto from 'crypto';
import { findEmailAuthByEmail, findEmailIsExist } from 'db/mysql/apis/auth';
import { RequestParamInvalidError } from 'error';
import { Context, Star } from 'node-universe';
import { ResponseCode } from 'typings/enum';
import { HttpResponseItem } from 'typings/response';
import { decryptPassword } from 'utils';

export default function login(star: Star) {
  return {
    'v1.login': {
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
              },
            };
          }

          // 查询数据库判断邮箱是否已注册
          const isExist = await findEmailIsExist(ctx.params.email);

          if (!isExist) {
            return {
              status: 200,
              data: {
                content: null,
                message: '邮箱错误或未注册',
                code: ResponseCode.UserEmailError,
              },
            };
          }

          // 验证邮箱验证码是否正确
          const verifyCode = await star.cacher.get(`verifyCode:${ctx.params.email};type:login`);

          if (verifyCode !== ctx.params.code) {
            return {
              status: 200,
              data: {
                content: null,
                message: '邮箱验证码已失效，请重新生成～',
                code: ResponseCode.UserEmailError,
              },
            };
          }

          // 解密
          const decryptedPassword = decryptPassword(
            ctx.params.hash,
            `${PASSWORD_SECRET_KEY}`,
          ).toString();

          // 查询数据库获取盐值和加密后的密码
          const data = (await findEmailAuthByEmail(ctx.params.email)) as any;

          if (!data)
            return {
              status: 200,
              data: {
                content: null,
                message: '服务查询报错',
                code: ResponseCode.ServiceActionFaild,
              },
            };

          // 生成密码
          const password = crypto
            .pbkdf2Sync(decryptedPassword, data.salt, 1000, 64, 'sha512')
            .toString('hex');

          if (password !== data.passwordHash) {
            return {
              status: 200,
              data: {
                content: null,
                message: '密码错误',
                code: ResponseCode.UserPasswordError,
              },
            };
          }

          star.logger?.debug('login', data);

          // 生成token和refreshToken
          const tokenResult = await Promise.all([
            (this as any).generateToken({ userId: data.userId }),
            (this as any).generateRefreshToken({ userId: data.userId }),
          ]);

          const [accessToken, refreshToken] = tokenResult;

          if (accessToken) {
            // 设置cookies
            (ctx.meta as any).token = accessToken;
            (ctx.meta as any).refreshToken = refreshToken;

            try {
              // 获取用户详细信息
              const userInfoResult = await ctx.call('user.v1.getUserInfo', {
                userId: data.userId,
              });

              // 如果获取用户信息成功，返回完整的用户信息
              if (
                userInfoResult &&
                userInfoResult.data &&
                userInfoResult.data.code === ResponseCode.Success
              ) {
                return {
                  status: 200,
                  data: {
                    content: {
                      userId: data.userId,
                      userInfo: userInfoResult.data.content,
                    },
                    message: '登录成功',
                    code: ResponseCode.Success,
                  },
                };
              } else {
                // 如果获取用户信息失败，仍然返回登录成功，但只包含基本信息
                star.logger?.warn('Failed to get user info after login', { userId: data.userId });
                return {
                  status: 200,
                  data: {
                    content: {
                      userId: data.userId,
                    },
                    message: '登录成功',
                    code: ResponseCode.Success,
                  },
                };
              }
            } catch (userInfoError) {
              // 获取用户信息出错，记录日志但不影响登录流程
              star.logger?.error('Error getting user info after login', userInfoError);
              return {
                status: 200,
                data: {
                  content: {
                    userId: data.userId,
                  },
                  message: '登录成功',
                  code: ResponseCode.Success,
                },
              };
            }
          }

          return {
            status: 200,
            data: {
              content: null,
              message: '登录失败，请稍后重试～',
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
