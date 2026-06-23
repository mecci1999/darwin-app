import { DataTypes, Model, Sequelize } from 'sequelize';
import { DataBaseTableNames } from 'typings';

export type MicroAppVersionStatus = 'uploaded' | 'pending_review' | 'approved' | 'rejected' | 'published' | 'deprecated';

export interface IMicroAppVersionTableAttributes {
  id?: number;
  appId: string;
  version: string;
  manifestJson: string;
  packageBase64: string;
  packageSha256: string;
  packageSize: number;
  status: MicroAppVersionStatus;
  reviewerUserId?: string;
  reviewReason?: string;
  reviewedAt?: Date;
  publishedAt?: Date;
  signature?: string;
  scanReportJson?: string;
  previousPublishedVersion?: string;
  createdBy: string;
  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date;
}

export class MicroAppVersionTable
  extends Model<IMicroAppVersionTableAttributes>
  implements IMicroAppVersionTableAttributes {
  public id!: number;
  public appId!: string;
  public version!: string;
  public manifestJson!: string;
  public packageBase64!: string;
  public packageSha256!: string;
  public packageSize!: number;
  public status!: MicroAppVersionStatus;
  public reviewerUserId!: string | undefined;
  public reviewReason!: string | undefined;
  public reviewedAt!: Date | undefined;
  public publishedAt!: Date | undefined;
  public signature!: string | undefined;
  public scanReportJson!: string | undefined;
  public previousPublishedVersion!: string | undefined;
  public createdBy!: string;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
  public deletedAt!: Date | undefined;
}

export default function (sequelize: Sequelize) {
  return MicroAppVersionTable.init(
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      appId: { type: DataTypes.STRING(96), field: 'app_id', allowNull: false },
      version: { type: DataTypes.STRING(64), allowNull: false },
      manifestJson: { type: DataTypes.TEXT('long'), field: 'manifest_json', allowNull: false },
      packageBase64: { type: DataTypes.TEXT('long'), field: 'package_base64', allowNull: false },
      packageSha256: { type: DataTypes.STRING(128), field: 'package_sha256', allowNull: false },
      packageSize: { type: DataTypes.INTEGER, field: 'package_size', allowNull: false },
      status: {
        type: DataTypes.ENUM('uploaded', 'pending_review', 'approved', 'rejected', 'published', 'deprecated'),
        defaultValue: 'pending_review',
      },
      reviewerUserId: { type: DataTypes.STRING(64), field: 'reviewer_user_id' },
      reviewReason: { type: DataTypes.TEXT, field: 'review_reason' },
      reviewedAt: { type: DataTypes.DATE, field: 'reviewed_at' },
      publishedAt: { type: DataTypes.DATE, field: 'published_at' },
      signature: { type: DataTypes.STRING(256) },
      scanReportJson: { type: DataTypes.TEXT('long'), field: 'scan_report_json' },
      previousPublishedVersion: { type: DataTypes.STRING(64), field: 'previous_published_version' },
      createdBy: { type: DataTypes.STRING(64), field: 'created_by', allowNull: false },
      createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
      updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
      deletedAt: { type: DataTypes.DATE },
    },
    {
      sequelize,
      paranoid: true,
      tableName: DataBaseTableNames.MicroAppVersion,
      modelName: DataBaseTableNames.MicroAppVersion,
      indexes: [
        { fields: ['app_id', 'version'], unique: true },
        { fields: ['status'] },
        { fields: ['created_by'] },
      ],
      timestamps: true,
    },
  );
}
