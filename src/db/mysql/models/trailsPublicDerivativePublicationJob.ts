import { DataTypes, Model, Sequelize } from 'sequelize';
import { DataBaseTableNames } from 'typings';

export interface ITrailsPublicDerivativePublicationJobTableAttributes {
  tenantId: string;
  jobId: string;
  assetId: string;
  ownerUserId: string;
  actorUserId: string;
  expectedResourceVersion: string;
  approvalId: string;
  status: 'pending' | 'processing' | 'published' | 'failed';
  attempts: number;
  leaseToken?: string;
  leaseExpiresAt?: Date;
  publishedAt?: Date;
  failedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export class TrailsPublicDerivativePublicationJobTable extends Model<ITrailsPublicDerivativePublicationJobTableAttributes> implements ITrailsPublicDerivativePublicationJobTableAttributes {
  public tenantId!: string;
  public jobId!: string;
  public assetId!: string;
  public ownerUserId!: string;
  public actorUserId!: string;
  public expectedResourceVersion!: string;
  public approvalId!: string;
  public status!: 'pending' | 'processing' | 'published' | 'failed';
  public attempts!: number;
  public leaseToken?: string;
  public leaseExpiresAt?: Date;
  public publishedAt?: Date;
  public failedAt?: Date;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export default function (sequelize: Sequelize) {
  return TrailsPublicDerivativePublicationJobTable.init({
    tenantId: { type: DataTypes.STRING(64), field: 'tenant_id', primaryKey: true },
    jobId: { type: DataTypes.STRING(160), field: 'job_id', primaryKey: true },
    assetId: { type: DataTypes.STRING(160), field: 'asset_id', allowNull: false },
    ownerUserId: { type: DataTypes.STRING(64), field: 'owner_user_id', allowNull: false },
    actorUserId: { type: DataTypes.STRING(64), field: 'actor_user_id', allowNull: false },
    expectedResourceVersion: { type: DataTypes.BIGINT.UNSIGNED, field: 'expected_resource_version', allowNull: false },
    approvalId: { type: DataTypes.STRING(160), field: 'approval_id', allowNull: false },
    status: { type: DataTypes.ENUM('pending', 'processing', 'published', 'failed'), allowNull: false },
    attempts: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    leaseToken: { type: DataTypes.CHAR(64), field: 'lease_token', allowNull: true },
    leaseExpiresAt: { type: DataTypes.DATE, field: 'lease_expires_at', allowNull: true },
    publishedAt: { type: DataTypes.DATE, field: 'published_at', allowNull: true },
    failedAt: { type: DataTypes.DATE, field: 'failed_at', allowNull: true },
    createdAt: { type: DataTypes.DATE, field: 'created_at', defaultValue: DataTypes.NOW },
    updatedAt: { type: DataTypes.DATE, field: 'updated_at', defaultValue: DataTypes.NOW },
  }, { sequelize, tableName: DataBaseTableNames.TrailsPublicDerivativePublicationJob, modelName: DataBaseTableNames.TrailsPublicDerivativePublicationJob, timestamps: true });
}
