/**
 * 用户续期接口
 */
import { RequestParamInvalidError } from 'error';
import { Context, Star } from 'node-universe';
import { ResponseCode } from 'typings/enum';
import { HttpResponseItem } from 'typings/response';

export default function login(star: Star) {
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
                code: ResponseCode.ERR_INVALID_TOKEN,
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
                code: ResponseCode.Success,
              },
            };
          }

          return {
            status: 200,
            data: {
              content: null,
              message: 'Token续期失败，请稍后重试～',
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
