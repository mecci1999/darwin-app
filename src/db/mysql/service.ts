/**
 * 数据库服务适配器
 * 为微服务提供统一的数据库访问接口
 * 每个微服务实例都拥有独立的数据库连接
 */
import { Star } from 'node-universe';
import * as Sequelize from 'sequelize';
import { DataBaseTableNames } from 'typings';
import { DatabaseInitializer } from './initializer';
import databaseConnectionManager from './manager';
import { mainConnection } from './index';

// 导入所有API模块
import * as authApi from './apis/auth';
import * as billingApi from './apis/billing';
import * as configApi from './apis/config';
import * as paymentApi from './apis/payment';
import * as quotaApi from './apis/quota';
import * as subscriptionApi from './apis/subscription';
import * as userApi from './apis/user';
import * as userLayoutApi from './apis/userLayout';
import * as microAppApi from './apis/microApp';
import * as creatorSpaceMembershipApi from './apis/creatorSpaceMembership';

/**
 * 数据库服务配置接口
 */
export interface DatabaseServiceConfig {
  enableSlowQueryLog?: boolean;
  slowQueryThreshold?: number;
  enableIpBlacklist?: boolean;
  enableIpSyncTimer?: boolean;
}

/**
 * 数据库服务类
 * 提供统一的数据库访问接口
 * 每个实例拥有独立的数据库连接
 */
export class DatabaseService {
  private star: Star;
  private isInitialized: boolean = false;
  private connection: Sequelize.Sequelize | null = null;
  private serviceName: string;

  constructor(star: Star, serviceName: string = 'default') {
    this.star = star;
    this.serviceName = serviceName;
  }

  private emitQueryDurationMetric(sql: string, timing?: number) {
    if (typeof timing !== 'number' || !Number.isFinite(timing) || timing < 0) return;

    const [firstToken] = sql.trim().split(/\s+/);
    const operation = firstToken ? firstToken.toUpperCase() : 'UNKNOWN';
    const timestamp = Date.now();

    if (typeof this.star.emit !== 'function') return;

    const emitResult = this.star.emit('metrics.raw', {
      tenantId: 'system',
      data: {
        measurement: 'db_query_duration_ms',
        tags: {
          tenantId: 'system',
          appKeyId: 'system',
          visibilityScope: 'system-admin',
          sourceType: 'darwin-system',
          source: 'mysql-sequelize',
          service: this.serviceName,
          serviceId: `system:${this.serviceName}`,
          protocol: 'db',
          'db.system': 'mysql',
          operation,
          unit: 'ms',
        },
        fields: { value: timing, duration: timing },
        timestamp,
      },
    });

    Promise.resolve(emitResult).catch((error: unknown) => {
      this.star.logger?.warn(`[${this.serviceName}] Failed to emit DB query duration metric`, error);
    });
  }

  /**
   * 初始化数据库服务
   */
  async initialize(state: any, config: DatabaseServiceConfig = {}) {
    if (this.isInitialized) {
      this.star.logger?.warn(`Database service [${this.serviceName}] already initialized`);
      return;
    }

    try {
      // 创建独立的数据库连接
      this.connection = databaseConnectionManager.getConnection(
        {
          benchmark: true,
          logging: (sql: string, timing?: number) => {
            this.emitQueryDurationMetric(sql, timing);
            if (timing && timing > (config.slowQueryThreshold ?? 1000)) {
              this.star.logger?.warn(
                `[${this.serviceName}] Slow query detected: ${sql}, timing: ${timing}ms`,
              );
            }
          },
        },
        {
          models: [
            DataBaseTableNames.User,
            DataBaseTableNames.UserLayout,
            DataBaseTableNames.Config,
            DataBaseTableNames.IPBlackList,
            DataBaseTableNames.EmailAuth,
            DataBaseTableNames.AdminBootstrapLock,
            DataBaseTableNames.WechatAuth,
            DataBaseTableNames.ScanAuth,
            DataBaseTableNames.SubscriptionPlan,
            DataBaseTableNames.UserSubscription,
            DataBaseTableNames.UserQuota,
            DataBaseTableNames.QuotaUsageHistory,
            DataBaseTableNames.ApiKey,
            DataBaseTableNames.ApiKeyStats,
            DataBaseTableNames.PaymentOrder,
            DataBaseTableNames.RefundRequest,
            DataBaseTableNames.PaymentProvider,
            DataBaseTableNames.Bill,
            DataBaseTableNames.BillItem,
            DataBaseTableNames.UserBillingAddress,
            DataBaseTableNames.BillingReminderSetting,
            DataBaseTableNames.MicroApp,
            DataBaseTableNames.MicroAppVersion,
            DataBaseTableNames.MicroAppAuditLog,
            DataBaseTableNames.MicroAppInstall,
            DataBaseTableNames.CreatorSpaceMembership,
            DataBaseTableNames.TrailsPortfolioCategory,
            DataBaseTableNames.TrailsSyncChange,
            DataBaseTableNames.TrailsSyncMutation,
            DataBaseTableNames.TrailsDurablePortfolio,
            DataBaseTableNames.TrailsDurableJournal,
            DataBaseTableNames.TrailsDurableHike,
            DataBaseTableNames.TrailsDurableGear,
            DataBaseTableNames.TrailsDurablePackingPlan,
            DataBaseTableNames.TrailsDurablePackingPlanItem,
            DataBaseTableNames.AlertInstance,
            DataBaseTableNames.AlertEvent,
            DataBaseTableNames.AlertNotificationDelivery,
          ],
        },
      );

      // Hack: 确保全局 mainConnection 也有引用，因为遗留的 API 代码依赖它
      // 如果全局连接未设置，则使用当前服务的连接
      if (!mainConnection.connection) {
        mainConnection.connection = this.connection;
      }

      if (process.env.NODE_ENV === 'production') {
        await this.connection.authenticate();
      } else {
        await this.connection.sync({ force: false });
      }

      // 如果需要完整初始化（包括IP黑名单等）
      if (config.enableIpBlacklist || config.enableIpSyncTimer) {
        await DatabaseInitializer.fullInitialize(this.star.logger, state, {
          enableSlowQueryLog: config.enableSlowQueryLog ?? true,
          slowQueryThreshold: config.slowQueryThreshold ?? 1000,
          enableIpBlacklist: config.enableIpBlacklist ?? false,
          enableIpSyncTimer: config.enableIpSyncTimer ?? false,
        });
      }

      this.isInitialized = true;
      this.star.logger?.info(`Database service [${this.serviceName}] initialized successfully`);
    } catch (error) {
      this.star.logger?.error(
        `Failed to initialize database service [${this.serviceName}]:`,
        error,
      );
      throw error;
    }
  }

  /**
   * 简单初始化（仅连接数据库）
   */
  async simpleInitialize() {
    if (this.isInitialized) {
      this.star.logger?.warn(`Database service [${this.serviceName}] already initialized`);
      return;
    }

    try {
      // 创建独立的数据库连接
      this.connection = databaseConnectionManager.getConnection(
        {
          benchmark: true,
          logging: (sql: string, timing?: number) => {
            this.emitQueryDurationMetric(sql, timing);
            if (timing && timing > 1000) {
              this.star.logger?.warn(
                `[${this.serviceName}] Slow query detected: ${sql}, timing: ${timing}ms`,
              );
            }
          },
        },
        {
          models: [
            DataBaseTableNames.User,
            DataBaseTableNames.UserLayout,
            DataBaseTableNames.Config,
            DataBaseTableNames.IPBlackList,
            DataBaseTableNames.EmailAuth,
            DataBaseTableNames.AdminBootstrapLock,
            DataBaseTableNames.WechatAuth,
            DataBaseTableNames.ScanAuth,
            DataBaseTableNames.SubscriptionPlan,
            DataBaseTableNames.UserSubscription,
            DataBaseTableNames.UserQuota,
            DataBaseTableNames.QuotaUsageHistory,
            DataBaseTableNames.ApiKey,
            DataBaseTableNames.ApiKeyStats,
            DataBaseTableNames.PaymentOrder,
            DataBaseTableNames.RefundRequest,
            DataBaseTableNames.PaymentProvider,
            DataBaseTableNames.Bill,
            DataBaseTableNames.BillItem,
            DataBaseTableNames.UserBillingAddress,
            DataBaseTableNames.BillingReminderSetting,
            DataBaseTableNames.MicroApp,
            DataBaseTableNames.MicroAppVersion,
            DataBaseTableNames.MicroAppAuditLog,
            DataBaseTableNames.MicroAppInstall,
            DataBaseTableNames.CreatorSpaceMembership,
            DataBaseTableNames.TrailsPortfolioCategory,
            DataBaseTableNames.TrailsSyncChange,
            DataBaseTableNames.TrailsSyncMutation,
            DataBaseTableNames.TrailsDurablePortfolio,
            DataBaseTableNames.TrailsDurableJournal,
            DataBaseTableNames.TrailsDurableHike,
            DataBaseTableNames.TrailsDurableGear,
            DataBaseTableNames.TrailsDurablePackingPlan,
            DataBaseTableNames.TrailsDurablePackingPlanItem,
            DataBaseTableNames.AlertInstance,
            DataBaseTableNames.AlertEvent,
            DataBaseTableNames.AlertNotificationDelivery,
          ],
        },
      );

      // Hack: 确保全局 mainConnection 也有引用，因为遗留的 API 代码依赖它
      // 如果全局连接未设置，则使用当前服务的连接
      if (!mainConnection.connection) {
        mainConnection.connection = this.connection;
      }

      if (process.env.NODE_ENV === 'production') {
        await this.connection.authenticate();
      } else {
        await this.connection.sync({ force: false });
      }

      this.isInitialized = true;
      this.star.logger?.info(`Database connection [${this.serviceName}] established`);
    } catch (error) {
      this.star.logger?.error(
        `Failed to establish database connection [${this.serviceName}]:`,
        error,
      );
      throw error;
    }
  }

  /**
   * 清理数据库服务
   */
  async cleanup(state?: any) {
    try {
      if (state) {
        await DatabaseInitializer.cleanup(state);
      }

      if (this.connection) {
        databaseConnectionManager.closeConnection(this.connection);
        this.connection = null;
      }

      this.isInitialized = false;
      this.star.logger?.info(`Database service [${this.serviceName}] cleaned up successfully`);
    } catch (error) {
      this.star.logger?.error(`Failed to cleanup database service [${this.serviceName}]:`, error);
      throw error;
    }
  }

  /**
   * 认证相关数据库操作
   */
  get auth() {
    return {
      findEmailIsExist: authApi.findEmailIsExist,
      registerEmailUser: authApi.registerEmailUser,
      saveOrUpdateEmailAuth: authApi.saveOrUpdateEmailAuth,
      findEmailAuthByEmail: authApi.findEmailAuthByEmail,
      findEmailAuthByUserId: authApi.findEmailAuthByUserId,
      saveOrUpdateScanAuth: authApi.saveOrUpdateScanAuth,
    };
  }

  /**
   * 用户相关数据库操作
   */
  get user() {
    return {
      saveOrUpdateUsers: userApi.saveOrUpdateUsers,
      queryAllUsers: userApi.queryAllUsers,
      findUserByUserId: userApi.findUserByUserId,
      findUsersByUserIds: userApi.findUsersByUserIds,
    };
  }

  /**
   * 用户布局相关数据库操作
   */
  get userLayout() {
    return {
      saveOrUpdateUserLayout: userLayoutApi.saveOrUpdateUserLayout,
      findUserLayout: userLayoutApi.findUserLayout,
    };
  }

  get microApp() {
    return microAppApi;
  }

  get creatorSpaceMembership() {
    return creatorSpaceMembershipApi;
  }

  /**
   * 配置相关数据库操作
   */
  get config() {
    return {
      saveOrUpdateConfigs: configApi.saveOrUpdateConfigs,
      getAllConfigList: configApi.getAllConfigList,
      queryConfigs: configApi.queryConfigs,
      deleteConfigs: configApi.deleteConfigs,
    };
  }

  /**
   * 计费相关数据库操作
   */
  get billing() {
    return billingApi;
  }

  /**
   * 支付相关数据库操作
   */
  get payment() {
    return paymentApi;
  }

  /**
   * 配额相关数据库操作
   */
  get quota() {
    return quotaApi;
  }

  /**
   * 订阅相关数据库操作
   */
  get subscription() {
    return subscriptionApi;
  }

  /**
   * 获取原始连接（用于高级操作）
   */
  getConnection(): Sequelize.Sequelize | null {
    return this.connection;
  }

  /**
   * 获取数据库模型
   */
  async getModel<T extends Sequelize.Model>(
    modelName: string,
  ): Promise<Sequelize.ModelCtor<T> | null> {
    if (!this.connection) {
      this.star.logger?.warn(`Database connection [${this.serviceName}] not initialized`);
      return null;
    }
    return this.connection.models[modelName] as Sequelize.ModelCtor<T>;
  }

  /**
   * 检查服务是否已初始化
   */
  get initialized() {
    return this.isInitialized;
  }
}

/**
 * 为Star对象扩展数据库服务
 * @param star Star实例
 * @param serviceName 服务名称，用于标识不同的微服务实例
 */
export function extendStarWithDatabase(
  star: Star,
  serviceName?: string,
): Star & { db: DatabaseService } {
  const dbService = new DatabaseService(star, serviceName);
  (star as any).db = dbService;
  return star as Star & { db: DatabaseService };
}

/**
 * 为微服务创建独立的数据库服务实例
 * @param star Star实例
 * @param serviceName 微服务名称（如：'auth', 'user', 'gateway'等）
 */
export function createMicroserviceDatabase(star: Star, serviceName: string): DatabaseService {
  return new DatabaseService(star, serviceName);
}
