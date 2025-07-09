import { DataTypes, Model, Sequelize } from 'sequelize';

// 支付方式配置模型接口
interface PaymentProviderAttributes {
  id: string;
  providerName: string;
  displayName: string;
  isEnabled: boolean;
  supportedMethods: string[];
  config: Record<string, any>;
  sortOrder: number;
  createdAt?: Date;
  updatedAt?: Date;
}

interface PaymentProviderCreationAttributes
  extends Omit<PaymentProviderAttributes, 'id' | 'createdAt' | 'updatedAt'> {
  id?: string;
}

class PaymentProviderTable
  extends Model<PaymentProviderAttributes, PaymentProviderCreationAttributes>
  implements PaymentProviderAttributes
{
  public id!: string;
  public providerName!: string;
  public displayName!: string;
  public isEnabled!: boolean;
  public supportedMethods!: string[];
  public config!: Record<string, any>;
  public sortOrder!: number;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export default function (sequelize: Sequelize) {
  PaymentProviderTable.init(
    {
      id: {
        type: DataTypes.STRING(36),
        primaryKey: true,
        allowNull: false,
      },
      providerName: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true,
      },
      displayName: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      isEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      supportedMethods: {
        type: DataTypes.JSON,
        allowNull: false,
      },
      config: {
        type: DataTypes.JSON,
        allowNull: false,
      },
      sortOrder: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
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
      tableName: 'payment_providers',
      timestamps: true,
      indexes: [
        {
          fields: ['providerName'],
          unique: true,
        },
        {
          fields: ['isEnabled'],
        },
        {
          fields: ['sortOrder'],
        },
      ],
    },
  );

  return PaymentProviderTable;
}

export { PaymentProviderTable, PaymentProviderAttributes, PaymentProviderCreationAttributes };
