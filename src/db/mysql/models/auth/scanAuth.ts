import { DataTypes, Model, Sequelize } from 'sequelize';
import { DataBaseTableNames } from 'typings/enum';
import { UserTable } from '../user'; // 添加用户模型引用

export interface IScanAuthAttributes {
  id: string; // 主健
  userId: string; // 扫码确认后关联
  deviceInfo: object; // 扫码设备信息
  expiresAt: Date;
}

export class ScanAuthTable extends Model<IScanAuthAttributes> implements IScanAuthAttributes {
  public id!: string; // 主键ID
  public userId!: string; // 关联用户ID
  public deviceInfo!: object; // 扫码设备信息
  public expiresAt!: Date; // 过期时间
}

export default function (sequelize: Sequelize) {
  const model = ScanAuthTable.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
        references: {
          model: UserTable,
          key: 'user_id',
        },
        onDelete: 'CASCADE',
      },
      deviceInfo: { type: DataTypes.JSON },
      expiresAt: { type: DataTypes.DATE },
    },
    {
      sequelize,
      tableName: DataBaseTableNames.ScanAuth,
      modelName: DataBaseTableNames.ScanAuth,
      indexes: [
        { fields: ['expires_at'] },
        { fields: ['user_id'], name: 'scan_auth_user_id_index' }, // 新增用户ID索引
      ],
    },
  );

  // 建立模型关联
  model.belongsTo(UserTable, { foreignKey: 'userId' });

  return model;
}
