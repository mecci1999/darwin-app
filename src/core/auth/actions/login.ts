/**
 * 用户登录接口
 */
import { PASSWORD_SECRET_KEY } from 'config';
import crypto from 'crypto';
import { RequestParamInvalidError } from 'error';
import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, Starlight } from 'typings';
import { decryptPassword } from 'utils';

const LOGIN_USER_INFO_TIMEOUT_MS = Number(process.env.LOGIN_USER_INFO_TIMEOUT_MS || 2000);

const buildSafeUserInfo = (userInfo: any, isStarlight = true) => {
  if (!userInfo) return null;

  const safeUserInfo: any = {
    userId: userInfo.userId,
    nickname: userInfo.nickname,
    avatar: userInfo.avatar,
    status: userInfo.status,
    source: userInfo.source,
    isAdmin: userInfo.power === 999,
    devices: userInfo.devices ? JSON.parse(userInfo.devices) : {},
    timezone: userInfo.timezone,
    locale: userInfo.locale,
    lastActiveAt: userInfo.lastActiveAt,
    meta: userInfo.meta ? JSON.parse(userInfo.meta) : {},
    createdAt: userInfo.createdAt,
    updatedAt: userInfo.updatedAt,
  };

  if (isStarlight) {
    safeUserInfo.isOnboardingCompleted = userInfo.isOnboardingCompleted ?? false;
  }

  return safeUserInfo;
};

const loadUserInfoFallback = async (star: Starlight, userId: string, isStarlight = true) => {
  const userInfo = await star.db.user.findUserByUserId(userId);
  return buildSafeUserInfo(userInfo, isStarlight);
};

export default function login(star: Starlight) {
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
                success: false,
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
                message: '邮箱验证码失效，请重新生成～',
                code: HttpResponseCode.UserEmailError,
                success: false,
              },
            };
          }

          // 邮箱验证码验证通过后，删除验证码
          await star.cacher.delete(`verifyCode:${ctx.params.email};type:login`);

          // 解密
          const decryptedPassword = decryptPassword(
            ctx.params.hash,
            `${PASSWORD_SECRET_KEY}`,
          ).toString();

          // 查询数据库获取盐值和加密后的密码
          const data = (await star.db.auth.findEmailAuthByEmail(ctx.params.email)) as any;

          if (!data)
            return {
              status: 200,
              data: {
                content: null,
                message: '邮箱错误或未注册',
                code: HttpResponseCode.UserEmailError,
                success: false,
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
                code: HttpResponseCode.UserPasswordError,
                success: false,
              },
            };
          }

          star.logger?.debug('login', data);

          // 生成token和refreshToken
          const isStarlight = ctx.meta?.appId !== 'starlight' ? ctx.meta?.appId === 'starlight' : true;
          const userInfoPromise = ctx.call(
            'user.v1.getUserInfo',
            {
              userId: data.userId,
            },
            {
              meta: {
                ...ctx.meta,
                appId: ctx.meta?.appId || 'starlight',
              },
              timeout: LOGIN_USER_INFO_TIMEOUT_MS,
            },
          ).catch(async (userInfoError) => {
            star.logger?.warn('getUserInfo timed out after login, using local DB fallback', {
              userId: data.userId,
              timeoutMs: LOGIN_USER_INFO_TIMEOUT_MS,
              error: userInfoError instanceof Error ? userInfoError.message : String(userInfoError),
            });
            const fallbackUserInfo = await loadUserInfoFallback(star, data.userId, isStarlight).catch((fallbackError) => {
              star.logger?.error('Local user info fallback after login failed', fallbackError);
              return null;
            });

            return fallbackUserInfo
              ? {
                  data: {
                    code: HttpResponseCode.Success,
                    content: fallbackUserInfo,
                  },
                  fallback: true,
                  error: userInfoError,
                }
              : {
                  data: null,
                  error: userInfoError,
                };
          });

          const tokenResult = await Promise.all([
            (this as any).generateToken({ userId: data.userId }),
            (this as any).generateRefreshToken({ userId: data.userId }),
            userInfoPromise,
          ]);

          const [accessToken, refreshToken, userInfoResult] = tokenResult;

          if (accessToken) {
            // 设置cookies
            ctx.meta.token = accessToken;
            ctx.meta.refreshToken = refreshToken;

            if (
              userInfoResult &&
              (userInfoResult as any).data &&
              (userInfoResult as any).data.code === HttpResponseCode.Success
            ) {
              return {
                status: 200,
                data: {
                  content: {
                    userId: data.userId,
                    userInfo: (userInfoResult as any).data.content,
                    accessToken,
                    refreshToken,
                  },
                  message: '登录成功',
                  code: HttpResponseCode.Success,
                  success: true,
                },
              };
            }

            if ((userInfoResult as any)?.error) {
              star.logger?.error('Error getting user info after login', (userInfoResult as any).error);
            } else {
              star.logger?.warn('Failed to get user info after login', { userId: data.userId });
            }

            return {
              status: 200,
              data: {
                content: {
                  userId: data.userId,
                  accessToken,
                  refreshToken,
                },
                message: '登录成功',
                code: HttpResponseCode.Success,
                success: true,
              },
            };
          }

          return {
            status: 200,
            data: {
              content: null,
              message: '登录失败，请稍后重试～',
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
