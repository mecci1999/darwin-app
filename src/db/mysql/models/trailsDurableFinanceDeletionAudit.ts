import { DataTypes, Model, Sequelize } from 'sequelize';
import { DataBaseTableNames } from 'typings';

/** Contains policy/process evidence only: no finance values, entry IDs, receipts, descriptions, or session IDs. */
export interface ITrailsDurableFinanceDeletionAuditTableAttributes { eventId: string; eventType: 'retention-disposal'; scopeDigest: string; policyVersion: string; eligibleAt: Date; executedAt: Date; outcome: 'disposed' | 'nothing-eligible'; createdAt?: Date; updatedAt?: Date; }
export class TrailsDurableFinanceDeletionAuditTable extends Model<ITrailsDurableFinanceDeletionAuditTableAttributes> implements ITrailsDurableFinanceDeletionAuditTableAttributes { public eventId!: string; public eventType!: 'retention-disposal'; public scopeDigest!: string; public policyVersion!: string; public eligibleAt!: Date; public executedAt!: Date; public outcome!: 'disposed' | 'nothing-eligible'; public readonly createdAt!: Date; public readonly updatedAt!: Date; }
export default function (sequelize: Sequelize) {
  return TrailsDurableFinanceDeletionAuditTable.init({
    eventId: { type: DataTypes.STRING(160), field: 'event_id', primaryKey: true }, eventType: { type: DataTypes.ENUM('retention-disposal'), field: 'event_type', allowNull: false }, scopeDigest: { type: DataTypes.STRING(128), field: 'scope_digest', allowNull: false }, policyVersion: { type: DataTypes.STRING(64), field: 'policy_version', allowNull: false }, eligibleAt: { type: DataTypes.DATE, field: 'eligible_at', allowNull: false }, executedAt: { type: DataTypes.DATE, field: 'executed_at', allowNull: false }, outcome: { type: DataTypes.ENUM('disposed', 'nothing-eligible'), allowNull: false },
    createdAt: { type: DataTypes.DATE, field: 'created_at', defaultValue: DataTypes.NOW }, updatedAt: { type: DataTypes.DATE, field: 'updated_at', defaultValue: DataTypes.NOW },
  }, { sequelize, tableName: DataBaseTableNames.TrailsDurableFinanceDeletionAudit, modelName: DataBaseTableNames.TrailsDurableFinanceDeletionAudit, indexes: [{ fields: ['scope_digest', 'executed_at'], name: 'trails_durable_finance_audit_scope_executed' }], timestamps: true });
}
