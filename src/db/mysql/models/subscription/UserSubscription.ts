import { DataTypes, Model, Sequelize } from 'sequelize';

// 用户订阅模型接口
interface UserSubscriptionAttributes {
  id: string;
  userId: string;
  planName: string;
  billingCycle: 'monthly' | 'yearly';
  status: 'active' | 'cancelled' | 'expired' | 'suspended';
  startedAt: Date;
  expiresAt?: Date;
  cancelledAt?: Date;
  cancelAtPeriodEnd: boolean;
  trialEndsAt?: Date;
  metadata?: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
}

interface UserSubscriptionCreationAttributes
  extends Omit<UserSubscriptionAttributes, 'id' | 'createdAt' | 'updatedAt'> {
  id?: string;
}

class UserSubscriptionTable
  extends Model<UserSubscriptionAttributes, UserSubscriptionCreationAttributes>
  implements UserSubscriptionAttributes
{
  public id!: string;
  public userId!: string;
  public planName!: string;
  public billingCycle!: 'monthly' | 'yearly';
  public status!: 'active' | 'cancelled' | 'expired' | 'suspended';
  public startedAt!: Date;
  public expiresAt?: Date;
  public cancelledAt?: Date;
  public cancelAtPeriodEnd!: boolean;
  public trialEndsAt?: Date;
  public metadata?: Record<string, any>;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export default function (sequelize: Sequelize) {
  UserSubscriptionTable.init(
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
      planName: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      billingCycle: {
        type: DataTypes.ENUM('monthly', 'yearly'),
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM('active', 'cancelled', 'expired', 'suspended'),
        allowNull: false,
        defaultValue: 'active',
      },
      startedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      cancelledAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      cancelAtPeriodEnd: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      trialEndsAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      metadata: {
        type: DataTypes.JSON,
        allowNull: true,
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
      tableName: 'user_subscriptions',
      timestamps: true,
      indexes: [
        {
          fields: ['userId'],
        },
        {
          fields: ['status'],
        },
        {
          fields: ['expiresAt'],
        },
        {
          fields: ['planName'],
        },
      ],
    },
  );

  return UserSubscriptionTable;
}

export { UserSubscriptionTable, UserSubscriptionAttributes, UserSubscriptionCreationAttributes };
