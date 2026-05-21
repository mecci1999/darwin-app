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
        field: 'user_id',
      },
      companyName: {
        type: DataTypes.STRING(200),
        allowNull: true,
        field: 'company_name',
      },
      contactName: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: 'contact_name',
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: 'email',
      },
      phone: {
        type: DataTypes.STRING(50),
        allowNull: true,
        field: 'phone',
      },
      country: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: 'country',
      },
      state: {
        type: DataTypes.STRING(100),
        allowNull: true,
        field: 'state',
      },
      city: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: 'city',
      },
      address: {
        type: DataTypes.TEXT,
        allowNull: false,
        field: 'address',
      },
      postalCode: {
        type: DataTypes.STRING(20),
        allowNull: true,
        field: 'postal_code',
      },
      taxId: {
        type: DataTypes.STRING(50),
        allowNull: true,
        field: 'tax_id',
      },
      isDefault: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: 'is_default',
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
      tableName: 'user_billing_addresses',
      timestamps: true,
      indexes: [
        {
          fields: ['user_id'],
        },
        {
          fields: ['user_id', 'is_default'],
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
