import { Context, Star } from 'node-universe';
import { ResponseCode } from 'typings/enum';
import { HttpResponseItem } from 'typings/response';

const quota = (star: Star) => {
  return {
    // 检查用户配额
    'quota.check': {
      metadata: {
        auth: true,
      },
      params: {
        quotaType: { type: 'string', required: true }, // metrics, appkeys, schemas, etc.
        amount: { type: 'number', optional: true, default: 1 },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { quotaType, amount } = ctx.params;
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

          // 获取用户订阅计划
          const subscription = await (this as any).getUserCurrentSubscription(userId);
          if (!subscription) {
            return {
              status: 404,
              data: {
                code: ResponseCode.ParamsError,
                content: null,
                message: '用户没有有效订阅',
                success: false,
              },
            };
          }

          // 获取计划配额限制
          const plan = await (this as any).getPlanByName(subscription.planName);
          const quotaLimit = await (this as any).getQuotaLimit(plan, quotaType);

          // 获取当前使用量
          const currentUsage = await (this as any).getCurrentUsage(userId, quotaType);

          // 检查配额
          const quotaCheck = {
            quotaType,
            limit: quotaLimit,
            current: currentUsage,
            requested: amount,
            available: quotaLimit === -1 ? -1 : Math.max(0, quotaLimit - currentUsage),
            allowed: quotaLimit === -1 || currentUsage + amount <= quotaLimit,
            percentage: quotaLimit === -1 ? 0 : Math.min(100, (currentUsage / quotaLimit) * 100),
          };

          // 检查是否需要发送警告
          if (quotaCheck.percentage >= 80 && quotaCheck.percentage < 95) {
            await star.emit('quota.warning', {
              userId,
              quotaType,
              usage: currentUsage,
              limit: quotaLimit,
              threshold: 'warning',
            });
          } else if (quotaCheck.percentage >= 95) {
            await star.emit('quota.warning', {
              userId,
              quotaType,
              usage: currentUsage,
              limit: quotaLimit,
              threshold: 'critical',
            });
          }

          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                quota: quotaCheck,
                plan: {
                  name: subscription.planName,
                  displayName: subscription.planDisplayName,
                },
                recommendations:
                  quotaCheck.percentage > 80
                    ? [
                        {
                          type: 'upgrade',
                          message: '考虑升级到更高级别的计划以获得更多配额',
                          action: 'upgrade_plan',
                        },
                      ]
                    : [],
              },
              message: '配额检查完成',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Check quota failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '配额检查失败',
              success: false,
            },
          };
        }
      },
    },

    // 获取用户所有配额状态
    'quota.status': {
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
                code: ResponseCode.UserNotLoginError,
                content: null,
                message: '用户未认证',
                success: false,
              },
            };
          }

          // 获取用户订阅计划
          const subscription = await (this as any).getUserCurrentSubscription(userId);
          if (!subscription) {
            return {
              status: 404,
              data: {
                code: ResponseCode.ParamsError,
                content: null,
                message: '用户没有有效订阅',
                success: false,
              },
            };
          }

          const plan = await (this as any).getPlanByName(subscription.planName);

          // 获取所有配额类型的状态
          const quotaTypes = [
            'maxAppKeys',
            'maxMetricsPerHour',
            'maxMetricsPerDay',
            'maxMetricsPerMonth',
            'maxCustomSchemas',
            'maxDashboards',
            'maxAlerts',
          ];

          const quotaStatus = await Promise.all(
            quotaTypes.map(async (quotaType) => {
              const limit = plan.features[quotaType] || 0;
              const current = await (this as any).getCurrentUsage(userId, quotaType);

              return {
                type: quotaType,
                name: (this as any).getQuotaDisplayName(quotaType),
                limit,
                current,
                available: limit === -1 ? -1 : Math.max(0, limit - current),
                percentage: limit === -1 ? 0 : Math.min(100, (current / limit) * 100),
                status:
                  limit === -1
                    ? 'unlimited'
                    : current >= limit
                      ? 'exceeded'
                      : current / limit >= 0.95
                        ? 'critical'
                        : current / limit >= 0.8
                          ? 'warning'
                          : 'normal',
              };
            }),
          );

          // 计算总体健康度
          const healthScore = quotaStatus.reduce((score, quota) => {
            if (quota.status === 'exceeded') return score - 25;
            if (quota.status === 'critical') return score - 15;
            if (quota.status === 'warning') return score - 5;
            return score;
          }, 100);

          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                plan: {
                  name: subscription.planName,
                  displayName: subscription.planDisplayName,
                  expiresAt: subscription.expiresAt,
                },
                quotas: quotaStatus,
                summary: {
                  total: quotaStatus.length,
                  normal: quotaStatus.filter((q) => q.status === 'normal').length,
                  warning: quotaStatus.filter((q) => q.status === 'warning').length,
                  critical: quotaStatus.filter((q) => q.status === 'critical').length,
                  exceeded: quotaStatus.filter((q) => q.status === 'exceeded').length,
                  unlimited: quotaStatus.filter((q) => q.status === 'unlimited').length,
                },
                healthScore: Math.max(0, healthScore),
                recommendations: (this as any).generateQuotaRecommendations(quotaStatus, plan),
              },
              message: '获取配额状态成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Get quota status failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '获取配额状态失败',
              success: false,
            },
          };
        }
      },
    },

    // 使用配额
    'quota.consume': {
      metadata: {
        auth: true,
      },
      params: {
        quotaType: { type: 'string', required: true },
        amount: { type: 'number', optional: true, default: 1 },
        metadata: { type: 'object', optional: true },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { quotaType, amount, metadata } = ctx.params;
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

          // 先检查配额
          const quotaCheckResult = await star.call(
            'subscription.quota.check',
            {
              quotaType,
              amount,
            },
            { meta: ctx.meta },
          );

          if (!quotaCheckResult.data.content.quota.allowed) {
            return {
              status: 429,
              data: {
                code: ResponseCode.UserQuotaExceeded,
                content: {
                  quota: quotaCheckResult.data.content.quota,
                  upgradeUrl: `${process.env.FRONTEND_URL}/subscription/upgrade`,
                },
                message: '配额已用完，请升级订阅计划',
                success: false,
              },
            };
          }

          // 消费配额
          const consumeResult = await (this as any).consumeQuota({
            userId,
            quotaType,
            amount,
            metadata,
          });

          // 记录使用日志
          await (this as any).logQuotaUsage({
            userId,
            quotaType,
            amount,
            metadata,
            timestamp: new Date(),
          });

          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                consumed: amount,
                remaining: consumeResult.remaining,
                quota: {
                  type: quotaType,
                  limit: consumeResult.limit,
                  current: consumeResult.current,
                  percentage: consumeResult.percentage,
                },
              },
              message: '配额消费成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Consume quota failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '配额消费失败',
              success: false,
            },
          };
        }
      },
    },

    // 获取配额使用历史
    'quota.history': {
      metadata: {
        auth: true,
      },
      params: {
        quotaType: { type: 'string', optional: true },
        timeRange: { type: 'string', optional: true, default: '7d' }, // 1h, 1d, 7d, 30d
        limit: { type: 'number', optional: true, default: 100 },
        offset: { type: 'number', optional: true, default: 0 },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { quotaType, timeRange, limit, offset } = ctx.params;
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

          const history = await (this as any).getQuotaUsageHistory({
            userId,
            quotaType,
            timeRange,
            limit,
            offset,
          });

          // 生成统计数据
          const stats = await (this as any).generateQuotaStats(history.data, timeRange);

          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                history: history.data,
                stats,
                timeRange,
                total: history.total,
                limit,
                offset,
                hasMore: history.total > offset + limit,
              },
              message: '获取配额使用历史成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Get quota history failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '获取配额使用历史失败',
              success: false,
            },
          };
        }
      },
    },

    // 重置配额（管理员功能）
    'quota.reset': {
      metadata: {
        auth: true,
        roles: ['admin'],
      },
      params: {
        userId: { type: 'string', required: true },
        quotaType: { type: 'string', required: true },
        reason: { type: 'string', optional: true },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { userId, quotaType, reason } = ctx.params;
          const adminUserId = (ctx.meta as any).user?.userId;

          if (!adminUserId) {
            return {
              status: 401,
              data: {
                code: ResponseCode.UserNotLoginError,
                content: null,
                message: '管理员未认证',
                success: false,
              },
            };
          }

          // 检查目标用户是否存在
          const targetUser = await (this as any).getUserById(userId);
          if (!targetUser) {
            return {
              status: 404,
              data: {
                code: ResponseCode.ParamsError,
                content: null,
                message: '目标用户不存在',
                success: false,
              },
            };
          }

          // 获取重置前的使用量
          const beforeReset = await (this as any).getCurrentUsage(userId, quotaType);

          // 重置配额
          await (this as any).resetQuota(userId, quotaType);

          // 记录管理员操作
          await (this as any).logAdminAction({
            adminUserId,
            action: 'quota.reset',
            targetUserId: userId,
            details: {
              quotaType,
              beforeReset,
              reason,
            },
          });

          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                userId,
                quotaType,
                beforeReset,
                afterReset: 0,
                resetAt: new Date(),
                resetBy: adminUserId,
                reason,
              },
              message: '配额重置成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Reset quota failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '配额重置失败',
              success: false,
            },
          };
        }
      },
    },

    // 获取配额预测
    'quota.forecast': {
      metadata: {
        auth: true,
      },
      params: {
        quotaType: { type: 'string', required: true },
        forecastDays: { type: 'number', optional: true, default: 30 },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { quotaType, forecastDays } = ctx.params;
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

          // 获取历史使用数据
          const historicalData = await (this as any).getQuotaUsageHistory({
            userId,
            quotaType,
            timeRange: '30d',
            limit: 1000,
          });

          // 生成预测
          const forecast = await (this as any).generateQuotaForecast({
            historicalData: historicalData.data,
            quotaType,
            forecastDays,
          });

          // 获取当前配额限制
          const subscription = await (this as any).getUserCurrentSubscription(userId);
          const plan = await (this as any).getPlanByName(subscription.planName);
          const quotaLimit = plan.features[quotaType] || 0;

          // 计算预警
          const warnings: Array<{ type: string; message: string; severity: string }> = [];
          if (quotaLimit > 0 && forecast.projectedUsage > quotaLimit * 0.8) {
            warnings.push({
              type: 'quota_warning',
              message: `预计在 ${forecast.daysToLimit} 天内达到配额限制`,
              severity: forecast.projectedUsage > quotaLimit ? 'critical' : 'warning',
            });
          }

          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                quotaType,
                forecastDays,
                current: {
                  usage: forecast.currentUsage,
                  limit: quotaLimit,
                  percentage: quotaLimit > 0 ? (forecast.currentUsage / quotaLimit) * 100 : 0,
                },
                forecast: {
                  projectedUsage: forecast.projectedUsage,
                  projectedPercentage:
                    quotaLimit > 0 ? (forecast.projectedUsage / quotaLimit) * 100 : 0,
                  trend: forecast.trend, // increasing, decreasing, stable
                  confidence: forecast.confidence,
                  daysToLimit: forecast.daysToLimit,
                },
                recommendations: forecast.recommendations,
                warnings,
              },
              message: '获取配额预测成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Get quota forecast failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '获取配额预测失败',
              success: false,
            },
          };
        }
      },
    },
  };
};

export default quota;
