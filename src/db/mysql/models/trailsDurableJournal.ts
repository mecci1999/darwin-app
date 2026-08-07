import { DataTypes, Model, Sequelize } from 'sequelize';
import { DataBaseTableNames } from 'typings';

export interface ITrailsDurableJournalTableAttributes {
  id: string;
  tenantId: string;
  ownerUserId: string;
  title: string;
  excerpt: string;
  body: string;
  coverMediaId?: string;
  publishedAt?: Date;
  isPinned: boolean;
  visibility: 'public' | 'private' | 'unlisted';
  lifecycle: 'draft' | 'published' | 'archived';
  resourceVersion: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export class TrailsDurableJournalTable extends Model<ITrailsDurableJournalTableAttributes> implements ITrailsDurableJournalTableAttributes {
  public id!: string;
  public tenantId!: string;
  public ownerUserId!: string;
  public title!: string;
  public excerpt!: string;
  public body!: string;
  public coverMediaId?: string;
  public publishedAt?: Date;
  public isPinned!: boolean;
  public visibility!: 'public' | 'private' | 'unlisted';
  public lifecycle!: 'draft' | 'published' | 'archived';
  public resourceVersion!: string;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export default function (sequelize: Sequelize) {
  return TrailsDurableJournalTable.init({
    id: { type: DataTypes.STRING(160), primaryKey: true },
    tenantId: { type: DataTypes.STRING(64), field: 'tenant_id', allowNull: false, primaryKey: true },
    ownerUserId: { type: DataTypes.STRING(64), field: 'owner_user_id', allowNull: false },
    title: { type: DataTypes.STRING(160), allowNull: false }, excerpt: { type: DataTypes.TEXT, allowNull: false }, body: { type: DataTypes.TEXT('long'), allowNull: false },
    coverMediaId: { type: DataTypes.STRING(160), field: 'cover_media_id' }, publishedAt: { type: DataTypes.DATE, field: 'published_at' }, isPinned: { type: DataTypes.BOOLEAN, field: 'is_pinned', allowNull: false, defaultValue: false },
    visibility: { type: DataTypes.ENUM('public', 'private', 'unlisted'), allowNull: false }, lifecycle: { type: DataTypes.ENUM('draft', 'published', 'archived'), allowNull: false },
    resourceVersion: { type: DataTypes.BIGINT.UNSIGNED, field: 'resource_version', allowNull: false },
    createdAt: { type: DataTypes.DATE, field: 'created_at', defaultValue: DataTypes.NOW }, updatedAt: { type: DataTypes.DATE, field: 'updated_at', defaultValue: DataTypes.NOW },
  }, { sequelize, tableName: DataBaseTableNames.TrailsDurableJournal, modelName: DataBaseTableNames.TrailsDurableJournal,
    indexes: [{ fields: ['tenant_id', 'owner_user_id', 'updated_at'], name: 'trails_durable_journal_owner_updated' }, { fields: ['tenant_id', 'owner_user_id', 'visibility', 'lifecycle', 'published_at'], name: 'trails_durable_journal_public' }, { fields: ['tenant_id', 'owner_user_id', 'visibility', 'lifecycle', 'is_pinned', 'published_at', 'id'], name: 'trails_durable_journal_public_pinned' }], timestamps: true });
}
