/**
 * 用户更新动作
 */
import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, Starlight } from 'typings';
import { saveOrUpdateUsers, findUserByUserId } from '../../../db/mysql/apis/user';
import { ValidationHandler, EventHandler } from '../utils';

export default function updateUser(star: Starlight) {
  return {
    'v1.update': {
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

          // 构建更新数据
          const updateData: any = {
            userId: params.userId,
          };

          // 只更新提供的字段
          if (params.nickname !== undefined) updateData.nickname = params.nickname;
          if (params.avatar !== undefined) updateData.avatar = params.avatar;
          if (params.status !== undefined) updateData.status = params.status;
          if (params.timezone !== undefined) updateData.timezone = params.timezone;
          if (params.locale !== undefined) updateData.locale = params.locale;
          if (params.meta !== undefined) updateData.meta = JSON.stringify(params.meta);

          // 更新用户信息
          const updatedUser = await star.db.user.saveOrUpdateUsers([updateData]);

          if (!updatedUser || updatedUser.length === 0) {
            return {
              status: 500,
              data: {
                content: null,
                message: '更新用户信息失败',
                code: HttpResponseCode.ServiceActionFaild,
                success: false,
              },
            };
          }

          star.logger?.info(`用户${params.userId}信息更新成功`);

          // 发布用户更新事件
        const eventHandler = EventHandler.getInstance();
        eventHandler.publishUserUpdated(params.userId, updateData);

          return {
            status: 200,
            data: {
              message: '用户信息更新成功',
              content: { user: updatedUser[0] },
              code: HttpResponseCode.Success,
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('updateUser error', error);
          return {
            status: 500,
            data: {
              content: null,
              message: `更新用户信息失败: ${error}`,
              code: HttpResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        }
      },
    },
  };
}