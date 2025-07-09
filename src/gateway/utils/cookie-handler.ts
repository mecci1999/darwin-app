import { GatewayResponse } from 'typings';

/**
 * Cookie处理器
 */
export class CookieHandler {
  /**
   * 设置认证cookie
   */
  public static setAuthCookies(res: GatewayResponse, token: string, refreshToken: string) {
    res.setHeader(
      'Set-Cookie',
      `ACCESS_TOKEN=${token}; REFRESH_TOKEN=${refreshToken}; HttpOnly; Path=/; SameSite=Strict;`,
    );
  }

  /**
   * 清除认证cookie
   */
  public static clearAuthCookies(res: GatewayResponse) {
    res.setHeader('Set-Cookie', [
      'ACCESS_TOKEN=; HttpOnly; Path=/; SameSite=Strict; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      'REFRESH_TOKEN=; HttpOnly; Path=/; SameSite=Strict; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    ]);
  }
}
