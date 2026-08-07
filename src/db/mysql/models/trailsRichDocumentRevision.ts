import { DataTypes, Model, Sequelize } from 'sequelize';
import { DataBaseTableNames } from 'typings';

export interface ITrailsRichDocumentRevisionTableAttributes { tenantId: string; subjectType: 'portfolio' | 'journal'; subjectId: string; revision: string; documentJson: string; createdByUserId: string; createdAt?: Date; updatedAt?: Date; }
export class TrailsRichDocumentRevisionTable extends Model<ITrailsRichDocumentRevisionTableAttributes> implements ITrailsRichDocumentRevisionTableAttributes {
  public tenantId!: string; public subjectType!: 'portfolio' | 'journal'; public subjectId!: string; public revision!: string; public documentJson!: string; public createdByUserId!: string; public readonly createdAt!: Date; public readonly updatedAt!: Date;
}
export default function (sequelize: Sequelize) {
  return TrailsRichDocumentRevisionTable.init({
    tenantId: { type: DataTypes.STRING(64), field: 'tenant_id', primaryKey: true }, subjectType: { type: DataTypes.ENUM('portfolio', 'journal'), field: 'subject_type', primaryKey: true }, subjectId: { type: DataTypes.STRING(160), field: 'subject_id', primaryKey: true }, revision: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true }, documentJson: { type: DataTypes.TEXT('long'), field: 'document_json', allowNull: false }, createdByUserId: { type: DataTypes.STRING(64), field: 'created_by_user_id', allowNull: false }, createdAt: { type: DataTypes.DATE, field: 'created_at', defaultValue: DataTypes.NOW }, updatedAt: { type: DataTypes.DATE, field: 'updated_at', defaultValue: DataTypes.NOW },
  }, { sequelize, tableName: DataBaseTableNames.TrailsRichDocumentRevision, modelName: DataBaseTableNames.TrailsRichDocumentRevision, indexes: [{ fields: ['tenant_id', 'subject_type', 'subject_id', 'revision'], name: 'trails_rich_document_revision_lookup' }], timestamps: true });
}
