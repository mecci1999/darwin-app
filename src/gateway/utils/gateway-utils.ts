import { IPAddressBanStatus } from 'typings/enum';
import { GatewayState } from '../types';

/**
 * 网关通用工具类
 */
export class GatewayUtils {
  /**
   * 检查IP是否在黑名单中
   */
  public static isIpBlocked(ip: string, state: GatewayState): boolean {
    return state.ips.includes(ip);
  }

  /**
   * 添加IP到黑名单
   */
  public static addIpToBlacklist(
    ip: string,
    state: GatewayState,
    reason: string = '频繁请求',
  ): void {
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
  public static extractTokenFromCookie(cookie: string, tokenName: string): string | undefined {
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
}
