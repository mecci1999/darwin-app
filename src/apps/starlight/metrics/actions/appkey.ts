import crypto from 'crypto';
import {
  createApiKey,
  deleteApiKey,
  findApiKeyById,
  findApiKeyByKey,
  findApiKeyByPair,
  findApiKeysByUserId,
  getApiKeyStats,
  getApiKeyTotalStats,
  updateApiKeyLastUsed,
  updateApiKeyStats,
  updateApiKeyStatus,
} from 'db/mysql/apis/apiKey';
import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, Starlight } from 'typings';
import { validators } from '../validators';

const appkey = (star: Starlight) => {
  return {
    // 生成新的AppKey
    'v1.appkey.generate': {
      metadata: {
        auth: true,
      },
      params: {
        name: { type: 'string', required: true },
        description: { type: 'string', optional: true },
        permissions: { type: 'array', optional: true, default: ['read', 'write'] },
        expiresAt: { type: 'string', optional: true }, // ISO date string
        rateLimit: { type: 'number', optional: true, default: 1000 }, // requests per hour
      },
      hooks: {
        before: [validators.appKeyGenerate],
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { name, description, permissions, expiresAt, rateLimit } = ctx.params;
          const userId = (ctx.meta as any).user.userId;
          const tenantId = (ctx.meta as any).tenantId || 'default';

          star.logger?.debug(`用户 ${userId} 尝试生成 AppKey`);
          if (!userId) {
            return {
              status: 401,
              data: {
                code: HttpResponseCode.UserNotLoginError,
                content: null,
                message: '用户未认证',
                success: false,
              },
            };
          }

          // 检查用户是否已达到AppKey数量限制
          const currentKeys = await findApiKeysByUserId(userId);
          const currentKeyCount = currentKeys.length;
          const maxKeys = 5; // 默认限制5个，需要从用户订阅计划获取

          if (currentKeyCount >= maxKeys) {
            return {
              status: 403,
              data: {
                code: HttpResponseCode.UserQuotaExceeded,
                content: {
                  current: currentKeyCount,
                  max: maxKeys,
                  plan: 'free',
                },
                message: `已达到AppKey数量限制 (${maxKeys}个)`,
                success: false,
              },
            };
          }

          // 默认过期时间逻辑：如果是新生成的 Key 且未指定过期时间，默认为 15 天后过期（试用期）
          // TODO: 后续应根据用户订阅计划动态设置（如 Pro 用户无过期时间）
          let finalExpiresAt = expiresAt;
          if (!finalExpiresAt) {
            const trialDays = 15;
            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + trialDays);
            finalExpiresAt = expiryDate;
          }

          // 生成AppKey和Secret
          const appKey = `ak_${crypto.randomBytes(16).toString('hex')}`;
          const appSecret = crypto.randomBytes(32).toString('hex');
          const keyId = crypto.randomUUID();

          // expiresAt已经通过validator验证并转换为Date对象

          // 保存到数据库
          const appKeyData = {
            id: keyId,
            tenantId,
            userId,
            keyName: name,
            keyHash: crypto.createHash('sha256').update(appSecret).digest('hex'), // 存储hash
            keyPrefix: appKey.substring(0, 8), // 存储前缀用于快速查找
            permissions,
            rateLimitPerMinute: Math.ceil(rateLimit / 60), // 转换为每分钟限制
            expiresAt: finalExpiresAt,
            isActive: true,
            lastUsedAt: undefined,
          };

          const createdKey = await createApiKey(appKeyData);

          // 记录操作日志 (暂时注释，需要实现日志系统)
          // await logUserAction({
          //   userId,
          //   action: 'appkey.generate',
          //   details: {
          //     keyId,
          //     name,
          //     permissions,
          //     rateLimit,
          //   },
          // });

          return {
            status: 201,
            data: {
              code: HttpResponseCode.Success,
              content: {
                keyId,
                name,
                appKey,
                appSecret, // 只在创建时返回，之后不再显示
                permissions,
                rateLimit,
                expiresAt: expiresAt,
                createdAt: (createdKey as any).createdAt || new Date(),
                warning: 'AppSecret只显示一次，请妥善保存',
              },
              message: 'AppKey生成成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Generate AppKey failed:', error);
          return {
            status: 500,
            data: {
              code: HttpResponseCode.ServiceActionFaild,
              content: null,
              message: 'AppKey生成失败',
              success: false,
            },
          };
        }
      },
    },

    // 获取用户的AppKey列表
    'v1.appkey.list': {
      metadata: {
        auth: true,
      },
      params: {
        includeInactive: { type: 'boolean', optional: true, default: false },
        limit: { type: 'number', optional: true, default: 20 },
        offset: { type: 'number', optional: true, default: 0 },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { includeInactive, limit, offset } = ctx.params;
          const userId = (ctx.meta as any).user?.userId;

          if (!userId) {
            return {
              status: 401,
              data: {
                code: HttpResponseCode.UserNotLoginError,
                content: null,
                message: '用户未认证',
                success: false,
              },
            };
          }

          const allAppKeys = await findApiKeysByUserId(userId);

          // 过滤非活跃的key（如果需要的话）
          const filteredKeys = includeInactive
            ? allAppKeys
            : allAppKeys.filter((key) => key.isActive);

          // 分页处理
          const paginatedKeys = filteredKeys.slice(offset, offset + limit);

          // 不返回敏感信息
          const safeAppKeys = await Promise.all(
            paginatedKeys.map(async (key: any) => {
              const usageStats = await getApiKeyTotalStats(key.id);

              return {
                id: key.id,
                name: key.keyName,
                description: '', // ApiKey模型中没有description字段
                appKey: key.keyPrefix + '***', // 只显示前缀，隐藏完整key
                permissions: key.permissions,
                rateLimit: key.rateLimitPerMinute * 60, // 转换回每小时限制
                isActive: key.isActive,
                expiresAt: key.expiresAt,
                createdAt: key.createdAt,
                lastUsedAt: key.lastUsedAt,
                usageCount: usageStats.totalRequests || 0,
                status:
                  key.expiresAt && new Date(key.expiresAt) <= new Date()
                    ? 'expired'
                    : key.isActive
                      ? 'active'
                      : 'inactive',
              };
            }),
          );

          return {
            status: 200,
            data: {
              code: HttpResponseCode.Success,
              content: {
                appKeys: safeAppKeys,
                total: filteredKeys.length,
                limit,
                offset,
                hasMore: filteredKeys.length > offset + limit,
              },
              message: '获取AppKey列表成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('List AppKeys failed:', error);
          return {
            status: 500,
            data: {
              code: HttpResponseCode.ServiceActionFaild,
              content: null,
              message: '获取AppKey列表失败',
              success: false,
            },
          };
        }
      },
    },

    // 验证AppKey
    'v1.appkey.verify': {
      params: {
        appKey: { type: 'string', required: true },
        appSecret: { type: 'string', required: true },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { appKey, appSecret } = ctx.params;

          const keyPrefix = String(appKey || '').slice(0, 8);

          const hashedSecret = crypto.createHash('sha256').update(appSecret).digest('hex');
          const keyData = await findApiKeyByPair(hashedSecret, keyPrefix);
          if (!keyData) {
            return {
              status: 401,
              data: {
                code: HttpResponseCode.AppKeyIsInvalid,
                content: null,
                message: 'AppKey或AppSecret不匹配',
                success: false,
              },
            };
          }

          // 检查是否激活
          if (!keyData.isActive) {
            return {
              status: 401,
              data: {
                code: HttpResponseCode.AppKeyIsInactive,
                content: null,
                message: 'AppKey未激活',
                success: false,
              },
            };
          }

          // 检查是否过期
          if (keyData.expiresAt && new Date(keyData.expiresAt) <= new Date()) {
            return {
              status: 401,
              data: {
                code: HttpResponseCode.AppKeyIsExpired,
                content: null,
                message: 'AppKey已过期',
                success: false,
              },
            };
          }

          // 验证Secret (已经在查找时验证过了)
          // const hashedSecret = crypto.createHash('sha256').update(appSecret).digest('hex');
          // if (keyData.keyHash !== hashedSecret) {
          //   return {
          //     status: 401,
          //     data: {
          //       code: HttpResponseCode.AuthenticationFailed,
          //       content: null,
          //       message: 'AppSecret错误',
          //       success: false,
          //     },
          //   };
          // }

          // 检查速率限制 (暂时跳过，需要实现速率限制逻辑)
          // const rateLimitCheck = await checkRateLimit(keyData.id, keyData.rateLimitPerMinute);
          // if (!rateLimitCheck.allowed) {
          //   return {
          //     status: 429,
          //     data: {
          //       code: HttpResponseCode.RateLimitExceeded,
          //       content: {
          //         limit: keyData.rateLimitPerMinute,
          //         remaining: rateLimitCheck.remaining,
          //         resetTime: rateLimitCheck.resetTime,
          //       },
          //       message: '请求频率超限',
          //       success: false,
          //     },
          //   };
          // }

          // 更新使用统计
          await updateApiKeyLastUsed(keyData.id);
          await updateApiKeyStats(keyData.id, 1);

          // 获取用户信息
          const user = await star.db.user.findUserByUserId(keyData.userId);
          if (!user) {
            return {
              status: 401,
              data: {
                code: HttpResponseCode.UserNotExist,
                content: null,
                message: '用户不存在',
                success: false,
              },
            };
          }

          return {
            status: 200,
            data: {
              code: HttpResponseCode.Success,
              content: {
                valid: true,
                keyId: keyData.id,
                userId: keyData.userId,
                permissions: keyData.permissions,
                rateLimit: {
                  limit: keyData.rateLimitPerMinute * 60, // 转换为每小时限制
                  remaining: null,
                  resetTime: null,
                },
                user: {
                  id: user.id,
                  userId: user.userId,
                  nickname: user.nickname,
                  // email: user.email, // 用户模型中没有email字段
                  // plan: user.subscriptionPlan, // 用户模型中没有subscriptionPlan字段
                },
              },
              message: 'AppKey验证成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Verify AppKey failed:', error);
          return {
            status: 500,
            data: {
              code: HttpResponseCode.ServiceActionFaild,
              content: null,
              message: 'AppKey验证失败',
              success: false,
            },
          };
        }
      },
    },

    // 删除AppKey
    'v1.appkey.delete': {
      metadata: {
        auth: true,
      },
      params: {
        keyId: { type: 'string', required: true },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { keyId } = ctx.params;
          const userId = (ctx.meta as any).user?.userId;

          if (!userId) {
            return {
              status: 401,
              data: {
                code: HttpResponseCode.UserNotLoginError,
                content: null,
                message: '用户未认证',
                success: false,
              },
            };
          }

          // 检查AppKey是否属于当前用户
          const keyData = await findApiKeyById(keyId);
          if (!keyData || keyData.userId !== userId) {
            return {
              status: 404,
              data: {
                code: HttpResponseCode.ParamsError,
                content: null,
                message: 'AppKey不存在或无权限',
                success: false,
              },
            };
          }

          // 删除AppKey
          await deleteApiKey(keyId);

          // 记录操作日志 (暂时注释，需要实现日志系统)
          // await logUserAction({
          //   userId,
          //   action: 'appkey.delete',
          //   details: {
          //     keyId,
          //     keyName: keyData.keyName,
          //   },
          // });

          return {
            status: 200,
            data: {
              code: HttpResponseCode.Success,
              content: {
                keyId,
                deletedAt: new Date(),
              },
              message: 'AppKey删除成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Delete AppKey failed:', error);
          return {
            status: 500,
            data: {
              code: HttpResponseCode.ServiceActionFaild,
              content: null,
              message: 'AppKey删除失败',
              success: false,
            },
          };
        }
      },
    },

    'v1.appkey.ingestionStatus': {
      metadata: {
        auth: true,
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
                message: '用户未认证',
                success: false,
              },
            };
          }

          const appKeys = await findApiKeysByUserId(userId);
          const now = Date.now();
          const activeKeys = appKeys.filter(
            (key) => key.isActive && (!key.expiresAt || new Date(key.expiresAt).getTime() > now),
          );
          const expiredKeys = appKeys.filter(
            (key) => key.expiresAt && new Date(key.expiresAt).getTime() <= now,
          );
          const inactiveKeys = appKeys.filter((key) => !key.isActive);
          const lastActivity = [...appKeys]
            .map((key) => key.lastUsedAt || key.createdAt)
            .filter(Boolean)
            .sort((a: any, b: any) => new Date(b).getTime() - new Date(a).getTime())[0];

          return {
            status: 200,
            data: {
              code: HttpResponseCode.Success,
              content: {
                totalKeys: appKeys.length,
                activeKeys: activeKeys.length,
                expiredKeys: expiredKeys.length,
                inactiveKeys: inactiveKeys.length,
                status: activeKeys.length > 0 ? 'connected' : 'pending',
                lastActivityAt: lastActivity || null,
              },
              message: '获取接入状态成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Get ingestion status failed:', error);
          return {
            status: 500,
            data: {
              code: HttpResponseCode.ServiceActionFaild,
              content: null,
              message: '获取接入状态失败',
              success: false,
            },
          };
        }
      },
    },
  };
};

export default appkey;
