import { DataTypes, Model, Sequelize } from 'sequelize';
import { DataBaseTableNames } from 'typings';
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
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
        references: {
          model: UserTable,
          key: 'user_id',
        },
        onDelete: 'CASCADE',
        field: 'user_id',
      },
      openid: {
        type: DataTypes.STRING(128),
        unique: true,
        field: 'openid',
      },
      unionid: { type: DataTypes.STRING(128), field: 'unionid' },
      sessionKey: { type: DataTypes.STRING(255), field: 'session_key' },
    },
    {
      sequelize,
      tableName: DataBaseTableNames.WechatAuth,
      modelName: DataBaseTableNames.WechatAuth,
      indexes: [
        { fields: ['openid'], unique: true },
        { fields: ['unionid'] },
        { fields: ['user_id'], name: 'wechat_auth_user_id_index' },
      ],
    },
  );

  model.belongsTo(UserTable, { foreignKey: 'userId' });

  return model;
}
