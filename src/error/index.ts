import { Errors } from 'node-universe';
import { HttpResponseCode } from 'typings';

/**
 * IP被被封禁报错
 */
export class IPNotPermissionAccess extends Errors.StarClientError {
  constructor(type?: string, data?: any) {
    super('该IP地址已被封禁', 404, type || '', {
      content: data,
      code: HttpResponseCode.IPNotAccess,
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
      code: HttpResponseCode.NotLogin,
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
      code: HttpResponseCode.ERR_INVALID_TOKEN,
    });
  }
}

/**
 * 无效的Token
 */
export class InvalidTokenError extends Errors.StarClientError {
  constructor(type?: string, data?: any) {
    super('无效的Token', 401, type || '', {
      content: data,
      code: HttpResponseCode.ERR_INVALID_TOKEN,
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
      code: HttpResponseCode.REFRESH_TOKEN,
    });
  }
}

/**
 * 权限被拒绝
 */
export class PermissionDeniedError extends Errors.StarClientError {
  constructor(type?: string, data?: any) {
    super('权限被拒绝', 403, type || '', {
      content: data,
      code: HttpResponseCode.NoPermissionError,
    });
  }
}

/**
 * 请求频率超限
 */
export class RateLimitExceededError extends Errors.StarClientError {
  constructor(type?: string, data?: any) {
    super('请求过于频繁，请稍后再试', 429, type || '', {
      content: data,
      code: HttpResponseCode.TooManyRequests,
    });
  }
}
