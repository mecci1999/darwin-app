import { DataTypes, Model, Sequelize } from 'sequelize';
import { DataBaseTableNames } from 'typings';

export interface ITrailsDurablePackingPlanItemTableAttributes { tenantId: string; planId: string; gearId: string; snapshotWeightGrams: number; sortOrder: number; createdAt?: Date; updatedAt?: Date; }
export class TrailsDurablePackingPlanItemTable extends Model<ITrailsDurablePackingPlanItemTableAttributes> implements ITrailsDurablePackingPlanItemTableAttributes {
  public tenantId!: string; public planId!: string; public gearId!: string; public snapshotWeightGrams!: number; public sortOrder!: number; public readonly createdAt!: Date; public readonly updatedAt!: Date;
}
export default function (sequelize: Sequelize) {
  return TrailsDurablePackingPlanItemTable.init({
    tenantId: { type: DataTypes.STRING(64), field: 'tenant_id', allowNull: false, primaryKey: true }, planId: { type: DataTypes.STRING(160), field: 'plan_id', allowNull: false, primaryKey: true }, gearId: { type: DataTypes.STRING(160), field: 'gear_id', allowNull: false, primaryKey: true }, snapshotWeightGrams: { type: DataTypes.INTEGER.UNSIGNED, field: 'snapshot_weight_grams', allowNull: false }, sortOrder: { type: DataTypes.INTEGER.UNSIGNED, field: 'sort_order', allowNull: false }, createdAt: { type: DataTypes.DATE, field: 'created_at', defaultValue: DataTypes.NOW }, updatedAt: { type: DataTypes.DATE, field: 'updated_at', defaultValue: DataTypes.NOW },
  }, { sequelize, tableName: DataBaseTableNames.TrailsDurablePackingPlanItem, modelName: DataBaseTableNames.TrailsDurablePackingPlanItem, indexes: [{ fields: ['tenant_id', 'plan_id', 'sort_order'], name: 'trails_durable_packing_plan_item_order' }], timestamps: true });
}
