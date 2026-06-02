/**
 * 批量获取用户信息动作
 */
import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, Starlight } from 'typings';

export default function batchGetUsers(star: Starlight) {
  return {
    'v1.batchGetUsers': {
      metadata: {
        auth: true,
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const params = ctx.params;

        // 验证必需参数
        if (!params.userIds || !Array.isArray(params.userIds) || params.userIds.length === 0) {
          return {
            status: 400,
            data: {
              content: null,
              message: '用户ID列表不能为空',
              code: HttpResponseCode.ParamsError,
              success: false,
            },
          };
        }

        // 限制批量查询数量
        if (params.userIds.length > 100) {
          return {
            status: 400,
            data: {
              content: null,
              message: '批量查询用户数量不能超过100个',
              code: HttpResponseCode.ParamsError,
              success: false,
            },
          };
        }

        try {
          const userIds: string[] = Array.from(
            new Set(params.userIds.map((userId: unknown) => String(userId))),
          );
          const userRecords = await star.db.user.findUsersByUserIds(userIds);
          const userMap = new Map(userRecords.map((user: any) => [user.userId, user]));

          const users: any[] = [];
          const notFoundUsers: string[] = [];

          for (const userId of userIds) {
            const userInfo = userMap.get(userId);
            if (userInfo) {
              const safeUserInfo = {
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
              users.push(safeUserInfo);
            } else {
              notFoundUsers.push(userId);
            }
          }

          star.logger?.info('批量获取用户信息成功', {
            requestedCount: userIds.length,
            foundCount: users.length,
            notFoundCount: notFoundUsers.length,
            queryMode: 'batch',
          });

          return {
            status: 200,
            data: {
              content: {
                users,
                notFoundUsers,
                total: users.length,
              },
              message: '批量获取用户信息成功',
              code: HttpResponseCode.Success,
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('batchGetUsers error', error);
          return {
            status: 500,
            data: {
              content: null,
              message: `批量获取用户信息失败: ${error}`,
              code: HttpResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        }
      },
    },
  };
}