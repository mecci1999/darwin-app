import { Erros } from "node-universe-gateway";
import { ResponseErrorCode } from "typings/enum";

/**
 * IP被被封禁报错
 */
export class IPNotPermissionAccess extends Erros.StarClientError {
  constructor(type?: string, data?: any) {
    super("该IP地址已被封禁", 404, type, {
      data,
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
