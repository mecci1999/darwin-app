/**
 * 用户续期接口
 */
import { RequestParamInvalidError } from 'error';
import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, Starlight } from 'typings';

export default function login(star: Starlight) {
  return {
    'v1.refreshToken': {
      metadata: {
        auth: false,
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const headerCookie = ((ctx.meta as any)?.req?.headers?.cookie ||
            (ctx.meta as any)?.req?.headers?.Cookie ||
            '') as string;
          const refreshTokenFromCookie = headerCookie
            .split(';')
            .map((item) => item.trim())
            .find((item) => item.startsWith('REFRESH_TOKEN='))
            ?.split('=')
            .slice(1)
            .join('=');

          const refreshTokenFromBody = (ctx.params as any)?.refreshToken;
          const refreshToken = refreshTokenFromBody || refreshTokenFromCookie;

          // 排除极端情况
          if (!refreshToken) {
            return {
              status: 401,
              data: {
                content: null,
                message: '登录过期，请重新登录~',
                code: HttpResponseCode.NotLogin,
                success: false,
              },
            };
          }

          // 验证refreshToken是否过期
          const user = await (this as any).resolveToken(refreshToken);

          if (
            !user ||
            (user as any).error ||
            (user as any).code === HttpResponseCode.REFRESH_TOKEN
          ) {
            return {
              status: 401,
              data: {
                content: null,
                message: '登录过期，请重新登录~',
                code: HttpResponseCode.ERR_INVALID_TOKEN,
                success: false,
              },
            };
          }

          // 判断是否过期
          if ((user as any).isExpired) {
            return {
              status: 401,
              data: {
                content: null,
                message: '登录过期，请重新登录~',
                code: HttpResponseCode.ERR_INVALID_TOKEN,
                success: false,
              },
            };
          }

          // 生成新token
          const accessToken = await (this as any).generateToken({ userId: (user as any).userId });

          if (accessToken) {
            // 设置cookies
            (ctx.meta as any).token = accessToken;
            (ctx.meta as any).refreshToken = refreshToken;

            return {
              status: 200,
              data: {
                content: {
                  accessToken,
                  refreshToken,
                },
                message: 'Token续期成功',
                code: HttpResponseCode.Success,
                success: true,
              },
            };
          }

          return {
            status: 200,
            data: {
              content: null,
              message: 'Token续期失败，请稍后重试～',
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
