/**
 * 登录校验方法
 */
import { DataBaseTableNames } from 'typings/enum';
import { mainConnection } from '..';

// 查询邮箱是否存在
export async function findEmailIsExist(email: string): Promise<boolean> {
  if (!email) return false;

  const model = await mainConnection.getModel(DataBaseTableNames.EmailAuth);

  console.log(model);

  const result = await model.findOne({ where: { email } });

  return !!result;
}

// 新增邮箱验证信息
export async function saveOrUpdateEmailAuth(params: {
  email: string;
  passwordHash: string;
  salt: string;
  userId: string;
}) {
  try {
    const model = await mainConnection.getModel(DataBaseTableNames.EmailAuth);
    const data = { ...params, isVerified: true };

    return await model
      .bulkCreate([data], {
        updateOnDuplicate: [
          'email',
          'userId',
          'passwordHash',
          'salt',
          'isVerified',
        ],
      })
      .then(() => true);
  } catch (error) {
    console.log(error);
  }
}

// 根据邮箱获取用户邮箱验证表中的信息
export async function findEmailAuthByEmail(email: string) {
  const model = await mainConnection.getModel(DataBaseTableNames.EmailAuth);

  const result = await model.findOne({
    where: { email },
    attributes: ['salt', 'passwordHash'],
  });

  return result;
}
