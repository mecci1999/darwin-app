import { DataBaseTableNames } from 'typings/enum';
import { mainConnection } from '..';
import { SubscriptionPlanAttributes, SubscriptionPlanTable } from '../models/subscription/SubscriptionPlan';
import { UserSubscriptionAttributes, UserSubscriptionTable } from '../models/subscription/UserSubscription';

/**
 * 订阅计划相关数据库操作
 */

/**
 * 创建或更新订阅计划
 */
export async function saveOrUpdateSubscriptionPlan(plan: SubscriptionPlanAttributes) {
  try {
    const model = await mainConnection.getModel<SubscriptionPlanTable>(DataBaseTableNames.SubscriptionPlan);
    return await model.upsert(plan);
  } catch (error) {
    console.log('saveOrUpdateSubscriptionPlan error:', error);
    throw error;
  }
}

/**
 * 获取所有订阅计划
 */
export async function queryAllSubscriptionPlans(): Promise<SubscriptionPlanAttributes[]> {
  try {
    const model = await mainConnection.getModel<SubscriptionPlanTable>(DataBaseTableNames.SubscriptionPlan);
    if (!model) return [];
    
    const plans = await model.findAll({
      where: { isActive: true },
      order: [['price', 'ASC']],
    });
    
    return plans.map(plan => plan.toJSON());
  } catch (error) {
    console.log('queryAllSubscriptionPlans error:', error);
    return [];
  }
}

/**
 * 根据ID查询订阅计划
 */
export async function findSubscriptionPlanById(planId: string): Promise<SubscriptionPlanAttributes | null> {
  try {
    const model = await mainConnection.getModel<SubscriptionPlanTable>(DataBaseTableNames.SubscriptionPlan);
    if (!model) return null;

    const plan = await model.findOne({
      where: { id: planId, isActive: true },
    });

    return plan ? plan.toJSON() : null;
  } catch (error) {
    console.log('findSubscriptionPlanById error:', error);
    return null;
  }
}

/**
 * 用户订阅相关数据库操作
 */

/**
 * 创建用户订阅
 */
export async function createUserSubscription(subscription: UserSubscriptionAttributes) {
  try {
    const model = await mainConnection.getModel<UserSubscriptionTable>(DataBaseTableNames.UserSubscription);
    return await model.create(subscription);
  } catch (error) {
    console.log('createUserSubscription error:', error);
    throw error;
  }
}

/**
 * 获取用户当前有效订阅
 */
export async function findActiveUserSubscription(userId: string): Promise<UserSubscriptionAttributes | null> {
  try {
    const model = await mainConnection.getModel<UserSubscriptionTable>(DataBaseTableNames.UserSubscription);
    if (!model) return null;

    const subscription = await model.findOne({
      where: {
        userId,
        status: 'active',
        expiresAt: {
          [mainConnection.Sequelize.Op.gt]: new Date(),
        },
      },
      order: [['expiresAt', 'DESC']],
    });

    return subscription ? subscription.toJSON() : null;
  } catch (error) {
    console.log('findActiveUserSubscription error:', error);
    return null;
  }
}

/**
 * 获取用户所有订阅历史
 */
export async function findUserSubscriptionHistory(userId: string): Promise<UserSubscriptionAttributes[]> {
  try {
    const model = await mainConnection.getModel<UserSubscriptionTable>(DataBaseTableNames.UserSubscription);
    if (!model) return [];

    const subscriptions = await model.findAll({
      where: { userId },
      order: [['createdAt', 'DESC']],
    });

    return subscriptions.map(sub => sub.toJSON());
  } catch (error) {
    console.log('findUserSubscriptionHistory error:', error);
    return [];
  }
}

/**
 * 更新订阅状态
 */
export async function updateSubscriptionStatus(
  subscriptionId: string, 
  status: 'active' | 'cancelled' | 'expired' | 'suspended'
) {
  try {
    const model = await mainConnection.getModel<UserSubscriptionTable>(DataBaseTableNames.UserSubscription);
    return await model.update(
      { status },
      { where: { id: subscriptionId } }
    );
  } catch (error) {
    console.log('updateSubscriptionStatus error:', error);
    throw error;
  }
}