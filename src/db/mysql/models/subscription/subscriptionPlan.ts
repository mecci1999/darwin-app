import { DataTypes, Model, Sequelize } from 'sequelize';

// 订阅计划模型接口
interface SubscriptionPlanAttributes {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  price: number;
  currency: string;
  billingCycle: 'monthly' | 'yearly';
  features: Record<string, any>;
  limits: Record<string, any>;
  isActive: boolean;
  sortOrder: number;
  createdAt?: Date;
  updatedAt?: Date;
}

interface SubscriptionPlanCreationAttributes
  extends Omit<SubscriptionPlanAttributes, 'id' | 'createdAt' | 'updatedAt'> {
  id?: string;
}

class SubscriptionPlanTable
  extends Model<SubscriptionPlanAttributes, SubscriptionPlanCreationAttributes>
  implements SubscriptionPlanAttributes
{
  public id!: string;
  public name!: string;
  public displayName!: string;
  public description?: string;
  public price!: number;
  public currency!: string;
  public billingCycle!: 'monthly' | 'yearly';
  public features!: Record<string, any>;
  public limits!: Record<string, any>;
  public isActive!: boolean;
  public sortOrder!: number;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export default function (sequelize: Sequelize) {
  SubscriptionPlanTable.init(
    {
      id: {
        type: DataTypes.STRING(36),
        primaryKey: true,
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true,
      },
      displayName: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      price: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      currency: {
        type: DataTypes.STRING(3),
        allowNull: false,
        defaultValue: 'USD',
      },
      billingCycle: {
        type: DataTypes.ENUM('monthly', 'yearly'),
        allowNull: false,
      },
      features: {
        type: DataTypes.JSON,
        allowNull: false,
      },
      limits: {
        type: DataTypes.JSON,
        allowNull: false,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      sortOrder: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
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
      tableName: 'subscription_plans',
      timestamps: true,
      indexes: [
        {
          fields: ['name'],
          unique: true,
        },
        {
          fields: ['isActive'],
        },
        {
          fields: ['sortOrder'],
        },
      ],
    },
  );

  return SubscriptionPlanTable;
}

export { SubscriptionPlanTable, SubscriptionPlanAttributes, SubscriptionPlanCreationAttributes };
