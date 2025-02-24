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
        // 修改字段定义
        type: DataTypes.STRING(32), // 与user表类型一致
        allowNull: true, // 初始状态无用户关联
        references: {
          // 添加外键关联
          model: UserTable,
          key: 'userId',
        },
        onDelete: 'CASCADE', // 级联删除
      },
      status: {
        type: DataTypes.ENUM('pending', 'confirmed', 'expired'),
        defaultValue: 'pending',
      },
      deviceInfo: DataTypes.JSON,
      expiresAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: DataBaseTableNames.ScanAuth,
      indexes: [
        { fields: ['expiresAt'] },
        { fields: ['status'] },
        { fields: ['userId'] }, // 新增用户ID索引
      ],
    },
  );

  // 建立模型关联
  model.belongsTo(UserTable, {
    foreignKey: 'userId',
    targetKey: 'userId',
  });

  return model;
}
