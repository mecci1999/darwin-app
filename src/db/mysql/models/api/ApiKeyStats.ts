import { DataTypes, Model, Sequelize } from 'sequelize';

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
      },
      date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      requestCount: {
        type: DataTypes.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      errorCount: {
        type: DataTypes.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      dataVolumeBytes: {
        type: DataTypes.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      tableName: 'api_key_stats',
      timestamps: true,
      indexes: [
        {
          fields: ['apiKeyId', 'date'],
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
