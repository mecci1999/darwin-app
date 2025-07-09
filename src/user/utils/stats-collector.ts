// User微服务统计收集工具类
import { UserStats, UserInfo } from '../types';
import { USER_CONFIG } from '../constants';

class StatsCollector {
  private static instance: StatsCollector;
  private stats: Map<string, UserStats> = new Map();
  private globalStats = {
    totalUsers: 0,
    activeUsers: 0,
    inactiveUsers: 0,
    suspendedUsers: 0,
    deletedUsers: 0,
    createdToday: 0,
    loginToday: 0,
    lastUpdated: new Date(),
  };
  private updateTimer?: NodeJS.Timeout;

  static getInstance(): StatsCollector {
    if (!StatsCollector.instance) {
      StatsCollector.instance = new StatsCollector();
    }
    return StatsCollector.instance;
  }

  /**
   * 初始化统计收集器
   */
  async initialize(): Promise<void> {
    // 启动定时更新
    this.startPeriodicUpdate();
    
    // 初始化全局统计
    await this.updateGlobalStats();
  }

  /**
   * 启动定时更新
   */
  private startPeriodicUpdate(): void {
    this.updateTimer = setInterval(() => {
      this.updateGlobalStats();
    }, 300000); // 每5分钟更新一次
  }

  /**
   * 更新全局统计信息
   */
  private async updateGlobalStats(): Promise<void> {
    try {
      // 这里应该从数据库获取实际统计数据
      // 暂时使用模拟数据
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      this.globalStats.lastUpdated = new Date();
      
      // 实际实现中应该查询数据库
      // const totalUsers = await this.getUserCountByStatus();
      // this.globalStats = { ...this.globalStats, ...totalUsers };
    } catch (error) {
      console.error('Failed to update global stats:', error);
    }
  }

  /**
   * 记录用户创建
   */
  async recordUserCreated(userInfo: UserInfo): Promise<void> {
    // 更新全局统计
    this.globalStats.totalUsers++;
    
    if (userInfo.status === USER_CONFIG.STATUS.ACTIVE) {
      this.globalStats.activeUsers++;
    }
    
    // 检查是否是今天创建的
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const createdDate = new Date(userInfo.createdAt);
    createdDate.setHours(0, 0, 0, 0);
    
    if (createdDate.getTime() === today.getTime()) {
      this.globalStats.createdToday++;
    }
    
    // 初始化用户统计
    const userStats: UserStats = {
      userId: userInfo.userId,
      loginCount: 0,
      lastLoginAt: undefined,
      totalApiCalls: 0,
      subscriptionStatus: 'free',
      quotaUsage: {
        used: 0,
        limit: 1000, // 默认限制
        percentage: 0,
      },
      createdAt: userInfo.createdAt,
    };
    
    this.stats.set(userInfo.userId, userStats);
  }

  /**
   * 记录用户状态变更
   */
  async recordUserStatusChanged(userId: string, oldStatus: string, newStatus: string): Promise<void> {
    // 更新全局统计
    this.updateStatusCount(oldStatus, -1);
    this.updateStatusCount(newStatus, 1);
    
    this.globalStats.lastUpdated = new Date();
  }

  /**
   * 更新状态计数
   */
  private updateStatusCount(status: string, delta: number): void {
    switch (status) {
      case USER_CONFIG.STATUS.ACTIVE:
        this.globalStats.activeUsers += delta;
        break;
      case USER_CONFIG.STATUS.INACTIVE:
        this.globalStats.inactiveUsers += delta;
        break;
      case USER_CONFIG.STATUS.SUSPENDED:
        this.globalStats.suspendedUsers += delta;
        break;
      case USER_CONFIG.STATUS.DELETED:
        this.globalStats.deletedUsers += delta;
        break;
    }
  }

  /**
   * 记录用户登录
   */
  async recordUserLogin(userId: string, success: boolean): Promise<void> {
    const userStats = this.stats.get(userId);
    if (userStats) {
      if (success) {
        userStats.loginCount++;
        userStats.lastLoginAt = new Date();
        
        // 检查是否是今天的登录
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const loginDate = new Date();
        loginDate.setHours(0, 0, 0, 0);
        
        if (loginDate.getTime() === today.getTime()) {
          this.globalStats.loginToday++;
        }
      }
      
      this.stats.set(userId, userStats);
    }
  }

  /**
   * 记录API调用
   */
  async recordApiCall(userId: string): Promise<void> {
    const userStats = this.stats.get(userId);
    if (userStats) {
      userStats.totalApiCalls++;
      this.stats.set(userId, userStats);
    }
  }

  /**
   * 更新用户配额使用情况
   */
  async updateUserQuotaUsage(userId: string, used: number, limit: number): Promise<void> {
    const userStats = this.stats.get(userId);
    if (userStats) {
      userStats.quotaUsage = {
        used,
        limit,
        percentage: limit > 0 ? Math.round((used / limit) * 100) : 0,
      };
      this.stats.set(userId, userStats);
    }
  }

  /**
   * 更新用户订阅状态
   */
  async updateUserSubscriptionStatus(userId: string, status: string): Promise<void> {
    const userStats = this.stats.get(userId);
    if (userStats) {
      userStats.subscriptionStatus = status;
      this.stats.set(userId, userStats);
    }
  }

  /**
   * 获取用户统计信息
   */
  async getUserStats(userId: string): Promise<UserStats | null> {
    return this.stats.get(userId) || null;
  }

  /**
   * 获取全局统计信息
   */
  getGlobalStats(): typeof StatsCollector.prototype.globalStats {
    return { ...this.globalStats };
  }

  /**
   * 获取活跃用户统计
   */
  getActiveUserStats(): {
    total: number;
    percentage: number;
    trend: 'up' | 'down' | 'stable';
  } {
    const total = this.globalStats.activeUsers;
    const percentage = this.globalStats.totalUsers > 0 
      ? Math.round((total / this.globalStats.totalUsers) * 100) 
      : 0;
    
    // 简单的趋势计算（实际应该基于历史数据）
    const trend: 'up' | 'down' | 'stable' = 'stable';
    
    return { total, percentage, trend };
  }

  /**
   * 获取今日统计
   */
  getTodayStats(): {
    newUsers: number;
    logins: number;
    activeUsers: number;
  } {
    return {
      newUsers: this.globalStats.createdToday,
      logins: this.globalStats.loginToday,
      activeUsers: this.globalStats.activeUsers,
    };
  }

  /**
   * 获取用户分布统计
   */
  getUserDistribution(): {
    active: number;
    inactive: number;
    suspended: number;
    deleted: number;
  } {
    return {
      active: this.globalStats.activeUsers,
      inactive: this.globalStats.inactiveUsers,
      suspended: this.globalStats.suspendedUsers,
      deleted: this.globalStats.deletedUsers,
    };
  }

  /**
   * 获取配额使用统计
   */
  getQuotaUsageStats(): {
    averageUsage: number;
    highUsageUsers: number;
    quotaExceededUsers: number;
  } {
    let totalUsage = 0;
    let highUsageCount = 0;
    let exceededCount = 0;
    let userCount = 0;
    
    for (const stats of this.stats.values()) {
      totalUsage += stats.quotaUsage.percentage;
      userCount++;
      
      if (stats.quotaUsage.percentage > 80) {
        highUsageCount++;
      }
      
      if (stats.quotaUsage.percentage >= 100) {
        exceededCount++;
      }
    }
    
    return {
      averageUsage: userCount > 0 ? Math.round(totalUsage / userCount) : 0,
      highUsageUsers: highUsageCount,
      quotaExceededUsers: exceededCount,
    };
  }

  /**
   * 获取登录统计
   */
  getLoginStats(): {
    totalLogins: number;
    averageLoginsPerUser: number;
    todayLogins: number;
  } {
    let totalLogins = 0;
    let userCount = 0;
    
    for (const stats of this.stats.values()) {
      totalLogins += stats.loginCount;
      userCount++;
    }
    
    return {
      totalLogins,
      averageLoginsPerUser: userCount > 0 ? Math.round(totalLogins / userCount) : 0,
      todayLogins: this.globalStats.loginToday,
    };
  }

  /**
   * 重置今日统计
   */
  resetDailyStats(): void {
    this.globalStats.createdToday = 0;
    this.globalStats.loginToday = 0;
    this.globalStats.lastUpdated = new Date();
  }

  /**
   * 清理用户统计
   */
  clearUserStats(userId: string): void {
    this.stats.delete(userId);
  }

  /**
   * 批量更新统计
   */
  async batchUpdateStats(updates: Array<{
    userId: string;
    type: 'login' | 'api_call' | 'quota_update';
    data: any;
  }>): Promise<void> {
    for (const update of updates) {
      switch (update.type) {
        case 'login':
          await this.recordUserLogin(update.userId, update.data.success);
          break;
        case 'api_call':
          await this.recordApiCall(update.userId);
          break;
        case 'quota_update':
          await this.updateUserQuotaUsage(
            update.userId,
            update.data.used,
            update.data.limit
          );
          break;
      }
    }
  }

  /**
   * 导出统计数据
   */
  exportStats(): {
    global: typeof StatsCollector.prototype.globalStats;
    users: Array<UserStats>;
    exportTime: Date;
  } {
    return {
      global: this.getGlobalStats(),
      users: Array.from(this.stats.values()),
      exportTime: new Date(),
    };
  }

  /**
   * 停止统计收集器
   */
  async stop(): Promise<void> {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = undefined;
    }
    
    this.stats.clear();
  }
}

export default StatsCollector;