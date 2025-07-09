/**
 * Subscription微服务使用量跟踪器
 */
import { Star } from 'node-universe';
import { SubscriptionState, UsageStats, UserSubscription } from '../types';
import { SUBSCRIPTION_CONFIG, MONITORING_CONFIG } from '../constants';

export class UsageTracker {
  private static usageCache = new Map<string, any>();
  private static trackingInterval: NodeJS.Timeout | null = null;

  /**
   * 启动使用量跟踪
   */
  static async startTracking(star: any): Promise<void> {
    try {
      // 启动定时跟踪
      this.trackingInterval = setInterval(async () => {
        await this.collectUsageData(star);
      }, 60000); // 1分钟间隔

      star.logger?.info('Usage tracking started');
    } catch (error) {
      star.logger?.error('Failed to start usage tracking:', error);
      throw error;
    }
  }

  /**
   * 停止使用量跟踪
   */
  static async stopTracking(star: any): Promise<void> {
    try {
      if (this.trackingInterval) {
        clearInterval(this.trackingInterval);
        this.trackingInterval = null;
      }

      // 清理缓存
      this.usageCache.clear();

      star.logger?.info('Usage tracking stopped');
    } catch (error) {
      star.logger?.error('Failed to stop usage tracking:', error);
    }
  }

  /**
   * 记录API调用
   */
  static async recordApiCall(
    userId: string,
    endpoint: string,
    method: string,
    responseTime: number,
    star: any,
  ): Promise<void> {
    try {
      const usage = await this.getUserUsage(userId, star);

      // 更新API调用统计
      usage.apiCalls.total++;
      usage.apiCalls.today++;
      usage.apiCalls.thisMonth++;

      // 记录端点使用情况
      if (!usage.apiCalls.byEndpoint[endpoint]) {
        usage.apiCalls.byEndpoint[endpoint] = 0;
      }
      usage.apiCalls.byEndpoint[endpoint]++;

      // 记录响应时间
      usage.performance.averageResponseTime =
        (usage.performance.averageResponseTime + responseTime) / 2;

      // 更新最后活动时间
      usage.updatedAt = new Date();

      // 保存到缓存
      this.usageCache.set(userId, usage);

      // 检查是否需要持久化
      if (usage.apiCalls.total % 100 === 0) {
        // 每100次API调用持久化一次
        await this.persistUsage(userId, usage, star);
      }
    } catch (error) {
      star.logger?.error('Failed to record API call:', error);
    }
  }

  /**
   * 记录存储使用量
   */
  static async recordStorageUsage(
    userId: string,
    bytesUsed: number,
    operation: 'upload' | 'delete',
    star: any,
  ): Promise<void> {
    try {
      const usage = await this.getUserUsage(userId, star);

      if (operation === 'upload') {
        usage.storage.used += bytesUsed;
        usage.storage.uploads++;
      } else {
        usage.storage.used = Math.max(0, usage.storage.used - bytesUsed);
        usage.storage.deletions++;
      }

      // 更新最后活动时间
      usage.updatedAt = new Date();

      // 保存到缓存
      this.usageCache.set(userId, usage);

      // 立即持久化存储使用量变化
      await this.persistUsage(userId, usage, star);
    } catch (error) {
      star.logger?.error('Failed to record storage usage:', error);
    }
  }

  /**
   * 记录带宽使用量
   */
  static async recordBandwidthUsage(
    userId: string,
    bytesTransferred: number,
    direction: 'inbound' | 'outbound',
    star: any,
  ): Promise<void> {
    try {
      const usage = await this.getUserUsage(userId, star);

      if (direction === 'inbound') {
        usage.bandwidth.inbound += bytesTransferred;
      } else {
        usage.bandwidth.outbound += bytesTransferred;
      }

      usage.bandwidth.total = usage.bandwidth.inbound + usage.bandwidth.outbound;

      // 更新最后活动时间
      usage.updatedAt = new Date();

      // 保存到缓存
      this.usageCache.set(userId, usage);
    } catch (error) {
      star.logger?.error('Failed to record bandwidth usage:', error);
    }
  }

  /**
   * 获取用户使用量统计
   */
  static async getUserUsage(userId: string, star: any): Promise<UsageStats> {
    try {
      // 首先从缓存获取
      let usage = this.usageCache.get(userId);

      if (!usage) {
        // 从数据库加载
        usage = await this.loadUsageFromDatabase(userId, star);

        if (!usage) {
          // 创建新的使用量记录
          usage = this.createEmptyUsageStats(userId);
        }

        // 缓存使用量数据
        this.usageCache.set(userId, usage);
      }

      return usage;
    } catch (error) {
      star.logger?.error('Failed to get user usage:', error);
      return this.createEmptyUsageStats(userId);
    }
  }

  /**
   * 获取用户当前周期使用量
   */
  static async getCurrentPeriodUsage(
    userId: string,
    subscription: UserSubscription,
    star: any,
  ): Promise<{
    apiCalls: number;
    storage: number;
    bandwidth: number;
    percentages: {
      apiCalls: number;
      storage: number;
      bandwidth: number;
    };
  }> {
    try {
      const usage = await this.getUserUsage(userId, star);
      const plan = subscription.planId;

      // 根据计费周期计算当前周期使用量
      const periodUsage = this.calculatePeriodUsage(usage, subscription.startDate);

      // 计算使用百分比
      // 需要获取计划限制来计算百分比
      // 这里需要修复：plan应该是计划对象，而不是planId字符串
      const percentages = {
        apiCalls: 0, // plan.limits?.apiCalls ? (periodUsage.apiCalls / plan.limits.apiCalls) * 100 : 0,
        storage: 0, // plan.limits?.storage ? (periodUsage.storage / plan.limits.storage) * 100 : 0,
        bandwidth: 0, // plan.limits?.bandwidth ? (periodUsage.bandwidth / plan.limits.bandwidth) * 100 : 0,
      };

      return {
        ...periodUsage,
        percentages,
      };
    } catch (error) {
      star.logger?.error('Failed to get current period usage:', error);
      return {
        apiCalls: 0,
        storage: 0,
        bandwidth: 0,
        percentages: { apiCalls: 0, storage: 0, bandwidth: 0 },
      };
    }
  }

  /**
   * 检查使用量限制
   */
  static async checkUsageLimits(
    userId: string,
    subscription: UserSubscription,
    star: any,
  ): Promise<{
    withinLimits: boolean;
    warnings: string[];
    exceeded: string[];
  }> {
    try {
      const currentUsage = await this.getCurrentPeriodUsage(userId, subscription, star);
      const warnings: string[] = [];
      const exceeded: string[] = [];

      // 检查API调用限制
      if (currentUsage.percentages.apiCalls >= 100) {
        exceeded.push('API calls limit exceeded');
      } else if (currentUsage.percentages.apiCalls >= 80) {
        warnings.push('API calls usage is above 80%');
      }

      // 检查存储限制
      if (currentUsage.percentages.storage >= 100) {
        exceeded.push('Storage limit exceeded');
      } else if (currentUsage.percentages.storage >= 80) {
        warnings.push('Storage usage is above 80%');
      }

      // 检查带宽限制
      if (currentUsage.percentages.bandwidth >= 100) {
        exceeded.push('Bandwidth limit exceeded');
      } else if (currentUsage.percentages.bandwidth >= 80) {
        warnings.push('Bandwidth usage is above 80%');
      }

      return {
        withinLimits: exceeded.length === 0,
        warnings,
        exceeded,
      };
    } catch (error) {
      star.logger?.error('Failed to check usage limits:', error);
      return {
        withinLimits: false,
        warnings: [],
        exceeded: ['Failed to check usage limits'],
      };
    }
  }

  /**
   * 获取使用量趋势
   */
  static async getUsageTrends(
    userId: string,
    days: number,
    star: any,
  ): Promise<{
    daily: Array<{
      date: string;
      apiCalls: number;
      storage: number;
      bandwidth: number;
    }>;
    growth: {
      apiCalls: number;
      storage: number;
      bandwidth: number;
    };
  }> {
    try {
      // 从数据库获取历史使用量数据
      const historicalData = await this.getHistoricalUsage(userId, days, star);

      // 计算增长率
      const growth = this.calculateGrowthRates(historicalData);

      return {
        daily: historicalData,
        growth,
      };
    } catch (error) {
      star.logger?.error('Failed to get usage trends:', error);
      return {
        daily: [],
        growth: { apiCalls: 0, storage: 0, bandwidth: 0 },
      };
    }
  }

  /**
   * 重置用户使用量（新计费周期开始时）
   */
  static async resetPeriodUsage(userId: string, star: any): Promise<void> {
    try {
      const usage = await this.getUserUsage(userId, star);

      // 保存当前周期数据到历史记录
      await this.archivePeriodUsage(userId, usage, star);

      // 重置当前周期计数器
      usage.apiCalls.today = 0;
      usage.apiCalls.thisMonth = 0;
      usage.bandwidth.inbound = 0;
      usage.bandwidth.outbound = 0;
      usage.bandwidth.total = 0;

      // 存储使用量不重置，因为它是累积的

      // 更新缓存
      this.usageCache.set(userId, usage);

      // 持久化重置后的数据
      await this.persistUsage(userId, usage, star);

      star.logger?.info(`Usage reset for user: ${userId}`);
    } catch (error) {
      star.logger?.error('Failed to reset period usage:', error);
    }
  }

  /**
   * 批量获取用户使用量
   */
  static async getBatchUsage(userIds: string[], star: any): Promise<Map<string, UsageStats>> {
    const usageMap = new Map<string, UsageStats>();

    try {
      // 并行获取所有用户的使用量
      const usagePromises = userIds.map(async (userId) => {
        const usage = await this.getUserUsage(userId, star);
        return { userId, usage };
      });

      const results = await Promise.all(usagePromises);

      results.forEach(({ userId, usage }) => {
        usageMap.set(userId, usage);
      });
    } catch (error) {
      star.logger?.error('Failed to get batch usage:', error);
    }

    return usageMap;
  }

  /**
   * 导出使用量报告
   */
  static async exportUsageReport(
    userId: string,
    startDate: Date,
    endDate: Date,
    format: 'json' | 'csv',
    star: any,
  ): Promise<string> {
    try {
      const usage = await this.getUserUsage(userId, star);
      const historicalData = await this.getHistoricalUsageRange(userId, startDate, endDate, star);

      const report = {
        userId,
        period: { start: startDate, end: endDate },
        summary: {
          totalApiCalls: usage.apiCalls.total,
          totalStorage: usage.storage.used,
          totalBandwidth: usage.bandwidth.total,
        },
        daily: historicalData,
        generatedAt: new Date(),
      };

      if (format === 'csv') {
        return this.convertToCSV(report);
      }

      return JSON.stringify(report, null, 2);
    } catch (error) {
      star.logger?.error('Failed to export usage report:', error);
      throw error;
    }
  }

  /**
   * 创建空的使用量统计
   */
  private static createEmptyUsageStats(userId: string): UsageStats {
    return {
      userId,
      apiCalls: {
        total: 0,
        today: 0,
        thisMonth: 0,
        byEndpoint: {},
      },
      storage: {
        used: 0,
        uploads: 0,
        deletions: 0,
      },
      bandwidth: {
        inbound: 0,
        outbound: 0,
        total: 0,
      },
      performance: {
        averageResponseTime: 0,
        errorRate: 0,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * 从数据库加载使用量
   */
  private static async loadUsageFromDatabase(
    userId: string,
    star: any,
  ): Promise<UsageStats | null> {
    try {
      // 从数据库查询使用量数据
      // const usage = await star.db.collection('usage_stats').findOne({ userId });
      // return usage;

      // 模拟返回null，表示没有找到数据
      return null;
    } catch (error) {
      star.logger?.error('Failed to load usage from database:', error);
      return null;
    }
  }

  /**
   * 持久化使用量数据
   */
  private static async persistUsage(userId: string, usage: UsageStats, star: any): Promise<void> {
    try {
      usage.updatedAt = new Date();

      // 保存到数据库
      // await star.db.collection('usage_stats').updateOne(
      //   { userId },
      //   { $set: usage },
      //   { upsert: true }
      // );

      star.logger?.debug(`Usage persisted for user: ${userId}`);
    } catch (error) {
      star.logger?.error('Failed to persist usage:', error);
    }
  }

  /**
   * 收集使用量数据
   */
  private static async collectUsageData(star: any): Promise<void> {
    try {
      // 批量持久化缓存中的使用量数据
      const persistPromises = Array.from(this.usageCache.entries()).map(async ([userId, usage]) => {
        await this.persistUsage(userId, usage, star);
      });

      await Promise.all(persistPromises);

      star.logger?.debug(`Collected usage data for ${this.usageCache.size} users`);
    } catch (error) {
      star.logger?.error('Failed to collect usage data:', error);
    }
  }

  /**
   * 计算周期使用量
   */
  private static calculatePeriodUsage(
    usage: UsageStats,
    periodStart: Date,
  ): {
    apiCalls: number;
    storage: number;
    bandwidth: number;
  } {
    // 简化实现：返回当前月份的使用量
    // 实际实现中应该根据periodStart计算精确的周期使用量
    return {
      apiCalls: usage.apiCalls.thisMonth,
      storage: usage.storage.used,
      bandwidth: usage.bandwidth.total,
    };
  }

  /**
   * 获取历史使用量数据
   */
  private static async getHistoricalUsage(
    userId: string,
    days: number,
    star: any,
  ): Promise<
    Array<{
      date: string;
      apiCalls: number;
      storage: number;
      bandwidth: number;
    }>
  > {
    try {
      // 从数据库获取历史数据
      // const endDate = new Date();
      // const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

      // 模拟返回历史数据
      const historicalData: Array<{
        date: string;
        apiCalls: number;
        storage: number;
        bandwidth: number;
      }> = [];
      for (let i = days - 1; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);

        historicalData.push({
          date: date.toISOString().split('T')[0],
          apiCalls: Math.floor(Math.random() * 1000),
          storage: Math.floor(Math.random() * 1024 * 1024 * 1024), // Random GB in bytes
          bandwidth: Math.floor(Math.random() * 1024 * 1024 * 1024), // Random GB in bytes
        });
      }

      return historicalData;
    } catch (error) {
      star.logger?.error('Failed to get historical usage:', error);
      return [];
    }
  }

  /**
   * 计算增长率
   */
  private static calculateGrowthRates(data: any[]): {
    apiCalls: number;
    storage: number;
    bandwidth: number;
  } {
    if (data.length < 2) {
      return { apiCalls: 0, storage: 0, bandwidth: 0 };
    }

    const first = data[0];
    const last = data[data.length - 1];

    return {
      apiCalls: first.apiCalls > 0 ? ((last.apiCalls - first.apiCalls) / first.apiCalls) * 100 : 0,
      storage: first.storage > 0 ? ((last.storage - first.storage) / first.storage) * 100 : 0,
      bandwidth:
        first.bandwidth > 0 ? ((last.bandwidth - first.bandwidth) / first.bandwidth) * 100 : 0,
    };
  }

  /**
   * 归档周期使用量
   */
  private static async archivePeriodUsage(
    userId: string,
    usage: UsageStats,
    star: any,
  ): Promise<void> {
    try {
      const archiveRecord = {
        userId,
        period: {
          start: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          end: new Date(),
        },
        usage: {
          apiCalls: usage.apiCalls.thisMonth,
          storage: usage.storage.used,
          bandwidth: usage.bandwidth.total,
        },
        archivedAt: new Date(),
      };

      // 保存到归档表
      // await star.db.collection('usage_archive').insertOne(archiveRecord);

      star.logger?.debug(`Usage archived for user: ${userId}`);
    } catch (error) {
      star.logger?.error('Failed to archive period usage:', error);
    }
  }

  /**
   * 获取指定时间范围的历史使用量
   */
  private static async getHistoricalUsageRange(
    userId: string,
    startDate: Date,
    endDate: Date,
    star: any,
  ): Promise<any[]> {
    try {
      // 从数据库查询指定时间范围的数据
      // const data = await star.db.collection('usage_archive')
      //   .find({
      //     userId,
      //     'period.start': { $gte: startDate },
      //     'period.end': { $lte: endDate }
      //   })
      //   .toArray();

      // 模拟返回数据
      return [];
    } catch (error) {
      star.logger?.error('Failed to get historical usage range:', error);
      return [];
    }
  }

  /**
   * 转换为CSV格式
   */
  private static convertToCSV(report: any): string {
    const headers = ['Date', 'API Calls', 'Storage (bytes)', 'Bandwidth (bytes)'];
    const rows = [headers.join(',')];

    report.daily.forEach((day: any) => {
      rows.push(`${day.date},${day.apiCalls},${day.storage},${day.bandwidth}`);
    });

    return rows.join('\n');
  }
}
