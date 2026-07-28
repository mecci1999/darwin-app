import { DataTypes, Model, Sequelize } from 'sequelize';

// 账单提醒设置模型接口
interface BillingReminderSettingAttributes {
  id: string;
  userId: string;
  reminderType: 'email' | 'sms' | 'push';
  daysBefore: number;
  isEnabled: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

interface BillingReminderSettingCreationAttributes
  extends Omit<BillingReminderSettingAttributes, 'id' | 'createdAt' | 'updatedAt'> {
  id?: string;
}

class BillingReminderSettingTable
  extends Model<BillingReminderSettingAttributes, BillingReminderSettingCreationAttributes>
  implements BillingReminderSettingAttributes
{
  public id!: string;
  public userId!: string;
  public reminderType!: 'email' | 'sms' | 'push';
  public daysBefore!: number;
  public isEnabled!: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export default function (sequelize: Sequelize) {
  BillingReminderSettingTable.init(
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
      reminderType: {
        type: DataTypes.ENUM('email', 'sms', 'push'),
        allowNull: false,
        field: 'reminder_type',
      },
      daysBefore: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'days_before',
      },
      isEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        field: 'is_enabled',
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
      modelName: 'BillingReminderSetting',
      tableName: 'billing_reminder_settings',
      timestamps: true,
      indexes: [
        {
          fields: ['user_id', 'reminder_type'],
          unique: true,
        },
        {
          fields: ['is_enabled'],
        },
      ],
    },
  );

  return BillingReminderSettingTable;
}

export {
  BillingReminderSettingTable,
  BillingReminderSettingAttributes,
  BillingReminderSettingCreationAttributes,
};
