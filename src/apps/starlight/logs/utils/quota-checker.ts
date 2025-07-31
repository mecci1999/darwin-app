/**
 * 配额检查器工具类
 * 负责SaaS化的配额管理和限制检查
 */

import { DEFAULT_QUOTAS, API_RATE_LIMIT } from '../constants';
import { TenantConfig, ApiKey } from '../types';

export interface QuotaUsage {
  logsPerMinute: number;
  storageUsed: number; // GB
  searchRequestsToday: number;
  exportRequestsToday: number;
  lastUpdated: string;
}

export interface QuotaLimits {
  logsPerMinute: number;
  storageGB: number;
  retentionDays: number;
  searchRequestsPerDay: number;
  exportRequestsPerDay: number;
}

export interface QuotaCheckResult {
  allowed: boolean;
  quotaType: string;
  current: number;
  limit: number;
  remaining: number;
  resetTime?: string;
  reason?: string;
}

export class QuotaChecker {
  private usageCache: Map<string, QuotaUsage> = new Map();
  private limitsCache: Map<string, QuotaLimits> = new Map();
  private rateLimitCache: Map<string, { count: number; resetTime: number }> = new Map();

  constructor(private logger?: any) {}

  /**
   * 检查日志摄取配额
   */
  async checkIngestQuota(tenantId: string, logCount: number = 1): Promise<QuotaCheckResult> {
    try {
      const usage = await this.getUsage(tenantId);
      const limits = await this.getLimits(tenantId);

      const current = usage.logsPerMinute;
      const limit = limits.logsPerMinute;
      const remaining = Math.max(0, limit - current);

      const allowed = current + logCount <= limit;

      if (allowed) {
        // 更新使用量
        await this.updateUsage(tenantId, 'logsPerMinute', logCount);
      }

      return {
        allowed,
        quotaType: 'logsPerMinute',
        current: current + (allowed ? logCount : 0),
        limit,
        remaining: remaining - (allowed ? logCount : 0),
        resetTime: this.getNextMinuteReset(),
        reason: allowed ? undefined : `日志摄取速率超过限制 (${current + logCount}/${limit} 条/分钟)`,
      };
    } catch (error: any) {
      this.logger?.error('检查摄取配额失败', {
        error: error?.message || 'Unknown error',
        tenantId,
      });
      return {
        allowed: false,
        quotaType: 'logsPerMinute',
        current: 0,
        limit: 0,
        remaining: 0,
        reason: '检查摄取配额时发生错误',
      };
    }
  }

  /**
   * 检查搜索配额
   */
  async checkSearchQuota(tenantId: string): Promise<QuotaCheckResult> {
    try {
      const usage = await this.getUsage(tenantId);
      const limits = await this.getLimits(tenantId);

      const current = usage.searchRequestsToday;
      const limit = limits.searchRequestsPerDay;
      const remaining = Math.max(0, limit - current);

      const allowed = current < limit;

      if (allowed) {
        await this.updateUsage(tenantId, 'searchRequestsToday', 1);
      }

      return {
        allowed,
        quotaType: 'searchRequestsPerDay',
        current: current + (allowed ? 1 : 0),
        limit,
        remaining: remaining - (allowed ? 1 : 0),
        resetTime: this.getNextDayReset(),
        reason: allowed ? undefined : `搜索请求次数超过每日限制 (${current + 1}/${limit} 次/天)`,
      };
    } catch (error: any) {
      this.logger?.error('检查搜索配额失败', {
        error: error?.message || 'Unknown error',
        tenantId,
      });
      return {
        allowed: false,
        quotaType: 'searchRequestsPerDay',
        current: 0,
        limit: 0,
        remaining: 0,
        reason: '检查搜索配额时发生错误',
      };
    }
  }

  /**
   * 检查导出配额
   */
  async checkExportQuota(tenantId: string): Promise<QuotaCheckResult> {
    try {
      const usage = await this.getUsage(tenantId);
      const limits = await this.getLimits(tenantId);

      const current = usage.exportRequestsToday;
      const limit = limits.exportRequestsPerDay;
      const remaining = Math.max(0, limit - current);

      const allowed = current < limit;

      if (allowed) {
        await this.updateUsage(tenantId, 'exportRequestsToday', 1);
      }

      return {
        allowed,
        quotaType: 'exportRequestsPerDay',
        current: current + (allowed ? 1 : 0),
        limit,
        remaining: remaining - (allowed ? 1 : 0),
        resetTime: this.getNextDayReset(),
        reason: allowed ? undefined : `导出请求次数超过每日限制 (${current + 1}/${limit} 次/天)`,
      };
    } catch (error: any) {
      this.logger?.error('检查导出配额失败', {
        error: error?.message || 'Unknown error',
        tenantId,
      });
      return {
        allowed: false,
        quotaType: 'exportRequestsPerDay',
        current: 0,
        limit: 0,
        remaining: 0,
        reason: '检查导出配额时发生错误',
      };
    }
  }

  /**
   * 检查存储配额
   */
  async checkStorageQuota(
    tenantId: string,
    additionalSizeGB: number = 0,
  ): Promise<QuotaCheckResult> {
    try {
      const usage = await this.getUsage(tenantId);
      const limits = await this.getLimits(tenantId);

      const current = usage.storageUsed;
      const limit = limits.storageGB;
      const remaining = Math.max(0, limit - current);

      const allowed = current + additionalSizeGB <= limit;

      return {
        allowed,
        quotaType: 'storageGB',
        current,
        limit,
        remaining,
        reason: allowed ? undefined : `存储使用量超过限制 (${current + additionalSizeGB}/${limit} GB)`,
      };
    } catch (error: any) {
      this.logger?.error('检查存储配额失败', {
        error: error?.message || 'Unknown error',
        tenantId,
      });
      return {
        allowed: false,
        quotaType: 'storageGB',
        current: 0,
        limit: 0,
        remaining: 0,
        reason: '检查存储配额时发生错误',
      };
    }
  }

  /**
   * 检查API速率限制
   */
  async checkRateLimit(
    tenantId: string,
    apiType: keyof typeof API_RATE_LIMIT,
  ): Promise<QuotaCheckResult> {
    try {
      const key = `${tenantId}:${apiType}`;
      const now = Date.now();
      const windowMs = 60 * 1000; // 1分钟窗口

      let rateData = this.rateLimitCache.get(key);

      // 如果没有数据或窗口已过期，重置
      if (!rateData || now >= rateData.resetTime) {
        rateData = {
          count: 0,
          resetTime: now + windowMs,
        };
      }

      const limit = API_RATE_LIMIT[apiType];
      const current = rateData.count;
      const remaining = Math.max(0, limit - current);
      const allowed = current < limit;

      if (allowed) {
        rateData.count++;
        this.rateLimitCache.set(key, rateData);
      }

      return {
        allowed,
        quotaType: `rateLimit_${apiType}`,
        current: current + (allowed ? 1 : 0),
        limit,
        remaining: remaining - (allowed ? 1 : 0),
        resetTime: new Date(rateData.resetTime).toISOString(),
        reason: allowed ? undefined : `API调用频率超过限制 (${current + 1}/${limit} 次/分钟)`,
      };
    } catch (error: any) {
      this.logger?.error('检查速率限制失败', {
        error: error?.message || 'Unknown error',
        tenantId,
        apiType,
      });
      return {
        allowed: false,
        quotaType: `rateLimit_${apiType}`,
        current: 0,
        limit: 0,
        remaining: 0,
        reason: '检查速率限制时发生错误',
      };
    }
  }

  /**
   * 获取租户使用量
   */
  private async getUsage(tenantId: string): Promise<QuotaUsage> {
    const cached = this.usageCache.get(tenantId);

    // 如果缓存存在且未过期（5分钟）
    if (cached && Date.now() - new Date(cached.lastUpdated).getTime() < 5 * 60 * 1000) {
      return cached;
    }

    // 从数据源获取使用量（这里简化为默认值）
    const usage: QuotaUsage = {
      logsPerMinute: 0,
      storageUsed: 0,
      searchRequestsToday: 0,
      exportRequestsToday: 0,
      lastUpdated: new Date().toISOString(),
    };

    // 实际实现中应该从数据库或缓存中获取真实数据
    // const usage = await this.fetchUsageFromDatabase(tenantId);

    this.usageCache.set(tenantId, usage);
    return usage;
  }

  /**
   * 获取租户限制
   */
  private async getLimits(tenantId: string): Promise<QuotaLimits> {
    const cached = this.limitsCache.get(tenantId);

    if (cached) {
      return cached;
    }

    // 从数据源获取限制（这里简化为默认值）
    const limits: QuotaLimits = {
      logsPerMinute: DEFAULT_QUOTAS.LOGS_PER_MINUTE,
      storageGB: DEFAULT_QUOTAS.STORAGE_GB,
      retentionDays: DEFAULT_QUOTAS.RETENTION_DAYS,
      searchRequestsPerDay: DEFAULT_QUOTAS.SEARCH_REQUESTS_PER_DAY,
      exportRequestsPerDay: DEFAULT_QUOTAS.EXPORT_REQUESTS_PER_DAY,
    };

    // 实际实现中应该从数据库获取租户的具体配额
    // const limits = await this.fetchLimitsFromDatabase(tenantId);

    this.limitsCache.set(tenantId, limits);
    return limits;
  }

  /**
   * 更新使用量
   */
  private async updateUsage(
    tenantId: string,
    type: keyof QuotaUsage,
    increment: number,
  ): Promise<void> {
    try {
      const usage = await this.getUsage(tenantId);

      if (
        type === 'logsPerMinute' ||
        type === 'searchRequestsToday' ||
        type === 'exportRequestsToday'
      ) {
        (usage[type] as number) += increment;
      } else if (type === 'storageUsed') {
        usage.storageUsed += increment;
      }

      usage.lastUpdated = new Date().toISOString();
      this.usageCache.set(tenantId, usage);

      // 实际实现中应该持久化到数据库
      // await this.persistUsageToDatabase(tenantId, usage);
    } catch (error: any) {
      this.logger?.error('更新使用量失败', {
        error: error?.message || 'Unknown error',
        tenantId,
        type,
        increment,
      });
    }
  }

  /**
   * 获取下一分钟重置时间
   */
  private getNextMinuteReset(): string {
    const now = new Date();
    const nextMinute = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      now.getMinutes() + 1,
      0,
      0,
    );
    return nextMinute.toISOString();
  }

  /**
   * 获取下一天重置时间
   */
  private getNextDayReset(): string {
    const now = new Date();
    const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
    return nextDay.toISOString();
  }

  /**
   * 更新搜索使用量
   */
  async updateSearchUsage(tenantId: string, amount: number = 1): Promise<void> {
    try {
      await this.updateUsage(tenantId, 'searchRequestsToday', amount);
    } catch (error: any) {
      this.logger?.error('更新搜索使用量失败', {
        error: error?.message || 'Unknown error',
        tenantId,
        amount,
      });
    }
  }

  /**
   * 获取配额状态
   */
  async getQuotaStatus(tenantId: string): Promise<{
    usage: QuotaUsage;
    limits: QuotaLimits;
    warnings: string[];
  }> {
    try {
      const usage = await this.getUsage(tenantId);
      const limits = await this.getLimits(tenantId);
      const warnings: string[] = [];

      // 检查各种配额警告
      if (usage.logsPerMinute > limits.logsPerMinute * 0.8) {
        warnings.push('日志摄取速率接近限制');
      }

      if (usage.storageUsed > limits.storageGB * 0.8) {
        warnings.push('存储使用量接近限制');
      }

      if (usage.searchRequestsToday > limits.searchRequestsPerDay * 0.8) {
        warnings.push('搜索请求次数接近每日限制');
      }

      if (usage.exportRequestsToday > limits.exportRequestsPerDay * 0.8) {
        warnings.push('导出请求次数接近每日限制');
      }

      return { usage, limits, warnings };
    } catch (error: any) {
      this.logger?.error('获取配额状态失败', {
        error: error?.message || 'Unknown error',
        tenantId,
      });
      throw error;
    }
  }

  /**
   * 重置每日配额
   */
  async resetDailyQuotas(tenantId: string): Promise<void> {
    try {
      const usage = await this.getUsage(tenantId);
      usage.searchRequestsToday = 0;
      usage.exportRequestsToday = 0;
      usage.lastUpdated = new Date().toISOString();

      this.usageCache.set(tenantId, usage);

      // 实际实现中应该持久化到数据库
      // await this.persistUsageToDatabase(tenantId, usage);

      this.logger?.info('每日配额已重置', { tenantId });
    } catch (error: any) {
      this.logger?.error('重置每日配额失败', {
        error: error?.message || 'Unknown error',
        tenantId,
      });
      throw error;
    }
  }

  /**
   * 重置每分钟配额
   */
  async resetMinuteQuotas(tenantId: string): Promise<void> {
    try {
      const usage = await this.getUsage(tenantId);
      usage.logsPerMinute = 0;
      usage.lastUpdated = new Date().toISOString();

      this.usageCache.set(tenantId, usage);

      this.logger?.debug('每分钟配额已重置', { tenantId });
    } catch (error: any) {
      this.logger?.error('重置每分钟配额失败', {
        error: error?.message || 'Unknown error',
        tenantId,
      });
    }
  }

  /**
   * 清理过期的缓存
   */
  cleanupExpiredCache(): void {
    const now = Date.now();

    // 清理速率限制缓存
    for (const [key, data] of this.rateLimitCache.entries()) {
      if (now >= data.resetTime) {
        this.rateLimitCache.delete(key);
      }
    }

    // 清理使用量缓存（超过1小时的）
    for (const [key, usage] of this.usageCache.entries()) {
      if (now - new Date(usage.lastUpdated).getTime() > 60 * 60 * 1000) {
        this.usageCache.delete(key);
      }
    }
  }

  /**
   * 设置租户配额限制
   */
  async setTenantLimits(tenantId: string, limits: Partial<QuotaLimits>): Promise<void> {
    try {
      const currentLimits = await this.getLimits(tenantId);
      const newLimits = { ...currentLimits, ...limits };

      this.limitsCache.set(tenantId, newLimits);

      // 实际实现中应该持久化到数据库
      // await this.persistLimitsToDatabase(tenantId, newLimits);

      this.logger?.info('租户配额限制已更新', { tenantId, limits });
    } catch (error: any) {
      this.logger?.error('设置租户配额限制失败', {
        error: error?.message || 'Unknown error',
        tenantId,
        limits,
      });
      throw error;
    }
  }
}

// 导出单例实例
export const quotaChecker = new QuotaChecker();
