import { DataTypes, Model, Sequelize } from 'sequelize';

// 账单模型接口
interface BillAttributes {
  id: string;
  userId: string;
  billNo: string;
  billingPeriodStart: Date;
  billingPeriodEnd: Date;
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
  dueDate: Date;
  paidAt?: Date;
  invoiceUrl?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

interface BillCreationAttributes extends Omit<BillAttributes, 'id' | 'createdAt' | 'updatedAt'> {
  id?: string;
}

class BillTable extends Model<BillAttributes, BillCreationAttributes> implements BillAttributes {
  public id!: string;
  public userId!: string;
  public billNo!: string;
  public billingPeriodStart!: Date;
  public billingPeriodEnd!: Date;
  public subtotal!: number;
  public tax!: number;
  public total!: number;
  public currency!: string;
  public status!: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
  public dueDate!: Date;
  public paidAt?: Date;
  public invoiceUrl?: string;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export default function (sequelize: Sequelize) {
  BillTable.init(
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
      billNo: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true,
      },
      billingPeriodStart: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      billingPeriodEnd: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      subtotal: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      tax: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      total: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      currency: {
        type: DataTypes.STRING(3),
        allowNull: false,
        defaultValue: 'CNY',
      },
      status: {
        type: DataTypes.ENUM('draft', 'sent', 'paid', 'overdue', 'cancelled'),
        allowNull: false,
        defaultValue: 'draft',
      },
      dueDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      paidAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      invoiceUrl: {
        type: DataTypes.STRING(500),
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
      tableName: 'bills',
      timestamps: true,
      indexes: [
        {
          fields: ['userId'],
        },
        {
          fields: ['billNo'],
          unique: true,
        },
        {
          fields: ['status'],
        },
        {
          fields: ['dueDate'],
        },
        {
          fields: ['billingPeriodStart', 'billingPeriodEnd'],
        },
      ],
    },
  );

  return BillTable;
}

export { BillTable, BillAttributes, BillCreationAttributes };
