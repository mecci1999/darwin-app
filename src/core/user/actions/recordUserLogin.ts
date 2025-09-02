/**
 * 记录用户登录动作
 */
import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, Starlight } from 'typings';
import { ValidationHandler, EventHandler } from '../utils';

export default function recordUserLogin(star: Starlight) {
  return {
    'v1.recordLogin': {
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

          // 更新用户最后活跃时间
          const loginData: any = {
            userId: params.userId,
            source: existingUser.source,
            status: existingUser.status,
            lastActiveAt: new Date(),
          };

          // 如果提供了设备信息，更新设备记录
          if (params.deviceInfo) {
            const devices = existingUser.devices ? JSON.parse(existingUser.devices) : {};
            const deviceId = params.deviceInfo.deviceId || 'unknown';

            devices[deviceId] = {
              ...params.deviceInfo,
              lastLoginAt: new Date(),
              ip: params.ip,
              userAgent: params.userAgent,
            };

            loginData.devices = JSON.stringify(devices);
          }

          const updatedUser = await star.db.user.saveOrUpdateUsers([loginData]);

          if (!updatedUser || updatedUser.length === 0) {
            return {
              status: 500,
              data: {
                content: null,
                message: '记录用户登录失败',
                code: HttpResponseCode.ServiceActionFaild,
                success: false,
              },
            };
          }

          star.logger?.info(`用户${params.userId}登录记录成功`, {
            ip: params.ip,
            userAgent: params.userAgent,
            deviceId: params.deviceInfo?.deviceId,
          });

          // 发布用户登录事件
          const eventHandler = EventHandler.getInstance();
          eventHandler.publishUserLogin(params.userId);

          return {
            status: 200,
            data: {
              message: '用户登录记录成功',
              content: {
                userId: params.userId,
                loginTime: loginData.lastActiveAt,
              },
              code: HttpResponseCode.Success,
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('recordUserLogin error', error);
          return {
            status: 500,
            data: {
              content: null,
              message: `记录用户登录失败: ${error}`,
              code: HttpResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        }
      },
    },
  };
}
