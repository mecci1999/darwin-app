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

/**
 * 发送邮箱验证码的选项
 */
export interface verifyCodeOptions {
  /** The e-mail address of the sender. All e-mail addresses can be plain 'sender@server.com' or formatted 'Sender Name <sender@server.com>' */
  from?: string | undefined;
  /** An e-mail address that will appear on the Sender: field */
  sender?: string | undefined;
  /** Comma separated list or an array of recipients e-mail addresses that will appear on the To: field */
  to?: string | Array<string> | undefined;
  /** Comma separated list or an array of recipients e-mail addresses that will appear on the Cc: field */
  cc?: string | Array<string> | undefined;
  /** Comma separated list or an array of recipients e-mail addresses that will appear on the Bcc: field */
  bcc?: string | Array<string> | undefined;
  /** Comma separated list or an array of e-mail addresses that will appear on the Reply-To: field */
  replyTo?: string | Array<string> | undefined;
  /** The message-id this message is replying */
  inReplyTo?: string | undefined;
  /** Message-id list (an array or space separated string) */
  references?: string | string[] | undefined;
  /** The subject of the e-mail */
  subject?: string | undefined;
  /** An object or array of additional header fields */
  headers?: Headers | undefined;
  /** optional Message-Id value, random value will be generated if not set */
  messageId?: string | undefined;
  /** optional Date value, current UTC string will be used if not set */
  date?: Date | string | undefined;
  /** optional transfer encoding for the textual parts */
  encoding?: string | undefined;
  /** if set to true then fails with an error when a node tries to load content from URL */
  disableUrlAccess?: boolean | undefined;
  /** if set to true then fails with an error when a node tries to load content from a file */
  disableFileAccess?: boolean | undefined;
  /** method to normalize header keys for custom caseing */
  normalizeHeaderKey?(key: string): string;
  priority?: 'high' | 'normal' | 'low' | undefined;
  /** if set to true then converts data:images in the HTML content of message to embedded attachments */
  attachDataUrls?: boolean | undefined;
}

/**
 * HTTP状态码枚举 - 适用于标准REST场景
 */
export enum HttpStatusCode {
  // 2xx 成功
  OK = 200, // 请求成功
  CREATED = 201, // 资源创建成功
  ACCEPTED = 202, // 请求已接受，正在处理
  NO_CONTENT = 204, // 请求成功，无返回内容

  // 3xx 重定向
  MOVED_PERMANENTLY = 301, // 永久重定向
  FOUND = 302, // 临时重定向
  NOT_MODIFIED = 304, // 资源未修改

  // 4xx 客户端错误
  BAD_REQUEST = 400, // 请求参数错误
  UNAUTHORIZED = 401, // 未授权
  FORBIDDEN = 403, // 禁止访问
  NOT_FOUND = 404, // 资源不存在
  METHOD_NOT_ALLOWED = 405, // 方法不允许
  CONFLICT = 409, // 资源冲突
  UNPROCESSABLE_ENTITY = 422, // 请求格式正确但语义错误
  TOO_MANY_REQUESTS = 429, // 请求过于频繁

  // 5xx 服务器错误
  INTERNAL_SERVER_ERROR = 500, // 服务器内部错误
  NOT_IMPLEMENTED = 501, // 功能未实现
  BAD_GATEWAY = 502, // 网关错误
  SERVICE_UNAVAILABLE = 503, // 服务不可用
  GATEWAY_TIMEOUT = 504, // 网关超时
}

// 导出其他声明类型
export * from './enum';
export * from './config';
