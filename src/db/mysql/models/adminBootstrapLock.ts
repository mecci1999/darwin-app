import { DataTypes, Model, Sequelize } from 'sequelize';
import { DataBaseTableNames } from 'typings';

export interface IAdminBootstrapLockAttributes {
  lockId: number;
}

export class AdminBootstrapLockTable
  extends Model<IAdminBootstrapLockAttributes>
  implements IAdminBootstrapLockAttributes
{
  public lockId!: number;
}

export default function (sequelize: Sequelize) {
  return AdminBootstrapLockTable.init(
    {
      lockId: {
        type: DataTypes.TINYINT,
        field: 'lock_id',
        allowNull: false,
        primaryKey: true,
      },
    },
    {
      sequelize,
      tableName: DataBaseTableNames.AdminBootstrapLock,
      modelName: DataBaseTableNames.AdminBootstrapLock,
      timestamps: false,
    },
  );
}
