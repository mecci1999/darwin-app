/**
 * 微服务相关的配置表
 */
import { DataTypes, Model, Sequelize } from "sequelize";
import { IConfig } from "typings/config";
import { DataBaseTableNames } from "typings/enum";

export interface IConfigTableAttributes extends IConfig {
  key: string;
  value: string;
}

export class ConfigTable
  extends Model<IConfigTableAttributes, IConfigTableAttributes>
  implements IConfigTableAttributes
{
  public key!: string;
  public value!: string;

  public readonly createdAt!: Date; // 创建时间
  public readonly updatedAt!: Date; // 更新时间

  public static staticMethod() {}

  public publicMethod() {}
}

export default function (sequelize: Sequelize) {
  const model = ConfigTable.init(
    {
      key: { type: DataTypes.STRING, allowNull: false, primaryKey: true },
      value: { type: DataTypes.TEXT, allowNull: false },
    },
    {
      sequelize,
      tableName: DataBaseTableNames.Config,
      modelName: DataBaseTableNames.Config,
    },
  );

  return model;
}
