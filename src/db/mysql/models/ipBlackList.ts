/**
 * IP黑名单表
 */
import { DataTypes, Model, Optional, Sequelize } from "sequelize";
import { DataBaseTableNames, IPAddressBanStatus } from "typings/enum";

export interface IIPBlackListTableAttributes {
  id: number;
  ipv4?: string;
  ipv6?: string;
  reason?: string; // 封禁原因
  status?: IPAddressBanStatus; // 当前状态
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
  reason!: string; // 封禁原因
  status!: IPAddressBanStatus; // 当前状态
  public readonly createdAt!: Date; // 创建时间
  public readonly updatedAt!: Date; // 更新时间
}

export default function (sequelize: Sequelize) {
  const model = IPBlackListTable.init(
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      ipv4: { type: DataTypes.STRING(32), allowNull: true },
      ipv6: { type: DataTypes.STRING(45), allowNull: true },
      reason: { type: DataTypes.TEXT, allowNull: true, defaultValue: "" },
      status: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: IPAddressBanStatus.active,
      },
    },
    {
      sequelize,
      tableName: DataBaseTableNames.User,
      modelName: DataBaseTableNames.User,
    },
  );

  return model;
}
