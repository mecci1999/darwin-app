/**
 * 用户应用管理动作
 */
import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, Starlight } from 'typings';
import { saveOrUpdateUsers, findUserByUserId } from '../../../db/mysql/apis/user';
import { ValidationHandler, EventHandler } from '../utils';

export default function manageApplications(star: Starlight) {
  return {
    /**
     * 为用户添加应用访问权限
     */
    addApplicationAccess: async (ctx: Context): Promise<HttpResponseItem> => {
      try {
        const params = ctx.params as {
          userId: string;
          applicationIds: string[];
          tenantId?: string;
        };

        // 参数验证
        if (!params.applicationIds || !Array.isArray(params.applicationIds) || params.applicationIds.length === 0) {
          return {
            status: 400,
            data: {
              message: '应用ID列表不能为空且必须是数组格式',
              code: HttpResponseCode.ParamsError,
              success: false,
            },
          };
        }

        // 查找用户
        const existingUser = await findUserByUserId(params.userId);
        if (!existingUser) {
          return {
            status: 404,
            data: {
              message: '用户不存在',
              code: HttpResponseCode.UserNotExist,
              success: false,
            },
          };
        }

        // 解析现有应用ID列表
        let currentApplicationIds: string[] = [];
        try {
          currentApplicationIds = JSON.parse(existingUser.applicationIds || '[]');
        } catch (error) {
          star.logger?.warn(`用户${params.userId}的应用ID数据格式错误，将重置应用列表`);
        }

        // 合并应用ID，去重
        const updatedApplicationIds = Array.from(new Set([...currentApplicationIds, ...params.applicationIds]));

        // 更新用户数据
        const updateData: any = {
          userId: params.userId,
          applicationIds: JSON.stringify(updatedApplicationIds),
          source: existingUser.source,
          status: existingUser.status,
        };

        // 如果提供了租户ID，也更新租户信息
        if (params.tenantId) {
          updateData.tenantId = params.tenantId;
        }

        const updatedUser = await saveOrUpdateUsers([updateData]);
        if (!updatedUser || updatedUser.length === 0) {
          return {
            status: 500,
            data: {
              message: '应用访问权限添加失败',
              code: HttpResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        }

        star.logger?.info(`用户${params.userId}应用访问权限添加成功`);

        // 发布应用添加事件
        const eventHandler = EventHandler.getInstance();
        eventHandler.publishUserApplicationAdded(params.userId, params.applicationIds.join(','));

        return {
          status: 200,
          data: {
            message: '应用访问权限添加成功',
            content: {
              userId: params.userId,
              applicationIds: updatedApplicationIds,
              tenantId: params.tenantId || existingUser.tenantId,
            },
            code: HttpResponseCode.Success,
            success: true,
          },
        };
      } catch (error) {
        star.logger?.error('添加用户应用访问权限时发生错误:', error);
        return {
          status: 500,
          data: {
            message: '服务器内部错误',
            code: HttpResponseCode.ServiceActionFaild,
            success: false,
          },
        };
      }
    },

    /**
     * 移除用户应用访问权限
     */
    removeApplicationAccess: async (ctx: Context): Promise<HttpResponseItem> => {
      try {
        const params = ctx.params as {
          userId: string;
          applicationIds: string[];
        };

        // 参数验证
        if (!params.applicationIds || !Array.isArray(params.applicationIds) || params.applicationIds.length === 0) {
          return {
            status: 400,
            data: {
              message: '应用ID列表不能为空且必须是数组格式',
              code: HttpResponseCode.ParamsError,
              success: false,
            },
          };
        }

        // 查找用户
        const existingUser = await findUserByUserId(params.userId);
        if (!existingUser) {
          return {
            status: 404,
            data: {
              message: '用户不存在',
              code: HttpResponseCode.UserNotExist,
              success: false,
            },
          };
        }

        // 解析现有应用ID列表
        let currentApplicationIds: string[] = [];
        try {
          currentApplicationIds = JSON.parse(existingUser.applicationIds || '[]');
        } catch (error) {
          star.logger?.warn(`用户${params.userId}的应用ID数据格式错误`);
          return {
            status: 400,
            data: {
              message: '用户应用数据格式错误',
              code: HttpResponseCode.ParamsError,
              success: false,
            },
          };
        }

        // 移除指定的应用ID
        const updatedApplicationIds = currentApplicationIds.filter(
          appId => !params.applicationIds.includes(appId)
        );

        // 更新用户数据
        const updateData: any = {
          userId: params.userId,
          applicationIds: JSON.stringify(updatedApplicationIds),
          source: existingUser.source,
          status: existingUser.status,
        };

        const updatedUser = await saveOrUpdateUsers([updateData]);
        if (!updatedUser || updatedUser.length === 0) {
          return {
            status: 500,
            data: {
              message: '应用访问权限移除失败',
              code: HttpResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        }

        star.logger?.info(`用户${params.userId}应用访问权限移除成功`);

        // 发布应用移除事件
        const eventHandler = EventHandler.getInstance();
        eventHandler.publishUserApplicationRemoved(params.userId, params.applicationIds.join(','));

        return {
          status: 200,
          data: {
            message: '应用访问权限移除成功',
            content: {
              userId: params.userId,
              applicationIds: updatedApplicationIds,
            },
            code: HttpResponseCode.Success,
            success: true,
          },
        };
      } catch (error) {
        star.logger?.error('移除用户应用访问权限时发生错误:', error);
        return {
          status: 500,
          data: {
            message: '服务器内部错误',
            code: HttpResponseCode.ServiceActionFaild,
            success: false,
          },
        };
      }
    },

    /**
     * 获取用户可访问的应用列表
     */
    getUserApplications: async (ctx: Context): Promise<HttpResponseItem> => {
      try {
        const params = ctx.params as {
          userId: string;
        };

        // 查找用户
        const existingUser = await findUserByUserId(params.userId);
        if (!existingUser) {
          return {
            status: 404,
            data: {
              message: '用户不存在',
              code: HttpResponseCode.UserNotExist,
              success: false,
            },
          };
        }

        // 解析应用ID列表
        let applicationIds: string[] = [];
        try {
          applicationIds = JSON.parse(existingUser.applicationIds || '[]');
        } catch (error) {
          star.logger?.warn(`用户${params.userId}的应用ID数据格式错误`);
        }

        return {
          status: 200,
          data: {
            message: '获取用户应用列表成功',
            content: {
              userId: params.userId,
              applicationIds,
              tenantId: existingUser.tenantId,
            },
            code: HttpResponseCode.Success,
            success: true,
          },
        };
      } catch (error) {
        star.logger?.error('获取用户应用列表时发生错误:', error);
        return {
          status: 500,
          data: {
            message: '服务器内部错误',
            code: HttpResponseCode.ServiceActionFaild,
            success: false,
          },
        };
      }
    },

    /**
     * 检查用户是否有访问指定应用的权限
     */
    checkApplicationAccess: async (ctx: Context): Promise<HttpResponseItem> => {
      try {
        const params = ctx.params as {
          userId: string;
          applicationId: string;
        };

        // 参数验证
        if (!params.applicationId) {
          return {
            status: 400,
            data: {
              message: '应用ID不能为空',
              code: HttpResponseCode.ParamsError,
              success: false,
            },
          };
        }

        // 查找用户
        const existingUser = await findUserByUserId(params.userId);
        if (!existingUser) {
          return {
            status: 404,
            data: {
              message: '用户不存在',
              code: HttpResponseCode.UserNotExist,
              success: false,
            },
          };
        }

        // 解析应用ID列表
        let applicationIds: string[] = [];
        try {
          applicationIds = JSON.parse(existingUser.applicationIds || '[]');
        } catch (error) {
          star.logger?.warn(`用户${params.userId}的应用ID数据格式错误`);
        }

        const hasAccess = applicationIds.includes(params.applicationId);

        return {
          status: 200,
          data: {
            message: hasAccess ? '用户有访问权限' : '用户无访问权限',
            content: {
              userId: params.userId,
              applicationId: params.applicationId,
              hasAccess,
              tenantId: existingUser.tenantId,
            },
            code: hasAccess ? HttpResponseCode.Success : HttpResponseCode.NoPermissionError,
            success: hasAccess,
          },
        };
      } catch (error) {
        star.logger?.error('检查用户应用访问权限时发生错误:', error);
        return {
          status: 500,
          data: {
            message: '服务器内部错误',
            code: HttpResponseCode.ServiceActionFaild,
            success: false,
          },
        };
      }
    },
  };
}