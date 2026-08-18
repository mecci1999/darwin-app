import { DataTypes, Model, Sequelize } from 'sequelize';
import { DataBaseTableNames } from 'typings';

export interface ITrailsDurableExhibitionThemeTableAttributes {
  tenantId: string; id: string; ownerUserId: string; slug: string; status: string;
  resourceVersion: string; payloadJson: string; publishedAt?: Date; createdAt?: Date; updatedAt?: Date;
}
export class TrailsDurableExhibitionThemeTable extends Model<ITrailsDurableExhibitionThemeTableAttributes> implements ITrailsDurableExhibitionThemeTableAttributes {
  public tenantId!: string; public id!: string; public ownerUserId!: string; public slug!: string; public status!: string;
  public resourceVersion!: string; public payloadJson!: string; public publishedAt?: Date;
  public readonly createdAt!: Date; public readonly updatedAt!: Date;
}
export default function (sequelize: Sequelize) {
  return TrailsDurableExhibitionThemeTable.init({
    tenantId: { type: DataTypes.STRING(64), field: 'tenant_id', primaryKey: true },
    id: { type: DataTypes.STRING(160), primaryKey: true },
    ownerUserId: { type: DataTypes.STRING(64), field: 'owner_user_id', allowNull: false },
    slug: { type: DataTypes.STRING(160), allowNull: false },
    status: { type: DataTypes.ENUM('draft', 'published', 'archived'), allowNull: false },
    resourceVersion: { type: DataTypes.BIGINT.UNSIGNED, field: 'resource_version', allowNull: false },
    payloadJson: { type: DataTypes.TEXT('long'), field: 'payload_json', allowNull: false },
    publishedAt: { type: DataTypes.DATE, field: 'published_at' },
    createdAt: { type: DataTypes.DATE, field: 'created_at', defaultValue: DataTypes.NOW },
    updatedAt: { type: DataTypes.DATE, field: 'updated_at', defaultValue: DataTypes.NOW },
  }, { sequelize, tableName: DataBaseTableNames.TrailsDurableExhibitionTheme, modelName: DataBaseTableNames.TrailsDurableExhibitionTheme, timestamps: true });
}
