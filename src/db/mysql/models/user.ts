/**
 * 用户表
 */
import { DataTypes, Model, Optional, Sequelize } from "sequelize";
import { DataBaseTableNames } from "typings/enum";

export interface IUserTableAttributes {
  id: number;
  userId: string;
  username: string;
  password: string;
  phone?: string;
}

export class UserTable
  extends Model<IUserTableAttributes, Optional<IUserTableAttributes, "id">>
  implements IUserTableAttributes
{
  public id!: number; // id
  public userId!: string; // 用户id，可以用作展示
  public username!: string; // 用户名
  public password!: string; // 用户密码，非明文保存
  public phone: string | undefined; // 用户手机号
  public readonly createdTime!: Date; // 创建时间
  public readonly updatedTime!: Date; // 更新时间
}

export default function (sequelize: Sequelize) {
  const model = UserTable.init(
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true },
      userId: { type: DataTypes.STRING(32), primaryKey: true },
      username: { type: DataTypes.STRING(255) },
      password: { type: DataTypes.STRING(255) },
      phone: { type: DataTypes.STRING(32) },
    },
    {
      sequelize,
      tableName: DataBaseTableNames.User,
      modelName: DataBaseTableNames.User,
    },
  );

  return model;
}
