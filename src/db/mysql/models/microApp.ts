import { DataTypes, Model, Sequelize } from 'sequelize';
import { DataBaseTableNames } from 'typings';

export interface IMicroAppTableAttributes {
  id?: number;
  appId: string;
  name: string;
  description?: string;
  ownerUserId: string;
  tenantId?: string;
  visibility: 'public' | 'tenant' | 'allowlist';
  status: 'active' | 'disabled';
  allowedUsers?: string;
  rolloutUsers?: string;
  rolloutTenants?: string;
  rolloutPercent?: number;
  releaseChannel?: 'stable' | 'beta' | 'dev';
  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date;
}

export class MicroAppTable extends Model<IMicroAppTableAttributes> implements IMicroAppTableAttributes {
  public id!: number;
  public appId!: string;
  public name!: string;
  public description!: string | undefined;
  public ownerUserId!: string;
  public tenantId!: string | undefined;
  public visibility!: 'public' | 'tenant' | 'allowlist';
  public status!: 'active' | 'disabled';
  public allowedUsers!: string | undefined;
  public rolloutUsers!: string | undefined;
  public rolloutTenants!: string | undefined;
  public rolloutPercent!: number | undefined;
  public releaseChannel!: 'stable' | 'beta' | 'dev' | undefined;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
  public deletedAt!: Date | undefined;
}

export default function (sequelize: Sequelize) {
  return MicroAppTable.init(
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      appId: { type: DataTypes.STRING(96), field: 'app_id', allowNull: false, unique: true },
      name: { type: DataTypes.STRING(128), allowNull: false },
      description: { type: DataTypes.TEXT },
      ownerUserId: { type: DataTypes.STRING(64), field: 'owner_user_id', allowNull: false },
      tenantId: { type: DataTypes.STRING(64), field: 'tenant_id' },
      visibility: { type: DataTypes.ENUM('public', 'tenant', 'allowlist'), defaultValue: 'tenant' },
      status: { type: DataTypes.ENUM('active', 'disabled'), defaultValue: 'active' },
      allowedUsers: { type: DataTypes.TEXT, field: 'allowed_users', defaultValue: '[]' },
      rolloutUsers: { type: DataTypes.TEXT, field: 'rollout_users', defaultValue: '[]' },
      rolloutTenants: { type: DataTypes.TEXT, field: 'rollout_tenants', defaultValue: '[]' },
      rolloutPercent: { type: DataTypes.INTEGER, field: 'rollout_percent', defaultValue: 100 },
      releaseChannel: { type: DataTypes.ENUM('stable', 'beta', 'dev'), field: 'release_channel', defaultValue: 'stable' },
      createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
      updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
      deletedAt: { type: DataTypes.DATE },
    },
    {
      sequelize,
      paranoid: true,
      tableName: DataBaseTableNames.MicroApp,
      modelName: DataBaseTableNames.MicroApp,
      indexes: [{ fields: ['app_id'], unique: true }, { fields: ['tenant_id'] }, { fields: ['status'] }],
      timestamps: true,
    },
  );
}
