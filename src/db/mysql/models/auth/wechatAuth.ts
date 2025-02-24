import { DataTypes, Model, Sequelize } from 'sequelize';
import { DataBaseTableNames } from 'typings/enum';
import { UserTable } from '../user';

export interface IWechatAuthAttributes {
  id: number;
  userId: string;
  openid: string;
  unionid?: string;
  sessionKey: string;
}

export class WechatAuthTable extends Model<IWechatAuthAttributes> implements IWechatAuthAttributes {
  public id!: number;
  public userId!: string;
  public openid!: string;
  public unionid!: string | undefined;
  public sessionKey!: string;
}

export default function (sequelize: Sequelize) {
  const model = WechatAuthTable.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.STRING(32),
        allowNull: false,
        references: {
          model: UserTable,
          key: 'userId',
        },
        onDelete: 'CASCADE',
      },
      openid: {
        type: DataTypes.STRING(128),
        unique: true,
      },
      unionid: DataTypes.STRING(128),
      sessionKey: DataTypes.STRING(255),
    },
    {
      sequelize,
      tableName: DataBaseTableNames.WechatAuth,
      indexes: [
        { fields: ['openid'], unique: true },
        { fields: ['unionid'] },
        { fields: ['userId'] },
      ],
    },
  );

  model.belongsTo(UserTable, {
    foreignKey: 'userId',
    targetKey: 'userId',
  });

  return model;
}
