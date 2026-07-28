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
        field: 'user_id',
      },
      subscriptionId: {
        type: DataTypes.STRING(36),
        allowNull: true,
        field: 'subscription_id',
      },
      orderNo: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true,
        field: 'order_no',
      },
      amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        field: 'amount',
      },
      currency: {
        type: DataTypes.STRING(3),
        allowNull: false,
        defaultValue: 'CNY',
        field: 'currency',
      },
      paymentMethod: {
        type: DataTypes.STRING(50),
        allowNull: false,
        field: 'payment_method',
      },
      paymentProvider: {
        type: DataTypes.STRING(50),
        allowNull: false,
        field: 'payment_provider',
      },
      providerOrderId: {
        type: DataTypes.STRING(100),
        allowNull: true,
        field: 'provider_order_id',
      },
      status: {
        type: DataTypes.ENUM('pending', 'paid', 'failed', 'cancelled', 'refunded'),
        allowNull: false,
        defaultValue: 'pending',
        field: 'status',
      },
      paidAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'paid_at',
      },
      failedReason: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: 'failed_reason',
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
      modelName: 'PaymentOrder',
      tableName: 'payment_orders',
      timestamps: true,
      indexes: [
        {
          fields: ['user_id'],
        },
        {
          fields: ['order_no'],
          unique: true,
        },
        {
          fields: ['status'],
        },
        {
          fields: ['payment_provider'],
        },
        {
          fields: ['provider_order_id'],
        },
      ],
    },
  );

  return PaymentOrderTable;
}

export { PaymentOrderTable, PaymentOrderAttributes, PaymentOrderCreationAttributes };
