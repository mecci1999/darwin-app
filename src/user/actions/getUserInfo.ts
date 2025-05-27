/**
 * 获取用户信息接口
 */
import { Context, Star } from 'node-universe';
import { ResponseCode } from 'typings/enum';
import { HttpResponseItem } from 'typings/response';
import { findUserByUserId } from 'db/mysql/apis/user';

export default function getUserInfo(star: Star) {
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
                code: ResponseCode.ParamsError,
              },
            };
          }

          // 查询用户信息
          const userInfo = await findUserByUserId(userId);

          if (!userInfo) {
            return {
              status: 200,
              data: {
                content: null,
                message: '用户不存在',
                code: ResponseCode.UserNotExist,
              },
            };
          }

          // 过滤敏感信息，只返回必要的用户信息
          const safeUserInfo = {
            userId: userInfo.userId,
            nickname: userInfo.nickname,
            avatar: userInfo.avatar,
            status: userInfo.status,
            source: userInfo.source,
            isAdmin: userInfo.power === 999,
            devices: userInfo.devices,
            timezone: userInfo.timezone,
            locale: userInfo.locale,
            lastActiveAt: userInfo.lastActiveAt,
            meta: userInfo.meta,
            createdAt: userInfo.createdAt,
            updatedAt: userInfo.updatedAt,
          };

          star.logger?.debug('获取用户信息成功', { userId });

          return {
            status: 200,
            data: {
              content: safeUserInfo,
              message: '获取用户信息成功',
              code: ResponseCode.Success,
            },
          };
        } catch (error) {
          star.logger?.error('getUserInfo error', error);
          return {
            status: 500,
            data: {
              content: null,
              message: `获取用户信息失败: ${error}`,
              code: ResponseCode.ServiceActionFaild,
            },
          };
        }
      },
    },
  };
}
