/**
 * 用户表
 */
import { DataTypes, Model, Optional, Sequelize } from 'sequelize';
import { DataBaseTableNames } from 'typings/enum';

export interface IUserTableAttributes {
  id: number; // 新增自增主键（提升索引性能）
  userId: string; // 保持UUID对外暴露
  nickname?: string; // 显示名称（增加长度限制）
  avatar?: string; // 增加CDN格式校验
  status: number; // 改为枚举类型
  source: string; // 明确注册来源枚举
  timezone?: string; // 新增时区支持
  locale?: string; // 新增语言偏好
  lastActiveAt?: Date; // 新增最后活跃时间
  meta?: object; // 扩展元数据
  version: number; // 乐观锁版本控制
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

export class UserTable extends Model<IUserTableAttributes> implements IUserTableAttributes {
  public id!: number;
  public userId!: string;
  public nickname!: string | undefined;
  public avatar!: string | undefined;
  public status!: number;
  public source!: string;
  public timezone!: string | undefined;
  public locale!: string | undefined;
  public lastActiveAt!: Date | undefined;
  public meta!: object | undefined;
  public version!: number;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
  public deletedAt!: Date | undefined;
}

export default function (sequelize: Sequelize) {
  return UserTable.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        field: 'user_id',
        unique: true,
        allowNull: false,
      },
      nickname: {
        type: DataTypes.STRING(64), // 限制长度
        validate: {
          len: [1, 64], // 防止超长昵称
        },
      },
      avatar: {
        type: DataTypes.STRING(512),
        validate: {
          isUrl: true, // 验证URL格式
          // contains: 'cdn.com', // 限制CDN域名
        },
      },
      status: {
        type: DataTypes.ENUM('active', 'disabled', 'unverified'),
        defaultValue: 'unverified',
      },
      source: {
        type: DataTypes.ENUM('system', 'wechat', 'email', 'invite'),
        defaultValue: 'system',
      },
      timezone: DataTypes.STRING(64),
      locale: {
        type: DataTypes.STRING(16),
        defaultValue: 'zh-CN',
      },
      lastActiveAt: { type: DataTypes.DATE },
      meta: { type: DataTypes.JSON },
      version: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
      updatedAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
      deletedAt: { type: DataTypes.DATE },
    },
    {
      sequelize,
      paranoid: true,
      tableName: DataBaseTableNames.User,
      modelName: DataBaseTableNames.User,
      indexes: [
        { fields: ['created_at'] },
        { fields: ['status'] },
        { fields: ['last_active_at'] },
        { fields: ['source', 'created_at'] }, // 联合索引
        {
          fields: ['user_id'],
          unique: true,
          using: 'HASH', // 对UUID字段优化
        },
      ],
      hooks: {
        beforeUpdate: (user: UserTable) => {
          user.version += 1; // 乐观锁版本控制
        },
      },
      timestamps: true,
    },
  );
}
