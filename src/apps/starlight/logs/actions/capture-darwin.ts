import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, HttpStatusCode, Starlight } from 'typings';
import {
  enqueueForwardedDarwinLogRecord,
  enqueueForwardedDarwinLogRecords,
  flushDarwinLogCaptureForSearch,
} from '../utils/darwin-log-capture';

const isGatewayRecord = (record: any) => {
  const bindings = record?.bindings || {};
  return String(bindings.svc || bindings.mod || '').toLowerCase() === 'gateway';
};

const isGatewayExplorerRecord = (record: any) => {
  if (!isGatewayRecord(record)) return false;
  const args = Array.isArray(record?.args) ? record.args : [];
  return args.some((arg) => typeof arg === 'string' && arg.includes('/api/logs/v1/explorer/'));
};

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
          const gatewayExplorerRecords = records
            ? records.filter(isGatewayExplorerRecord).length
            : isGatewayExplorerRecord(payload)
              ? 1
              : 0;
          if (gatewayExplorerRecords > 0) {
            star.logger?.info('Darwin gateway log capture checkpoint', {
              records: records?.length || 1,
              gatewayExplorerRecords,
              accepted,
              sample: records?.find(isGatewayExplorerRecord)?.args?.[0] || payload?.args?.[0],
            });
            void flushDarwinLogCaptureForSearch().catch((error) => {
              star.logger?.warn('Darwin gateway log capture background flush failed', {
                error: error instanceof Error ? error.message : String(error),
              });
            });
          }
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
