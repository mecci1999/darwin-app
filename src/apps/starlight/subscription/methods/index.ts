/**
 * 订阅微服务内部方法
 * 这些方法仅供服务内部使用，不对外暴露
 */
import { Context } from 'node-universe';
import { SubscriptionPlan, UserSubscription } from '../types';
import { SubscriptionPlanAttributes } from 'db/mysql/models/subscription/subscriptionPlan';
import { UserSubscriptionAttributes } from 'db/mysql/models/subscription/userSubscription';
import { Starlight } from 'typings';


/**
 * 创建订阅微服务的内部方法
 */
export function createMethods(star: Starlight) {
  return {
    /**
     * 根据名称获取订阅计划
     */
    async getPlanByName(planName: string): Promise<SubscriptionPlan | null> {
      try {
        // 从缓存或数据库获取计划
        const plans = await star.db.subscription.queryAllSubscriptionPlans();
        const plan = plans.find(p => p.name === planName);
        
        if (!plan) return null;
        
        // 转换为内部类型
    return {
      id: plan.id,
      name: plan.name,
      description: plan.description || '',
      price: plan.price,
      currency: plan.currency,
      billingCycle: plan.billingCycle as any,
      features: (plan.features as any) || [],
      limits: (plan.limits as any) || {
        apiCalls: 0,
        storage: 0,
        bandwidth: 0,
        users: 0,
        projects: 0,
        customDomains: 0,
        supportLevel: 'basic' as const
      },
      status: plan.isActive ? 'active' : 'inactive',
      createdAt: plan.createdAt || new Date(),
      updatedAt: plan.updatedAt || new Date()
    };
      } catch (error) {
        star.logger?.error('Failed to get plan by name:', error);
        return null;
      }
    },

    /**
     * 获取用户的活跃订阅
     */
    async getUserActiveSubscription(userId: string): Promise<UserSubscription | null> {
      try {
        const subscription = await star.db.subscription.findActiveUserSubscription(userId);
        
        if (!subscription) return null;
        
        // 转换为内部类型
    return {
      id: subscription.id,
      userId: subscription.userId,
      planId: subscription.planName, // 使用planName作为planId
      status: subscription.status as any,
      startDate: subscription.startedAt,
      endDate: subscription.expiresAt || new Date(),
      nextBillingDate: subscription.expiresAt || new Date(),
      autoRenew: !subscription.cancelAtPeriodEnd,
      paymentMethodId: undefined,
      discountId: undefined,
      metadata: subscription.metadata,
      createdAt: subscription.createdAt || new Date(),
      updatedAt: subscription.updatedAt || new Date()
    };
      } catch (error) {
        star.logger?.error('Failed to get user active subscription:', error);
        return null;
      }
    },

    /**
     * 检查是否可以取消订阅
     */
    async canCancelSubscription(subscription: UserSubscription): Promise<{ allowed: boolean; reason?: string }> {
      try {
        // 检查订阅状态
        if (subscription.status !== 'active') {
          return { allowed: false, reason: '订阅状态不允许取消' };
        }

        // 检查是否在宽限期内
        const now = new Date();
        const gracePeriodEnd = new Date(subscription.startDate.getTime() + 3 * 24 * 60 * 60 * 1000); // 3天宽限期
        
        if (now < gracePeriodEnd) {
          return { allowed: true };
        }

        // 其他业务逻辑检查
        return { allowed: true };
      } catch (error) {
        star.logger?.error('Failed to check cancellation eligibility:', error);
        return { allowed: false, reason: '系统错误' };
      }
    },

    /**
     * 处理订阅取消
     */
    async handleCancellation(ctx: Context) {
      const { tenantId, userId, subscriptionId, reason } = ctx.params;
      
      try {
        // 更新订阅状态
        await star.db.subscription.updateSubscriptionStatus(subscriptionId, 'cancelled');

        // 记录取消日志
        star.logger?.info(`Subscription cancelled: ${subscriptionId}`, {
          reason,
          tenantId,
          userId,
          timestamp: new Date().toISOString()
        });

        star.logger?.info(`Subscription cancelled: ${subscriptionId}`);
      } catch (error) {
        star.logger?.error('Failed to handle cancellation:', error);
        throw error;
      }
    },

    /**
     * 清理租户订阅数据
     */
    async cleanupTenantSubscriptions(ctx: Context) {
      const { tenantId } = ctx.params;
      
      try {
        // 获取租户相关的所有用户订阅并取消
        // 这里需要根据实际的租户-用户关系来实现
        star.logger?.warn('cleanupTenantSubscriptions needs implementation based on tenant-user relationship');
        star.logger?.info(`Tenant subscriptions cleanup requested: ${tenantId}`);
      } catch (error) {
        star.logger?.error('Failed to cleanup tenant subscriptions:', error);
        throw error;
      }
    },

    /**
     * 获取所有计划
     */
    async getAllPlans(currency: string = 'CNY') {
      try {
        const result = await star.db.subscription.queryAllSubscriptionPlans();
        
        return result || [];
      } catch (error) {
        star.logger?.error('Failed to get all plans:', error);
        return [];
      }
    }
  };
}

export default createMethods;