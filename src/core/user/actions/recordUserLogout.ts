/**
 * 记录用户登出动作
 */
import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, Starlight } from 'typings';
import { saveOrUpdateUsers, findUserByUserId } from 'db/mysql/apis/user';
import { ValidationHandler, EventHandler } from '../utils';

export default function recordUserLogout(star: Starlight) {
  return {
    'v1.recordLogout': {
      metadata: {
        auth: true,
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const params = ctx.params;

        // 验证必需参数
        if (!params.userId) {
          return {
            status: 400,
            data: {
              content: null,
              message: '用户ID不能为空',
              code: HttpResponseCode.ParamsError,
              success: false,
            },
          };
        }

        try {
          // 检查用户是否存在
          const existingUser = await star.db.user.findUserByUserId(params.userId);
          if (!existingUser) {
            return {
              status: 404,
              data: {
                content: null,
                message: '用户不存在',
                code: HttpResponseCode.UserNotExist,
                success: false,
              },
            };
          }

          // 如果提供了设备信息，更新设备登出记录
          if (params.deviceId) {
            const devices = existingUser.devices ? JSON.parse(existingUser.devices) : {};

            if (devices[params.deviceId]) {
              devices[params.deviceId] = {
                ...devices[params.deviceId],
                lastLogoutAt: new Date(),
                logoutReason: params.reason || 'manual',
              };

              const logoutData: any = {
                userId: params.userId,
                source: existingUser.source,
                status: existingUser.status,
                devices: JSON.stringify(devices),
              };

              await star.db.user.saveOrUpdateUsers([logoutData]);
            }
          }

          star.logger?.info(`用户${params.userId}登出记录成功`, {
            deviceId: params.deviceId,
            reason: params.reason,
          });

          // 发布用户登出事件
          const eventHandler = EventHandler.getInstance();
          eventHandler.publishUserLogout(params.userId);

          return {
            status: 200,
            data: {
              message: '用户登出记录成功',
              content: {
                userId: params.userId,
                logoutTime: new Date(),
              },
              code: HttpResponseCode.Success,
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('recordUserLogout error', error);
          return {
            status: 500,
            data: {
              content: null,
              message: `记录用户登出失败: ${error}`,
              code: HttpResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        }
      },
    },
  };
}
