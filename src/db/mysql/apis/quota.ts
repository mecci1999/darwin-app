import { DataBaseTableNames } from 'typings/enum';
import { mainConnection } from '..';
import { UserQuotaAttributes, UserQuotaTable } from '../models/quota/UserQuota';
import {
  QuotaUsageHistoryAttributes,
  QuotaUsageHistoryTable,
} from '../models/quota/QuotaUsageHistory';

/**
 * 用户配额相关数据库操作
 */

/**
 * 创建或更新用户配额
 */
export async function saveOrUpdateUserQuota(quota: UserQuotaAttributes) {
  try {
    const model = await mainConnection.getModel<UserQuotaTable>(DataBaseTableNames.UserQuota);
    return await model.upsert(quota);
  } catch (error) {
    console.log('saveOrUpdateUserQuota error:', error);
    throw error;
  }
}

/**
 * 根据用户ID查询配额信息
 */
export async function findUserQuotaByUserId(userId: string): Promise<UserQuotaAttributes | null> {
  try {
    const model = await mainConnection.getModel<UserQuotaTable>(DataBaseTableNames.UserQuota);
    if (!model) return null;

    const quota = await model.findOne({
      where: { userId },
    });

    return quota ? quota.toJSON() : null;
  } catch (error) {
    console.log('findUserQuotaByUserId error:', error);
    return null;
  }
}

/**
 * 更新用户已使用配额
 */
export async function updateUserQuotaUsage(userId: string, usedQuota: number) {
  try {
    const model = await mainConnection.getModel<UserQuotaTable>(DataBaseTableNames.UserQuota);
    return await model.update({ quotaUsed: usedQuota }, { where: { userId } });
  } catch (error) {
    console.log('updateUserQuotaUsage error:', error);
    throw error;
  }
}

/**
 * 增加用户已使用配额
 */
export async function incrementUserQuotaUsage(userId: string, increment: number) {
  try {
    const model = await mainConnection.getModel<UserQuotaTable>(DataBaseTableNames.UserQuota);
    return await model.increment('quotaUsed', {
      by: increment,
      where: { userId },
    });
  } catch (error) {
    console.log('incrementUserQuotaUsage error:', error);
    throw error;
  }
}

/**
 * 重置用户配额使用量
 */
export async function resetUserQuotaUsage(userId: string) {
  try {
    const model = await mainConnection.getModel<UserQuotaTable>(DataBaseTableNames.UserQuota);
    return await model.update({ quotaUsed: 0 }, { where: { userId } });
  } catch (error) {
    console.log('resetUserQuotaUsage error:', error);
    throw error;
  }
}

/**
 * 配额使用历史相关数据库操作
 */

/**
 * 创建配额使用记录
 */
export async function createQuotaUsageHistory(history: QuotaUsageHistoryAttributes) {
  try {
    const model = await mainConnection.getModel<QuotaUsageHistoryTable>(
      DataBaseTableNames.QuotaUsageHistory,
    );
    return await model.create(history);
  } catch (error) {
    console.log('createQuotaUsageHistory error:', error);
    throw error;
  }
}

/**
 * 获取用户配额使用历史
 */
export async function findUserQuotaUsageHistory(
  userId: string,
  startDate?: Date,
  endDate?: Date,
  limit: number = 100,
): Promise<QuotaUsageHistoryAttributes[]> {
  try {
    const model = await mainConnection.getModel<QuotaUsageHistoryTable>(
      DataBaseTableNames.QuotaUsageHistory,
    );
    if (!model) return [];

    const whereCondition: any = { userId };

    if (startDate || endDate) {
      whereCondition.usageDate = {};
      if (startDate) {
        whereCondition.usageDate[mainConnection.Sequelize.Op.gte] = startDate;
      }
      if (endDate) {
        whereCondition.usageDate[mainConnection.Sequelize.Op.lte] = endDate;
      }
    }

    const histories = await model.findAll({
      where: whereCondition,
      order: [['usageDate', 'DESC']],
      limit,
    });

    return histories.map((history) => history.toJSON());
  } catch (error) {
    console.log('findUserQuotaUsageHistory error:', error);
    return [];
  }
}

/**
 * 获取用户某个时间段的配额使用统计
 */
export async function getUserQuotaUsageStats(
  userId: string,
  startDate: Date,
  endDate: Date,
): Promise<{ totalUsage: number; recordCount: number }> {
  try {
    const model = await mainConnection.getModel<QuotaUsageHistoryTable>(
      DataBaseTableNames.QuotaUsageHistory,
    );
    if (!model) return { totalUsage: 0, recordCount: 0 };

    const result = (await model.findOne({
      where: {
        userId,
        usageDate: {
          [mainConnection.Sequelize.Op.between]: [startDate, endDate],
        },
      },
      attributes: [
        [
          mainConnection.Sequelize.fn('SUM', mainConnection.Sequelize.col('usageAmount')),
          'totalUsage',
        ],
        [mainConnection.Sequelize.fn('COUNT', mainConnection.Sequelize.col('id')), 'recordCount'],
      ],
      raw: true,
    })) as any;

    return {
      totalUsage: Number(result?.totalUsage) || 0,
      recordCount: Number(result?.recordCount) || 0,
    };
  } catch (error) {
    console.log('getUserQuotaUsageStats error:', error);
    return { totalUsage: 0, recordCount: 0 };
  }
}
