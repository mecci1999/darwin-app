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
      },
      reminderType: {
        type: DataTypes.ENUM('email', 'sms', 'push'),
        allowNull: false,
      },
      daysBefore: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      isEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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
      tableName: 'billing_reminder_settings',
      timestamps: true,
      indexes: [
        {
          fields: ['userId', 'reminderType'],
          unique: true,
        },
        {
          fields: ['isEnabled'],
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
