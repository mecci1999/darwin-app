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
      },
      quotaType: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      usageAmount: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      usageDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
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
    },
    {
      sequelize,
      tableName: 'quota_usage_history',
      timestamps: false,
      indexes: [
        {
          fields: ['userId', 'usageDate'],
        },
        {
          fields: ['quotaType'],
        },
        {
          fields: ['usageDate'],
        },
      ],
    },
  );

  return QuotaUsageHistoryTable;
}

export { QuotaUsageHistoryTable, QuotaUsageHistoryAttributes, QuotaUsageHistoryCreationAttributes };
