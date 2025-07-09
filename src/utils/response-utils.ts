import { ResponseCode } from 'typings/enum';

/**
 * 响应工具类
 * 提供标准化的响应格式创建方法
 */
export class ResponseUtils {
  /**
   * 创建标准响应格式
   */
  static createResponse(
    status: number,
    content: any,
    message: string,
    code: ResponseCode,
    success: boolean = true,
  ) {
    return {
      status,
      data: {
        content,
        message,
        code,
        success,
      },
    };
  }

  /**
   * 创建错误响应
   */
  static createErrorResponse(err: any) {
    return JSON.stringify({
      status: err.code || 500,
      data: {
        code: err?.data?.code || 0,
        message: err.message,
        content: err?.data?.content || null,
        success: false,
      },
    });
  }
}
