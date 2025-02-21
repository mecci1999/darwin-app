/**
 * 用户表
 */
import { DataTypes, Model, Optional, Sequelize } from 'sequelize';
import { DataBaseTableNames } from 'typings/enum';

export interface IUserTableAttributes {
  id?: number; // id
  userId: string; // 用户id，用作外键作为标识，全局唯一
  username: string; // 用户名，可以使用username登录
  password: string; // 用户密码，非明文保存
  phone?: string; // 用户手机号
  email: string; // 用户邮箱，必须使用邮箱注册，邮箱可以作为登录名
  nickname: string; // 用户昵称，可以作为展示
  avatar?: string; // 用户头像
  status: number; // 账户状态 0-正常 1-禁用 2-未激活
  source: string; // 注册来源（web/app/第三方）
  deletedAt?: Date; // 删除时间
}

export class UserTable
  extends Model<IUserTableAttributes, Optional<IUserTableAttributes, 'id'>>
  implements IUserTableAttributes
{
  public id!: number; // id
  public userId!: string; // 用户id，可以用作展示
  public username!: string; // 用户名，不作为登录名，只作为展示
  public password!: string; // 用户密码，非明文保存
  public phone: string | undefined; // 用户手机号
  public email!: string; // 用户邮箱
  public nickname!: string; // 用户昵称，可以作为展示
  public avatar?: string; // 用户头像
  public status!: number; // 账户状态 0-正常 1-禁用 2-未激活
  public source!: string; // 注册来源（web/app/第三方）
  public readonly createdAt!: Date; // 创建时间
  public readonly updatedAt!: Date; // 更新时间
  public deletedAt?: Date; // 删除时间
}

export default function (sequelize: Sequelize) {
  const model = UserTable.init(
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      userId: { type: DataTypes.STRING(32) },
      username: { type: DataTypes.STRING(255) },
      password: { type: DataTypes.STRING(255) },
      phone: { type: DataTypes.STRING(32) },
      email: { type: DataTypes.STRING(255) },
      nickname: { type: DataTypes.STRING(255) },
      avatar: { type: DataTypes.STRING(255) },
      status: { type: DataTypes.INTEGER, defaultValue: 0 },
      source: { type: DataTypes.STRING(255) },
      deletedAt: { type: DataTypes.DATE },
    },
    {
      sequelize,
      tableName: DataBaseTableNames.User,
      modelName: DataBaseTableNames.User,
    },
  );

  return model;
}
