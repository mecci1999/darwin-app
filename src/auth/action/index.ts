import { Star } from 'node-universe';
import forgetHash from './forgetHash';
import login from './login';
import register from './register';
import rsa from './rsa';
import updateHash from './updateHash';
import verifyCode from './verifyCode';

/**
 * 验证微服务的动作
 */
const authAction = (star: Star) => {
  const verifyCodeAction = verifyCode(star);
  const registerAction = register(star);
  const loginAction = login(star);
  const rsaAction = rsa(star);
  const forgetHashAction = forgetHash(star);
  const updateHashAction = updateHash(star);

  return {
    ...verifyCodeAction,
    ...registerAction,
    ...loginAction,
    ...rsaAction,
    ...forgetHashAction,
    ...updateHashAction,
  };
};

export default authAction;
