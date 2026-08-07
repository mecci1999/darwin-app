import { DataTypes, Model, Sequelize } from 'sequelize';
import { DataBaseTableNames } from 'typings';

export interface ITrailsSyncMutationTableAttributes {
  tenantId: string;
  actorUserId: string;
  mutationId: string;
  fingerprint: string;
  resultKind: 'applied' | 'conflict';
  resultJson: string;
  createdAt?: Date;
}

export class TrailsSyncMutationTable extends Model<ITrailsSyncMutationTableAttributes> implements ITrailsSyncMutationTableAttributes {
  public tenantId!: string;
  public actorUserId!: string;
  public mutationId!: string;
  public fingerprint!: string;
  public resultKind!: 'applied' | 'conflict';
  public resultJson!: string;
  public readonly createdAt!: Date;
}

export default function (sequelize: Sequelize) {
  return TrailsSyncMutationTable.init({
    tenantId: { type: DataTypes.STRING(64), field: 'tenant_id', allowNull: false, primaryKey: true },
    actorUserId: { type: DataTypes.STRING(64), field: 'actor_user_id', allowNull: false, primaryKey: true },
    mutationId: { type: DataTypes.STRING(160), field: 'mutation_id', allowNull: false, primaryKey: true },
    fingerprint: { type: DataTypes.STRING(128), allowNull: false },
    resultKind: { type: DataTypes.ENUM('applied', 'conflict'), field: 'result_kind', allowNull: false },
    resultJson: { type: DataTypes.TEXT('long'), field: 'result_json', allowNull: false },
    createdAt: { type: DataTypes.DATE, field: 'created_at', defaultValue: DataTypes.NOW },
  }, {
    sequelize,
    tableName: DataBaseTableNames.TrailsSyncMutation,
    modelName: DataBaseTableNames.TrailsSyncMutation,
    indexes: [{ fields: ['tenant_id', 'actor_user_id', 'mutation_id'], unique: true, name: 'trails_sync_mutation_unique' }],
    timestamps: true,
    updatedAt: false,
  });
}
