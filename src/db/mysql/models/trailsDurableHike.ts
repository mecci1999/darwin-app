import { DataTypes, Model, Sequelize } from 'sequelize';
import { DataBaseTableNames } from 'typings';

export interface ITrailsDurableHikeTableAttributes {
  id: string;
  tenantId: string;
  ownerUserId: string;
  title: string;
  startedAt: Date;
  distanceKm?: number | null;
  elevationGainM?: number | null;
  routeProvider: string;
  routeExternalId: string;
  routeLabel: string;
  privateGeometry?: string | null;
  visibility: 'private';
  lifecycle: 'draft';
  resourceVersion: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export class TrailsDurableHikeTable extends Model<ITrailsDurableHikeTableAttributes> implements ITrailsDurableHikeTableAttributes {
  public id!: string;
  public tenantId!: string;
  public ownerUserId!: string;
  public title!: string;
  public startedAt!: Date;
  public distanceKm?: number | null;
  public elevationGainM?: number | null;
  public routeProvider!: string;
  public routeExternalId!: string;
  public routeLabel!: string;
  public privateGeometry?: string | null;
  public visibility!: 'private';
  public lifecycle!: 'draft';
  public resourceVersion!: string;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export default function (sequelize: Sequelize) {
  return TrailsDurableHikeTable.init({
    id: { type: DataTypes.STRING(160), primaryKey: true }, tenantId: { type: DataTypes.STRING(64), field: 'tenant_id', allowNull: false, primaryKey: true }, ownerUserId: { type: DataTypes.STRING(64), field: 'owner_user_id', allowNull: false },
    title: { type: DataTypes.STRING(160), allowNull: false }, startedAt: { type: DataTypes.DATE, field: 'started_at', allowNull: false }, distanceKm: { type: DataTypes.DECIMAL(12, 3), field: 'distance_km' }, elevationGainM: { type: DataTypes.DECIMAL(12, 3), field: 'elevation_gain_m' },
    routeProvider: { type: DataTypes.STRING(160), field: 'route_provider', allowNull: false }, routeExternalId: { type: DataTypes.STRING(160), field: 'route_external_id', allowNull: false }, routeLabel: { type: DataTypes.STRING(240), field: 'route_label', allowNull: false }, privateGeometry: { type: DataTypes.TEXT('long'), field: 'private_geometry' },
    visibility: { type: DataTypes.ENUM('private'), allowNull: false }, lifecycle: { type: DataTypes.ENUM('draft'), allowNull: false }, resourceVersion: { type: DataTypes.BIGINT.UNSIGNED, field: 'resource_version', allowNull: false },
    createdAt: { type: DataTypes.DATE, field: 'created_at', defaultValue: DataTypes.NOW }, updatedAt: { type: DataTypes.DATE, field: 'updated_at', defaultValue: DataTypes.NOW },
  }, { sequelize, tableName: DataBaseTableNames.TrailsDurableHike, modelName: DataBaseTableNames.TrailsDurableHike, indexes: [{ fields: ['tenant_id', 'owner_user_id', 'updated_at'], name: 'trails_durable_hike_owner_updated' }], timestamps: true });
}
