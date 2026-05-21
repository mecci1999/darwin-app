import { DataTypes, Model, Sequelize } from 'sequelize';
import { DataBaseTableNames } from 'typings';

// API密钥使用统计模型接口
interface ApiKeyStatsAttributes {
  id: string;
  apiKeyId: string;
  date: Date;
  requestCount: number;
  errorCount: number;
  dataVolumeBytes: number;
  createdAt?: Date;
  updatedAt?: Date;
}

interface ApiKeyStatsCreationAttributes
  extends Omit<ApiKeyStatsAttributes, 'id' | 'createdAt' | 'updatedAt'> {
  id?: string;
}

class ApiKeyStatsTable
  extends Model<ApiKeyStatsAttributes, ApiKeyStatsCreationAttributes>
  implements ApiKeyStatsAttributes
{
  public id!: string;
  public apiKeyId!: string;
  public date!: Date;
  public requestCount!: number;
  public errorCount!: number;
  public dataVolumeBytes!: number;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export default function (sequelize: Sequelize) {
  ApiKeyStatsTable.init(
    {
      id: {
        type: DataTypes.STRING(36),
        primaryKey: true,
        allowNull: false,
      },
      apiKeyId: {
        type: DataTypes.STRING(36),
        allowNull: false,
        field: 'api_key_id',
      },
      date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        field: 'date',
      },
      requestCount: {
        type: DataTypes.BIGINT,
        allowNull: false,
        defaultValue: 0,
        field: 'request_count',
      },
      errorCount: {
        type: DataTypes.BIGINT,
        allowNull: false,
        defaultValue: 0,
        field: 'error_count',
      },
      dataVolumeBytes: {
        type: DataTypes.BIGINT,
        allowNull: false,
        defaultValue: 0,
        field: 'data_volume_bytes',
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'created_at',
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'updated_at',
      },
    },
    {
      sequelize,
      tableName: 'api_key_stats',
      modelName: DataBaseTableNames.ApiKeyStats,
      timestamps: true,
      indexes: [
        {
          fields: ['api_key_id', 'date'],
          unique: true,
        },
        {
          fields: ['date'],
        },
      ],
    },
  );

  return ApiKeyStatsTable;
}

export { ApiKeyStatsTable, ApiKeyStatsAttributes, ApiKeyStatsCreationAttributes };
