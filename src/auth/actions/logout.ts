/**
 * 用户退出登录接口
 */
import { Context, Star } from 'node-universe';
import { ResponseCode } from 'typings/enum';
import { HttpResponseItem } from 'typings/response';

export default function logout(star: Star) {
  return {
    'v1.logout': {
      metadata: {
        auth: true, // 需要token验证
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const userId = (ctx.meta as any)?.user?.userId;

          if (!userId) {
            return {
              status: 200,
              data: {
                content: null,
                message: '用户未登录',
                code: ResponseCode.UserNotLoginError,
                success: false,
              },
            };
          }

          // 清除用户相关的缓存token（如果有的话）
          const token = (ctx.meta as any)?.authToken;
          if (token) {
            // 可以将token加入黑名单或从缓存中移除
            await Promise.all([
              star.cacher.delete(`token:${token}`),
              star.cacher.delete(`refreshToken:${userId}`),
            ]);
          }

          // 清除cookies
          (ctx.meta as any).clearCookies = true;

          star.logger?.debug('logout success', { userId });

          return {
            status: 200,
            data: {
              content: { userId },
              message: '退出登录成功',
              code: ResponseCode.Success,
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('logout error', error);
          return {
            status: 500,
            data: {
              content: null,
              message: `退出登录失败: ${error}`,
              code: ResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        }
      },
    },
  };
}
