import { Context, Star } from 'node-universe';
import { ResponseCode } from '../../typings/enum';
import { HttpResponseItem } from '../../typings/response';
import crypto from 'crypto';
import {
  createApiKey,
  findApiKeyByKey,
  findApiKeysByUserId,
  findApiKeyById,
  updateApiKeyStatus,
  updateApiKeyLastUsed,
  deleteApiKey,
  updateApiKeyStats,
  getApiKeyStats,
  getApiKeyTotalStats,
} from '../../db/mysql/apis/apiKey';
import { findUserByUserId } from '../../db/mysql/apis/user';
import { findSubscriptionPlanById } from '../../db/mysql/apis/subscription';

const appkey = (star: Star) => {
  return {
    // 生成新的AppKey
    generate: {
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
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { name, description, permissions, expiresAt, rateLimit } = ctx.params;
          const userId = (ctx.meta as any).user?.userId;

          if (!userId) {
            return {
              status: 401,
              data: {
                code: ResponseCode.UserNotLoginError,
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
                code: ResponseCode.UserQuotaExceeded,
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

          // 生成AppKey和Secret
          const appKey = `ak_${crypto.randomBytes(16).toString('hex')}`;
          const appSecret = crypto.randomBytes(32).toString('hex');
          const keyId = crypto.randomUUID();

          // 验证过期时间
          let expiresAtDate: Date | undefined = undefined;
          if (expiresAt) {
            expiresAtDate = new Date(expiresAt);
            if (isNaN(expiresAtDate.getTime()) || expiresAtDate <= new Date()) {
              return {
                status: 400,
                data: {
                  code: ResponseCode.ParamsError,
                  content: null,
                  message: '过期时间格式错误或已过期',
                  success: false,
                },
              };
            }
          }

          // 保存到数据库
          const appKeyData = {
            id: keyId,
            userId,
            keyName: name,
            keyHash: crypto.createHash('sha256').update(appSecret).digest('hex'), // 存储hash
            keyPrefix: appKey.substring(0, 8), // 存储前缀用于快速查找
            permissions,
            rateLimitPerMinute: Math.ceil(rateLimit / 60), // 转换为每分钟限制
            expiresAt: expiresAtDate,
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
              code: ResponseCode.Success,
              content: {
                keyId,
                name,
                appKey,
                appSecret, // 只在创建时返回，之后不再显示
                permissions,
                rateLimit,
                expiresAt: expiresAtDate,
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
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: 'AppKey生成失败',
              success: false,
            },
          };
        }
      },
    },

    // 获取用户的AppKey列表
    list: {
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
                code: ResponseCode.UserNotLoginError,
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
          const safeAppKeys = paginatedKeys.map((key: any) => ({
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
            usageCount: 0, // ApiKey模型中没有usageCount字段
            status:
              key.expiresAt && new Date(key.expiresAt) <= new Date()
                ? 'expired'
                : key.isActive
                  ? 'active'
                  : 'inactive',
          }));

          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
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
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '获取AppKey列表失败',
              success: false,
            },
          };
        }
      },
    },

    // 验证AppKey
    verify: {
      params: {
        appKey: { type: 'string', required: true },
        appSecret: { type: 'string', required: true },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { appKey, appSecret } = ctx.params;

          // 查找AppKey (需要先hash appSecret来查找)
          const hashedSecret = crypto.createHash('sha256').update(appSecret).digest('hex');
          const keyData = await findApiKeyByKey(hashedSecret);
          if (!keyData) {
            return {
              status: 401,
              data: {
                code: ResponseCode.AppKeyIsInvalid,
                content: null,
                message: 'AppKey不存在',
                success: false,
              },
            };
          }

          // 检查是否激活
          if (!keyData.isActive) {
            return {
              status: 401,
              data: {
                code: ResponseCode.AppKeyIsInactive,
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
                code: ResponseCode.AppKeyIsExpired,
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
          //       code: ResponseCode.AuthenticationFailed,
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
          //       code: ResponseCode.RateLimitExceeded,
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
          const user = await findUserByUserId(keyData.userId);
          if (!user) {
            return {
              status: 401,
              data: {
                code: ResponseCode.UserNotExist,
                content: null,
                message: '用户不存在',
                success: false,
              },
            };
          }

          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                valid: true,
                keyId: keyData.id,
                userId: keyData.userId,
                permissions: keyData.permissions,
                rateLimit: {
                  limit: keyData.rateLimitPerMinute * 60, // 转换为每小时限制
                  remaining: keyData.rateLimitPerMinute * 60, // 暂时返回满额度
                  resetTime: new Date(Date.now() + 60 * 60 * 1000), // 1小时后重置
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
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: 'AppKey验证失败',
              success: false,
            },
          };
        }
      },
    },

    // 更新AppKey
    update: {
      metadata: {
        auth: true,
      },
      params: {
        keyId: { type: 'string', required: true },
        name: { type: 'string', optional: true },
        description: { type: 'string', optional: true },
        permissions: { type: 'array', optional: true },
        rateLimit: { type: 'number', optional: true },
        isActive: { type: 'boolean', optional: true },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { keyId, name, description, permissions, rateLimit, isActive } = ctx.params;
          const userId = (ctx.meta as any).user?.userId;

          if (!userId) {
            return {
              status: 401,
              data: {
                code: ResponseCode.UserNotLoginError,
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
                code: ResponseCode.ParamsError,
                content: null,
                message: 'AppKey不存在或无权限',
                success: false,
              },
            };
          }

          // 构建更新数据
          const updateData: any = {};

          if (name !== undefined) updateData.keyName = name;
          // description字段在ApiKey模型中不存在，跳过
          if (permissions !== undefined) updateData.permissions = permissions;
          if (rateLimit !== undefined) updateData.rateLimitPerMinute = Math.ceil(rateLimit / 60);
          if (isActive !== undefined) updateData.isActive = isActive;

          // 更新AppKey
          await updateApiKeyStatus(
            keyId,
            updateData.isActive !== undefined ? updateData.isActive : keyData.isActive,
          );
          // 注意：当前API只支持更新状态，其他字段更新需要扩展API

          // 记录操作日志 (暂时注释，需要实现日志系统)
          // await logUserAction({
          //   userId,
          //   action: 'appkey.update',
          //   details: {
          //     keyId,
          //     changes: updateData,
          //   },
          // });

          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                keyId,
                updated: Object.keys(updateData).filter((key) => key !== 'updatedAt'),
                updatedAt: updateData.updatedAt,
              },
              message: 'AppKey更新成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Update AppKey failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: 'AppKey更新失败',
              success: false,
            },
          };
        }
      },
    },

    // 删除AppKey
    delete: {
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
                code: ResponseCode.UserNotLoginError,
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
                code: ResponseCode.ParamsError,
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
              code: ResponseCode.Success,
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
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: 'AppKey删除失败',
              success: false,
            },
          };
        }
      },
    },

    // 获取AppKey使用统计
    stats: {
      metadata: {
        auth: true,
      },
      params: {
        keyId: { type: 'string', optional: true },
        timeRange: { type: 'string', optional: true, default: '7d' }, // 1h, 1d, 7d, 30d
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { keyId, timeRange } = ctx.params;
          const userId = (ctx.meta as any).user?.userId;

          if (!userId) {
            return {
              status: 401,
              data: {
                code: ResponseCode.UserNotLoginError,
                content: null,
                message: '用户未认证',
                success: false,
              },
            };
          }

          // 计算时间范围
          const now = new Date();
          let startDate: Date;
          let endDate: Date = now;

          switch (timeRange) {
            case '1h':
              startDate = new Date(now.getTime() - 60 * 60 * 1000);
              break;
            case '1d':
              startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
              break;
            case '30d':
              startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
              break;
            case '7d':
            default:
              startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
              break;
          }

          let stats;
          if (keyId) {
            // 获取特定AppKey的统计
            const keyData = await findApiKeyById(keyId);
            if (!keyData || keyData.userId !== userId) {
              return {
                status: 404,
                data: {
                  code: ResponseCode.ParamsError,
                  content: null,
                  message: 'AppKey不存在或无权限',
                  success: false,
                },
              };
            }
            stats = await getApiKeyStats(
              keyId,
              startDate.toISOString().split('T')[0],
              endDate.toISOString().split('T')[0],
            );
          } else {
            // 获取用户所有AppKey的统计 (暂时使用第一个keyId，需要实现用户级别统计)
            const userKeys = await findApiKeysByUserId(userId);
            if (userKeys.length > 0) {
              stats = await getApiKeyTotalStats(userKeys[0].id!.toString());
            } else {
              stats = { totalRequests: 0, daysActive: 0 };
            }
          }

          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                timeRange,
                stats,
                generatedAt: new Date(),
              },
              message: '获取使用统计成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Get AppKey stats failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '获取使用统计失败',
              success: false,
            },
          };
        }
      },
    },
  };
};

export default appkey;
