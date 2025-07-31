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
      },
      userId: {
        type: DataTypes.STRING(36),
        allowNull: false,
      },
      refundAmount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      refundReason: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM('pending', 'approved', 'rejected', 'processed'),
        allowNull: false,
        defaultValue: 'pending',
      },
      adminNotes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      processedAt: {
        type: DataTypes.DATE,
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
      tableName: 'refund_requests',
      timestamps: true,
      indexes: [
        {
          fields: ['paymentOrderId'],
        },
        {
          fields: ['userId'],
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
