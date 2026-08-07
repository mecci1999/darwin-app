import { DataTypes, Model, Sequelize } from 'sequelize';
import { DataBaseTableNames } from 'typings';

export interface ITrailsSyncChangeTableAttributes {
  cursor?: string;
  tenantId: string;
  ownerUserId: string;
  resourceType: 'portfolio-category';
  resourceId: string;
  operation: 'upsert';
  resourceVersion: string;
  resourceJson: string;
  createdAt?: Date;
}

export class TrailsSyncChangeTable extends Model<ITrailsSyncChangeTableAttributes> implements ITrailsSyncChangeTableAttributes {
  public cursor!: string;
  public tenantId!: string;
  public ownerUserId!: string;
  public resourceType!: 'portfolio-category';
  public resourceId!: string;
  public operation!: 'upsert';
  public resourceVersion!: string;
  public resourceJson!: string;
  public readonly createdAt!: Date;
}

export default function (sequelize: Sequelize) {
  return TrailsSyncChangeTable.init({
    cursor: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    tenantId: { type: DataTypes.STRING(64), field: 'tenant_id', allowNull: false },
    ownerUserId: { type: DataTypes.STRING(64), field: 'owner_user_id', allowNull: false },
    resourceType: { type: DataTypes.ENUM('portfolio-category'), field: 'resource_type', allowNull: false },
    resourceId: { type: DataTypes.STRING(160), field: 'resource_id', allowNull: false },
    operation: { type: DataTypes.ENUM('upsert'), allowNull: false },
    resourceVersion: { type: DataTypes.BIGINT.UNSIGNED, field: 'resource_version', allowNull: false },
    resourceJson: { type: DataTypes.TEXT('long'), field: 'resource_json', allowNull: false },
    createdAt: { type: DataTypes.DATE, field: 'created_at', defaultValue: DataTypes.NOW },
  }, {
    sequelize,
    tableName: DataBaseTableNames.TrailsSyncChange,
    modelName: DataBaseTableNames.TrailsSyncChange,
    indexes: [{ fields: ['tenant_id', 'owner_user_id', 'cursor'], name: 'trails_sync_owner_cursor' }],
    timestamps: true,
    updatedAt: false,
  });
}
