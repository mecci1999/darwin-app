import { Starlight } from 'typings';
import createUser from './createUser';
import getUserInfo from './getUserInfo';
import updateUser from './updateUser';
import deleteUser from './deleteUser';
import batchGetUsers from './batchGetUsers';
import recordUserLogin from './recordUserLogin';
import recordUserLogout from './recordUserLogout';
import uploadAvatar from './uploadAvatar';

import manageApplications from './manageApplications';

/**
 * 用户微服务的动作
 */
const userActions = (star: Starlight) => {
  const createUserAction = createUser(star);
  const getUserInfoAction = getUserInfo(star);
  const updateUserAction = updateUser(star);
  const deleteUserAction = deleteUser(star);
  const batchGetUsersAction = batchGetUsers(star);
  const recordUserLoginAction = recordUserLogin(star);
  const recordUserLogoutAction = recordUserLogout(star);
  const uploadAvatarAction = uploadAvatar(star);

  const manageApplicationsAction = manageApplications(star);

  return {
    ...createUserAction,
    ...getUserInfoAction,
    ...updateUserAction,
    ...deleteUserAction,
    ...batchGetUsersAction,
    ...recordUserLoginAction,
    ...recordUserLogoutAction,
    ...uploadAvatarAction,

    ...manageApplicationsAction,
  };
};

export default userActions;
