import { Errors } from 'node-universe';
import { ResponseCode } from 'typings/enum';

/**
 * IP被被封禁报错
 */
export class IPNotPermissionAccess extends Errors.StarClientError {
  constructor(type?: string, data?: any) {
    super('该IP地址已被封禁', 404, type || '', {
      content: data,
      code: ResponseCode.IPNotAccess,
    });
  }
}

/**
 * 请求参数不合法
 */
export class RequestParamInvalidError extends Errors.StarClientError {
  constructor(type?: string, data?: any) {
    super('Invalid request body ', 400, type || '', { content: data });
  }
}

/**
 * 没有权限访问
 */
export class NoPermissionError extends Errors.StarClientError {
  constructor(type?: string, data?: any) {
    super('No permission to access', 403, type || '', { content: data });
  }
}

/**
 * 用户没有登录
 */
export class UserNotLoginError extends Errors.StarClientError {
  constructor(type?: string, data?: any) {
    super('请先登录~', 200, type || '', {
      content: data,
      code: ResponseCode.NotLogin,
    });
  }
}

/**
 * Token无效
 */
export class UnAuthorizedError extends Errors.StarClientError {
  constructor(type?: string, data?: any) {
    super('Token无效', 401, type || '', {
      content: data,
      code: ResponseCode.ERR_INVALID_TOKEN,
    });
  }
}

/**
 * Token过期，续签
 */
export class TokenExpiredError extends Errors.StarClientError {
  constructor(type?: string, data?: any) {
    super('Token过期续签', 401, type || '', {
      content: data,
      code: ResponseCode.REFRESH_TOKEN,
    });
  }
}
