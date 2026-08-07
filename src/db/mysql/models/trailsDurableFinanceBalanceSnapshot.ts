import { DataTypes, Model, Sequelize } from 'sequelize';
import { DataBaseTableNames } from 'typings';

export interface ITrailsDurableFinanceBalanceSnapshotTableAttributes {
  id: string; tenantId: string; ownerUserId: string; observedAt?: Date; balanceCents?: number; currency?: string;
  calendarFinancialYear: number; retentionExpiresAt: Date; disposedAt?: Date | null; visibility: 'private'; lifecycle: 'draft'; resourceVersion: string; createdAt?: Date; updatedAt?: Date;
}
export class TrailsDurableFinanceBalanceSnapshotTable extends Model<ITrailsDurableFinanceBalanceSnapshotTableAttributes> implements ITrailsDurableFinanceBalanceSnapshotTableAttributes {
  public id!: string; public tenantId!: string; public ownerUserId!: string; public observedAt?: Date; public balanceCents?: number; public currency?: string;
  public calendarFinancialYear!: number; public retentionExpiresAt!: Date; public disposedAt?: Date | null; public visibility!: 'private'; public lifecycle!: 'draft'; public resourceVersion!: string; public readonly createdAt!: Date; public readonly updatedAt!: Date;
}
export default function (sequelize: Sequelize) {
  return TrailsDurableFinanceBalanceSnapshotTable.init({
    id: { type: DataTypes.STRING(160), primaryKey: true }, tenantId: { type: DataTypes.STRING(64), field: 'tenant_id', allowNull: false, primaryKey: true }, ownerUserId: { type: DataTypes.STRING(64), field: 'owner_user_id', allowNull: false },
    observedAt: { type: DataTypes.DATE, field: 'observed_at', allowNull: true }, balanceCents: { type: DataTypes.BIGINT, field: 'balance_cents', allowNull: true }, currency: { type: DataTypes.STRING(3), allowNull: true },
    calendarFinancialYear: { type: DataTypes.INTEGER.UNSIGNED, field: 'calendar_financial_year', allowNull: false }, retentionExpiresAt: { type: DataTypes.DATE, field: 'retention_expires_at', allowNull: false }, disposedAt: { type: DataTypes.DATE, field: 'disposed_at', allowNull: true }, visibility: { type: DataTypes.ENUM('private'), allowNull: false }, lifecycle: { type: DataTypes.ENUM('draft'), allowNull: false }, resourceVersion: { type: DataTypes.BIGINT.UNSIGNED, field: 'resource_version', allowNull: false },
    createdAt: { type: DataTypes.DATE, field: 'created_at', defaultValue: DataTypes.NOW }, updatedAt: { type: DataTypes.DATE, field: 'updated_at', defaultValue: DataTypes.NOW },
  }, { sequelize, tableName: DataBaseTableNames.TrailsDurableFinanceBalanceSnapshot, modelName: DataBaseTableNames.TrailsDurableFinanceBalanceSnapshot, indexes: [{ fields: ['tenant_id', 'owner_user_id', 'currency', 'observed_at'], name: 'trails_durable_finance_balance_owner_current' }, { fields: ['tenant_id', 'owner_user_id', 'retention_expires_at'], name: 'trails_durable_finance_balance_owner_expiry' }], timestamps: true });
}
