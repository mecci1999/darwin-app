import { DataBaseTableNames } from 'typings';
import { mainConnection } from '..';
import { IUserLayoutTableAttributes, UserLayoutTable } from '../models/userLayout';

export async function saveOrUpdateUserLayout(userLayout: IUserLayoutTableAttributes) {
  const model = await mainConnection.getModel<UserLayoutTable>(DataBaseTableNames.UserLayout);
  if (!model) return null;

  await model.upsert(userLayout);
  return userLayout;
}

export async function findUserLayout(userId: string, key: string) {
  const model = await mainConnection.getModel<UserLayoutTable>(DataBaseTableNames.UserLayout);
  if (!model) return null;

  const userLayout = await model.findOne({
    where: {
      userId,
      key,
    },
    raw: true,
  });

  return userLayout;
}
