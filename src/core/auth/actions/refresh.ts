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
        auth: true,
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const refreshToken = (ctx.params as any).refreshToken || (ctx.meta as any).refreshToken;

          // 排除极端情况
          if (!refreshToken) {
            // 参数不通过
            throw new RequestParamInvalidError();
          }

          // 验证refreshToken是否过期
          const user = await (this as any).resolveToken(refreshToken);

          // 判断是否过期
          if (user && user.isExpired) {
            return {
              status: 200,
              data: {
                content: null,
                message: '登录过期，请重新登录~',
                code: HttpResponseCode.ERR_INVALID_TOKEN,
                success: false,
              },
            };
          }

          // 生成新token
          const accessToken = await (this as any).generateToken({ userId: user.userId });

          if (accessToken) {
            // 设置cookies
            (ctx.meta as any).token = accessToken;
            (ctx.meta as any).refreshToken = refreshToken;

            return {
              status: 200,
              data: {
                content: null,
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
