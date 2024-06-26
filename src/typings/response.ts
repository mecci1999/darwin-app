import { ResponseErrorCode } from "./enum";

/**
 * 请求返回的响应类型
 */
export interface HttpResponseItem {
  status: number; // http状态码
  data: {
    code?: ResponseErrorCode | number; // 响应码
    content?: any; // 响应主体
    message?: string; // 消息
  };
}
