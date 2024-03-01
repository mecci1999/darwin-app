import Sequelize, { Model } from "sequelize";
import databaseConnectionManager, {
  DataBaseConnectionManager,
} from "../manager";

class MainDatabaseConnection {
  public connection!: Sequelize.Sequelize;
  private promise: Promise<Sequelize.Sequelize> | null = null;

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
    if (this.promise !== null) return this.promise.then(() => this.connection);

    throw new Error("请先调用bindMember方法，建立连接");
  }
}
