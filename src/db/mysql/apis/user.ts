import { DataBaseTableNames } from 'typings/enum';
import { mainConnection } from '..';
import { IUserTableAttributes, UserTable } from '../models/user';

/**
 * 用户表相关数据库操作
 */
export async function saveOrUpdateUsers(users: IUserTableAttributes[]) {
  try {
    const model = await mainConnection.getModel<UserTable>(DataBaseTableNames.User);
    return model
      .bulkCreate(users, {
        updateOnDuplicate: ['userId', 'nickname', 'avatar', 'status', 'source'],
      })
      .then(() => users);
  } catch (error) {
    console.log(error);
  }
}

/**
 * 获取所用的用户
 */
export async function queryAllUsers() {
  try {
    const model = await mainConnection.getModel<UserTable>(DataBaseTableNames.User);
    if (!model) return [];
    return model
      .findAll({ attributes: ['userId', 'nickname', 'avatar', 'status', 'source'] })
      .then((res) => {
        if (res) {
          return res.map((item) => {
            return item.toJSON();
          });
        }
      });
  } catch (error) {
    console.log(error);
  }
}
