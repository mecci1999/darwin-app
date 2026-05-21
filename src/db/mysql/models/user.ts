/**
 * 用户表
 */
import { DataTypes, Model, Optional, Sequelize } from 'sequelize';
import { DataBaseTableNames } from 'typings';

export interface IUserTableAttributes {
  id?: number;
  userId: string;
  nickname?: string;
  avatar?: string;
  status: string;
  source: string;
  power?: number; // 用户权限等级
  devices?: string; // 存储多设备登录信息的JSON字符串
  timezone?: string;
  locale?: string;
  lastActiveAt?: Date;
  meta?: string; // 扩展元数据的JSON字符串
  version?: number;
  // 多应用支持字段
  tenantId?: string; // 租户ID，支持多租户架构
  applicationIds?: string; // 用户可访问的应用ID列表，JSON字符串

  /**
   * @StarlightExclusive
   * 是否已完成接入向导
   * 仅 starlight 应用内生效
   */
  isOnboardingCompleted?: boolean;

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
  public devices!: string | undefined;
  public timezone!: string | undefined;
  public locale!: string | undefined;
  public lastActiveAt!: Date | undefined;
  public meta!: string | undefined;
  public version!: number;
  // 多应用支持字段
  public tenantId!: string | undefined;
  public applicationIds!: string | undefined;

  /**
   * @StarlightExclusive
   */
  public isOnboardingCompleted!: boolean | undefined;

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
      meta: {
        type: DataTypes.TEXT,
        defaultValue: '{}',
        comment: '扩展元数据的JSON字符串',
        validate: {
          isValidJSON(value: any) {
            if (value && typeof value === 'string') {
              try {
                JSON.parse(value);
              } catch (error) {
                throw new Error('meta字段必须是有效的JSON字符串');
              }
            }
          },
        },
      },
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
        type: DataTypes.TEXT,
        defaultValue: '{}',
        comment: '多设备登录信息的JSON字符串',
        validate: {
          isValidJSON(value: any) {
            if (value && typeof value === 'string') {
              try {
                const parsed = JSON.parse(value);
                // 验证设备信息格式
                if (parsed && typeof parsed === 'object') {
                  for (const [deviceType, deviceInfo] of Object.entries(parsed)) {
                    if (!['web', 'mobile', 'desktop'].includes(deviceType)) {
                      throw new Error(`Invalid device type: ${deviceType}`);
                    }
                  }
                }
              } catch (error) {
                if (error instanceof SyntaxError) {
                  throw new Error('devices字段必须是有效的JSON字符串');
                }
                throw error;
              }
            }
          },
        },
      },
      // 多应用支持字段
      tenantId: {
        type: DataTypes.STRING(64),
        field: 'tenant_id',
        comment: '租户ID，支持多租户架构',
      },
      applicationIds: {
        type: DataTypes.TEXT,
        field: 'application_ids',
        defaultValue: '[]',
        comment: '用户可访问的应用ID列表，JSON数组字符串',
        validate: {
          isValidJSON(value: any) {
            if (value && typeof value === 'string') {
              try {
                const parsed = JSON.parse(value);
                if (!Array.isArray(parsed)) {
                  throw new Error('applicationIds必须是JSON数组格式');
                }
              } catch (error) {
                if (error instanceof SyntaxError) {
                  throw new Error('applicationIds字段必须是有效的JSON字符串');
                }
                throw error;
              }
            }
          },
        },
      },
      /**
       * @StarlightExclusive
       * 仅 starlight 应用使用
       */
      isOnboardingCompleted: {
        type: DataTypes.BOOLEAN,
        field: 'is_onboarding_completed',
        allowNull: true,
        defaultValue: false,
        comment: '是否已完成接入向导 (Starlight Exclusive)',
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
        // 多应用支持索引
        { fields: ['tenant_id'] },
        { fields: ['tenant_id', 'status'] },
        { fields: ['tenant_id', 'created_at'] },
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
