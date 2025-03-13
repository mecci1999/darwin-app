import { DataTypes, Model, Sequelize } from 'sequelize';
import { DataBaseTableNames } from 'typings/enum';
import { UserTable } from '../user';

export interface IEmailAuthAttributes {
  id: number; // 主键
  userId: string; // 用户ID
  email: string; // 邮箱
  passwordHash: string; // 密码哈希值
  salt: string; // 盐值
  isVerified: boolean; // 是否验证
}

export class EmailAuthTable extends Model<IEmailAuthAttributes> implements IEmailAuthAttributes {
  public id!: number; // 主键
  public userId!: string; // 用户ID
  public email!: string; // 邮箱
  public passwordHash!: string; // 密码哈希值
  public salt!: string; // 盐值
  public isVerified!: boolean; // 是否验证
}

export default function (sequelize: Sequelize) {
  const model = EmailAuthTable.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.STRING(512),
        allowNull: false,
        unique: true,
        references: {
          model: UserTable,
          key: 'user_id',
        },
        onDelete: 'CASCADE',
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
        validate: {
          isEmail: true,
        },
      },
      passwordHash: {
        type: DataTypes.STRING(512),
        allowNull: false,
      },
      salt: {
        type: DataTypes.STRING(128),
        allowNull: false,
      },
      isVerified: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
    },
    {
      sequelize,
      tableName: DataBaseTableNames.EmailAuth,
      modelName: DataBaseTableNames.EmailAuth,
      indexes: [
        {
          fields: ['email'],
          unique: true,
          name: 'email_auth_email_unique',
        },
        {
          fields: ['user_id'],
          name: 'email_auth_user_id_index',
        },
      ],
    },
  );

  model.belongsTo(UserTable, { foreignKey: 'user_id' });

  model.addHook('beforeValidate', (instance: EmailAuthTable) => {
    if (instance.email) {
      instance.email = instance.email.toLowerCase();
    }
  });

  return model;
}
