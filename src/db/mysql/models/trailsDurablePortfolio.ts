import { DataTypes, Model, Sequelize } from 'sequelize';
import { DataBaseTableNames } from 'typings';

export interface ITrailsDurablePortfolioTableAttributes {
  id: string;
  tenantId: string;
  ownerUserId: string;
  title: string;
  summary: string;
  categoryId?: string;
  coverMediaId?: string;
  mediaIds: string;
  locationLabel?: string;
  photoTechnicalMetadata?: string | null;
  visibility: 'public' | 'private' | 'unlisted';
  lifecycle: 'draft' | 'published' | 'archived';
  resourceVersion: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export class TrailsDurablePortfolioTable extends Model<ITrailsDurablePortfolioTableAttributes> implements ITrailsDurablePortfolioTableAttributes {
  public id!: string;
  public tenantId!: string;
  public ownerUserId!: string;
  public title!: string;
  public summary!: string;
  public categoryId?: string;
  public coverMediaId?: string;
  public mediaIds!: string;
  public locationLabel?: string;
  public photoTechnicalMetadata?: string | null;
  public visibility!: 'public' | 'private' | 'unlisted';
  public lifecycle!: 'draft' | 'published' | 'archived';
  public resourceVersion!: string;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export default function (sequelize: Sequelize) {
  return TrailsDurablePortfolioTable.init({
    id: { type: DataTypes.STRING(160), primaryKey: true },
    tenantId: { type: DataTypes.STRING(64), field: 'tenant_id', allowNull: false, primaryKey: true },
    ownerUserId: { type: DataTypes.STRING(64), field: 'owner_user_id', allowNull: false },
    title: { type: DataTypes.STRING(160), allowNull: false }, summary: { type: DataTypes.TEXT, allowNull: false },
    categoryId: { type: DataTypes.STRING(160), field: 'category_id' }, coverMediaId: { type: DataTypes.STRING(160), field: 'cover_media_id' },
    mediaIds: { type: DataTypes.TEXT('long'), field: 'media_ids', allowNull: false }, locationLabel: { type: DataTypes.STRING(240), field: 'location_label' },
    photoTechnicalMetadata: { type: DataTypes.TEXT('long'), field: 'photo_technical_metadata', allowNull: true },
    visibility: { type: DataTypes.ENUM('public', 'private', 'unlisted'), allowNull: false }, lifecycle: { type: DataTypes.ENUM('draft', 'published', 'archived'), allowNull: false },
    resourceVersion: { type: DataTypes.BIGINT.UNSIGNED, field: 'resource_version', allowNull: false },
    createdAt: { type: DataTypes.DATE, field: 'created_at', defaultValue: DataTypes.NOW }, updatedAt: { type: DataTypes.DATE, field: 'updated_at', defaultValue: DataTypes.NOW },
  }, { sequelize, tableName: DataBaseTableNames.TrailsDurablePortfolio, modelName: DataBaseTableNames.TrailsDurablePortfolio,
    indexes: [{ fields: ['tenant_id', 'owner_user_id', 'updated_at'], name: 'trails_durable_portfolio_owner_updated' }, { fields: ['tenant_id', 'owner_user_id', 'visibility', 'lifecycle', 'updated_at'], name: 'trails_durable_portfolio_public' }, { fields: ['tenant_id', 'owner_user_id', 'category_id', 'visibility', 'lifecycle', 'updated_at'], name: 'trails_durable_portfolio_public_category' }], timestamps: true });
}
