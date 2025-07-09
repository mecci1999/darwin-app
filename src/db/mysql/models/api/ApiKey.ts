import { DataTypes, Model, Sequelize } from 'sequelize';

// API密钥模型接口
interface ApiKeyAttributes {
  id: string;
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
      userId: {
        type: DataTypes.STRING(36),
        allowNull: false,
      },
      keyName: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      keyHash: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
      },
      keyPrefix: {
        type: DataTypes.STRING(20),
        allowNull: false,
      },
      permissions: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      rateLimitPerMinute: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1000,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      lastUsedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
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
      tableName: 'api_keys',
      timestamps: true,
      indexes: [
        {
          fields: ['userId'],
        },
        {
          fields: ['keyHash'],
          unique: true,
        },
        {
          fields: ['keyPrefix'],
        },
        {
          fields: ['isActive'],
        },
      ],
    },
  );

  return ApiKeyTable;
}

export { ApiKeyTable, ApiKeyAttributes, ApiKeyCreationAttributes };
