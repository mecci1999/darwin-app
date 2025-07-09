import { Context, Star } from 'node-universe';
import { ResponseCode } from '../../typings/enum';
import { HttpResponseItem } from '../../typings/response';

const subscription = (star: Star) => {
  return {
    // 获取用户当前订阅
    'subscription.current': {
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
          
          const subscription = await (this as any).getUserCurrentSubscription(userId);
          if (!subscription) {
            return {
              status: 404,
              data: {
                code: ResponseCode.ParamsError,
                content: null,
                message: '用户当前没有订阅',
                success: false,
              },
            };
          }
          
          // 获取计划详情
          const plan = await (this as any).getPlanByName(subscription.planName);
          
          // 获取使用情况
          const usage = await (this as any).getUserCurrentUsage(userId);
          
          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                subscription: {
                  id: subscription.id,
                  planName: subscription.planName,
                  planDisplayName: subscription.planDisplayName,
                  status: subscription.status,
                  startDate: subscription.startDate,
                  expiresAt: subscription.expiresAt,
                  autoRenew: subscription.autoRenew,
                  billingCycle: subscription.billingCycle,
                  price: subscription.price,
                  currency: subscription.currency,
                  trialEndsAt: subscription.trialEndsAt,
                  isTrialActive: subscription.trialEndsAt && new Date(subscription.trialEndsAt) > new Date(),
                },
                plan: plan ? {
                  features: plan.features,
                  limitations: plan.limitations,
                } : null,
                usage,
                daysUntilExpiry: subscription.expiresAt ? 
                  Math.ceil((new Date(subscription.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null,
              },
              message: '获取当前订阅成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Get current subscription failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '获取当前订阅失败',
              success: false,
            },
          };
        }
      },
    },
    
    // 创建订阅
    'subscription.create': {
      metadata: {
        auth: true,
      },
      params: {
        planName: { type: 'string', required: true },
        billingCycle: { type: 'string', optional: true, default: 'monthly' },
        paymentMethodId: { type: 'string', optional: true },
        promoCode: { type: 'string', optional: true },
        autoRenew: { type: 'boolean', optional: true, default: true },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { planName, billingCycle, paymentMethodId, promoCode, autoRenew } = ctx.params;
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
          
          // 检查计划是否存在
          const plan = await (this as any).getPlanByName(planName);
          if (!plan) {
            return {
              status: 404,
              data: {
                code: ResponseCode.ParamsError,
                content: null,
                message: '订阅计划不存在',
                success: false,
              },
            };
          }
          
          // 检查用户是否已有活跃订阅
          const existingSubscription = await (this as any).getUserActiveSubscription(userId);
          if (existingSubscription) {
            return {
              status: 409,
              data: {
                code: ResponseCode.ParamsError,
                content: {
                  existingSubscription: {
                    id: existingSubscription.id,
                    planName: existingSubscription.planName,
                    status: existingSubscription.status,
                    expiresAt: existingSubscription.expiresAt,
                  },
                },
                message: '用户已有活跃订阅',
                success: false,
              },
            };
          }
          
          // 计算定价
          const pricing = await (this as any).calculatePlanPricing({
            plan,
            billingCycle,
            promoCode,
          });
          
          // 如果是免费计划，直接创建订阅
          if (plan.price === 0) {
            const subscription = await (this as any).createFreeSubscription(userId, planName);
            
            return {
              status: 201,
              data: {
                code: ResponseCode.Success,
                content: {
                  subscription: {
                    id: subscription.id,
                    planName: subscription.planName,
                    status: subscription.status,
                    startDate: subscription.startDate,
                    expiresAt: subscription.expiresAt,
                  },
                  requiresPayment: false,
                },
                message: '免费订阅创建成功',
                success: true,
              },
            };
          }
          
          // 付费计划需要创建支付订单
          const paymentOrder = await (this as any).createPaymentOrder({
            userId,
            planName,
            billingCycle,
            pricing,
            paymentMethodId,
            autoRenew,
          });
          
          return {
            status: 201,
            data: {
              code: ResponseCode.Success,
              content: {
                orderId: paymentOrder.id,
                planName,
                pricing,
                requiresPayment: true,
                paymentUrl: paymentOrder.paymentUrl,
                expiresAt: paymentOrder.expiresAt,
              },
              message: '订阅订单创建成功，请完成支付',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Create subscription failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '创建订阅失败',
              success: false,
            },
          };
        }
      },
    },
    
    // 升级订阅
    'subscription.upgrade': {
      metadata: {
        auth: true,
      },
      params: {
        targetPlan: { type: 'string', required: true },
        billingCycle: { type: 'string', optional: true },
        paymentMethodId: { type: 'string', optional: true },
        upgradeType: { type: 'string', optional: true, default: 'immediate' }, // immediate, scheduled
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { targetPlan, billingCycle, paymentMethodId, upgradeType } = ctx.params;
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
          
          // 获取当前订阅
          const currentSubscription = await (this as any).getUserActiveSubscription(userId);
          if (!currentSubscription) {
            return {
              status: 404,
              data: {
                code: ResponseCode.ParamsError,
                content: null,
                message: '用户当前没有活跃订阅',
                success: false,
              },
            };
          }
          
          // 检查目标计划
          const targetPlanData = await (this as any).getPlanByName(targetPlan);
          if (!targetPlanData) {
            return {
              status: 404,
              data: {
                code: ResponseCode.ParamsError,
                content: null,
                message: '目标订阅计划不存在',
                success: false,
              },
            };
          }
          
          // 检查是否可以升级
          const canUpgrade = await (this as any).canUpgradePlan(
            currentSubscription.planName,
            targetPlan
          );
          
          if (!canUpgrade.allowed) {
            return {
              status: 400,
              data: {
                code: ResponseCode.ParamsError,
                content: {
                  reason: canUpgrade.reason,
                },
                message: '无法升级到目标计划',
                success: false,
              },
            };
          }
          
          // 计算升级费用
          const upgradeCost = await (this as any).calculateUpgradeCost(
            currentSubscription,
            targetPlanData,
            billingCycle || currentSubscription.billingCycle,
            upgradeType
          );
          
          // 如果无需额外费用，直接升级
          if (upgradeCost.amount <= 0) {
            const upgradedSubscription = await (this as any).upgradeSubscriptionDirect(
              currentSubscription.id,
              targetPlan,
              upgradeType
            );
            
            return {
              status: 200,
              data: {
                code: ResponseCode.Success,
                content: {
                  subscription: {
                    id: upgradedSubscription.id,
                    planName: upgradedSubscription.planName,
                    status: upgradedSubscription.status,
                    effectiveDate: upgradedSubscription.effectiveDate,
                  },
                  requiresPayment: false,
                  upgradeType,
                },
                message: '订阅升级成功',
                success: true,
              },
            };
          }
          
          // 需要支付升级费用
          const upgradeOrder = await (this as any).createUpgradeOrder({
            userId,
            currentSubscriptionId: currentSubscription.id,
            targetPlan,
            billingCycle: billingCycle || currentSubscription.billingCycle,
            upgradeCost,
            paymentMethodId,
            upgradeType,
          });
          
          return {
            status: 201,
            data: {
              code: ResponseCode.Success,
              content: {
                orderId: upgradeOrder.id,
                currentPlan: currentSubscription.planName,
                targetPlan,
                upgradeCost,
                requiresPayment: true,
                paymentUrl: upgradeOrder.paymentUrl,
                upgradeType,
                effectiveDate: upgradeOrder.effectiveDate,
              },
              message: '升级订单创建成功，请完成支付',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Upgrade subscription failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '升级订阅失败',
              success: false,
            },
          };
        }
      },
    },
    
    // 取消订阅
    'subscription.cancel': {
      metadata: {
        auth: true,
      },
      params: {
        reason: { type: 'string', optional: true },
        cancelType: { type: 'string', optional: true, default: 'end_of_period' }, // immediate, end_of_period
        feedback: { type: 'string', optional: true },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { reason, cancelType, feedback } = ctx.params;
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
          
          // 获取当前订阅
          const currentSubscription = await (this as any).getUserActiveSubscription(userId);
          if (!currentSubscription) {
            return {
              status: 404,
              data: {
                code: ResponseCode.ParamsError,
                content: null,
                message: '用户当前没有活跃订阅',
                success: false,
              },
            };
          }
          
          // 检查是否可以取消
          const canCancel = await (this as any).canCancelSubscription(currentSubscription);
          if (!canCancel.allowed) {
            return {
              status: 400,
              data: {
                code: ResponseCode.ParamsError,
                content: {
                  reason: canCancel.reason,
                },
                message: '无法取消订阅',
                success: false,
              },
            };
          }
          
          // 计算退款金额
          const refundAmount = await (this as any).calculateRefundAmount(
            currentSubscription,
            cancelType
          );
          
          // 执行取消操作
          const cancelResult = await (this as any).cancelSubscription({
            subscriptionId: currentSubscription.id,
            userId,
            reason,
            cancelType,
            feedback,
            refundAmount,
          });
          
          // 记录取消反馈
          if (feedback) {
            await (this as any).recordCancellationFeedback({
              userId,
              subscriptionId: currentSubscription.id,
              reason,
              feedback,
            });
          }
          
          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                subscription: {
                  id: currentSubscription.id,
                  status: cancelResult.status,
                  cancelledAt: cancelResult.cancelledAt,
                  effectiveDate: cancelResult.effectiveDate,
                },
                cancelType,
                refund: refundAmount > 0 ? {
                  amount: refundAmount,
                  currency: currentSubscription.currency,
                  processTime: '3-5个工作日',
                } : null,
                accessUntil: cancelResult.accessUntil,
              },
              message: cancelType === 'immediate' ? '订阅已立即取消' : '订阅将在当前周期结束后取消',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Cancel subscription failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '取消订阅失败',
              success: false,
            },
          };
        }
      },
    },
    
    // 恢复订阅
    'subscription.resume': {
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
          
          // 获取已取消但未到期的订阅
          const cancelledSubscription = await (this as any).getUserCancelledSubscription(userId);
          if (!cancelledSubscription) {
            return {
              status: 404,
              data: {
                code: ResponseCode.ParamsError,
                content: null,
                message: '没有可恢复的订阅',
                success: false,
              },
            };
          }
          
          // 检查是否可以恢复
          const canResume = await (this as any).canResumeSubscription(cancelledSubscription);
          if (!canResume.allowed) {
            return {
              status: 400,
              data: {
                code: ResponseCode.ParamsError,
                content: {
                  reason: canResume.reason,
                },
                message: '无法恢复订阅',
                success: false,
              },
            };
          }
          
          // 恢复订阅
          const resumedSubscription = await (this as any).resumeSubscription(
            cancelledSubscription.id
          );
          
          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                subscription: {
                  id: resumedSubscription.id,
                  planName: resumedSubscription.planName,
                  status: resumedSubscription.status,
                  resumedAt: resumedSubscription.resumedAt,
                  expiresAt: resumedSubscription.expiresAt,
                  autoRenew: resumedSubscription.autoRenew,
                },
              },
              message: '订阅恢复成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Resume subscription failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '恢复订阅失败',
              success: false,
            },
          };
        }
      },
    },
    
    // 获取订阅历史
    'subscription.history': {
      metadata: {
        auth: true,
      },
      params: {
        limit: { type: 'number', optional: true, default: 20 },
        offset: { type: 'number', optional: true, default: 0 },
        status: { type: 'string', optional: true }, // active, cancelled, expired
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { limit, offset, status } = ctx.params;
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
          
          const subscriptions = await (this as any).getUserSubscriptionHistory({
            userId,
            limit,
            offset,
            status,
          });
          
          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                subscriptions: subscriptions.data.map((sub: any) => ({
                  id: sub.id,
                  planName: sub.planName,
                  planDisplayName: sub.planDisplayName,
                  status: sub.status,
                  startDate: sub.startDate,
                  expiresAt: sub.expiresAt,
                  cancelledAt: sub.cancelledAt,
                  price: sub.price,
                  currency: sub.currency,
                  billingCycle: sub.billingCycle,
                  autoRenew: sub.autoRenew,
                })),
                total: subscriptions.total,
                limit,
                offset,
                hasMore: subscriptions.total > offset + limit,
              },
              message: '获取订阅历史成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Get subscription history failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '获取订阅历史失败',
              success: false,
            },
          };
        }
      },
    },
  };
};

export default subscription;