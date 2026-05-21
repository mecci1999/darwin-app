import crypto from 'crypto';
import { findApiKeyByKey, updateApiKeyLastUsed, updateApiKeyStats } from 'db/mysql/apis/apiKey';
import { ApiKey, ApiPermission, CreateApiKeyRequest } from '../types';

// 简单的内存存储，生产环境应使用数据库
const apiKeys = new Map<string, ApiKey>();
const keysByTenant = new Map<string, Set<string>>();

export class ApiKeyManager {
  private static instance: ApiKeyManager;
  private constructor() {}
  static getInstance(): ApiKeyManager {
    if (!ApiKeyManager.instance) {
      ApiKeyManager.instance = new ApiKeyManager();
    }
    return ApiKeyManager.instance;
  }
  // 创建API密钥
  async createApiKey(request: CreateApiKeyRequest, tenantId: string = 'default'): Promise<ApiKey> {
    const id = crypto.randomUUID();
    const key = this.generateApiKey();
    
    const apiKey: ApiKey = {
      id,
      name: request.name,
      description: request.description,
      key,
      permissions: request.permissions || [ApiPermission.INGEST, ApiPermission.SEARCH],
      tenantId,
      userId: '', // 需要从参数中获取
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isActive: true
    };

    // 存储API密钥
    apiKeys.set(key, apiKey);
    
    // 按租户索引
    if (!keysByTenant.has(tenantId)) {
      keysByTenant.set(tenantId, new Set());
    }
    keysByTenant.get(tenantId)!.add(key);

    return apiKey;
  }

  // 验证API密钥
  async validateApiKey(key: string): Promise<ApiKey | null> {
    const keyHash = crypto.createHash('sha256').update(key).digest('hex');
    const dbKey = await findApiKeyByKey(keyHash);

    if (dbKey?.isActive) {
      await updateApiKeyLastUsed(dbKey.id);
      await updateApiKeyStats(dbKey.id, 1);

      const tenantId = (dbKey as any).tenantId || 'default';

      return {
        id: dbKey.id,
        name: dbKey.keyName,
        description: '',
        key,
        tenantId,
        userId: dbKey.userId,
        permissions: dbKey.permissions
          ? (Object.keys(dbKey.permissions) as ApiPermission[])
          : [ApiPermission.INGEST, ApiPermission.SEARCH],
        isActive: dbKey.isActive,
        lastUsedAt: Date.now(),
        createdAt: dbKey.createdAt ? new Date(dbKey.createdAt).getTime() : Date.now(),
        updatedAt: dbKey.updatedAt ? new Date(dbKey.updatedAt).getTime() : Date.now(),
        expiresAt: dbKey.expiresAt ? new Date(dbKey.expiresAt).getTime() : undefined,
      };
    }

    const memoryKey = apiKeys.get(key);

    if (memoryKey?.isActive) {
      memoryKey.lastUsedAt = Date.now();
      return memoryKey;
    }

    return null;
  }

  // 检查权限
  hasPermission(apiKey: ApiKey, permission: ApiPermission): boolean {
    return apiKey.permissions.includes(permission);
  }

  // 获取租户的所有API密钥
  async getApiKeysByTenant(tenantId: string): Promise<ApiKey[]> {
    const tenantKeys = keysByTenant.get(tenantId);
    if (!tenantKeys) {
      return [];
    }

    const keys: ApiKey[] = [];
    for (const key of tenantKeys) {
      const apiKey = apiKeys.get(key);
      if (apiKey) {
        // 返回时隐藏实际密钥
        keys.push({
          ...apiKey,
          key: this.maskApiKey(apiKey.key)
        });
      }
    }

    return keys;
  }

  // 禁用API密钥
  async revokeApiKey(keyId: string, tenantId: string): Promise<boolean> {
    for (const [key, apiKey] of apiKeys.entries()) {
      if (apiKey.id === keyId && apiKey.tenantId === tenantId) {
        apiKey.isActive = false;
        return true;
      }
    }
    return false;
  }

  // 删除API密钥
  async deleteApiKey(keyId: string, tenantId: string): Promise<boolean> {
    for (const [key, apiKey] of apiKeys.entries()) {
      if (apiKey.id === keyId && apiKey.tenantId === tenantId) {
        apiKeys.delete(key);
        keysByTenant.get(tenantId)?.delete(key);
        return true;
      }
    }
    return false;
  }

  // 生成API密钥
  private generateApiKey(): string {
    const prefix = 'dk_'; // darwin-key prefix
    const randomBytes = crypto.randomBytes(32);
    const key = randomBytes.toString('hex');
    return `${prefix}${key}`;
  }

  // 掩码API密钥（用于显示）
  private maskApiKey(key: string): string {
    if (key.length <= 8) return key;
    const start = key.substring(0, 8);
    const end = key.substring(key.length - 4);
    return `${start}${'*'.repeat(key.length - 12)}${end}`;
  }

  // 获取API密钥统计
  async getApiKeyStats(tenantId: string): Promise<{
    total: number;
    active: number;
    inactive: number;
    recentlyUsed: number;
  }> {
    const tenantKeys = keysByTenant.get(tenantId);
    if (!tenantKeys) {
      return { total: 0, active: 0, inactive: 0, recentlyUsed: 0 };
    }

    let total = 0;
    let active = 0;
    let inactive = 0;
    let recentlyUsed = 0;

    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    for (const key of tenantKeys) {
      const apiKey = apiKeys.get(key);
      if (apiKey) {
        total++;
        if (apiKey.isActive) {
          active++;
        } else {
          inactive++;
        }
        if (apiKey.lastUsedAt && apiKey.lastUsedAt > oneDayAgo) {
          recentlyUsed++;
        }
      }
    }

    return { total, active, inactive, recentlyUsed };
  }

  // 清理过期的API密钥（可选功能）
  async cleanupExpiredKeys(): Promise<number> {
    // 这里可以实现清理逻辑，比如删除长时间未使用的密钥
    // 目前返回0表示没有清理任何密钥
    return 0;
  }

  // 初始化默认API密钥（用于开发测试）
  async initializeDefaultKeys(): Promise<void> {
    // 检查是否已有默认密钥
    const defaultTenantKeys = keysByTenant.get('default');
    if (defaultTenantKeys && defaultTenantKeys.size > 0) {
      return;
    }

    // 创建默认的开发密钥
    await this.createApiKey({
      name: 'Development Key',
      description: '默认开发环境API密钥',
      permissions: [ApiPermission.INGEST, ApiPermission.SEARCH, ApiPermission.EXPORT, ApiPermission.STATS]
    }, 'default');

    console.log('已创建默认API密钥');
  }
}

// 中间件：验证API密钥
export async function validateApiKeyMiddleware(ctx: any, next: any) {
  const apiKey = ctx.params.apiKey;
  
  if (!apiKey) {
    throw new Error('缺少API密钥');
  }

  const validatedKey = await ApiKeyManager.getInstance().validateApiKey(apiKey);
  if (!validatedKey) {
    throw new Error('无效的API密钥');
  }

  // 将验证后的API密钥信息添加到上下文
  ctx.meta.apiKey = validatedKey;
  ctx.meta.tenantId = validatedKey.tenantId;

  await next();
}

// 中间件：检查权限
export function requirePermission(permission: ApiPermission) {
  return async function(ctx: any, next: any) {
    const apiKey = ctx.meta.apiKey;
    
    if (!apiKey) {
      throw new Error('未找到API密钥信息');
    }

    if (!ApiKeyManager.getInstance().hasPermission(apiKey, permission)) {
      throw new Error(`缺少权限: ${permission}`);
    }

    await next();
  };
}
