import { Context, Star } from 'node-universe';
import { ResponseCode } from '../../typings/enum';
import { HttpResponseItem } from '../../typings/response';

const plans = (star: Star) => {
  return {
    // 获取所有订阅计划
    'plans.list': {
      params: {
        includeFeatures: { type: 'boolean', optional: true, default: true },
        currency: { type: 'string', optional: true, default: 'CNY' },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { includeFeatures, currency } = ctx.params;
          
          const plans = await (this as any).getAllPlans(currency);
          
          const formattedPlans = plans.map((plan: any) => {
            const result: any = {
              id: plan.name,
              name: plan.name,
              displayName: plan.displayName,
              price: plan.price,
              currency: plan.currency,
              billingCycle: plan.billingCycle,
              popular: plan.name === 'pro', // 标记推荐计划
            };
            
            if (includeFeatures) {
              result.features = plan.features;
              result.limitations = plan.limitations;
            }
            
            return result;
          });
          
          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                plans: formattedPlans,
                currency,
                total: formattedPlans.length,
              },
              message: '获取订阅计划成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('List plans failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '获取订阅计划失败',
              success: false,
            },
          };
        }
      },
    },
    
    // 获取特定订阅计划详情
    'plans.get': {
      params: {
        planName: { type: 'string', required: true },
        currency: { type: 'string', optional: true, default: 'CNY' },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { planName, currency } = ctx.params;
          
          const plan = await (this as any).getPlanByName(planName, currency);
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
          
          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                plan: {
                  id: plan.name,
                  name: plan.name,
                  displayName: plan.displayName,
                  description: plan.description,
                  price: plan.price,
                  currency: plan.currency,
                  billingCycle: plan.billingCycle,
                  features: plan.features,
                  limitations: plan.limitations,
                  popular: plan.name === 'pro',
                },
              },
              message: '获取订阅计划详情成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Get plan failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '获取订阅计划详情失败',
              success: false,
            },
          };
        }
      },
    },
    
    // 比较订阅计划
    'plans.compare': {
      params: {
        planNames: { type: 'array', required: true },
        currency: { type: 'string', optional: true, default: 'CNY' },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { planNames, currency } = ctx.params;
          
          if (!Array.isArray(planNames) || planNames.length === 0) {
            return {
              status: 400,
              data: {
                code: ResponseCode.ParamsError,
                content: null,
                message: '请提供要比较的计划名称',
                success: false,
              },
            };
          }
          
          const plans = await Promise.all(
            planNames.map((name: string) => (this as any).getPlanByName(name, currency))
          );
          
          const validPlans = plans.filter(Boolean);
          if (validPlans.length === 0) {
            return {
              status: 404,
              data: {
                code: ResponseCode.ParamsError,
                content: null,
                message: '没有找到有效的订阅计划',
                success: false,
              },
            };
          }
          
          // 生成比较表
          const comparison = await (this as any).generatePlanComparison(validPlans);
          
          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                plans: validPlans.map((plan: any) => ({
                  id: plan.name,
                  name: plan.name,
                  displayName: plan.displayName,
                  price: plan.price,
                  currency: plan.currency,
                  billingCycle: plan.billingCycle,
                })),
                comparison,
                currency,
              },
              message: '订阅计划比较成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Compare plans failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '订阅计划比较失败',
              success: false,
            },
          };
        }
      },
    },
    
    // 获取计划升级路径
    'plans.upgradePath': {
      metadata: {
        auth: true,
      },
      params: {
        targetPlan: { type: 'string', required: true },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { targetPlan } = ctx.params;
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
          
          // 获取用户当前订阅
          const currentSubscription = await (this as any).getUserCurrentSubscription(userId);
          if (!currentSubscription) {
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
          
          // 检查目标计划是否存在
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
          
          // 计算升级路径和费用
          const upgradePath = await (this as any).calculateUpgradePath(
            currentSubscription.planName,
            targetPlan,
            currentSubscription
          );
          
          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                currentPlan: {
                  name: currentSubscription.planName,
                  displayName: currentSubscription.planDisplayName,
                  expiresAt: currentSubscription.expiresAt,
                },
                targetPlan: {
                  name: targetPlanData.name,
                  displayName: targetPlanData.displayName,
                  price: targetPlanData.price,
                  currency: targetPlanData.currency,
                },
                upgradePath,
                canUpgrade: upgradePath.canUpgrade,
                upgradeType: upgradePath.upgradeType, // immediate, prorated, scheduled
                cost: upgradePath.cost,
                savings: upgradePath.savings,
                effectiveDate: upgradePath.effectiveDate,
              },
              message: '获取升级路径成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Get upgrade path failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '获取升级路径失败',
              success: false,
            },
          };
        }
      },
    },
    
    // 获取计划推荐
    'plans.recommend': {
      metadata: {
        auth: true,
      },
      params: {
        usage: { type: 'object', optional: true }, // 用户使用情况
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { usage } = ctx.params;
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
          
          // 获取用户历史使用数据
          const userUsage = usage || await (this as any).getUserUsageStats(userId, '30d');
          
          // 获取当前订阅
          const currentSubscription = await (this as any).getUserCurrentSubscription(userId);
          
          // 基于使用情况推荐计划
          const recommendation = await (this as any).recommendPlan(userUsage, currentSubscription);
          
          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                currentPlan: currentSubscription ? {
                  name: currentSubscription.planName,
                  displayName: currentSubscription.planDisplayName,
                } : null,
                recommendedPlan: {
                  name: recommendation.plan.name,
                  displayName: recommendation.plan.displayName,
                  price: recommendation.plan.price,
                  currency: recommendation.plan.currency,
                  reason: recommendation.reason,
                  confidence: recommendation.confidence,
                },
                usage: {
                  current: userUsage,
                  projected: recommendation.projectedUsage,
                },
                benefits: recommendation.benefits,
                potentialSavings: recommendation.potentialSavings,
              },
              message: '获取计划推荐成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Get plan recommendation failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '获取计划推荐失败',
              success: false,
            },
          };
        }
      },
    },
    
    // 获取计划定价
    'plans.pricing': {
      params: {
        planName: { type: 'string', required: true },
        billingCycle: { type: 'string', optional: true }, // monthly, yearly
        currency: { type: 'string', optional: true, default: 'CNY' },
        promoCode: { type: 'string', optional: true },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { planName, billingCycle, currency, promoCode } = ctx.params;
          
          const plan = await (this as any).getPlanByName(planName, currency);
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
          
          // 计算定价
          const pricing = await (this as any).calculatePlanPricing({
            plan,
            billingCycle: billingCycle || plan.billingCycle,
            currency,
            promoCode,
          });
          
          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                plan: {
                  name: plan.name,
                  displayName: plan.displayName,
                },
                pricing: {
                  basePrice: pricing.basePrice,
                  finalPrice: pricing.finalPrice,
                  currency: pricing.currency,
                  billingCycle: pricing.billingCycle,
                  discount: pricing.discount,
                  promoCode: pricing.promoCode,
                  taxes: pricing.taxes,
                  total: pricing.total,
                },
                breakdown: pricing.breakdown,
                validUntil: pricing.validUntil,
              },
              message: '获取计划定价成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Get plan pricing failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '获取计划定价失败',
              success: false,
            },
          };
        }
      },
    },
  };
};

export default plans;