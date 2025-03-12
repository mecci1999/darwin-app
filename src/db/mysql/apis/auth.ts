/**
 * 登录校验方法
 */
import {} from 'sequelize';
import { DataBaseTableNames } from 'typings/enum';
import { mainConnection } from '..';

// 查询邮箱是否存在
export async function findEmailIsExist(email: string): Promise<boolean> {
  if (!email) return false;

  const model = mainConnection.getModel(DataBaseTableNames.EmailAuth);

  const result = (await model).findOne({ where: { email } });

  return !!result;
}

// 新增数据
export async function saveOrUpdateEmailAuth(params: {
  email: string;
  passwordHash: string;
  salt: string;
  userId: string;
}) {
  try {
    const model = mainConnection.getModel(DataBaseTableNames.EmailAuth);
    const data = { ...params, isVerified: true };

    return (await model)
      .bulkCreate([data], {
        updateOnDuplicate: ['email', 'passwordHash', 'salt', 'userId'],
      })
      .then(() => true);
  } catch (error) {
    console.log(error);
  }
}
