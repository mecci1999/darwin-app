/**
 * 管理数据库的连接和断开
 */
import * as SequelizeStatic from 'sequelize';
import deepmerge from 'deepmerge';
import getModels from './models';

export class DataBaseConnectionManager {
  public static SequelizeStatic = SequelizeStatic;

  public connections: { connection: SequelizeStatic.Sequelize }[] = [];

  constructor(public options?: any) {}

  public get Sequelize() {
    return SequelizeStatic;
  }

  /**
   * 获得数据库的链接
   * @param id
   * @param options
   * @param models
   */
  public getConnection(
    options: SequelizeStatic.Options = {},
    { models = [] as string[] } = {},
  ): SequelizeStatic.Sequelize {
    const connection = new SequelizeStatic.Sequelize(
      deepmerge(
        {
          dialect: 'mysql',
          host: 'localhost',
          port: 3306,
          database: 'darwin_app',
          username: 'darwin',
          password: 'darwin19990709',
          define: {
            underscored: true,
            alter: { drop: false }, // 有新增字段  会自动加上
          },
          transactionType: SequelizeStatic.Transaction.TYPES.IMMEDIATE,
          logging: false,
        },
        options,
      ),
    );

    // 创建数据库的表格
    getModels(connection, models);

    this.connections.push({ connection });

    return connection;
  }

  /**
   * 关闭连接
   * @param connection
   */
  public closeConnection(connection) {
    const index = this.connections.findIndex((conn) => conn.connection === connection);
    if (index !== -1) {
      this.connections[index].connection.close();
      this.connections.splice(index, 1);
    }
  }
}

export default new DataBaseConnectionManager();
