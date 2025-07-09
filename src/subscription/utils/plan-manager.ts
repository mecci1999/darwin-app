/**
 * Subscription微服务计划管理器
 */
import { Star } from 'node-universe';
import { SubscriptionState, SubscriptionPlan, PlanFeature, PlanLimits } from '../types';
import { SUBSCRIPTION_CONFIG, MONITORING_CONFIG } from '../constants';

export class PlanManager {
  /**
   * 创建订阅计划
   */
  static async createPlan(
    planData: Omit<SubscriptionPlan, 'id' | 'createdAt' | 'updatedAt'>,
    star: any,
  ): Promise<SubscriptionPlan> {
    try {
      const plan: SubscriptionPlan = {
        ...planData,
        id: this.generatePlanId(planData.name),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // 验证计划数据
      this.validatePlanData(plan);

      // 保存到数据库
      // await this.savePlanToDatabase(plan, star);

      star.logger?.info(`Subscription plan created: ${plan.id}`);
      return plan;
    } catch (error) {
      star.logger?.error('Failed to create subscription plan:', error);
      throw error;
    }
  }

  /**
   * 更新订阅计划
   */
  static async updatePlan(
    planId: string,
    updates: Partial<SubscriptionPlan>,
    star: any,
  ): Promise<SubscriptionPlan> {
    try {
      // 获取现有计划
      const existingPlan = await this.getPlanById(planId, star);
      if (!existingPlan) {
        throw new Error(`Plan not found: ${planId}`);
      }

      // 合并更新
      const updatedPlan: SubscriptionPlan = {
        ...existingPlan,
        ...updates,
        updatedAt: new Date(),
      };

      // 验证更新后的数据
      this.validatePlanData(updatedPlan);

      // 保存到数据库
      // await this.savePlanToDatabase(updatedPlan, star);

      star.logger?.info(`Subscription plan updated: ${planId}`);
      return updatedPlan;
    } catch (error) {
      star.logger?.error('Failed to update subscription plan:', error);
      throw error;
    }
  }

  /**
   * 删除订阅计划
   */
  static async deletePlan(planId: string, star: any): Promise<boolean> {
    try {
      // 检查是否有活跃订阅使用此计划
      const activeSubscriptions = await this.getActiveSubscriptionsByPlan(planId, star);
      if (activeSubscriptions.length > 0) {
        throw new Error(`Cannot delete plan with active subscriptions: ${planId}`);
      }

      // 软删除：将状态设置为deprecated
      await this.updatePlan(planId, { status: 'deprecated' }, star);

      star.logger?.info(`Subscription plan deleted: ${planId}`);
      return true;
    } catch (error) {
      star.logger?.error('Failed to delete subscription plan:', error);
      throw error;
    }
  }

  /**
   * 根据ID获取计划
   */
  static async getPlanById(planId: string, star: any): Promise<SubscriptionPlan | null> {
    try {
      // 首先从缓存中查找
      // const cachedPlan = await this.getPlanFromCache(planId, star);
      // if (cachedPlan) {
      //   return cachedPlan;
      // }

      // 从数据库查找
      // const plan = await this.getPlanFromDatabase(planId, star);
      // if (plan) {
      //   await this.cachePlan(plan, star);
      // }

      // 模拟返回计划数据
      const mockPlan: SubscriptionPlan = {
        id: planId,
        name: 'Basic Plan',
        description: 'Basic subscription plan',
        price: 999, // $9.99
        currency: 'USD',
        billingCycle: 'monthly',
        features: [
          {
            id: 'api_calls',
            name: 'API Calls',
            description: 'Monthly API call limit',
            enabled: true,
            value: 10000,
          },
          {
            id: 'storage',
            name: 'Storage',
            description: 'Storage space in GB',
            enabled: true,
            value: 10,
          },
        ],
        limits: {
          apiCalls: 10000,
          storage: 10,
          bandwidth: 100,
          users: 5,
          projects: 3,
          customDomains: 1,
          supportLevel: 'basic',
        },
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      return mockPlan;
    } catch (error) {
      star.logger?.error('Failed to get plan by ID:', error);
      return null;
    }
  }

  /**
   * 获取所有活跃计划
   */
  static async getActivePlans(star: any): Promise<SubscriptionPlan[]> {
    try {
      // 从数据库获取所有活跃计划
      // const plans = await this.getPlansFromDatabase({ status: 'active' }, star);

      // 模拟返回计划列表
      const mockPlans: SubscriptionPlan[] = [
        {
          id: 'plan_free',
          name: 'Free',
          description: 'Free plan with basic features',
          price: 0,
          currency: 'USD',
          billingCycle: 'monthly',
          features: [
            {
              id: 'api_calls',
              name: 'API Calls',
              description: 'Monthly API call limit',
              enabled: true,
              value: 1000,
            },
          ],
          limits: {
            apiCalls: 1000,
            storage: 1,
            bandwidth: 10,
            users: 1,
            projects: 1,
            customDomains: 0,
            supportLevel: 'basic',
          },
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'plan_basic',
          name: 'Basic',
          description: 'Basic plan for small teams',
          price: 999,
          currency: 'USD',
          billingCycle: 'monthly',
          features: [
            {
              id: 'api_calls',
              name: 'API Calls',
              description: 'Monthly API call limit',
              enabled: true,
              value: 10000,
            },
            {
              id: 'storage',
              name: 'Storage',
              description: 'Storage space in GB',
              enabled: true,
              value: 10,
            },
          ],
          limits: {
            apiCalls: 10000,
            storage: 10,
            bandwidth: 100,
            users: 5,
            projects: 3,
            customDomains: 1,
            supportLevel: 'standard',
          },
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'plan_pro',
          name: 'Professional',
          description: 'Professional plan for growing businesses',
          price: 2999,
          currency: 'USD',
          billingCycle: 'monthly',
          features: [
            {
              id: 'api_calls',
              name: 'API Calls',
              description: 'Monthly API call limit',
              enabled: true,
              value: 100000,
            },
            {
              id: 'storage',
              name: 'Storage',
              description: 'Storage space in GB',
              enabled: true,
              value: 100,
            },
            {
              id: 'priority_support',
              name: 'Priority Support',
              description: 'Priority customer support',
              enabled: true,
            },
          ],
          limits: {
            apiCalls: 100000,
            storage: 100,
            bandwidth: 1000,
            users: 25,
            projects: 10,
            customDomains: 5,
            supportLevel: 'premium',
          },
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      return mockPlans;
    } catch (error) {
      star.logger?.error('Failed to get active plans:', error);
      return [];
    }
  }

  /**
   * 比较计划功能
   */
  static comparePlans(plan1: SubscriptionPlan, plan2: SubscriptionPlan): any {
    return {
      pricing: {
        plan1: { price: plan1.price, currency: plan1.currency, cycle: plan1.billingCycle },
        plan2: { price: plan2.price, currency: plan2.currency, cycle: plan2.billingCycle },
        difference: plan2.price - plan1.price,
      },
      features: {
        plan1Only: plan1.features.filter((f1) => !plan2.features.some((f2) => f2.id === f1.id)),
        plan2Only: plan2.features.filter((f2) => !plan1.features.some((f1) => f1.id === f2.id)),
        common: plan1.features.filter((f1) => plan2.features.some((f2) => f2.id === f1.id)),
      },
      limits: {
        apiCalls: {
          plan1: plan1.limits.apiCalls,
          plan2: plan2.limits.apiCalls,
          difference: plan2.limits.apiCalls - plan1.limits.apiCalls,
        },
        storage: {
          plan1: plan1.limits.storage,
          plan2: plan2.limits.storage,
          difference: plan2.limits.storage - plan1.limits.storage,
        },
        bandwidth: {
          plan1: plan1.limits.bandwidth,
          plan2: plan2.limits.bandwidth,
          difference: plan2.limits.bandwidth - plan1.limits.bandwidth,
        },
        users: {
          plan1: plan1.limits.users,
          plan2: plan2.limits.users,
          difference: plan2.limits.users - plan1.limits.users,
        },
      },
    };
  }

  /**
   * 推荐计划升级
   */
  static recommendUpgrade(
    currentPlan: SubscriptionPlan,
    usage: any,
    availablePlans: SubscriptionPlan[],
  ): SubscriptionPlan | null {
    // 检查当前使用量是否接近限制
    const usageRatio = {
      apiCalls: (usage.apiCalls?.total || usage.apiCalls || 0) / currentPlan.limits.apiCalls,
      storage: (usage.storage?.used || usage.storage || 0) / currentPlan.limits.storage,
      bandwidth: (usage.bandwidth?.total || usage.bandwidth || 0) / currentPlan.limits.bandwidth,
      users: (usage.users || 0) / currentPlan.limits.users,
    };

    // 如果任何指标超过80%，推荐升级
    const needsUpgrade = Object.values(usageRatio).some((ratio) => ratio > 0.8);

    if (!needsUpgrade) {
      return null;
    }

    // 找到下一个更高级的计划
    const higherPlans = availablePlans
      .filter((plan) => plan.price > currentPlan.price)
      .sort((a, b) => a.price - b.price);

    return higherPlans[0] || null;
  }

  /**
   * 计算计划升级/降级的费用差异
   */
  static calculatePlanChangeCost(
    fromPlan: SubscriptionPlan,
    toPlan: SubscriptionPlan,
    remainingDays: number,
  ): {
    proratedRefund: number;
    newPlanCost: number;
    totalCost: number;
    savings: number;
  } {
    const daysInCycle = this.getDaysInBillingCycle(fromPlan.billingCycle);
    const usedDays = daysInCycle - remainingDays;

    // 计算已使用部分的费用
    const usedCost = (fromPlan.price * usedDays) / daysInCycle;

    // 计算按比例退款
    const proratedRefund = fromPlan.price - usedCost;

    // 新计划费用
    const newPlanCost = toPlan.price;

    // 总费用（新计划费用减去退款）
    const totalCost = newPlanCost - proratedRefund;

    // 节省金额（如果是降级）
    const savings = fromPlan.price - toPlan.price;

    return {
      proratedRefund,
      newPlanCost,
      totalCost,
      savings,
    };
  }

  /**
   * 验证计划数据
   */
  private static validatePlanData(plan: SubscriptionPlan): void {
    if (!plan.name || plan.name.trim().length === 0) {
      throw new Error('Plan name is required');
    }

    if (plan.price < 0) {
      throw new Error('Plan price cannot be negative');
    }

    if (!plan.currency || plan.currency.length !== 3) {
      throw new Error('Valid currency code is required');
    }

    if (!Object.values(SUBSCRIPTION_CONFIG.BILLING_CYCLES).includes(plan.billingCycle)) {
      throw new Error('Invalid billing cycle');
    }

    if (!plan.limits) {
      throw new Error('Plan limits are required');
    }

    // 验证限制值
    if (plan.limits.apiCalls < 0 || plan.limits.storage < 0 || plan.limits.bandwidth < 0) {
      throw new Error('Plan limits cannot be negative');
    }
  }

  /**
   * 生成计划ID
   */
  private static generatePlanId(planName: string): string {
    const sanitizedName = planName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const timestamp = Date.now();
    return `plan_${sanitizedName}_${timestamp}`;
  }

  /**
   * 获取计费周期的天数
   */
  private static getDaysInBillingCycle(billingCycle: string): number {
    switch (billingCycle) {
      case SUBSCRIPTION_CONFIG.BILLING_CYCLES.DAILY:
        return 1;
      case SUBSCRIPTION_CONFIG.BILLING_CYCLES.WEEKLY:
        return 7;
      case SUBSCRIPTION_CONFIG.BILLING_CYCLES.MONTHLY:
        return 30;
      case SUBSCRIPTION_CONFIG.BILLING_CYCLES.YEARLY:
        return 365;
      default:
        return 30;
    }
  }

  /**
   * 获取使用指定计划的活跃订阅
   */
  private static async getActiveSubscriptionsByPlan(planId: string, star: any): Promise<any[]> {
    try {
      // 从数据库查询活跃订阅
      // const subscriptions = await this.getSubscriptionsFromDatabase({
      //   planId,
      //   status: 'active'
      // }, star);

      // 模拟返回空数组
      return [];
    } catch (error) {
      star.logger?.error('Failed to get active subscriptions by plan:', error);
      return [];
    }
  }

  /**
   * 获取计划使用统计
   */
  static async getPlanUsageStats(
    planId: string,
    timeRange: { start: Date; end: Date },
    star: any,
  ): Promise<any> {
    try {
      // 从数据库获取统计数据
      const stats = {
        planId,
        period: timeRange,
        metrics: {
          totalSubscriptions: 0,
          activeSubscriptions: 0,
          newSubscriptions: 0,
          cancelledSubscriptions: 0,
          revenue: 0,
          averageLifetime: 0,
        },
        demographics: {
          byCountry: {},
          byUserType: {},
          bySource: {},
        },
      };

      // 模拟统计数据
      stats.metrics.totalSubscriptions = Math.floor(Math.random() * 1000) + 100;
      stats.metrics.activeSubscriptions = Math.floor(stats.metrics.totalSubscriptions * 0.8);
      stats.metrics.newSubscriptions = Math.floor(Math.random() * 50) + 10;
      stats.metrics.cancelledSubscriptions = Math.floor(Math.random() * 20) + 5;
      stats.metrics.revenue = stats.metrics.activeSubscriptions * 999; // 假设每个订阅$9.99
      stats.metrics.averageLifetime = Math.floor(Math.random() * 365) + 30; // 30-395天

      return stats;
    } catch (error) {
      star.logger?.error('Failed to get plan usage stats:', error);
      return null;
    }
  }

  /**
   * 创建自定义计划
   */
  static async createCustomPlan(
    basePlanId: string,
    customizations: {
      name?: string;
      price?: number;
      features?: PlanFeature[];
      limits?: Partial<PlanLimits>;
    },
    star: any,
  ): Promise<SubscriptionPlan> {
    try {
      const basePlan = await this.getPlanById(basePlanId, star);
      if (!basePlan) {
        throw new Error(`Base plan not found: ${basePlanId}`);
      }

      const customPlan: SubscriptionPlan = {
        ...basePlan,
        id: this.generatePlanId(customizations.name || `${basePlan.name}_custom`),
        name: customizations.name || `${basePlan.name} (Custom)`,
        price: customizations.price ?? basePlan.price,
        features: customizations.features || basePlan.features,
        limits: {
          ...basePlan.limits,
          ...customizations.limits,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // 验证自定义计划
      this.validatePlanData(customPlan);

      // 保存自定义计划
      // await this.savePlanToDatabase(customPlan, star);

      star.logger?.info(`Custom plan created: ${customPlan.id}`);
      return customPlan;
    } catch (error) {
      star.logger?.error('Failed to create custom plan:', error);
      throw error;
    }
  }

  /**
   * 获取计划定价历史
   */
  static async getPlanPricingHistory(planId: string, star: any): Promise<any[]> {
    try {
      // 从数据库获取定价历史
      // const history = await this.getPricingHistoryFromDatabase(planId, star);

      // 模拟定价历史
      const mockHistory = [
        {
          id: 'price_1',
          planId,
          price: 999,
          currency: 'USD',
          effectiveDate: new Date('2024-01-01'),
          reason: 'Initial pricing',
          createdAt: new Date('2024-01-01'),
        },
        {
          id: 'price_2',
          planId,
          price: 1299,
          currency: 'USD',
          effectiveDate: new Date('2024-06-01'),
          reason: 'Price adjustment due to increased costs',
          createdAt: new Date('2024-06-01'),
        },
      ];

      return mockHistory;
    } catch (error) {
      star.logger?.error('Failed to get plan pricing history:', error);
      return [];
    }
  }

  /**
   * 批量更新计划
   */
  static async bulkUpdatePlans(
    updates: { planId: string; changes: Partial<SubscriptionPlan> }[],
    star: any,
  ): Promise<{ success: number; failed: number; errors: any[] }> {
    let success = 0;
    let failed = 0;
    const errors: any[] = [];

    for (const update of updates) {
      try {
        await this.updatePlan(update.planId, update.changes, star);
        success++;
      } catch (error: any) {
        failed++;
        errors.push({
          planId: update.planId,
          error: error?.message || 'Unknown error',
        });
      }
    }

    star.logger?.info(`Bulk plan update completed: ${success} success, ${failed} failed`);
    return { success, failed, errors };
  }
}
