import { DataTypes, Model, Sequelize } from 'sequelize';
import { DataBaseTableNames } from 'typings/enum';
import { UserTable } from '../user'; // 添加用户模型引用

export interface IScanAuthAttributes {
  token: string; // JWT格式临时令牌
  userId?: string; // 扫码确认后关联
  status: 'pending' | 'confirmed' | 'expired';
  deviceInfo: object; // 扫码设备信息
  expiresAt: Date;
}

export class ScanAuthTable extends Model<IScanAuthAttributes> implements IScanAuthAttributes {
  public token!: string; // token
  public userId!: string | undefined; // 关联用户ID
  public status!: 'pending' | 'confirmed' | 'expired'; // 状态
  public deviceInfo!: object; // 扫码设备信息
  public expiresAt!: Date; // 过期时间
}

export default function (sequelize: Sequelize) {
  const model = ScanAuthTable.init(
    {
      token: {
        type: DataTypes.STRING(512),
        primaryKey: true,
      },
      userId: {
        type: DataTypes.STRING(128),
        allowNull: false,
        unique: true,
        references: {
          model: UserTable,
          key: 'user_id',
        },
        onDelete: 'CASCADE',
      },
      status: {
        type: DataTypes.ENUM('pending', 'confirmed', 'expired'),
        defaultValue: 'pending',
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
        { fields: ['status'] },
        { fields: ['user_id'], name: 'scan_auth_user_id_index' }, // 新增用户ID索引
      ],
    },
  );

  // 建立模型关联
  model.belongsTo(UserTable, {
    foreignKey: 'user_id',
  });

  return model;
}
