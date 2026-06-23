import { DataTypes, Model, Sequelize } from 'sequelize';
import { DataBaseTableNames } from 'typings';

export interface IMicroAppAuditLogTableAttributes {
  id?: number;
  appId: string;
  version?: string;
  action: string;
  operatorUserId: string;
  tenantId?: string;
  reason?: string;
  beforeStatus?: string;
  afterStatus?: string;
  ip?: string;
  detailsJson?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export class MicroAppAuditLogTable
  extends Model<IMicroAppAuditLogTableAttributes>
  implements IMicroAppAuditLogTableAttributes {
  public id!: number;
  public appId!: string;
  public version!: string | undefined;
  public action!: string;
  public operatorUserId!: string;
  public tenantId!: string | undefined;
  public reason!: string | undefined;
  public beforeStatus!: string | undefined;
  public afterStatus!: string | undefined;
  public ip!: string | undefined;
  public detailsJson!: string | undefined;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export default function (sequelize: Sequelize) {
  return MicroAppAuditLogTable.init(
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      appId: { type: DataTypes.STRING(96), field: 'app_id', allowNull: false },
      version: { type: DataTypes.STRING(64) },
      action: { type: DataTypes.STRING(64), allowNull: false },
      operatorUserId: { type: DataTypes.STRING(64), field: 'operator_user_id', allowNull: false },
      tenantId: { type: DataTypes.STRING(64), field: 'tenant_id' },
      reason: { type: DataTypes.TEXT },
      beforeStatus: { type: DataTypes.STRING(64), field: 'before_status' },
      afterStatus: { type: DataTypes.STRING(64), field: 'after_status' },
      ip: { type: DataTypes.STRING(96) },
      detailsJson: { type: DataTypes.TEXT('long'), field: 'details_json' },
      createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
      updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    },
    {
      sequelize,
      tableName: DataBaseTableNames.MicroAppAuditLog,
      modelName: DataBaseTableNames.MicroAppAuditLog,
      indexes: [{ fields: ['app_id', 'version'] }, { fields: ['operator_user_id'] }, { fields: ['action'] }],
      timestamps: true,
    },
  );
}
