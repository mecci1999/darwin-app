import { DataBaseTableNames } from 'typings/enum';
import { mainConnection } from '..';
import { ApiKeyAttributes, ApiKeyCreationAttributes, ApiKeyTable } from '../models/api/ApiKey';
import { ApiKeyStatsAttributes, ApiKeyStatsCreationAttributes, ApiKeyStatsTable } from '../models/api/ApiKeyStats';

/**
 * API密钥相关数据库操作
 */

/**
 * 创建API密钥
 */
export async function createApiKey(apiKey: ApiKeyCreationAttributes) {
  try {
    const model = await mainConnection.getModel(DataBaseTableNames.ApiKey);
    return await model.create(apiKey as any);
  } catch (error) {
    console.log('createApiKey error:', error);
    throw error;
  }
}

/**
 * 根据密钥查询API密钥信息
 */
export async function findApiKeyByKey(keyHash: string): Promise<ApiKeyAttributes | null> {
  try {
    const model = await mainConnection.getModel<ApiKeyTable>(DataBaseTableNames.ApiKey);
    if (!model) return null;

    const apiKey = await model.findOne({
      where: {
        keyHash,
        isActive: true,
      },
    });

    return apiKey ? apiKey.toJSON() : null;
  } catch (error) {
    console.log('findApiKeyByKey error:', error);
    return null;
  }
}

/**
 * 根据用户ID查询API密钥列表
 */
export async function findApiKeysByUserId(userId: string): Promise<ApiKeyAttributes[]> {
  try {
    const model = await mainConnection.getModel<ApiKeyTable>(DataBaseTableNames.ApiKey);
    if (!model) return [];

    const apiKeys = await model.findAll({
      where: { userId },
      order: [['createdAt', 'DESC']],
      attributes: {
        exclude: ['keyHash'], // 出于安全考虑，不返回完整密钥
      },
    });

    return apiKeys.map((key) => key.toJSON());
  } catch (error) {
    console.log('findApiKeysByUserId error:', error);
    return [];
  }
}

/**
 * 根据ID查询API密钥
 */
export async function findApiKeyById(id: string): Promise<ApiKeyAttributes | null> {
  try {
    const model = await mainConnection.getModel<ApiKeyTable>(DataBaseTableNames.ApiKey);
    if (!model) return null;

    const apiKey = await model.findOne({
      where: { id },
    });

    return apiKey ? apiKey.toJSON() : null;
  } catch (error) {
    console.log('findApiKeyById error:', error);
    return null;
  }
}

/**
 * 更新API密钥状态
 */
export async function updateApiKeyStatus(id: string, isActive: boolean) {
  try {
    const model = await mainConnection.getModel<ApiKeyTable>(DataBaseTableNames.ApiKey);
    return await model.update({ isActive }, { where: { id } });
  } catch (error) {
    console.log('updateApiKeyStatus error:', error);
    throw error;
  }
}

/**
 * 更新API密钥最后使用时间
 */
export async function updateApiKeyLastUsed(id: string) {
  try {
    const model = await mainConnection.getModel<ApiKeyTable>(DataBaseTableNames.ApiKey);
    return await model.update({ lastUsedAt: new Date() }, { where: { id } });
  } catch (error) {
    console.log('updateApiKeyLastUsed error:', error);
    throw error;
  }
}

/**
 * 删除API密钥
 */
export async function deleteApiKey(id: string) {
  try {
    const model = await mainConnection.getModel<ApiKeyTable>(DataBaseTableNames.ApiKey);
    return await model.destroy({
      where: { id },
    });
  } catch (error) {
    console.log('deleteApiKey error:', error);
    throw error;
  }
}

/**
 * API密钥统计相关数据库操作
 */

/**
 * 创建API密钥统计记录
 */
export async function createApiKeyStats(stats: ApiKeyStatsCreationAttributes) {
  try {
    const model = await mainConnection.getModel(DataBaseTableNames.ApiKeyStats);
    return await model.create(stats as any);
  } catch (error) {
    console.log('createApiKeyStats error:', error);
    throw error;
  }
}

/**
 * 更新API密钥统计
 */
export async function updateApiKeyStats(apiKeyId: string, requestCount: number = 1) {
  try {
    const model = await mainConnection.getModel<ApiKeyStatsTable>(DataBaseTableNames.ApiKeyStats);
    const today = new Date(); // 使用Date对象而不是字符串
    today.setHours(0, 0, 0, 0); // 设置为当天的开始时间

    // 尝试更新今天的记录
    const [updatedRows] = await model.update(
      {
        requestCount: mainConnection.Sequelize.literal(`requestCount + ${requestCount}`),
      },
      {
        where: {
          apiKeyId,
          date: today,
        },
      },
    );

    // 如果没有更新任何记录，说明今天还没有统计记录，创建一个新的
    if (updatedRows === 0) {
      await model.create({
        apiKeyId,
        date: today,
        requestCount,
        errorCount: 0,
        dataVolumeBytes: 0,
      });
    }

    return true;
  } catch (error) {
    console.log('updateApiKeyStats error:', error);
    throw error;
  }
}

/**
 * 获取API密钥统计信息
 */
export async function getApiKeyStats(
  apiKeyId: string,
  startDate?: string,
  endDate?: string,
): Promise<ApiKeyStatsAttributes[]> {
  try {
    const model = await mainConnection.getModel<ApiKeyStatsTable>(DataBaseTableNames.ApiKeyStats);
    if (!model) return [];

    const whereCondition: any = { apiKeyId };

    if (startDate || endDate) {
      whereCondition.date = {};
      if (startDate) {
        whereCondition.date[mainConnection.Sequelize.Op.gte] = new Date(startDate);
      }
      if (endDate) {
        whereCondition.date[mainConnection.Sequelize.Op.lte] = new Date(endDate);
      }
    }

    const stats = await model.findAll({
      where: whereCondition,
      order: [['date', 'DESC']],
    });

    return stats.map((stat) => stat.toJSON());
  } catch (error) {
    console.log('getApiKeyStats error:', error);
    return [];
  }
}

/**
 * 获取API密钥总统计
 */
export async function getApiKeyTotalStats(
  apiKeyId: string,
): Promise<{ totalRequests: number; daysActive: number }> {
  try {
    const model = await mainConnection.getModel<ApiKeyStatsTable>(DataBaseTableNames.ApiKeyStats);
    if (!model) return { totalRequests: 0, daysActive: 0 };

    const result = (await model.findOne({
      where: { apiKeyId },
      attributes: [
        [
          mainConnection.Sequelize.fn('SUM', mainConnection.Sequelize.col('requestCount')),
          'totalRequests',
        ],
        [mainConnection.Sequelize.fn('COUNT', mainConnection.Sequelize.col('date')), 'daysActive'],
      ],
      raw: true,
    })) as any;

    return {
      totalRequests: Number(result?.totalRequests) || 0,
      daysActive: Number(result?.daysActive) || 0,
    };
  } catch (error) {
    console.log('getApiKeyTotalStats error:', error);
    return { totalRequests: 0, daysActive: 0 };
  }
}
