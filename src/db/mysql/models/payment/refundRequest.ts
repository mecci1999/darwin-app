import { DataTypes, Model, Sequelize } from 'sequelize';

// 退款申请模型接口
interface RefundRequestAttributes {
  id: string;
  paymentOrderId: string;
  userId: string;
  refundAmount: number;
  refundReason: string;
  status: 'pending' | 'approved' | 'rejected' | 'processed';
  adminNotes?: string;
  processedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

interface RefundRequestCreationAttributes
  extends Omit<RefundRequestAttributes, 'id' | 'createdAt' | 'updatedAt'> {
  id?: string;
}

class RefundRequestTable
  extends Model<RefundRequestAttributes, RefundRequestCreationAttributes>
  implements RefundRequestAttributes
{
  public id!: string;
  public paymentOrderId!: string;
  public userId!: string;
  public refundAmount!: number;
  public refundReason!: string;
  public status!: 'pending' | 'approved' | 'rejected' | 'processed';
  public adminNotes?: string;
  public processedAt?: Date;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export default function (sequelize: Sequelize) {
  RefundRequestTable.init(
    {
      id: {
        type: DataTypes.STRING(36),
        primaryKey: true,
        allowNull: false,
      },
      paymentOrderId: {
        type: DataTypes.STRING(36),
        allowNull: false,
        field: 'payment_order_id',
      },
      userId: {
        type: DataTypes.STRING(36),
        allowNull: false,
        field: 'user_id',
      },
      refundAmount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        field: 'refund_amount',
      },
      refundReason: {
        type: DataTypes.TEXT,
        allowNull: false,
        field: 'refund_reason',
      },
      status: {
        type: DataTypes.ENUM('pending', 'approved', 'rejected', 'processed'),
        allowNull: false,
        defaultValue: 'pending',
        field: 'status',
      },
      adminNotes: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: 'admin_notes',
      },
      processedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'processed_at',
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
      tableName: 'refund_requests',
      timestamps: true,
      indexes: [
        {
          fields: ['payment_order_id'],
        },
        {
          fields: ['user_id'],
        },
        {
          fields: ['status'],
        },
      ],
    },
  );

  return RefundRequestTable;
}

export { RefundRequestTable, RefundRequestAttributes, RefundRequestCreationAttributes };
