import { DataTypes, Model, Sequelize } from 'sequelize';

// 用户账单地址模型接口
interface UserBillingAddressAttributes {
  id: string;
  userId: string;
  companyName?: string;
  contactName: string;
  email: string;
  phone?: string;
  country: string;
  state?: string;
  city: string;
  address: string;
  postalCode?: string;
  taxId?: string;
  isDefault: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

interface UserBillingAddressCreationAttributes
  extends Omit<UserBillingAddressAttributes, 'id' | 'createdAt' | 'updatedAt'> {
  id?: string;
}

class UserBillingAddressTable
  extends Model<UserBillingAddressAttributes, UserBillingAddressCreationAttributes>
  implements UserBillingAddressAttributes
{
  public id!: string;
  public userId!: string;
  public companyName?: string;
  public contactName!: string;
  public email!: string;
  public phone?: string;
  public country!: string;
  public state?: string;
  public city!: string;
  public address!: string;
  public postalCode?: string;
  public taxId?: string;
  public isDefault!: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export default function (sequelize: Sequelize) {
  UserBillingAddressTable.init(
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
      companyName: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },
      contactName: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      phone: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      country: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      state: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      city: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      address: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      postalCode: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      taxId: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      isDefault: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
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
      tableName: 'user_billing_addresses',
      timestamps: true,
      indexes: [
        {
          fields: ['userId'],
        },
        {
          fields: ['userId', 'isDefault'],
        },
      ],
    },
  );

  return UserBillingAddressTable;
}

export {
  UserBillingAddressTable,
  UserBillingAddressAttributes,
  UserBillingAddressCreationAttributes,
};
