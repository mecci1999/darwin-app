import Sequelize, { Model } from "sequelize";
import databaseConnectionManager, {
  DataBaseConnectionManager,
} from "../manager";
import { DataBaseTableNames } from "typings/enum";

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
  public getModel<T extends Model>(
    modelName: string,
  ): Promise<Sequelize.ModelCtor<T>> {
    return this.getConnection().then(
      (connection) => connection.models[modelName] as Sequelize.ModelCtor<T>,
    );
  }

  public getConnection(): Promise<Sequelize.Sequelize> {
    if (this.promise !== null)
      return this.promise.then(() => this.connection as any);

    throw new Error("请先调用bindMember方法，建立连接");
  }

  /**
   * 获取数据库的连接
   */
  public getConnectionByOptions(options: Sequelize.Options = {}) {
    return databaseConnectionManager.getConnection(options, {
      models: [
        DataBaseTableNames.User,
        DataBaseTableNames.Config,
        DataBaseTableNames.IPBlackList,
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
          (this.promise = this.connection.sync().then(() => {
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
      await databaseConnectionManager.closeConnection(this.connection);
      this.connection = null;
      this.promise = null;
    }
  }
}

export default new MainDatabaseConnection();
