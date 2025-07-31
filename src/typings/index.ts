import { IncomingMessage, ServerResponse } from 'http';
import { Star } from 'node-universe';
import { DatabaseService } from 'db/mysql';

/**
 * 扩展的 Star 类型，包含数据库服务
 */
export interface Starlight extends Star {
  db: DatabaseService;
}

/**
 * 动作文件的定义
 */
export interface ServiceActionSchema {
  name: string;
  action: GenericObject;
}

export interface GenericObject {
  [name: string]: any;
}

// 路由
export class Route {
  callOptions?: any;
  cors?: CorsOptions;
  etag?: any;
  hasWhitelist?: boolean;
  logging?: boolean;
  mappingPolicy?: string;
  middlewares?: Function[];
  onBeforeCall?: onBeforeCall;
  onAfterCall?: onAfterCall;
  opts?: any;
  path?: string;
  whitelist?: string[];
}

// CORS配置
export interface CorsOptions {
  origin?: boolean | string | RegExp | (string | RegExp)[] | CustomOrigin;
  methods?: string | string[];
  allowedHeaders?: string | string[];
  exposedHeaders?: string | string[];
  credentials?: boolean;
  maxAge?: number;
  preflightContinue?: boolean;
  optionsSuccessStatus?: number;
}

export type CustomOrigin = (origin: string) => boolean;

export type onBeforeCall = (
  ctx: any,
  route: Route,
  req: IncomingRequest,
  res: GatewayResponse,
) => void;

export type onAfterCall = (
  ctx: any,
  route: Route,
  req: IncomingRequest,
  res: GatewayResponse,
  data: any,
) => any;

export class GatewayResponse extends ServerResponse {
  $ctx: any;
  $route?: Route;
  $service?: any;
  locals?: Record<string, unknown>;
}

export class IncomingRequest extends IncomingMessage {
  $action: any;
  $alias?: any;
  $ctx?: any;
  $endpoint?: any;
  $next: any;
  $params: any;
  $route?: Route;
  $service?: any;
  $startTime?: number[];
  originalUrl?: string;
  parsedUrl?: string;
  query?: Record<string, string>;
}

// 导出其他声明文件的类型
export * from './auth';
export * from './config';
export * from './enum';
export * from './response';
