import { DataTypes, Model, Sequelize } from 'sequelize';
import { DataBaseTableNames } from 'typings';

export interface IMicroAppInstallTableAttributes {
  id?: number;
  appId: string;
  version: string;
  userId: string;
  tenantId?: string;
  status: 'downloaded' | 'opened' | 'uninstalled';
  packageSha256?: string;
  lastOpenedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export class MicroAppInstallTable
  extends Model<IMicroAppInstallTableAttributes>
  implements IMicroAppInstallTableAttributes {
  public id!: number;
  public appId!: string;
  public version!: string;
  public userId!: string;
  public tenantId!: string | undefined;
  public status!: 'downloaded' | 'opened' | 'uninstalled';
  public packageSha256!: string | undefined;
  public lastOpenedAt!: Date | undefined;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export default function (sequelize: Sequelize) {
  return MicroAppInstallTable.init(
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      appId: { type: DataTypes.STRING(96), field: 'app_id', allowNull: false },
      version: { type: DataTypes.STRING(64), allowNull: false },
      userId: { type: DataTypes.STRING(64), field: 'user_id', allowNull: false },
      tenantId: { type: DataTypes.STRING(64), field: 'tenant_id' },
      status: { type: DataTypes.ENUM('downloaded', 'opened', 'uninstalled'), defaultValue: 'downloaded' },
      packageSha256: { type: DataTypes.STRING(128), field: 'package_sha256' },
      lastOpenedAt: { type: DataTypes.DATE, field: 'last_opened_at' },
      createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
      updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    },
    {
      sequelize,
      tableName: DataBaseTableNames.MicroAppInstall,
      modelName: DataBaseTableNames.MicroAppInstall,
      indexes: [{ fields: ['app_id', 'version'] }, { fields: ['user_id', 'app_id'] }, { fields: ['tenant_id'] }],
      timestamps: true,
    },
  );
}
