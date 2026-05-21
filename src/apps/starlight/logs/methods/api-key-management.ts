/**
 * API密钥管理方法
 * 处理API密钥的创建、验证、权限管理和生命周期
 */

import * as crypto from 'crypto';
import { mainConnection } from 'db/mysql';
import {
  countActiveApiKeysByTenantId,
  createApiKey as dbCreateApiKey,
  findApiKeyById,
  findApiKeyByKey,
  findApiKeysByTenantId,
  findApiKeysByUserId,
  getApiKeyStats,
  getApiKeyTotalStats,
  updateApiKeyLastUsed,
  updateApiKeyStats,
  updateApiKeyStatus,
} from 'db/mysql/apis/apiKey';
import { Context } from 'node-universe';
import { DataBaseTableNames } from 'typings';
import { API_KEY_EXPIRY_DAYS, API_KEY_MAX_PER_TENANT, SUPPORTED_PERMISSIONS } from '../constants';
import { ApiKey, ApiPermission } from '../types';

// 定义API密钥属性接口
interface ApiKeyAttributes {
  id: string;
  userId: string;
  keyName: string;
  keyHash: string;
  keyPrefix: string;
  permissions?: Record<string, any>;
  rateLimitPerMinute: number;
  isActive: boolean;
  lastUsedAt?: Date;
  expiresAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
  usageCount?: number;
  tenantId?: string;
}

/**
 * 生成API密钥密文
 */
function generateApiKeySecret(): string {
  const prefix = 'dk_';
  const randomBytes = crypto.randomBytes(32);
  const key = randomBytes.toString('hex');
  return `${prefix}${key}`;
}

/**
 * 哈希API密钥
 */
function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

/**
 * 掩码API密钥显示
 */
function maskApiKey(key: string): string {
  if (!key || key.length < 8) return '****';
  return `${key.substring(0, 8)}${'*'.repeat(key.length - 12)}${key.substring(key.length - 4)}`;
}

/**
 * 创建API密钥
 */
export async function createApiKey(
  ctx: Context,
  params: {
    name: string;
    tenantId: string;
    userId: string;
    permissions: ApiPermission[];
    description?: string;
    expiresAt?: Date;
    ipWhitelist?: string[];
  },
): Promise<{
  success: boolean;
  apiKey?: {
    id: string;
    key: string;
    name: string;
    permissions: ApiPermission[];
    createdAt: Date;
    expiresAt?: Date;
  };
  error?: string;
}> {
  try {
    const { name, tenantId, userId, permissions, description, expiresAt, ipWhitelist } = params;

    // 验证权限
    const invalidPermissions = permissions.filter((perm) => !SUPPORTED_PERMISSIONS.includes(perm));
    if (invalidPermissions.length > 0) {
      throw new Error(`Invalid permissions: ${invalidPermissions.join(', ')}`);
    }

    // 检查租户API密钥数量限制
    const existingKeysCount = await countActiveApiKeysByTenantId(tenantId);

    if (existingKeysCount >= API_KEY_MAX_PER_TENANT) {
      throw new Error(`Maximum API keys limit reached: ${API_KEY_MAX_PER_TENANT}`);
    }

    // 生成API密钥
    const keyId = crypto.randomUUID();
    const keySecret = generateApiKeySecret();
    const hashedKey = hashApiKey(keySecret);

    // 设置默认过期时间
    const defaultExpiresAt =
      expiresAt || new Date(Date.now() + API_KEY_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const apiKeyData: ApiKey = {
      id: keyId,
      key: keySecret,
      name,
      tenantId,
      userId,
      permissions,
      description,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: defaultExpiresAt.getTime(),
      lastUsedAt: undefined,
    };

    // 保存到数据库
    await dbCreateApiKey({
      id: keyId,
      tenantId,
      userId,
      keyName: name,
      keyHash: hashedKey,
      keyPrefix: keySecret.substring(0, 8),
      permissions: permissions,
      rateLimitPerMinute: 100, // 默认限制
      isActive: true,
      expiresAt: defaultExpiresAt,
    });

    // 记录创建事件
    await ctx.emit('api_key.created', {
      keyId,
      tenantId,
      userId,
      name,
      permissions,
      timestamp: Date.now(),
    });

    ctx.service?.logger?.info(`API key created: ${keyId} for tenant ${tenantId}`);

    return {
      success: true,
      apiKey: {
        id: keyId,
        key: keySecret, // 只在创建时返回明文密钥
        name,
        permissions,
        createdAt: new Date(apiKeyData.createdAt),
        expiresAt: defaultExpiresAt,
      },
    };
  } catch (error) {
    ctx.service?.logger?.error('Failed to create API key:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 获取API密钥列表
 */
export async function getApiKeys(
  ctx: Context,
  params: {
    tenantId: string;
    userId?: string;
    includeInactive?: boolean;
  },
): Promise<{
  apiKeys: Array<{
    id: string;
    name: string;
    permissions: ApiPermission[];
    description?: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    expiresAt?: Date;
    lastUsedAt?: Date;
    usageCount: number;
    maskedKey: string;
  }>;
}> {
  try {
    const { tenantId, userId, includeInactive = false } = params;

    const filter: any = { tenantId };
    if (userId) {
      filter.userId = userId;
    }
    if (!includeInactive) {
      filter.isActive = true;
    }

    let apiKeys;
    if (userId) {
      apiKeys = await findApiKeysByUserId(userId);
    } else {
      apiKeys = await findApiKeysByTenantId(tenantId);
    }

    apiKeys = apiKeys.filter((key) => (key as any).tenantId === tenantId && (!userId || key.userId === userId));

    // 过滤非活跃的密钥
    if (!includeInactive) {
      apiKeys = apiKeys.filter((key) => key.isActive);
    }

    return {
      apiKeys: await Promise.all(
        apiKeys.map(async (key) => {
          const totalStats = await getApiKeyTotalStats(key.id);

          return {
            id: key.id,
            name: key.keyName,
            permissions: key.permissions ? (Object.keys(key.permissions) as ApiPermission[]) : [],
            description: key.description || '',
            isActive: key.isActive,
            createdAt: key.createdAt || new Date(),
            updatedAt: key.updatedAt || new Date(),
            expiresAt: key.expiresAt,
            lastUsedAt: key.lastUsedAt,
            usageCount: totalStats.totalRequests || 0,
            maskedKey: maskApiKey(key.keyHash),
          };
        }),
      ),
    };
  } catch (error) {
    ctx.service?.logger?.error('Failed to get API keys:', error);
    throw error;
  }
}

/**
 * 获取API密钥详情
 */
export async function getApiKeyDetails(
  ctx: Context,
  params: {
    keyId: string;
    tenantId: string;
    userId?: string;
  },
): Promise<{
  apiKey?: {
    id: string;
    name: string;
    permissions: ApiPermission[];
    description?: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    expiresAt?: Date;
    lastUsedAt?: Date;
    usageCount: number;
    ipWhitelist?: string[];
    maskedKey: string;
  };
  error?: string;
}> {
  try {
    const { keyId, tenantId, userId } = params;

    const filter: any = { id: keyId, tenantId };
    if (userId) {
      filter.userId = userId;
    }

    const apiKey = await findApiKeyById(keyId);

    // 验证租户和用户权限
    if (!apiKey || (apiKey as any).tenantId !== tenantId || (userId && apiKey.userId !== userId)) {
      return { error: 'API key not found' };
    }

    return {
      apiKey: {
        id: apiKey.id,
        name: apiKey.keyName,
        permissions: apiKey.permissions ? (Object.keys(apiKey.permissions) as ApiPermission[]) : [],
        description: '', // 需要从其他地方获取或添加到模型
        isActive: apiKey.isActive,
        createdAt: apiKey.createdAt || new Date(),
        updatedAt: apiKey.updatedAt || new Date(),
        expiresAt: apiKey.expiresAt,
        lastUsedAt: apiKey.lastUsedAt,
        usageCount: (apiKey as any).usageCount || 0,
        ipWhitelist: [], // 需要从其他地方获取或添加到模型
        maskedKey: maskApiKey(apiKey.keyHash),
      },
    };
  } catch (error) {
    ctx.service?.logger?.error('Failed to get API key details:', error);
    return {
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 更新API密钥
 */
export async function updateApiKey(
  ctx: Context,
  params: {
    keyId: string;
    tenantId: string;
    userId?: string;
    updates: {
      name?: string;
      description?: string;
      permissions?: ApiPermission[];
      expiresAt?: Date;
      ipWhitelist?: string[];
      isActive?: boolean;
    };
  },
): Promise<{ success: boolean; error?: string }> {
  try {
    const { keyId, tenantId, userId, updates } = params;

    // 验证权限
    if (updates.permissions) {
      const invalidPermissions = updates.permissions.filter(
        (perm) => !SUPPORTED_PERMISSIONS.includes(perm),
      );
      if (invalidPermissions.length > 0) {
        throw new Error(`Invalid permissions: ${invalidPermissions.join(', ')}`);
      }
    }

    const filter: any = { id: keyId, tenantId };
    if (userId) {
      filter.userId = userId;
    }

    const updateData: any = {
      ...updates,
      updatedAt: new Date(),
    };

    // permissions字段现在直接存储为对象，无需JSON.stringify

    // 验证API密钥存在性
    const existingKey = await findApiKeyById(keyId);
    if (!existingKey || (existingKey as any).tenantId !== tenantId || (userId && existingKey.userId !== userId)) {
      throw new Error('API key not found');
    }

    // 使用Sequelize模型更新
    const model = await mainConnection.getModel(DataBaseTableNames.ApiKey);
    const [affectedRows] = await model.update(updateData, {
      where: { id: keyId, tenantId, ...(userId ? { userId } : {}) },
    });

    if (affectedRows === 0) {
      throw new Error('API key not found');
    }

    // 记录更新事件
    await ctx.emit('api_key.updated', {
      keyId,
      tenantId,
      userId,
      updates,
      timestamp: Date.now(),
    });

    ctx.service?.logger?.info(`API key updated: ${keyId}`);

    return { success: true };
  } catch (error) {
    ctx.service?.logger?.error('Failed to update API key:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 删除API密钥
 */
export async function deleteApiKey(
  ctx: Context,
  params: {
    keyId: string;
    tenantId: string;
    userId?: string;
  },
): Promise<{ success: boolean; error?: string }> {
  try {
    const { keyId, tenantId, userId } = params;

    const filter: any = { id: keyId, tenantId };
    if (userId) {
      filter.userId = userId;
    }

    // 验证API密钥存在性
    const existingKey = await findApiKeyById(keyId);
    if (!existingKey || (existingKey as any).tenantId !== tenantId || (userId && existingKey.userId !== userId)) {
      throw new Error('API key not found');
    }

    // 软删除：标记为非活跃
    const model = await mainConnection.getModel(DataBaseTableNames.ApiKey);
    const [affectedRows] = await model.update(
      { isActive: false, updatedAt: new Date() },
      { where: { id: keyId, tenantId, ...(userId ? { userId } : {}) } },
    );
    if (affectedRows === 0) {
      throw new Error('Failed to delete API key');
    }

    // 清除缓存 (如果有缓存机制的话)
    // TODO: 实现缓存清除逻辑

    // 记录删除事件
    await ctx.emit('api_key.deleted', {
      keyId,
      tenantId,
      userId,
      timestamp: Date.now(),
    });

    ctx.service?.logger?.info(`API key deleted: ${keyId}`);

    return { success: true };
  } catch (error) {
    ctx.service?.logger?.error('Failed to delete API key:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 重新生成API密钥
 */
export async function regenerateApiKey(
  ctx: Context,
  params: {
    keyId: string;
    tenantId: string;
    userId?: string;
  },
): Promise<{
  success: boolean;
  newKey?: string;
  error?: string;
}> {
  try {
    const { keyId, tenantId, userId } = params;

    const filter: any = { id: keyId, tenantId };
    if (userId) {
      filter.userId = userId;
    }

    // 检查API密钥是否存在
    const existingKey = await findApiKeyById(keyId);

    if (
      !existingKey ||
      (existingKey as any).tenantId !== tenantId ||
      (userId && existingKey.userId !== userId)
    ) {
      throw new Error('API key not found');
    }

    // 生成新的密钥
    const newKeySecret = generateApiKeySecret();
    const newHashedKey = hashApiKey(newKeySecret);

    // 更新数据库
    const model = await mainConnection.getModel(DataBaseTableNames.ApiKey);
    await model.update(
      {
        keyHash: newHashedKey,
        updatedAt: new Date(),
        lastUsedAt: null,
      },
      { where: { id: keyId } },
    );

    // 清除缓存 (如果有缓存机制的话)
    // TODO: 实现缓存清除逻辑

    // 记录重新生成事件
    await ctx.emit('api_key.regenerated', {
      keyId,
      tenantId,
      userId,
      timestamp: Date.now(),
    });

    ctx.service?.logger?.info(`API key regenerated: ${keyId}`);

    return {
      success: true,
      newKey: newKeySecret,
    };
  } catch (error) {
    ctx.service?.logger?.error('Failed to regenerate API key:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 验证API密钥
 */
export async function validateApiKey(
  ctx: Context,
  params: {
    apiKey: string;
    tenantId: string;
    requiredPermission?: ApiPermission;
    clientIp?: string;
  },
): Promise<{
  isValid: boolean;
  keyId?: string;
  permissions?: ApiPermission[];
  error?: string;
}> {
  try {
    const { apiKey, tenantId, requiredPermission, clientIp } = params;

    // 哈希输入的API密钥
    const hashedKey = hashApiKey(apiKey);

    // 查找API密钥
    const keyData = await findApiKeyByKey(hashedKey);
    if (!keyData || !keyData.isActive) {
      return {
        isValid: false,
        error: 'Invalid API key',
      };
    }

    // 检查过期时间
    if (keyData.expiresAt && keyData.expiresAt < new Date()) {
      return {
        isValid: false,
        error: 'API key has expired',
      };
    }

    // 检查租户
    if ((keyData as any).tenantId && (keyData as any).tenantId !== tenantId) {
      return {
        isValid: false,
        error: 'API key not valid for this tenant',
      };
    }

    const permissions = keyData.permissions
      ? (Object.keys(keyData.permissions) as ApiPermission[])
      : [];

    // 检查特定权限
    if (requiredPermission && !permissions.includes(requiredPermission)) {
      return {
        isValid: false,
        error: `Missing required permission: ${requiredPermission}`,
      };
    }

    await updateApiKeyLastUsed(keyData.id);
    await updateApiKeyStats(keyData.id, 1);

    return {
      isValid: true,
      keyId: keyData.id,
      permissions,
    };
  } catch (error) {
    ctx.service?.logger?.error('Failed to validate API key:', error);
    return {
      isValid: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 获取API密钥使用统计
 */
export async function getApiKeyUsageStats(
  ctx: Context,
  params: {
    keyId?: string;
    tenantId: string;
    userId?: string;
    timeRange?: string;
  },
): Promise<{
  stats: Array<{
    keyId: string;
    keyName: string;
    usageCount: number;
    lastUsedAt?: Date;
    dailyUsage: Array<{ date: string; count: number }>;
  }>;
}> {
  try {
    const { keyId, tenantId, userId, timeRange = '7d' } = params;

    const filter: any = { tenantId, isActive: true };
    if (keyId) {
      filter.id = keyId;
    }
    if (userId) {
      filter.userId = userId;
    }

    let apiKeys: ApiKeyAttributes[];
    if (keyId) {
      const singleKey = await findApiKeyById(keyId);
      apiKeys =
        singleKey &&
        (singleKey as any).tenantId === tenantId &&
        (!userId || singleKey.userId === userId)
          ? [singleKey as ApiKeyAttributes]
          : [];
    } else if (userId) {
      apiKeys = (await findApiKeysByUserId(userId)) as ApiKeyAttributes[];
      apiKeys = apiKeys.filter((key) => (key as any).tenantId === tenantId);
    } else {
      apiKeys = (await findApiKeysByTenantId(tenantId)) as ApiKeyAttributes[];
    }

    // 过滤活跃状态
    apiKeys = apiKeys.filter((key) => key.isActive);

    const stats: Array<{
      keyId: string;
      keyName: string;
      usageCount: number;
      lastUsedAt?: Date;
      dailyUsage: Array<{ date: string; count: number }>;
    }> = [];

    for (const key of apiKeys) {
      // 获取每日使用统计
      const dailyUsage = await getApiKeyDailyUsage(ctx, key.id, timeRange);
      const totalStats = await getApiKeyTotalStats(key.id);

      stats.push({
        keyId: key.id,
        keyName: key.keyName,
        usageCount: totalStats.totalRequests || 0,
        lastUsedAt: key.lastUsedAt,
        dailyUsage,
      });
    }

    return { stats };
  } catch (error) {
    ctx.service?.logger?.error('Failed to get API key usage stats:', error);
    throw error;
  }
}

/**
 * 清理过期的API密钥
 */
export async function cleanupExpiredApiKeys(
  ctx: Context,
): Promise<{ success: boolean; cleanedCount: number }> {
  try {
    const now = new Date();

    const model = await mainConnection.getModel(DataBaseTableNames.ApiKey);
    const { Op } = mainConnection.Sequelize;
    const [affectedRows] = await model.update(
      {
        isActive: false,
        updatedAt: now,
      },
      {
        where: {
          isActive: true,
          expiresAt: {
            [Op.lt]: now,
          },
        },
      },
    );

    if (affectedRows > 0) {
      ctx.service?.logger?.info(`Cleaned up ${affectedRows} expired API keys`);
    }

    return {
      success: true,
      cleanedCount: affectedRows,
    };
  } catch (error) {
    ctx.service?.logger?.error('Failed to cleanup expired API keys:', error);
    return {
      success: false,
      cleanedCount: 0,
    };
  }
}

/**
 * 获取API密钥每日使用统计
 */
async function getApiKeyDailyUsage(
  ctx: Context,
  keyId: string,
  timeRange: string,
): Promise<Array<{ date: string; count: number }>> {
  try {
    const now = new Date();
    const normalizedRange = String(timeRange || '7d');
    const days = normalizedRange.endsWith('d') ? Number(normalizedRange.replace('d', '')) || 7 : 7;
    const start = new Date(now);
    start.setDate(start.getDate() - Math.max(days - 1, 0));
    start.setHours(0, 0, 0, 0);

    const stats = await getApiKeyStats(
      keyId,
      start.toISOString().split('T')[0],
      now.toISOString().split('T')[0],
    );

    return stats.map((item) => ({
      date: new Date(item.date).toISOString().split('T')[0],
      count: Number(item.requestCount) || 0,
    }));
  } catch (error) {
    ctx.service?.logger?.error('Failed to get daily usage:', error);
    return [];
  }
}
