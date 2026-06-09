import { Context } from 'node-universe';
import { IUserTableAttributes } from 'db/mysql/models/user';
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

type DashboardLayoutsMeta = {
  dashboardLayouts?: Record<string, unknown>;
};

const parseJsonRecord = (value?: string): Record<string, unknown> => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const parseLayoutValue = (value?: string) => {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

const saveLayoutRecord = async (star: Starlight, userId: string, key: string, layout: unknown) => {
  await star.db.userLayout.saveOrUpdateUserLayout({
    userId,
    key,
    layout: JSON.stringify(layout),
  });
};

const removeLegacyDashboardLayouts = async (
  star: Starlight,
  user: IUserTableAttributes,
  meta: DashboardLayoutsMeta & Record<string, unknown>,
) => {
  if (!meta.dashboardLayouts) return;
  delete meta.dashboardLayouts;
  await star.db.user.saveOrUpdateUsers([
    {
      ...user,
      meta: JSON.stringify(meta),
    },
  ]);
};

const migrateLegacyDashboardLayouts = async (
  star: Starlight,
  userId: string,
  user: IUserTableAttributes,
  meta: DashboardLayoutsMeta & Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) => {
  if (!meta.dashboardLayouts) return;
  const layoutsToMigrate = {
    ...meta.dashboardLayouts,
    ...overrides,
  };

  for (const [layoutKey, layoutValue] of Object.entries(layoutsToMigrate)) {
    await saveLayoutRecord(star, userId, layoutKey, layoutValue);
  }

  await removeLegacyDashboardLayouts(star, user, meta);
};

const isOverviewStateKey = (key: string) =>
  key === 'starlight_overview_default_view_v5' ||
  key === 'starlight_overview_panel_state_v5' ||
  key === 'starlight_overview_auto_refresh_v1';

const isValidOverviewCachedLayout = (key: string, value: unknown) => {
  if (!isOverviewStateKey(key)) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  if (key === 'starlight_overview_default_view_v5') {
    return 'panelId' in value || 'timeRange' in value || 'scope' in value;
  }

  if (key === 'starlight_overview_auto_refresh_v1') {
    return ['off', 'auto', '15s', '30s', '1m', '5m'].includes(
      (value as { autoRefresh?: string }).autoRefresh || '',
    );
  }

  return Array.isArray((value as { panels?: unknown }).panels);
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
              if (!isValidOverviewCachedLayout(key, cached)) {
                star.logger?.warn('Ignoring invalid cached metrics layout shape', {
                  userId,
                  key,
                  cacheKey,
                  cachedType: Array.isArray(cached) ? 'array' : typeof cached,
                  cacheReadDurationMs,
                });
              } else {
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
          }

          if (layout !== undefined && !isValidOverviewCachedLayout(key, layout)) {
            star.logger?.warn('Rejected invalid overview layout write', {
              userId,
              key,
              cacheKey,
              layoutType: Array.isArray(layout) ? 'array' : typeof layout,
              totalDurationMs: Date.now() - requestStartedAt,
            });
            return {
              status: 400,
              data: {
                code: HttpResponseCode.ParamsError,
                content: null,
                message: '概览布局数据格式不正确',
                success: false,
              },
            };
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

          const meta = parseJsonRecord(user.meta) as DashboardLayoutsMeta & Record<string, unknown>;

          if (layout !== undefined) {
            const updateUserStartedAt = Date.now();
            await saveLayoutRecord(star, userId, key, layout);
            await migrateLegacyDashboardLayouts(star, userId, user, meta, { [key]: layout });
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

          const savedLayout = await star.db.userLayout.findUserLayout(userId, key);
          const savedLayoutValue = parseLayoutValue(savedLayout?.layout);
          const legacyLayout = meta.dashboardLayouts?.[key];
          const result = savedLayoutValue !== undefined ? savedLayoutValue : legacyLayout || [];
          if (savedLayoutValue === undefined && legacyLayout !== undefined) {
            await migrateLegacyDashboardLayouts(star, userId, user, meta);
          }
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
