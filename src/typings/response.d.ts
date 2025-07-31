import { HttpResponseCode } from './enum';

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

/**
 * 请求返回的响应类型
 */
export interface HttpResponseItem {
  status: HttpStatusCode; // http状态码
  data: {
    code?: HttpResponseCode | number; // 响应码
    content?: any; // 响应主体
    message?: string; // 消息
    success?: boolean; // 是否成功
  };
}
export { HttpResponseCode };
