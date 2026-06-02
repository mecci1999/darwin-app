/**
 * 获取用户信息动作
 */
import { Context, Star } from 'node-universe';
import { HttpResponseCode, HttpResponseItem } from 'typings';

export default function getUserInfo(star: Star & { db: any }) {
  return {
    'v1.getUserInfo': {
      metadata: {
        auth: true, // 需要token验证
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { userId } = ctx.params;

          if (!userId) {
            return {
              status: 200,
              data: {
                content: null,
                message: '用户ID不能为空',
                code: HttpResponseCode.ParamsError,
                success: false,
              },
            };
          }

          const cacheKey = `user:profile:${userId}:${ctx.meta?.appId === 'starlight' ? 'starlight' : 'default'}`;
          if (star.cacher?.get) {
            const cached = await star.cacher.get(cacheKey);
            if (cached) {
              return {
                status: 200,
                data: {
                  content: cached,
                  message: '获取用户信息成功',
                  code: HttpResponseCode.Success,
                  success: true,
                },
              };
            }
          }

          const userInfo = await star.db.user.findUserByUserId(userId);

          if (!userInfo) {
            return {
              status: 200,
              data: {
                content: null,
                message: '用户不存在',
                code: HttpResponseCode.UserNotExist,
                success: false,
              },
            };
          }

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

          const isStarlight = ctx.meta?.appId === 'starlight';
          if (isStarlight) {
            safeUserInfo.isOnboardingCompleted = userInfo.isOnboardingCompleted ?? false;
          }

          if (star.cacher?.set) {
            await star.cacher.set(cacheKey, safeUserInfo, 60);
          }

          star.logger?.debug('获取用户信息成功', { userId });

          return {
            status: 200,
            data: {
              content: safeUserInfo,
              message: '获取用户信息成功',
              code: HttpResponseCode.Success,
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('getUserInfo error', error);
          return {
            status: 500,
            data: {
              content: null,
              message: `获取用户信息失败: ${error}`,
              code: HttpResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        }
      },
    },
  };
}
