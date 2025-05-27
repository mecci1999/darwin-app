/**
 * 用户表
 */
import { DataTypes, Model, Optional, Sequelize } from 'sequelize';
import { DataBaseTableNames } from 'typings/enum';

export interface IUserTableAttributes {
  id?: number;
  userId: string;
  nickname?: string;
  avatar?: string;
  status: string;
  source: string;
  power?: number; // 用户权限等级
  devices?: object; // 存储多设备登录信息
  timezone?: string;
  locale?: string;
  lastActiveAt?: Date;
  meta?: object;
  version?: number;
  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date;
}

export class UserTable extends Model<IUserTableAttributes> implements IUserTableAttributes {
  public id!: number;
  public userId!: string;
  public nickname!: string | undefined;
  public avatar!: string | undefined;
  public status!: string;
  public source!: string;
  public power!: number | undefined;
  public devices!: object | undefined;
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
        type: DataTypes.STRING(64),
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
        defaultValue: '',
        // validate: {
        //   isUrl: true, // 验证URL格式
        //   // contains: 'cdn.com', // 限制CDN域名
        // },
      },
      status: {
        type: DataTypes.ENUM('active', 'disabled', 'unverified'),
        defaultValue: 'unverified',
      },
      source: {
        type: DataTypes.ENUM('system', 'wechat', 'email', 'invite'),
        defaultValue: 'system',
      },
      timezone: { type: DataTypes.STRING(64), defaultValue: 'UTC+8' },
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
      power: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        validate: {
          min: 0,
          max: 999,
        },
        comment: '用户权限等级，数值越高权限越大',
      },
      devices: {
        type: DataTypes.JSON,
        defaultValue: {},
        comment: '多设备登录信息',
        validate: {
          isValidDevices(value: any) {
            if (value && typeof value === 'object') {
              // 验证设备信息格式
              for (const [deviceType, deviceInfo] of Object.entries(value)) {
                if (!['web', 'mobile', 'desktop'].includes(deviceType)) {
                  throw new Error(`Invalid device type: ${deviceType}`);
                }
              }
            }
          },
        },
      },
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
        { fields: ['power'] },
        { fields: ['source', 'created_at'] },
        {
          fields: ['user_id'],
          unique: true,
          // using: 'HASH', // 对UUID字段优化
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
