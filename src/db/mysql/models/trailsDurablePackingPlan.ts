import { DataTypes, Model, Sequelize } from 'sequelize';
import { DataBaseTableNames } from 'typings';

export interface ITrailsDurablePackingPlanTableAttributes {
  id: string; tenantId: string; ownerUserId: string; name: string; visibility: 'private'; lifecycle: 'draft'; resourceVersion: string; createdAt?: Date; updatedAt?: Date;
}
export class TrailsDurablePackingPlanTable extends Model<ITrailsDurablePackingPlanTableAttributes> implements ITrailsDurablePackingPlanTableAttributes {
  public id!: string; public tenantId!: string; public ownerUserId!: string; public name!: string; public visibility!: 'private'; public lifecycle!: 'draft'; public resourceVersion!: string; public readonly createdAt!: Date; public readonly updatedAt!: Date;
}
export default function (sequelize: Sequelize) {
  return TrailsDurablePackingPlanTable.init({
    id: { type: DataTypes.STRING(160), primaryKey: true }, tenantId: { type: DataTypes.STRING(64), field: 'tenant_id', allowNull: false, primaryKey: true }, ownerUserId: { type: DataTypes.STRING(64), field: 'owner_user_id', allowNull: false }, name: { type: DataTypes.STRING(160), allowNull: false },
    visibility: { type: DataTypes.ENUM('private'), allowNull: false }, lifecycle: { type: DataTypes.ENUM('draft'), allowNull: false }, resourceVersion: { type: DataTypes.BIGINT.UNSIGNED, field: 'resource_version', allowNull: false }, createdAt: { type: DataTypes.DATE, field: 'created_at', defaultValue: DataTypes.NOW }, updatedAt: { type: DataTypes.DATE, field: 'updated_at', defaultValue: DataTypes.NOW },
  }, { sequelize, tableName: DataBaseTableNames.TrailsDurablePackingPlan, modelName: DataBaseTableNames.TrailsDurablePackingPlan, indexes: [{ fields: ['tenant_id', 'owner_user_id', 'updated_at'], name: 'trails_durable_packing_plan_owner_updated' }], timestamps: true });
}
