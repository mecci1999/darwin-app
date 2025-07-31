// 网关相关类型定义
import { DatabaseState } from 'db/mysql';
import { IIPBlackListTableAttributes } from 'db/mysql/models/ipBlackList';
import { IConfig } from 'typings';

/**
 * 网关全局状态接口
 * 继承通用数据库状态接口，在 created 生命周期中手动初始化数据库
 */
export interface GatewayState extends DatabaseState {
  ips: string[];
  ipBlackList: IIPBlackListTableAttributes[];
  configs: IConfig[];
  ipTimer: NodeJS.Timeout | null;
}

/**
 * WebSocket消息发送参数
 */
export interface WebSocketMessageParams {
  channel?: string;
  data: any;
  clientId?: string;
  userId?: string;
}

/**
 * 认证Token信息
 */
export interface AuthTokens {
  accessToken?: string;
  refreshToken?: string;
  bearerToken?: string;
  finalToken?: string;
}
