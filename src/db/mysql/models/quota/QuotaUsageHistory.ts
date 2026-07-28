import { DataTypes, Model, Sequelize } from 'sequelize';

// 配额使用历史模型接口
interface QuotaUsageHistoryAttributes {
  id: string;
  userId: string;
  quotaType: string;
  usageAmount: number;
  usageDate: Date;
  metadata?: Record<string, any>;
  createdAt?: Date;
}

interface QuotaUsageHistoryCreationAttributes
  extends Omit<QuotaUsageHistoryAttributes, 'id' | 'createdAt'> {
  id?: string;
}

class QuotaUsageHistoryTable
  extends Model<QuotaUsageHistoryAttributes, QuotaUsageHistoryCreationAttributes>
  implements QuotaUsageHistoryAttributes
{
  public id!: string;
  public userId!: string;
  public quotaType!: string;
  public usageAmount!: number;
  public usageDate!: Date;
  public metadata?: Record<string, any>;
  public readonly createdAt!: Date;
}

export default function (sequelize: Sequelize) {
  QuotaUsageHistoryTable.init(
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
      quotaType: {
        type: DataTypes.STRING(50),
        allowNull: false,
        field: 'quota_type',
      },
      usageAmount: {
        type: DataTypes.BIGINT,
        allowNull: false,
        field: 'usage_amount',
      },
      usageDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        field: 'usage_date',
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
    },
    {
      sequelize,
      modelName: 'QuotaUsageHistory',
      tableName: 'quota_usage_history',
      timestamps: false,
      indexes: [
        {
          fields: ['user_id', 'usage_date'],
        },
        {
          fields: ['quota_type'],
        },
        {
          fields: ['usage_date'],
        },
      ],
    },
  );

  return QuotaUsageHistoryTable;
}

export { QuotaUsageHistoryTable, QuotaUsageHistoryAttributes, QuotaUsageHistoryCreationAttributes };
