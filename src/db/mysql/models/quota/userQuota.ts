import { DataTypes, Model, Sequelize } from 'sequelize';

// 用户配额模型接口
interface UserQuotaAttributes {
  id: string;
  userId: string;
  quotaType: string;
  quotaLimit: number;
  quotaUsed: number;
  resetPeriod: 'daily' | 'monthly' | 'yearly' | 'never';
  lastResetAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

interface UserQuotaCreationAttributes
  extends Omit<UserQuotaAttributes, 'id' | 'createdAt' | 'updatedAt'> {
  id?: string;
}

class UserQuotaTable
  extends Model<UserQuotaAttributes, UserQuotaCreationAttributes>
  implements UserQuotaAttributes
{
  public id!: string;
  public userId!: string;
  public quotaType!: string;
  public quotaLimit!: number;
  public quotaUsed!: number;
  public resetPeriod!: 'daily' | 'monthly' | 'yearly' | 'never';
  public lastResetAt!: Date;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export default function (sequelize: Sequelize) {
  UserQuotaTable.init(
    {
      id: {
        type: DataTypes.STRING(36),
        primaryKey: true,
        allowNull: false,
      },
      userId: {
        type: DataTypes.STRING(36),
        allowNull: false,
      },
      quotaType: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      quotaLimit: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      quotaUsed: {
        type: DataTypes.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      resetPeriod: {
        type: DataTypes.ENUM('daily', 'monthly', 'yearly', 'never'),
        allowNull: false,
        defaultValue: 'monthly',
      },
      lastResetAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      tableName: 'user_quotas',
      timestamps: true,
      indexes: [
        {
          fields: ['userId', 'quotaType'],
          unique: true,
        },
        {
          fields: ['userId'],
        },
        {
          fields: ['quotaType'],
        },
      ],
    },
  );

  return UserQuotaTable;
}

export { UserQuotaTable, UserQuotaAttributes, UserQuotaCreationAttributes };
