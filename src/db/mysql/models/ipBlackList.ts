/**
 * IP黑名单表
 */
import { DataTypes, Model, Optional, Sequelize } from 'sequelize';
import { DataBaseTableNames, IPAddressBanStatus } from 'typings';

export interface IIPBlackListTableAttributes {
  id?: number;
  ipv4?: string;
  ipv6?: string;
  reason?: string; // 封禁原因
  status: IPAddressBanStatus; // 当前状态
  isArtificial: boolean; // 是否人为操作
}

export class IPBlackListTable
  extends Model<IIPBlackListTableAttributes, Optional<IIPBlackListTableAttributes, 'id'>>
  implements IIPBlackListTableAttributes
{
  public id!: number; // id
  ipv4!: string;
  ipv6!: string;
  reason!: string; // 封禁原因
  status!: IPAddressBanStatus; // 当前状态
  isArtificial!: boolean; // 是否人为操作
  public readonly createdAt!: Date; // 创建时间
  public readonly updatedAt!: Date; // 更新时间
}

export default function (sequelize: Sequelize) {
  const model = IPBlackListTable.init(
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      ipv4: { type: DataTypes.STRING(32), allowNull: true, field: 'ipv4' },
      ipv6: { type: DataTypes.STRING(45), allowNull: true, field: 'ipv6' },
      reason: { type: DataTypes.TEXT, allowNull: true, field: 'reason' },
      status: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: IPAddressBanStatus.active,
        field: 'status',
      },
      isArtificial: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        field: 'is_artificial',
      },
    },
    {
      sequelize,
      tableName: DataBaseTableNames.IPBlackList,
      modelName: DataBaseTableNames.IPBlackList,
      hooks: {
        beforeValidate: (ipBlackList: IPBlackListTable) => {
          if (ipBlackList.reason === undefined || ipBlackList.reason === null) {
            ipBlackList.reason = '';
          }
        },
      },
    },
  );

  return model;
}
