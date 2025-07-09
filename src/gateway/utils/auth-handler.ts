import { Context } from 'node-universe';
import { IncomingRequest } from 'typings';
import { UserNotLoginError } from 'error';
import { AuthTokens } from '../types';
import { GatewayUtils } from './gateway-utils';

/**
 * 认证处理器
 */
export class AuthHandler {
  /**
   * 提取认证token
   */
  private static extractTokens(req: IncomingRequest): AuthTokens {
    const cookieHeader = req.headers['Cookie'] || req.headers['cookie'];
    const authorizationHeader = req.headers['Authorization'] || req.headers['authorization'] || '';

    // 处理可能的数组类型
    const cookie = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
    const authorization = Array.isArray(authorizationHeader)
      ? authorizationHeader[0]
      : authorizationHeader;

    const accessToken = cookie
      ? GatewayUtils.extractTokenFromCookie(cookie, 'ACCESS_TOKEN')
      : undefined;
    const refreshToken = cookie
      ? GatewayUtils.extractTokenFromCookie(cookie, 'REFRESH_TOKEN')
      : undefined;
    const bearerToken = authorization?.split(' ')[1];

    return {
      accessToken,
      refreshToken,
      bearerToken,
      finalToken: accessToken || bearerToken,
    };
  }

  /**
   * 处理认证逻辑
   */
  public static async handleAuthentication(
    ctx: Context,
    req: IncomingRequest,
    action: any,
    authorizeFn: (ctx: Context, token: string) => Promise<void>,
  ) {
    if (!action?.action?.metadata?.auth) {
      return;
    }

    const tokens = this.extractTokens(req);

    if (!tokens.finalToken) {
      throw new UserNotLoginError();
    }

    // 将token传递到ctx.meta中
    (ctx.meta as any).authToken = tokens.finalToken;
    if (tokens.refreshToken) {
      (ctx.meta as any).refreshToken = tokens.refreshToken;
    }

    try {
      await authorizeFn(ctx, tokens.finalToken);
    } catch (error) {
      throw error;
    }
  }
}
