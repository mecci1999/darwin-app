/**
 * IP黑名单表
 */
import { DataTypes, Model, Optional, Sequelize } from "sequelize";
import { DataBaseTableNames } from "typings/enum";

export interface IIPBlackListTableAttributes {
  id: number;
  ipv4: string;
  ipv6: string;
}

export class IPBlackListTable
  extends Model<
    IIPBlackListTableAttributes,
    Optional<IIPBlackListTableAttributes, "id">
  >
  implements IIPBlackListTableAttributes
{
  public id!: number; // id
  ipv4!: string;
  ipv6!: string;
  public readonly createdAt!: Date; // 创建时间
  public readonly updatedAt!: Date; // 更新时间
}

export default function (sequelize: Sequelize) {
  const model = IPBlackListTable.init(
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      ipv4: { type: DataTypes.TEXT, allowNull: true },
      ipv6: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      sequelize,
      tableName: DataBaseTableNames.User,
      modelName: DataBaseTableNames.User,
    },
  );

  return model;
}
