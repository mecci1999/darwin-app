import { DataTypes, Model, Sequelize } from 'sequelize';

// 账单项目模型接口
interface BillItemAttributes {
  id: string;
  billId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  metadata?: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
}

interface BillItemCreationAttributes
  extends Omit<BillItemAttributes, 'id' | 'createdAt' | 'updatedAt'> {
  id?: string;
}

class BillItemTable
  extends Model<BillItemAttributes, BillItemCreationAttributes>
  implements BillItemAttributes
{
  public id!: string;
  public billId!: string;
  public description!: string;
  public quantity!: number;
  public unitPrice!: number;
  public amount!: number;
  public metadata?: Record<string, any>;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export default function (sequelize: Sequelize) {
  BillItemTable.init(
    {
      id: {
        type: DataTypes.STRING(36),
        primaryKey: true,
        allowNull: false,
      },
      billId: {
        type: DataTypes.STRING(36),
        allowNull: false,
      },
      description: {
        type: DataTypes.STRING(500),
        allowNull: false,
      },
      quantity: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      unitPrice: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      amount: {
        type: DataTypes.DECIMAL(10, 2),
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
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      tableName: 'bill_items',
      timestamps: true,
      indexes: [
        {
          fields: ['billId'],
        },
      ],
    },
  );

  return BillItemTable;
}

export { BillItemTable, BillItemAttributes, BillItemCreationAttributes };
