import { DataTypes, Model, Sequelize } from 'sequelize';
import { DataBaseTableNames } from 'typings';

export interface ITrailsRichDocumentTableAttributes { tenantId: string; subjectType: 'portfolio' | 'journal'; subjectId: string; ownerUserId: string; documentJson: string; revision: string; resourceVersion: string; createdAt?: Date; updatedAt?: Date; }
export class TrailsRichDocumentTable extends Model<ITrailsRichDocumentTableAttributes> implements ITrailsRichDocumentTableAttributes {
  public tenantId!: string; public subjectType!: 'portfolio' | 'journal'; public subjectId!: string; public ownerUserId!: string; public documentJson!: string; public revision!: string; public resourceVersion!: string; public readonly createdAt!: Date; public readonly updatedAt!: Date;
}
export default function (sequelize: Sequelize) {
  return TrailsRichDocumentTable.init({
    tenantId: { type: DataTypes.STRING(64), field: 'tenant_id', primaryKey: true }, subjectType: { type: DataTypes.ENUM('portfolio', 'journal'), field: 'subject_type', primaryKey: true }, subjectId: { type: DataTypes.STRING(160), field: 'subject_id', primaryKey: true }, ownerUserId: { type: DataTypes.STRING(64), field: 'owner_user_id', allowNull: false }, documentJson: { type: DataTypes.TEXT('long'), field: 'document_json', allowNull: false }, revision: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false }, resourceVersion: { type: DataTypes.BIGINT.UNSIGNED, field: 'resource_version', allowNull: false }, createdAt: { type: DataTypes.DATE, field: 'created_at', defaultValue: DataTypes.NOW }, updatedAt: { type: DataTypes.DATE, field: 'updated_at', defaultValue: DataTypes.NOW },
  }, { sequelize, tableName: DataBaseTableNames.TrailsRichDocument, modelName: DataBaseTableNames.TrailsRichDocument, indexes: [{ fields: ['tenant_id', 'owner_user_id', 'updated_at'], name: 'trails_rich_document_owner_updated' }], timestamps: true });
}
