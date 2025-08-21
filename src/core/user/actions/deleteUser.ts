/**
 * 用户删除动作（软删除）
 */
import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, Starlight } from 'typings';
import { saveOrUpdateUsers, findUserByUserId } from '../../../db/mysql/apis/user';
import { ValidationHandler, EventHandler } from '../utils';

export default function deleteUser(star: Starlight) {
  return {
    'v1.delete': {
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

          // 检查用户是否已被删除
          if (existingUser.status === 'deleted') {
            return {
              status: 400,
              data: {
                content: null,
                message: '用户已被删除',
                code: HttpResponseCode.ParamsError,
                success: false,
              },
            };
          }

          // 软删除用户（更新状态为deleted）
          const deleteData = {
            userId: params.userId,
            status: 'deleted',
            source: existingUser.source, // 保持原有的source
          };

          const deletedUser = await star.db.user.saveOrUpdateUsers([deleteData]);

          if (!deletedUser || deletedUser.length === 0) {
            return {
              status: 500,
              data: {
                content: null,
                message: '删除用户失败',
                code: HttpResponseCode.ServiceActionFaild,
                success: false,
              },
            };
          }

          star.logger?.info(`用户${params.userId}已被软删除`);

          // 发布用户删除事件
          const eventHandler = EventHandler.getInstance();
          eventHandler.publishUserDeleted(params.userId, '用户主动删除');

          return {
            status: 200,
            data: {
              message: '用户删除成功',
              content: { userId: params.userId },
              code: HttpResponseCode.Success,
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('deleteUser error', error);
          return {
            status: 500,
            data: {
              content: null,
              message: `删除用户失败: ${error}`,
              code: HttpResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        }
      },
    },
  };
}