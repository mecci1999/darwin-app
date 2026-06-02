import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, Starlight } from 'typings';

const getCachedLayout = async (star: Starlight, cacheKey: string) => {
  if (!star.cacher?.get) return undefined;
  try {
    return await star.cacher.get(cacheKey);
  } catch (error) {
    star.logger?.warn('Metrics layout cache read failed', { cacheKey, error: String(error) });
    return undefined;
  }
};

const setCachedLayout = async (star: Starlight, cacheKey: string, value: unknown) => {
  if (!star.cacher?.set) return;
  try {
    await star.cacher.set(cacheKey, value);
  } catch (error) {
    star.logger?.warn('Metrics layout cache write failed', { cacheKey, error: String(error) });
  }
};

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
        const requestStartedAt = Date.now();
        try {
          const userId = (ctx.meta as any).user?.userId;
          const { key, layout } = ctx.params;
          star.logger?.info('Metrics layout request received', {
            userId,
            key,
            isWrite: layout !== undefined,
          });

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

          const cacheKey = `metrics:layout:${userId}:${key}`;

          if (layout === undefined) {
            const cacheReadStartedAt = Date.now();
            const cached = await getCachedLayout(star, cacheKey);
            const cacheReadDurationMs = Date.now() - cacheReadStartedAt;
            if (cached !== undefined) {
              star.logger?.info('Metrics layout timing', {
                userId,
                key,
                operation: 'read',
                cacheHit: true,
                cacheReadDurationMs,
                totalDurationMs: Date.now() - requestStartedAt,
              });
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
          }

          const findUserStartedAt = Date.now();
          const user = await star.db.user.findUserByUserId(userId);
          const findUserDurationMs = Date.now() - findUserStartedAt;

          if (!user) {
            if (layout !== undefined) {
              const cacheWriteStartedAt = Date.now();
              await setCachedLayout(star, cacheKey, layout);
              star.logger?.info('Metrics layout timing', {
                userId,
                key,
                operation: 'save',
                dbLayer: 'star.db',
                userFound: false,
                findUserDurationMs,
                cacheWriteDurationMs: Date.now() - cacheWriteStartedAt,
                totalDurationMs: Date.now() - requestStartedAt,
              });
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

            const cacheReadStartedAt = Date.now();
            const cached = await getCachedLayout(star, cacheKey);
            star.logger?.info('Metrics layout timing', {
              userId,
              key,
              operation: 'read',
              cacheHit: cached !== undefined,
              dbLayer: 'star.db',
              userFound: false,
              findUserDurationMs,
              cacheReadDurationMs: Date.now() - cacheReadStartedAt,
              totalDurationMs: Date.now() - requestStartedAt,
            });
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
          } catch {
            meta = {};
          }

          if (!meta.dashboardLayouts) {
            meta.dashboardLayouts = {};
          }

          if (layout !== undefined) {
            meta.dashboardLayouts[key] = layout;
            const updateUserStartedAt = Date.now();
            await star.db.user.saveOrUpdateUsers([
              {
                ...user,
                meta: JSON.stringify(meta),
              },
            ]);
            const cacheWriteStartedAt = Date.now();
            await setCachedLayout(star, cacheKey, layout);
            star.logger?.info('Metrics layout timing', {
              userId,
              key,
              operation: 'save',
              dbLayer: 'star.db',
              userFound: true,
              findUserDurationMs,
              updateUserDurationMs: Date.now() - updateUserStartedAt,
              cacheWriteDurationMs: Date.now() - cacheWriteStartedAt,
              totalDurationMs: Date.now() - requestStartedAt,
            });
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

          const result = meta.dashboardLayouts[key] || [];
          const cacheWriteStartedAt = Date.now();
          await setCachedLayout(star, cacheKey, result);
          star.logger?.info('Metrics layout timing', {
            userId,
            key,
            operation: 'read',
            cacheHit: false,
            dbLayer: 'star.db',
            userFound: true,
            findUserDurationMs,
            cacheWriteDurationMs: Date.now() - cacheWriteStartedAt,
            totalDurationMs: Date.now() - requestStartedAt,
          });
          return {
            status: 200,
            data: {
              code: HttpResponseCode.Success,
              content: { layout: result },
              message: '布局获取成功',
              success: true,
            },
          };
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
