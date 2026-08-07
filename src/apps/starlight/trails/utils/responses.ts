import { HttpResponseCode, HttpResponseItem, HttpStatusCode } from 'typings';

export const success = (content: unknown, message: string, status = HttpStatusCode.OK): HttpResponseItem => ({
  status,
  data: { content, message, code: HttpResponseCode.Success, success: true },
});

export const failure = (message: string, status = HttpStatusCode.BAD_REQUEST, content: unknown = null): HttpResponseItem => ({
  status,
  data: { content, message, code: HttpResponseCode.ServiceActionFaild, success: false },
});
