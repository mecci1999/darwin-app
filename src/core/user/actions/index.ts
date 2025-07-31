import { Starlight } from 'typings';
import createUser from './createUser';
import getUserInfo from './getUserInfo';

/**
 * 用户微服务的动作
 */
const userActions = (star: Starlight) => {
  const createUserAction = createUser(star);
  const getUserInfoAction = getUserInfo(star);

  return {
    ...createUserAction,
    ...getUserInfoAction,
  };
};

export default userActions;
