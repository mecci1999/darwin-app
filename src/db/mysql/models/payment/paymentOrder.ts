import { DataTypes, Model, Sequelize } from 'sequelize';

// 支付订单模型接口
interface PaymentOrderAttributes {
  id: string;
  userId: string;
  subscriptionId?: string;
  orderNo: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  paymentProvider: string;
  providerOrderId?: string;
  status: 'pending' | 'paid' | 'failed' | 'cancelled' | 'refunded';
  paidAt?: Date;
  failedReason?: string;
  metadata?: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
}

interface PaymentOrderCreationAttributes
  extends Omit<PaymentOrderAttributes, 'id' | 'createdAt' | 'updatedAt'> {
  id?: string;
}

class PaymentOrderTable
  extends Model<PaymentOrderAttributes, PaymentOrderCreationAttributes>
  implements PaymentOrderAttributes
{
  public id!: string;
  public userId!: string;
  public subscriptionId?: string;
  public orderNo!: string;
  public amount!: number;
  public currency!: string;
  public paymentMethod!: string;
  public paymentProvider!: string;
  public providerOrderId?: string;
  public status!: 'pending' | 'paid' | 'failed' | 'cancelled' | 'refunded';
  public paidAt?: Date;
  public failedReason?: string;
  public metadata?: Record<string, any>;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export default function (sequelize: Sequelize) {
  PaymentOrderTable.init(
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
      subscriptionId: {
        type: DataTypes.STRING(36),
        allowNull: true,
      },
      orderNo: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true,
      },
      amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      currency: {
        type: DataTypes.STRING(3),
        allowNull: false,
        defaultValue: 'CNY',
      },
      paymentMethod: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      paymentProvider: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      providerOrderId: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM('pending', 'paid', 'failed', 'cancelled', 'refunded'),
        allowNull: false,
        defaultValue: 'pending',
      },
      paidAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      failedReason: {
        type: DataTypes.TEXT,
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
      tableName: 'payment_orders',
      timestamps: true,
      indexes: [
        {
          fields: ['userId'],
        },
        {
          fields: ['orderNo'],
          unique: true,
        },
        {
          fields: ['status'],
        },
        {
          fields: ['paymentProvider'],
        },
        {
          fields: ['providerOrderId'],
        },
      ],
    },
  );

  return PaymentOrderTable;
}

export { PaymentOrderTable, PaymentOrderAttributes, PaymentOrderCreationAttributes };
