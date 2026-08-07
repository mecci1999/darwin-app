import { DataTypes, Model, Sequelize } from 'sequelize';
import { DataBaseTableNames } from 'typings';

export interface ITrailsPortfolioCategoryTableAttributes {
  id: string;
  tenantId: string;
  ownerUserId: string;
  slug: string;
  nameZh: string;
  description: string;
  sortOrder: number;
  visibility: 'public' | 'private' | 'unlisted';
  status: 'active' | 'archived';
  lifecycle: 'draft' | 'published' | 'archived';
  resourceVersion: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export class TrailsPortfolioCategoryTable extends Model<ITrailsPortfolioCategoryTableAttributes> implements ITrailsPortfolioCategoryTableAttributes {
  public id!: string;
  public tenantId!: string;
  public ownerUserId!: string;
  public slug!: string;
  public nameZh!: string;
  public description!: string;
  public sortOrder!: number;
  public visibility!: 'public' | 'private' | 'unlisted';
  public status!: 'active' | 'archived';
  public lifecycle!: 'draft' | 'published' | 'archived';
  public resourceVersion!: string;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export default function (sequelize: Sequelize) {
  return TrailsPortfolioCategoryTable.init({
    id: { type: DataTypes.STRING(160), primaryKey: true },
    tenantId: { type: DataTypes.STRING(64), field: 'tenant_id', allowNull: false, primaryKey: true },
    ownerUserId: { type: DataTypes.STRING(64), field: 'owner_user_id', allowNull: false },
    slug: { type: DataTypes.STRING(160), allowNull: false },
    nameZh: { type: DataTypes.STRING(160), field: 'name_zh', allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    sortOrder: { type: DataTypes.INTEGER.UNSIGNED, field: 'sort_order', allowNull: false, defaultValue: 0 },
    visibility: { type: DataTypes.ENUM('public', 'private', 'unlisted'), allowNull: false },
    status: { type: DataTypes.ENUM('active', 'archived'), allowNull: false },
    lifecycle: { type: DataTypes.ENUM('draft', 'published', 'archived'), allowNull: false },
    resourceVersion: { type: DataTypes.BIGINT.UNSIGNED, field: 'resource_version', allowNull: false },
    createdAt: { type: DataTypes.DATE, field: 'created_at', defaultValue: DataTypes.NOW },
    updatedAt: { type: DataTypes.DATE, field: 'updated_at', defaultValue: DataTypes.NOW },
  }, {
    sequelize,
    tableName: DataBaseTableNames.TrailsPortfolioCategory,
    modelName: DataBaseTableNames.TrailsPortfolioCategory,
    indexes: [
      { fields: ['tenant_id', 'owner_user_id', 'slug'], unique: true, name: 'trails_category_owner_slug_unique' },
      { fields: ['tenant_id', 'owner_user_id', 'sort_order', 'slug'], name: 'trails_category_owner_sort' },
    ],
    timestamps: true,
  });
}
