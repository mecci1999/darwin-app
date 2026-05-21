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
        field: 'user_id',
      },
      billNo: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true,
        field: 'bill_no',
      },
      billingPeriodStart: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        field: 'billing_period_start',
      },
      billingPeriodEnd: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        field: 'billing_period_end',
      },
      subtotal: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        field: 'subtotal',
      },
      tax: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
        field: 'tax',
      },
      total: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        field: 'total',
      },
      currency: {
        type: DataTypes.STRING(3),
        allowNull: false,
        defaultValue: 'CNY',
        field: 'currency',
      },
      status: {
        type: DataTypes.ENUM('draft', 'sent', 'paid', 'overdue', 'cancelled'),
        allowNull: false,
        defaultValue: 'draft',
        field: 'status',
      },
      dueDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        field: 'due_date',
      },
      paidAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'paid_at',
      },
      invoiceUrl: {
        type: DataTypes.STRING(500),
        allowNull: true,
        field: 'invoice_url',
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
      tableName: 'bills',
      timestamps: true,
      indexes: [
        {
          fields: ['user_id'],
        },
        {
          fields: ['bill_no'],
          unique: true,
        },
        {
          fields: ['status'],
        },
        {
          fields: ['due_date'],
        },
        {
          fields: ['billing_period_start', 'billing_period_end'],
        },
      ],
    },
  );

  return BillTable;
}

export { BillTable, BillAttributes, BillCreationAttributes };
