import { DataTypes, Model, Sequelize } from 'sequelize';
import { DataBaseTableNames } from 'typings';

export type CreatorSpaceMembershipRole = 'creator-space-owner' | 'creator-space-editor' | 'participant';

export interface ICreatorSpaceMembershipAttributes {
  tenantId: string;
  userId: string;
  role: CreatorSpaceMembershipRole;
  assignedOwnerUserId?: string;
  status: 'active' | 'disabled';
  createdAt?: Date;
  updatedAt?: Date;
}

export class CreatorSpaceMembershipTable extends Model<ICreatorSpaceMembershipAttributes> implements ICreatorSpaceMembershipAttributes {
  public tenantId!: string;
  public userId!: string;
  public role!: CreatorSpaceMembershipRole;
  public assignedOwnerUserId!: string | undefined;
  public status!: 'active' | 'disabled';
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export default function (sequelize: Sequelize) {
  return CreatorSpaceMembershipTable.init({
    tenantId: { type: DataTypes.STRING(64), field: 'tenant_id', primaryKey: true },
    userId: { type: DataTypes.STRING(64), field: 'user_id', primaryKey: true },
    role: { type: DataTypes.ENUM('creator-space-owner', 'creator-space-editor', 'participant'), allowNull: false },
    assignedOwnerUserId: { type: DataTypes.STRING(64), field: 'assigned_owner_user_id', allowNull: true },
    status: { type: DataTypes.ENUM('active', 'disabled'), allowNull: false, defaultValue: 'active' },
    createdAt: { type: DataTypes.DATE, field: 'created_at', defaultValue: DataTypes.NOW },
    updatedAt: { type: DataTypes.DATE, field: 'updated_at', defaultValue: DataTypes.NOW },
  }, {
    sequelize,
    tableName: DataBaseTableNames.CreatorSpaceMembership,
    modelName: DataBaseTableNames.CreatorSpaceMembership,
    indexes: [{ fields: ['tenant_id', 'assigned_owner_user_id'], name: 'creator_space_membership_owner' }],
    timestamps: true,
  });
}
