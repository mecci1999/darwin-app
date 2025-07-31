import { IPNotPermissionAccess, UserNotLoginError } from 'error';
import { Context, Star } from 'node-universe';
import {
  GatewayResponse,
  HttpResponseCode,
  HttpStatusCode,
  IncomingRequest,
  IPAddressBanStatus,
  Route,
} from 'typings';
import { AuthTokens, GatewayState } from '../types';

/**
 * 网关辅助工具类
 * 包含所有网关相关的工具方法
 */
export class GatewayHelper {
  /**
   * 检查IP是否在黑名单中
   */
  static isIpBlocked(ip: string, state: GatewayState): boolean {
    return state.ips.includes(ip);
  }

  /**
   * 添加IP到黑名单
   */
  static addIpToBlacklist(ip: string, state: GatewayState, reason: string = '频繁请求'): void {
    if (!state.ips.includes(ip)) {
      state.ips.push(ip);
      state.ipBlackList.push({
        ipv4: ip,
        reason,
        status: IPAddressBanStatus.active,
        isArtificial: false,
      });
    }
  }

  /**
   * 从cookie中提取token
   */
  static extractTokenFromCookie(cookie: string, tokenName: string): string | undefined {
    return cookie
      ?.split(';')
      .find((item) => item.includes(tokenName))
      ?.split('=')[1];
  }

  /**
   * 处理action路径
   */
  static processActionPath(action: any): string {
    if (!action) return '';

    if (Array.isArray(action)) {
      return action.join('.');
    }

    if (typeof action === 'string' && action.includes('/')) {
      return action.split('/').join('.');
    }

    return action;
  }

  /**
   * 提取认证token
   */
  static extractTokens(req: IncomingRequest): AuthTokens {
    const cookieHeader = req.headers['Cookie'] || req.headers['cookie'];
    const authorizationHeader = req.headers['Authorization'] || req.headers['authorization'] || '';

    // 处理可能的数组类型
    const cookie = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
    const authorization = Array.isArray(authorizationHeader)
      ? authorizationHeader[0]
      : authorizationHeader;

    const accessToken = cookie ? this.extractTokenFromCookie(cookie, 'ACCESS_TOKEN') : undefined;
    const refreshToken = cookie ? this.extractTokenFromCookie(cookie, 'REFRESH_TOKEN') : undefined;
    const bearerToken = authorization?.split(' ')[1];

    return {
      accessToken,
      refreshToken,
      bearerToken,
      finalToken: accessToken || bearerToken,
    };
  }

  /**
   * 设置认证cookie
   */
  static setAuthCookies(res: GatewayResponse, token: string, refreshToken: string) {
    res.setHeader(
      'Set-Cookie',
      `ACCESS_TOKEN=${token}; REFRESH_TOKEN=${refreshToken}; HttpOnly; Path=/; SameSite=Strict;`,
    );
  }

  /**
   * 清除认证cookie
   */
  static clearAuthCookies(res: GatewayResponse) {
    res.setHeader('Set-Cookie', [
      'ACCESS_TOKEN=; HttpOnly; Path=/; SameSite=Strict; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      'REFRESH_TOKEN=; HttpOnly; Path=/; SameSite=Strict; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    ]);
  }

  /**
   * 处理认证逻辑
   */
  static async handleAuthentication(
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

  /**
   * 通用的请求前处理
   */
  static async handleBeforeCall(
    ctx: Context,
    route: Route,
    req: IncomingRequest,
    res: GatewayResponse,
    star: Star,
    state: any,
    requireAuth: boolean = true,
  ) {
    // 设置请求元数据
    (ctx.meta as any).req = {
      userAgent: req.headers['user-agent'] || req.headers['User-Agent'],
    };

    // IP黑名单检查
    if (req?.socket?.remoteAddress) {
      if (this.isIpBlocked(req.socket.remoteAddress, state)) {
        throw new IPNotPermissionAccess();
      }
      (ctx.meta as any).req = { ...(ctx.meta as any).req, ip: req.socket.remoteAddress };
    }

    // 认证处理
    if (requireAuth) {
      const actions = star.registry?.actions.list() || [];
      const action = actions.find(
        (item) =>
          item.name === `${req.$params.service}.${req.$params.version}.${req.$params.action}`,
      );

      await this.handleAuthentication(ctx, req, action, async (ctx, token) => {
        await (star as any).authorize(ctx, token);
      });
    }
  }

  /**
   * 通用的请求后处理
   */
  static handleAfterCall(
    ctx: Context,
    route: Route,
    req: IncomingRequest,
    res: GatewayResponse,
    data: any,
  ) {
    // 设置认证cookie
    if ((ctx.meta as any)?.token && (ctx.meta as any)?.refreshToken) {
      this.setAuthCookies(res, (ctx.meta as any).token, (ctx.meta as any).refreshToken);
    }

    // 清除cookie
    if ((ctx.meta as any)?.clearCookies) {
      this.clearAuthCookies(res);
    }

    return data;
  }

  /**
   * 通用的错误处理
   */
  static handleError(req: IncomingRequest, res: GatewayResponse, err: any, state: any) {
    // 处理频率限制错误
    if (err.code === 429 && req?.socket?.remoteAddress) {
      this.addIpToBlacklist(req.socket.remoteAddress, state, '频繁请求');
    }

    res.setHeader('Content-Type', 'text/plain');
    res.writeHead(err.code || 500);
    res.end({
      status: HttpStatusCode.BAD_REQUEST,
      data: {
        content: err,
        message: 'Bad request',
        code: HttpResponseCode.BAD_REQUEST,
        success: false,
      },
    });
  }
}
