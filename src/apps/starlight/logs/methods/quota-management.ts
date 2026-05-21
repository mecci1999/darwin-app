/**
 * 配额管理方法
 * 处理SaaS化的配额限制、使用量跟踪和配额策略
 */

import { Context } from 'node-universe';
import { Quota } from '../types';
import { QuotaChecker } from '../utils/quota-checker';
import { DEFAULT_QUOTAS, QUOTA_RESET_INTERVALS, QUOTA_WARNING_THRESHOLDS } from '../constants';

/**
 * 获取租户配额
 */
export async function getTenantQuota(
  ctx: Context,
  params: {
    tenantId: string;
    userId?: string;
  },
): Promise<{
  quota: Quota;
  usage: {
    logsPerMinute: number;
    searchRequestsToday: number;
    exportRequestsToday: number;
    storageUsed: number;
    streamConnections: number;
  };
  limits: {
    logsPerMinute: number;
    searchRequestsPerDay: number;
    exportRequestsPerDay: number;
    storageGB: number;
    maxStreamConnections: number;
  };
  resetTime: Date;
}> {
  try {
    const { tenantId, userId } = params;

    const quotaChecker = new QuotaChecker();
    const quota = await quotaChecker.getQuota(tenantId, userId);
    const usage = await quotaChecker.getUsage(tenantId);
    const limits = await quotaChecker.getLimits(tenantId);

    // 计算下次重置时间
    const resetTime = calculateNextResetTime(quota.resetInterval);

    return {
      quota,
      usage,
      limits,
      resetTime,
    };
  } catch (error) {
    ctx.service?.logger?.error('Failed to get tenant quota:', error);
    throw error;
  }
}

/**
 * 更新租户配额
 */
export async function updateTenantQuota(
  ctx: Context,
  params: {
    tenantId: string;
    userId?: string;
    quotaUpdates: Partial<{
      logsPerDay: number;
      searchesPerDay: number;
      exportsPerDay: number;
      maxStorageGB: number;
      maxStreamConnections: number;
      resetInterval: 'daily' | 'weekly' | 'monthly';
    }>;
  },
): Promise<{ success: boolean; error?: string }> {
  try {
    const { tenantId, userId, quotaUpdates } = params;

    // 验证配额值
    const validationResult = validateQuotaUpdates(quotaUpdates);
    if (!validationResult.isValid) {
      throw new Error(`Invalid quota updates: ${validationResult.errors.join(', ')}`);
    }

    const quotaChecker = new QuotaChecker();
    await quotaChecker.updateQuota(tenantId, userId, quotaUpdates);

    // 清除相关缓存
    await quotaChecker.clearCache(tenantId, userId);

    // 记录配额更新事件
    await ctx.emit('quota.updated', {
      tenantId,
      userId,
      updates: quotaUpdates,
      timestamp: Date.now(),
    });

    ctx.service?.logger?.info(
      `Quota updated for tenant ${tenantId}${userId ? ` user ${userId}` : ''}`,
    );

    return { success: true };
  } catch (error) {
    ctx.service?.logger?.error('Failed to update tenant quota:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 重置配额使用量
 */
export async function resetQuotaUsage(
  ctx: Context,
  params: {
    tenantId: string;
    userId?: string;
    resetType?: 'all' | 'ingestion' | 'search' | 'export' | 'storage' | 'stream';
  },
): Promise<{ success: boolean; error?: string }> {
  try {
    const { tenantId, userId, resetType = 'all' } = params;

    const quotaChecker = new QuotaChecker();
    await quotaChecker.resetUsage(tenantId, userId, resetType);

    // 记录重置事件
    await ctx.emit('quota.usage.reset', {
      tenantId,
      userId,
      resetType,
      timestamp: Date.now(),
    });

    ctx.service?.logger?.info(
      `Quota usage reset for tenant ${tenantId}${userId ? ` user ${userId}` : ''}: ${resetType}`,
    );

    return { success: true };
  } catch (error) {
    ctx.service?.logger?.error('Failed to reset quota usage:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 检查配额状态
 */
export async function checkQuotaStatus(
  ctx: Context,
  params: {
    tenantId: string;
    userId?: string;
    quotaType: 'ingestion' | 'search' | 'export' | 'storage' | 'stream';
    requestedAmount?: number;
  },
): Promise<{
  allowed: boolean;
  remaining: number;
  limit: number;
  usagePercentage: number;
  warningLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  resetTime: Date;
  reason?: string;
}> {
  try {
    const { tenantId, quotaType, requestedAmount = 1 } = params;

    const quotaChecker = new QuotaChecker();
    let quotaCheck;

    // 根据配额类型检查
    switch (quotaType) {
      case 'ingestion':
        quotaCheck = await quotaChecker.checkIngestQuota(tenantId, requestedAmount);
        break;
      case 'search':
        quotaCheck = await quotaChecker.checkSearchQuota(tenantId);
        break;
      case 'export':
        quotaCheck = await quotaChecker.checkExportQuota(tenantId);
        break;
      case 'storage':
        quotaCheck = await quotaChecker.checkStorageQuota(tenantId, requestedAmount);
        break;
      case 'stream':
        quotaCheck = await quotaChecker.checkStreamQuota(tenantId);
        break;
      default:
        throw new Error(`Invalid quota type: ${quotaType}`);
    }

    const usage = await quotaChecker.getUsage(tenantId);
    const limits = await quotaChecker.getLimits(tenantId);
    const quota = await quotaChecker.getQuota(tenantId);

    // 计算使用百分比和警告级别
    const { usagePercentage, warningLevel } = calculateUsageMetrics(quotaType, usage, limits);

    const resetTime = calculateNextResetTime(quota.resetInterval);

    return {
      allowed: quotaCheck.allowed,
      remaining: quotaCheck.remaining || 0,
      limit: quotaCheck.limit || 0,
      usagePercentage,
      warningLevel,
      resetTime,
      reason: quotaCheck.reason,
    };
  } catch (error) {
    ctx.service?.logger?.error('Failed to check quota status:', error);
    throw error;
  }
}

/**
 * 获取配额使用历史
 */
export async function getQuotaUsageHistory(
  ctx: Context,
  params: {
    tenantId: string;
    userId?: string;
    quotaType?: 'ingestion' | 'search' | 'export' | 'storage' | 'stream';
    timeRange?: string;
    interval?: 'hour' | 'day' | 'week';
  },
): Promise<{
  history: Array<{
    timestamp: Date;
    quotaType: string;
    usage: number;
    limit: number;
    percentage: number;
  }>;
  summary: {
    totalUsage: number;
    averageUsage: number;
    peakUsage: number;
    peakTimestamp: Date;
  };
}> {
  try {
    const { tenantId, userId, quotaType, timeRange = '7d', interval = 'day' } = params;

    const quotaChecker = new QuotaChecker();
    const history = await quotaChecker.getUsageHistory(
      tenantId,
      userId,
      quotaType,
      timeRange,
      interval,
    );

    // 计算摘要统计
    const totalUsage = history.reduce((sum, item) => sum + item.usage, 0);
    const averageUsage = history.length > 0 ? totalUsage / history.length : 0;
    const peakUsageItem = history.reduce(
      (max, item) => (item.usage > max.usage ? item : max),
      history[0] || { usage: 0, timestamp: new Date() },
    );

    return {
      history,
      summary: {
        totalUsage,
        averageUsage,
        peakUsage: peakUsageItem.usage,
        peakTimestamp: peakUsageItem.timestamp,
      },
    };
  } catch (error) {
    ctx.service?.logger?.error('Failed to get quota usage history:', error);
    throw error;
  }
}

/**
 * 设置配额警报
 */
export async function setQuotaAlert(
  ctx: Context,
  params: {
    tenantId: string;
    userId?: string;
    quotaType: 'ingestion' | 'search' | 'export' | 'storage' | 'stream';
    threshold: number; // 百分比 (0-100)
    alertType: 'email' | 'webhook' | 'both';
    alertTarget: string; // 邮箱地址或webhook URL
    isActive?: boolean;
  },
): Promise<{ success: boolean; alertId: string; error?: string }> {
  try {
    const {
      tenantId,
      userId,
      quotaType,
      threshold,
      alertType,
      alertTarget,
      isActive = true,
    } = params;

    // 验证阈值
    if (threshold < 0 || threshold > 100) {
      throw new Error('Threshold must be between 0 and 100');
    }

    // 验证警报目标
    if (alertType === 'email' && !isValidEmail(alertTarget)) {
      throw new Error('Invalid email address');
    }
    if (alertType === 'webhook' && !isValidUrl(alertTarget)) {
      throw new Error('Invalid webhook URL');
    }

    const alertId = `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 保存警报配置
    const db = (ctx.service as any)?.db;
    if (!db) {
      throw new Error('Database connection not available');
    }

    await db.collection('quota_alerts').insertOne({
      alertId,
      tenantId,
      userId,
      quotaType,
      threshold,
      alertType,
      alertTarget,
      isActive,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 记录警报创建事件
    await ctx.emit('quota.alert.created', {
      alertId,
      tenantId,
      userId,
      quotaType,
      threshold,
      timestamp: Date.now(),
    });

    ctx.service?.logger?.info(`Quota alert created: ${alertId}`);

    return {
      success: true,
      alertId,
    };
  } catch (error) {
    ctx.service?.logger?.error('Failed to set quota alert:', error);
    return {
      success: false,
      alertId: '',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 获取配额警报列表
 */
export async function getQuotaAlerts(
  ctx: Context,
  params: {
    tenantId: string;
    userId?: string;
    isActive?: boolean;
  },
): Promise<{
  alerts: Array<{
    alertId: string;
    quotaType: string;
    threshold: number;
    alertType: string;
    alertTarget: string;
    isActive: boolean;
    createdAt: Date;
    lastTriggered?: Date;
  }>;
}> {
  try {
    const { tenantId, userId, isActive } = params;

    const filter: any = { tenantId };
    if (userId) {
      filter.userId = userId;
    }
    if (isActive !== undefined) {
      filter.isActive = isActive;
    }

    const db = (ctx.service as any)?.db;
    if (!db) {
      throw new Error('Database connection not available');
    }

    const alerts = await db
      .collection('quota_alerts')
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    return {
      alerts: alerts.map((alert) => ({
        alertId: alert.alertId,
        quotaType: alert.quotaType,
        threshold: alert.threshold,
        alertType: alert.alertType,
        alertTarget: alert.alertTarget,
        isActive: alert.isActive,
        createdAt: alert.createdAt,
        lastTriggered: alert.lastTriggered,
      })),
    };
  } catch (error) {
    ctx.service?.logger?.error('Failed to get quota alerts:', error);
    throw error;
  }
}

/**
 * 删除配额警报
 */
export async function deleteQuotaAlert(
  ctx: Context,
  params: {
    alertId: string;
    tenantId: string;
    userId?: string;
  },
): Promise<{ success: boolean; error?: string }> {
  try {
    const { alertId, tenantId, userId } = params;

    const filter: any = { alertId, tenantId };
    if (userId) {
      filter.userId = userId;
    }

    const db = (ctx.service as any)?.db;
    if (!db) {
      throw new Error('Database connection not available');
    }

    const result = await db.collection('quota_alerts').deleteOne(filter);

    if (result.deletedCount === 0) {
      throw new Error('Quota alert not found');
    }

    // 记录删除事件
    await ctx.emit('quota.alert.deleted', {
      alertId,
      tenantId,
      userId,
      timestamp: Date.now(),
    });

    ctx.service?.logger?.info(`Quota alert deleted: ${alertId}`);

    return { success: true };
  } catch (error) {
    ctx.service?.logger?.error('Failed to delete quota alert:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 触发配额警报检查
 */
export async function checkQuotaAlerts(
  ctx: Context,
  params: {
    tenantId: string;
    userId?: string;
  },
): Promise<{ success: boolean; triggeredAlerts: number }> {
  try {
    const { tenantId, userId } = params;

    const quotaChecker = new QuotaChecker();
    const usage = await quotaChecker.getUsage(tenantId);
    const limits = await quotaChecker.getLimits(tenantId);

    // 获取活跃的警报
    const db = (ctx.service as any)?.db;
    if (!db) {
      throw new Error('Database connection not available');
    }

    const alerts = await db
      .collection('quota_alerts')
      .find({ tenantId, userId, isActive: true })
      .toArray();

    let triggeredAlerts = 0;

    for (const alert of alerts) {
      const { usagePercentage } = calculateUsageMetrics(alert.quotaType, usage, limits);

      if (usagePercentage >= alert.threshold) {
        // 触发警报
        await triggerQuotaAlert(ctx, alert, usagePercentage, usage, limits);
        triggeredAlerts++;

        // 更新最后触发时间
        await db
          .collection('quota_alerts')
          .updateOne({ alertId: alert.alertId }, { $set: { lastTriggered: new Date() } });
      }
    }

    return {
      success: true,
      triggeredAlerts,
    };
  } catch (error) {
    ctx.service?.logger?.error('Failed to check quota alerts:', error);
    return {
      success: false,
      triggeredAlerts: 0,
    };
  }
}

/**
 * 获取所有租户的配额摘要
 */
export async function getAllTenantsQuotaSummary(ctx: Context): Promise<{
  tenants: Array<{
    tenantId: string;
    totalUsage: {
      logsPerMinute: number;
      searchRequestsToday: number;
      exportRequestsToday: number;
      storageUsed: number;
    };
    limits: {
      logsPerMinute: number;
      searchRequestsPerDay: number;
      exportRequestsPerDay: number;
      storageGB: number;
    };
    usagePercentages: {
      ingestion: number;
      search: number;
      export: number;
      storage: number;
    };
    warningLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  }>;
}> {
  try {
    // 获取所有活跃租户
    const db = (ctx.service as any)?.db;
    if (!db) {
      throw new Error('Database connection not available');
    }

    const tenants = await db.collection('quotas').find({ isActive: true }).toArray();

    const quotaChecker = new QuotaChecker();
    const tenantSummaries: Array<{
      tenantId: string;
      totalUsage: {
        logsPerMinute: number;
        searchRequestsToday: number;
        exportRequestsToday: number;
        storageUsed: number;
      };
      limits: {
        logsPerMinute: number;
        searchRequestsPerDay: number;
        exportRequestsPerDay: number;
        storageGB: number;
      };
      usagePercentages: {
        ingestion: number;
        search: number;
        export: number;
        storage: number;
      };
      warningLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
    }> = [];

    for (const tenant of tenants) {
      const usage = await quotaChecker.getUsage(tenant.tenantId);
      const limits = await quotaChecker.getLimits(tenant.tenantId);

      const usagePercentages = {
        ingestion: (usage.logsPerMinute / limits.logsPerMinute) * 100,
        search: (usage.searchRequestsToday / limits.searchRequestsPerDay) * 100,
        export: (usage.exportRequestsToday / limits.exportRequestsPerDay) * 100,
        storage: (usage.storageUsed / limits.storageGB) * 100,
      };

      // 计算整体警告级别
      const maxUsagePercentage = Math.max(...Object.values(usagePercentages));
      const warningLevel = getWarningLevel(maxUsagePercentage);

      tenantSummaries.push({
        tenantId: tenant.tenantId,
        totalUsage: usage,
        limits,
        usagePercentages,
        warningLevel,
      });
    }

    return { tenants: tenantSummaries };
  } catch (error) {
    ctx.service?.logger?.error('Failed to get all tenants quota summary:', error);
    throw error;
  }
}

/**
 * 验证配额更新
 */
function validateQuotaUpdates(updates: any): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (updates.logsPerDay !== undefined && updates.logsPerDay < 0) {
    errors.push('Logs per day must be non-negative');
  }

  if (updates.searchesPerDay !== undefined && updates.searchesPerDay < 0) {
    errors.push('Searches per day must be non-negative');
  }

  if (updates.exportsPerDay !== undefined && updates.exportsPerDay < 0) {
    errors.push('Exports per day must be non-negative');
  }

  if (updates.maxStorageGB !== undefined && updates.maxStorageGB < 0) {
    errors.push('Max storage must be non-negative');
  }

  if (updates.maxStreamConnections !== undefined && updates.maxStreamConnections < 0) {
    errors.push('Max stream connections must be non-negative');
  }

  const resetIntervals = Object.values(QUOTA_RESET_INTERVALS);
  if (updates.resetInterval && !resetIntervals.includes(updates.resetInterval)) {
    errors.push(`Invalid reset interval: ${updates.resetInterval}`);
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * 计算使用指标
 */
function calculateUsageMetrics(
  quotaType: string,
  usage: any,
  limits: any,
): { usagePercentage: number; warningLevel: 'none' | 'low' | 'medium' | 'high' | 'critical' } {
  let usagePercentage = 0;

  switch (quotaType) {
    case 'ingestion':
      usagePercentage = (usage.logsPerMinute / limits.logsPerMinute) * 100;
      break;
    case 'search':
      usagePercentage = (usage.searchRequestsToday / limits.searchRequestsPerDay) * 100;
      break;
    case 'export':
      usagePercentage = (usage.exportRequestsToday / limits.exportRequestsPerDay) * 100;
      break;
    case 'storage':
      usagePercentage = (usage.storageUsed / limits.storageGB) * 100;
      break;
    case 'stream':
      usagePercentage = (usage.streamConnections / limits.maxStreamConnections) * 100;
      break;
  }

  const warningLevel = getWarningLevel(usagePercentage);

  return { usagePercentage, warningLevel };
}

/**
 * 获取警告级别
 */
function getWarningLevel(usagePercentage: number): 'none' | 'low' | 'medium' | 'high' | 'critical' {
  if (usagePercentage >= QUOTA_WARNING_THRESHOLDS.CRITICAL) {
    return 'critical';
  } else if (usagePercentage >= QUOTA_WARNING_THRESHOLDS.HIGH) {
    return 'high';
  } else if (usagePercentage >= QUOTA_WARNING_THRESHOLDS.MEDIUM) {
    return 'medium';
  } else if (usagePercentage >= QUOTA_WARNING_THRESHOLDS.LOW) {
    return 'low';
  }
  return 'none';
}

/**
 * 计算下次重置时间
 */
function calculateNextResetTime(resetInterval: string): Date {
  const now = new Date();

  switch (resetInterval) {
    case 'daily':
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      return tomorrow;

    case 'weekly':
      const nextWeek = new Date(now);
      nextWeek.setDate(nextWeek.getDate() + (7 - nextWeek.getDay()));
      nextWeek.setHours(0, 0, 0, 0);
      return nextWeek;

    case 'monthly':
      const nextMonth = new Date(now);
      nextMonth.setMonth(nextMonth.getMonth() + 1, 1);
      nextMonth.setHours(0, 0, 0, 0);
      return nextMonth;

    default:
      return new Date(now.getTime() + 24 * 60 * 60 * 1000); // 默认24小时后
  }
}

/**
 * 触发配额警报
 */
async function triggerQuotaAlert(
  ctx: Context,
  alert: any,
  usagePercentage: number,
  usage: any,
  limits: any,
): Promise<void> {
  try {
    const alertData = {
      alertId: alert.alertId,
      tenantId: alert.tenantId,
      userId: alert.userId,
      quotaType: alert.quotaType,
      threshold: alert.threshold,
      currentUsage: usagePercentage,
      usage,
      limits,
      timestamp: Date.now(),
    };

    // 发送警报事件
    await ctx.emit('quota.alert.triggered', alertData);

    ctx.service?.logger?.warn(
      `Quota alert triggered: ${alert.alertId} for tenant ${alert.tenantId}`,
    );
  } catch (error) {
    ctx.service?.logger?.error('Failed to trigger quota alert:', error);
  }
}

/**
 * 验证邮箱地址
 */
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * 验证URL
 */
function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}
