import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, HttpStatusCode, Starlight } from 'typings';
import {
  enqueueForwardedDarwinLogRecord,
  enqueueForwardedDarwinLogRecords,
} from '../utils/darwin-log-capture';

export default function captureDarwin(star: Starlight) {
  return {
    'v1.capture-darwin': {
      metadata: {
        auth: false,
      },

      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const payload = ctx.params as any;
          const records = Array.isArray(payload?.records) ? payload.records : undefined;
          const accepted = records
            ? enqueueForwardedDarwinLogRecords(records)
            : (enqueueForwardedDarwinLogRecord(payload) ? 1 : 0);
          return {
            status: HttpStatusCode.OK,
            data: {
              content: { accepted },
              message: accepted > 0 ? 'Darwin log captured' : 'Darwin log ignored',
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
