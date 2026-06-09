/**
 * 用户布局表
 */
import { DataTypes, Model, Optional, Sequelize } from 'sequelize';
import { DataBaseTableNames } from 'typings';

export interface IUserLayoutTableAttributes {
  id?: number;
  userId: string;
  key: string;
  layout: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export type IUserLayoutTableCreationAttributes = Optional<
  IUserLayoutTableAttributes,
  'id' | 'layout' | 'createdAt' | 'updatedAt'
>;

export class UserLayoutTable
  extends Model<IUserLayoutTableAttributes, IUserLayoutTableCreationAttributes>
  implements IUserLayoutTableAttributes
{
  public id!: number;
  public userId!: string;
  public key!: string;
  public layout!: string;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export default function (sequelize: Sequelize) {
  return UserLayoutTable.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.STRING(64),
        field: 'user_id',
        allowNull: false,
      },
      key: {
        type: DataTypes.STRING(128),
        allowNull: false,
      },
      layout: {
        type: DataTypes.TEXT('long'),
        allowNull: false,
        comment: '用户布局JSON字符串',
        validate: {
          isValidJSON(value: string) {
            if (!value) return;
            try {
              JSON.parse(value);
            } catch (error) {
              throw new Error('layout字段必须是有效的JSON字符串');
            }
          },
        },
      },
      createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
      updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    },
    {
      sequelize,
      tableName: DataBaseTableNames.UserLayout,
      modelName: DataBaseTableNames.UserLayout,
      indexes: [
        {
          fields: ['user_id', 'key'],
          unique: true,
        },
        { fields: ['user_id'] },
      ],
      hooks: {
        beforeValidate: (userLayout: UserLayoutTable) => {
          if (userLayout.layout === undefined || userLayout.layout === null) {
            userLayout.layout = '[]';
          }
        },
      },
      timestamps: true,
    },
  );
}
