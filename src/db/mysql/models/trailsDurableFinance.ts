import { DataTypes, Model, Sequelize } from 'sequelize';
import { DataBaseTableNames } from 'typings';

export interface ITrailsDurableFinanceTableAttributes {
  id: string; tenantId: string; ownerUserId: string; occurredOn?: string; category?: string; amountCents?: number; currency?: string;
  calendarFinancialYear: number; retentionExpiresAt: Date; disposedAt?: Date | null; visibility: 'private'; lifecycle: 'draft'; resourceVersion: string; createdAt?: Date; updatedAt?: Date;
}
export class TrailsDurableFinanceTable extends Model<ITrailsDurableFinanceTableAttributes> implements ITrailsDurableFinanceTableAttributes {
  public id!: string; public tenantId!: string; public ownerUserId!: string; public occurredOn?: string; public category?: string; public amountCents?: number; public currency?: string;
  public calendarFinancialYear!: number; public retentionExpiresAt!: Date; public disposedAt?: Date | null; public visibility!: 'private'; public lifecycle!: 'draft'; public resourceVersion!: string; public readonly createdAt!: Date; public readonly updatedAt!: Date;
}
export default function (sequelize: Sequelize) {
  return TrailsDurableFinanceTable.init({
    id: { type: DataTypes.STRING(160), primaryKey: true }, tenantId: { type: DataTypes.STRING(64), field: 'tenant_id', allowNull: false, primaryKey: true }, ownerUserId: { type: DataTypes.STRING(64), field: 'owner_user_id', allowNull: false },
    occurredOn: { type: DataTypes.DATEONLY, field: 'occurred_on', allowNull: true }, category: { type: DataTypes.STRING(160), allowNull: true }, amountCents: { type: DataTypes.BIGINT, field: 'amount_cents', allowNull: true }, currency: { type: DataTypes.STRING(3), allowNull: true },
    calendarFinancialYear: { type: DataTypes.INTEGER.UNSIGNED, field: 'calendar_financial_year', allowNull: false }, retentionExpiresAt: { type: DataTypes.DATE, field: 'retention_expires_at', allowNull: false }, disposedAt: { type: DataTypes.DATE, field: 'disposed_at', allowNull: true }, visibility: { type: DataTypes.ENUM('private'), allowNull: false }, lifecycle: { type: DataTypes.ENUM('draft'), allowNull: false }, resourceVersion: { type: DataTypes.BIGINT.UNSIGNED, field: 'resource_version', allowNull: false },
    createdAt: { type: DataTypes.DATE, field: 'created_at', defaultValue: DataTypes.NOW }, updatedAt: { type: DataTypes.DATE, field: 'updated_at', defaultValue: DataTypes.NOW },
  }, { sequelize, tableName: DataBaseTableNames.TrailsDurableFinance, modelName: DataBaseTableNames.TrailsDurableFinance, indexes: [{ fields: ['tenant_id', 'owner_user_id', 'retention_expires_at'], name: 'trails_durable_finance_owner_expiry' }], timestamps: true });
}
