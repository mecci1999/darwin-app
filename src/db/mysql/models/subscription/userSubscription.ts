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
        field: 'user_id',
      },
      planName: {
        type: DataTypes.STRING(50),
        allowNull: false,
        field: 'plan_name',
      },
      billingCycle: {
        type: DataTypes.ENUM('monthly', 'yearly'),
        allowNull: false,
        field: 'billing_cycle',
      },
      status: {
        type: DataTypes.ENUM('active', 'cancelled', 'expired', 'suspended'),
        allowNull: false,
        defaultValue: 'active',
        field: 'status',
      },
      startedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'started_at',
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'expires_at',
      },
      cancelledAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'cancelled_at',
      },
      cancelAtPeriodEnd: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: 'cancel_at_period_end',
      },
      trialEndsAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'trial_ends_at',
      },
      metadata: {
        type: DataTypes.JSON,
        allowNull: true,
        field: 'metadata',
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'created_at',
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'updated_at',
      },
    },
    {
      sequelize,
      tableName: 'user_subscriptions',
      timestamps: true,
      indexes: [
        {
          fields: ['user_id'],
        },
        {
          fields: ['status'],
        },
        {
          fields: ['expires_at'],
        },
        {
          fields: ['plan_name'],
        },
      ],
    },
  );

  return UserSubscriptionTable;
}

export { UserSubscriptionTable, UserSubscriptionAttributes, UserSubscriptionCreationAttributes };
