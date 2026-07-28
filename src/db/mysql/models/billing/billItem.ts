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
        field: 'bill_id',
      },
      description: {
        type: DataTypes.STRING(500),
        allowNull: false,
        field: 'description',
      },
      quantity: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        field: 'quantity',
      },
      unitPrice: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        field: 'unit_price',
      },
      amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        field: 'amount',
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
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'updated_at',
      },
    },
    {
      sequelize,
      modelName: 'BillItem',
      tableName: 'bill_items',
      timestamps: true,
      indexes: [
        {
          fields: ['bill_id'],
        },
      ],
    },
  );

  return BillItemTable;
}

export { BillItemTable, BillItemAttributes, BillItemCreationAttributes };
