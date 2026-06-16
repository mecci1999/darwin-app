import { Context } from 'node-universe';
import { HttpResponseCode, Starlight } from 'typings';
import forgetHash from './forgetHash';
import login from './login';
import logout from './logout';
import qrcode from './qrcode';
import refresh from './refresh';
import register from './register';
import rsa from './rsa';
import updateHash from './updateHash';
import verifyCode from './verifyCode';
import { instrumentServiceActions } from '../../../apps/starlight/metrics/utils/action-metrics';

/**
 * 验证微服务的动作
 */
const authAction = (star: Starlight) => {
  const verifyCodeAction = verifyCode(star);
  const registerAction = register(star);
  const loginAction = login(star);
  const logoutAction = logout(star);
  const rsaAction = rsa(star);
  const forgetHashAction = forgetHash(star);
  const updateHashAction = updateHash(star);
  const refreshAction = refresh(star);
  const qrcodeAction = qrcode(star);

  return instrumentServiceActions(star, 'auth', {
    ...verifyCodeAction,
    ...registerAction,
    ...loginAction,
    ...logoutAction,
    ...rsaAction,
    ...forgetHashAction,
    ...updateHashAction,
    ...refreshAction,
    ...qrcodeAction,
    resolveToken: {
      metadata: {
        auth: true,
      },
      async handler(ctx: Context): Promise<any> {
        const { token } = ctx.params;
        if (!token) {
          return {
            status: 401,
            data: {
              content: null,
              message: 'token不存在',
              code: HttpResponseCode.ERR_INVALID_TOKEN,
            },
          };
        }

        return (this as any).resolveToken(token);
      },
    },
  });
};

export default authAction;
