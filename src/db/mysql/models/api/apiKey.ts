import { DataTypes, Model, Sequelize } from 'sequelize';
import { DataBaseTableNames } from 'typings';

// API密钥模型接口
interface ApiKeyAttributes {
  id: string;
  tenantId: string;
  userId: string;
  keyName: string;
  keyHash: string;
  keyPrefix: string;
  permissions?: Record<string, any>;
  rateLimitPerMinute: number;
  isActive: boolean;
  lastUsedAt?: Date;
  expiresAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

interface ApiKeyCreationAttributes
  extends Omit<ApiKeyAttributes, 'id' | 'createdAt' | 'updatedAt'> {
  id?: string;
}

class ApiKeyTable
  extends Model<ApiKeyAttributes, ApiKeyCreationAttributes>
  implements ApiKeyAttributes
{
  public id!: string;
  public tenantId!: string;
  public userId!: string;
  public keyName!: string;
  public keyHash!: string;
  public keyPrefix!: string;
  public permissions?: Record<string, any>;
  public rateLimitPerMinute!: number;
  public isActive!: boolean;
  public lastUsedAt?: Date;
  public expiresAt?: Date;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export default function (sequelize: Sequelize) {
  ApiKeyTable.init(
    {
      id: {
        type: DataTypes.STRING(36),
        primaryKey: true,
        allowNull: false,
      },
      tenantId: {
        type: DataTypes.STRING(36),
        allowNull: false,
        field: 'tenant_id',
      },
      userId: {
        type: DataTypes.STRING(36),
        allowNull: false,
        field: 'user_id',
      },
      keyName: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: 'key_name',
      },
      keyHash: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
        field: 'key_hash',
      },
      keyPrefix: {
        type: DataTypes.STRING(20),
        allowNull: false,
        field: 'key_prefix',
      },
      permissions: {
        type: DataTypes.JSON,
        allowNull: true,
        field: 'permissions',
      },
      rateLimitPerMinute: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1000,
        field: 'rate_limit_per_minute',
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        field: 'is_active',
      },
      lastUsedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'last_used_at',
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'expires_at',
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
      tableName: 'api_keys',
      modelName: DataBaseTableNames.ApiKey,
      timestamps: true,
      indexes: [
        {
          fields: ['tenant_id'],
        },
        {
          fields: ['user_id'],
        },
        {
          fields: ['key_hash'],
          unique: true,
        },
        {
          fields: ['key_prefix'],
        },
        {
          fields: ['is_active'],
        },
      ],
    },
  );

  return ApiKeyTable;
}

export { ApiKeyTable, ApiKeyAttributes, ApiKeyCreationAttributes };
