import { IncomingMessage, ServerResponse } from 'http';

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

type CustomOrigin = (origin: string) => boolean;

type onBeforeCall = (ctx: any, route: Route, req: IncomingRequest, res: GatewayResponse) => void;
type onAfterCall = (
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
