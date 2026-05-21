import { Context } from 'node-universe';
import { DataBaseTableNames, HttpResponseCode, HttpResponseItem, Starlight } from 'typings';
import { mainConnection } from 'db/mysql';
import { UserTable } from 'db/mysql/models/user';

const layout = (star: Starlight) => {
  return {
    'v1.layout': {
      metadata: {
        auth: true,
      },
      params: {
        key: { type: 'string', required: true },
        layout: { type: 'any', optional: true },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const userId = (ctx.meta as any).user?.userId;
          if (!userId) {
            return {
              status: 401,
              data: {
                code: HttpResponseCode.UserNotLoginError,
                content: null,
                message: '未授权访问',
                success: false,
              },
            };
          }

          const { key, layout } = ctx.params;
          const model = await mainConnection.getModel<UserTable>(DataBaseTableNames.User);
          const cacheKey = `metrics:layout:${userId}:${key}`;

          if (!model) {
            if (layout !== undefined) {
              await (this as any).cacher?.set(cacheKey, layout);
              return {
                status: 200,
                data: {
                  code: HttpResponseCode.Success,
                  content: null,
                  message: '布局保存成功',
                  success: true,
                },
              };
            }
            const cached = await (this as any).cacher?.get(cacheKey);
            return {
              status: 200,
              data: {
                code: HttpResponseCode.Success,
                content: { layout: cached || [] },
                message: '布局获取成功',
                success: true,
              },
            };
          }

          const user = await model.findOne({ where: { userId } });
          if (!user) {
            if (layout !== undefined) {
              await (this as any).cacher?.set(cacheKey, layout);
              return {
                status: 200,
                data: {
                  code: HttpResponseCode.Success,
                  content: null,
                  message: '布局保存成功',
                  success: true,
                },
              };
            }
            const cached = await (this as any).cacher?.get(cacheKey);
            return {
              status: 200,
              data: {
                code: HttpResponseCode.Success,
                content: { layout: cached || [] },
                message: '布局获取成功',
                success: true,
              },
            };
          }

          let meta: Record<string, any> = {};
          try {
            meta = user.meta ? JSON.parse(user.meta) : {};
          } catch (e) {
            meta = {};
          }

          if (!meta.dashboardLayouts) {
            meta.dashboardLayouts = {};
          }

          // If layout is provided, it's a save operation
          if (layout) {
            meta.dashboardLayouts[key] = layout;
            // Update user meta
            await user.update({ meta: JSON.stringify(meta) });
            return {
              status: 200,
              data: {
                code: HttpResponseCode.Success,
                content: null,
                message: '布局保存成功',
                success: true,
              },
            };
          } else {
            // If layout is not provided, it's a get operation
            const result = meta.dashboardLayouts[key] || [];
            return {
              status: 200,
              data: {
                code: HttpResponseCode.Success,
                content: { layout: result },
                message: '布局获取成功',
                success: true,
              },
            };
          }
        } catch (error) {
          star.logger?.error('Layout action failed:', error);
          return {
            status: 500,
            data: {
              code: HttpResponseCode.ServiceActionFaild,
              content: null,
              message: '服务器内部错误',
              success: false,
            },
          };
        }
      },
    },
  };
};

export default layout;
