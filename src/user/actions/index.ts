import { Context, Star } from 'node-universe';
import { ResponseCode } from 'typings/enum';
import createUser from './createUser';
import getUserInfo from './getUserInfo';

/**
 * 用户微服务的动作
 */
const userActions = (star: Star) => {
  const createUserAction = createUser(star);
  const getUserInfoAction = getUserInfo(star);

  return {
    ...createUserAction,
    ...getUserInfoAction,
  };
};

export default userActions;
