import { Erros } from "node-universe-gateway";
import { ResponseErrorCode } from "typings/enum";

/**
 * IP被被封禁报错
 */
export class IPNotPermissionAccess extends Erros.StarClientError {
  constructor(type?: string, data?: any) {
    super("该IP地址已被封禁", 404, type, {
      content: data,
      code: ResponseErrorCode.IPNotAccess,
    });
  }
}

/**
 * 请求参数不合法
 */
export class RequestParamInvalidError extends Erros.StarClientError {
  constructor(type?: string, data?: any) {
    super("Invalid request body ", 400, type, { content: data });
  }
}

/**
 * 没有权限访问
 */
export class NoPermissionError extends Erros.StarClientError {
  constructor(type?: string, data?: any) {
    super("No permission to access", 403, type, { content: data });
  }
}

/**
 * 用户没有登录
 */
export class UserNotLoginError extends Erros.StarClientError {
  constructor(type?: string, data?: any) {
    super("请先登录~", 200, type, {
      content: data,
      code: ResponseErrorCode.NotLogin,
    });
  }
}

/**
 * Token无效
 */
export class UnAuthorizedError extends Erros.StarClientError {
  constructor(type?: string, data?: any) {
    super("Token无效", 200, type, {
      content: data,
      code: ResponseErrorCode.ERR_INVALID_TOKEN,
    });
  }
}
