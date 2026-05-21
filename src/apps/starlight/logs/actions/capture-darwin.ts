import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, HttpStatusCode, Starlight } from 'typings';
import { enqueueDarwinLogRecord } from '../utils/darwin-log-capture';

export default function captureDarwin(star: Starlight) {
  return {
    'v1.capture-darwin': {
      metadata: {
        auth: false,
      },

      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const accepted = enqueueDarwinLogRecord(ctx.params);
          return {
            status: HttpStatusCode.OK,
            data: {
              content: { accepted },
              message: accepted ? 'Darwin log captured' : 'Darwin log ignored',
              code: HttpResponseCode.Success,
              success: true,
            },
          };
        } catch (error: any) {
          star.logger?.error('Darwin log capture failed', { error: error.message });
          return {
            status: HttpStatusCode.INTERNAL_SERVER_ERROR,
            data: {
              content: null,
              message: 'Darwin log capture failed',
              code: HttpResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        }
      },
    },
  };
}
