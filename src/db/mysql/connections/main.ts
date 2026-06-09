import Sequelize, { Model } from 'sequelize';
import { DataBaseTableNames } from 'typings';
import databaseConnectionManager, { DataBaseConnectionManager } from '../manager';

class MainDatabaseConnection {
  public connection: Sequelize.Sequelize | null = null;
  public promise: Promise<Sequelize.Sequelize> | null = null;

  public Sequelize = DataBaseConnectionManager.SequelizeStatic;

  constructor(public options?: any) {}

  /**
   * 获取表
   * @param modelName
   * @returns
   */
  public async getModel<T extends Model>(modelName: string): Promise<Sequelize.ModelCtor<T>> {
    const connection = await this.getConnection();
    return connection.models[modelName] as Sequelize.ModelCtor<T>;
  }

  public getConnection(): Promise<Sequelize.Sequelize> {
    if (this.promise !== null) return this.promise.then(() => this.connection as any);

    // 尝试自动连接
    return this.bindManinConnection().then(() => this.connection as any);
  }

  /**
   * 获取数据库的连接
   */
  public getConnectionByOptions(options: Sequelize.Options = {}) {
    return databaseConnectionManager.getConnection(options, {
      models: [
        DataBaseTableNames.User,
        DataBaseTableNames.UserLayout,
        DataBaseTableNames.Config,
        DataBaseTableNames.IPBlackList,
        DataBaseTableNames.EmailAuth,
        DataBaseTableNames.WechatAuth,
        DataBaseTableNames.ScanAuth,
        // SaaS 相关表
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
      ],
    });
  }

  /**
   * 绑定数据库
   */
  public bindManinConnection(options: Sequelize.Options = {}) {
    return new Promise((resolve, reject) => {
      try {
        this.connection = this.getConnectionByOptions(options);
        resolve(
          (this.promise = this.connection.sync({ force: false }).then(() => {
            return this.connection as any;
          })),
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 关闭数据库连接
   */
  public async destroy() {
    if (this.connection) {
      databaseConnectionManager.closeConnection(this.connection);
      this.connection = null;
      this.promise = null;
    }
  }
}

export default new MainDatabaseConnection();
