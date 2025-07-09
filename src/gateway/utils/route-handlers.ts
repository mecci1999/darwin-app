import { IPNotPermissionAccess } from 'error';
import { Context, Star } from 'node-universe';
import { GatewayResponse, IncomingRequest, Route } from 'typings';
import { ResponseUtils } from 'utils';
import { AuthHandler } from './auth-handler';
import { CookieHandler } from './cookie-handler';
import { GatewayUtils } from './gateway-utils';

/**
 * 路由处理器
 */
export class RouteHandlers {
  /**
   * 通用的请求前处理
   */
  public static async handleBeforeCall(
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
      if (GatewayUtils.isIpBlocked(req.socket.remoteAddress, state)) {
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

      await AuthHandler.handleAuthentication(ctx, req, action, async (ctx, token) => {
        await (star as any).authorize(ctx, token);
      });
    }
  }

  /**
   * 通用的请求后处理
   */
  public static handleAfterCall(
    ctx: Context,
    route: Route,
    req: IncomingRequest,
    res: GatewayResponse,
    data: any,
  ) {
    // 设置认证cookie
    if ((ctx.meta as any)?.token && (ctx.meta as any)?.refreshToken) {
      CookieHandler.setAuthCookies(res, (ctx.meta as any).token, (ctx.meta as any).refreshToken);
    }

    // 清除cookie
    if ((ctx.meta as any)?.clearCookies) {
      CookieHandler.clearAuthCookies(res);
    }

    return data;
  }

  /**
   * 通用的错误处理
   */
  public static handleError(req: IncomingRequest, res: GatewayResponse, err: any, state: any) {
    // 处理频率限制错误
    if (err.code === 429 && req?.socket?.remoteAddress) {
      GatewayUtils.addIpToBlacklist(req.socket.remoteAddress, state, '频繁请求');
    }

    res.setHeader('Content-Type', 'text/plain');
    res.writeHead(err.code || 500);
    res.end(ResponseUtils.createErrorResponse(err));
  }
}
