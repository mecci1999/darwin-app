// User微服务缓存处理工具类
import { UserInfo, UserProfile, UserStats, CacheConfig } from '../types';
import { CACHE_CONFIG, REDIS_CONFIG } from '../constants';

class CacheHandler {
  private static instance: CacheHandler;
  private redisClient: any;
  private localCache: Map<string, { data: any; expiry: number }> = new Map();
  private cleanupTimer?: NodeJS.Timeout;

  static getInstance(): CacheHandler {
    if (!CacheHandler.instance) {
      CacheHandler.instance = new CacheHandler();
    }
    return CacheHandler.instance;
  }

  /**
   * 初始化缓存处理器
   */
  async initialize(redisClient?: any): Promise<void> {
    this.redisClient = redisClient;
    
    // 启动本地缓存清理定时器
    this.startCleanupTimer();
  }

  /**
   * 启动缓存清理定时器
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredCache();
    }, 60000); // 每分钟清理一次过期缓存
  }

  /**
   * 清理过期的本地缓存
   */
  private cleanupExpiredCache(): void {
    const now = Date.now();
    for (const [key, value] of this.localCache.entries()) {
      if (value.expiry < now) {
        this.localCache.delete(key);
      }
    }
  }

  /**
   * 生成缓存键
   */
  private generateKey(type: string, identifier: string): string {
    return `${REDIS_CONFIG.KEY_PREFIX}${type}:${identifier}`;
  }

  /**
   * 设置用户信息缓存
   */
  async setUserInfo(userId: string, userInfo: UserInfo): Promise<void> {
    const key = this.generateKey('info', userId);
    const data = JSON.stringify(userInfo);
    
    // Redis缓存
    if (this.redisClient) {
      try {
        await this.redisClient.setex(key, CACHE_CONFIG.USER_INFO_TTL, data);
      } catch (error) {
        console.error('Failed to set user info in Redis:', error);
      }
    }
    
    // 本地缓存作为备份
    this.localCache.set(key, {
      data: userInfo,
      expiry: Date.now() + (CACHE_CONFIG.USER_INFO_TTL * 1000)
    });
  }

  /**
   * 获取用户信息缓存
   */
  async getUserInfo(userId: string): Promise<UserInfo | null> {
    const key = this.generateKey('info', userId);
    
    // 先尝试从Redis获取
    if (this.redisClient) {
      try {
        const data = await this.redisClient.get(key);
        if (data) {
          return JSON.parse(data);
        }
      } catch (error) {
        console.error('Failed to get user info from Redis:', error);
      }
    }
    
    // 从本地缓存获取
    const localData = this.localCache.get(key);
    if (localData && localData.expiry > Date.now()) {
      return localData.data;
    }
    
    return null;
  }

  /**
   * 设置用户资料缓存
   */
  async setUserProfile(userId: string, profile: UserProfile): Promise<void> {
    const key = this.generateKey('profile', userId);
    const data = JSON.stringify(profile);
    
    if (this.redisClient) {
      try {
        await this.redisClient.setex(key, CACHE_CONFIG.USER_PROFILE_TTL, data);
      } catch (error) {
        console.error('Failed to set user profile in Redis:', error);
      }
    }
    
    this.localCache.set(key, {
      data: profile,
      expiry: Date.now() + (CACHE_CONFIG.USER_PROFILE_TTL * 1000)
    });
  }

  /**
   * 获取用户资料缓存
   */
  async getUserProfile(userId: string): Promise<UserProfile | null> {
    const key = this.generateKey('profile', userId);
    
    if (this.redisClient) {
      try {
        const data = await this.redisClient.get(key);
        if (data) {
          return JSON.parse(data);
        }
      } catch (error) {
        console.error('Failed to get user profile from Redis:', error);
      }
    }
    
    const localData = this.localCache.get(key);
    if (localData && localData.expiry > Date.now()) {
      return localData.data;
    }
    
    return null;
  }

  /**
   * 设置用户统计缓存
   */
  async setUserStats(userId: string, stats: UserStats): Promise<void> {
    const key = this.generateKey('stats', userId);
    const data = JSON.stringify(stats);
    
    if (this.redisClient) {
      try {
        await this.redisClient.setex(key, CACHE_CONFIG.USER_STATS_TTL, data);
      } catch (error) {
        console.error('Failed to set user stats in Redis:', error);
      }
    }
    
    this.localCache.set(key, {
      data: stats,
      expiry: Date.now() + (CACHE_CONFIG.USER_STATS_TTL * 1000)
    });
  }

  /**
   * 获取用户统计缓存
   */
  async getUserStats(userId: string): Promise<UserStats | null> {
    const key = this.generateKey('stats', userId);
    
    if (this.redisClient) {
      try {
        const data = await this.redisClient.get(key);
        if (data) {
          return JSON.parse(data);
        }
      } catch (error) {
        console.error('Failed to get user stats from Redis:', error);
      }
    }
    
    const localData = this.localCache.get(key);
    if (localData && localData.expiry > Date.now()) {
      return localData.data;
    }
    
    return null;
  }

  /**
   * 删除用户相关缓存
   */
  async deleteUserCache(userId: string): Promise<void> {
    const keys = [
      this.generateKey('info', userId),
      this.generateKey('profile', userId),
      this.generateKey('stats', userId),
    ];
    
    // 删除Redis缓存
    if (this.redisClient) {
      try {
        await this.redisClient.del(...keys);
      } catch (error) {
        console.error('Failed to delete user cache from Redis:', error);
      }
    }
    
    // 删除本地缓存
    keys.forEach(key => this.localCache.delete(key));
  }

  /**
   * 批量删除缓存
   */
  async deleteCacheByPattern(pattern: string): Promise<void> {
    if (this.redisClient) {
      try {
        const keys = await this.redisClient.keys(`${REDIS_CONFIG.KEY_PREFIX}${pattern}`);
        if (keys.length > 0) {
          await this.redisClient.del(...keys);
        }
      } catch (error) {
        console.error('Failed to delete cache by pattern from Redis:', error);
      }
    }
    
    // 清理本地缓存中匹配的键
    const regex = new RegExp(pattern.replace('*', '.*'));
    for (const key of this.localCache.keys()) {
      if (regex.test(key)) {
        this.localCache.delete(key);
      }
    }
  }

  /**
   * 清空所有缓存
   */
  async clearAllCache(): Promise<void> {
    if (this.redisClient) {
      try {
        const keys = await this.redisClient.keys(`${REDIS_CONFIG.KEY_PREFIX}*`);
        if (keys.length > 0) {
          await this.redisClient.del(...keys);
        }
      } catch (error) {
        console.error('Failed to clear all cache from Redis:', error);
      }
    }
    
    this.localCache.clear();
  }

  /**
   * 获取缓存统计信息
   */
  getCacheStats(): { localCacheSize: number; redisConnected: boolean } {
    return {
      localCacheSize: this.localCache.size,
      redisConnected: !!this.redisClient,
    };
  }

  /**
   * 停止缓存处理器
   */
  async stop(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    
    this.localCache.clear();
    this.redisClient = null;
  }
}

export default CacheHandler;