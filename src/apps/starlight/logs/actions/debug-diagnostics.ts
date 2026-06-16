import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, HttpStatusCode, Starlight } from 'typings';
import { getDebugDiagnosticsState, setDebugDiagnosticsState } from '../utils/debug-diagnostics';
import {
  enqueueForwardedDarwinLogRecord,
  enqueueForwardedDarwinLogRecords,
  flushDarwinLogCaptureForSearch,
} from '../utils/darwin-log-capture';

type ClientDebugDiagnosticsState = {
  enabled: boolean;
  updatedAt: string | null;
  updatedBy?: string;
  expiresAt: string | null;
};

const buildSuccessResponse = (content: unknown, message: string): HttpResponseItem => ({
  status: HttpStatusCode.OK,
  data: {
    content,
    message,
    code: HttpResponseCode.Success,
    success: true,
  },
});

const toClientDebugDiagnosticsState = (
  state: ReturnType<typeof getDebugDiagnosticsState>,
): ClientDebugDiagnosticsState => ({
  enabled: state.enabled,
  updatedAt: state.updatedAt,
  updatedBy: state.updatedBy,
  expiresAt: state.expiresAt,
});

export default function debugDiagnostics(star: Starlight) {
  return {
    'v1.diagnostics.debug': {
      metadata: {
        auth: true,
        roles: ['admin', 'user'],
      },

      async handler(ctx: Context): Promise<HttpResponseItem> {
        const params = ctx.params as {
          enabled?: boolean;
          durationMs?: number;
          reason?: string;
        };

        if (typeof params?.enabled !== 'boolean') {
          return buildSuccessResponse(
            toClientDebugDiagnosticsState(getDebugDiagnosticsState()),
            '',
          );
        }

        const nextState = setDebugDiagnosticsState({
          enabled: params.enabled,
          durationMs: params.durationMs,
          reason: params.reason,
          updatedBy: String((ctx.meta as { userId?: string } | undefined)?.userId || 'client'),
        });

        star.logger?.info('Debug diagnostics switch updated', {
          enabled: nextState.enabled,
          expiresAt: nextState.expiresAt,
          updatedBy: nextState.updatedBy,
          reason: nextState.reason,
        });

        return buildSuccessResponse(toClientDebugDiagnosticsState(nextState), '');
      },
    },
    'v1.diagnostics.capture-debug': {
      metadata: {
        auth: true,
        roles: ['admin', 'user'],
      },

      async handler(ctx: Context): Promise<HttpResponseItem> {
        const state = getDebugDiagnosticsState();
        const payload = ctx.params as any;
        const records = Array.isArray(payload?.records) ? payload.records : undefined;
        const received = records ? records.length : 1;

        if (!state.enabled) {
          return buildSuccessResponse(
            {
              received,
              accepted: 0,
              ignored: received,
              reason: '',
            },
            '',
          );
        }

        const accepted = records
          ? enqueueForwardedDarwinLogRecords(records)
          : enqueueForwardedDarwinLogRecord(payload)
            ? 1
            : 0;

        if (accepted > 0) {
          void flushDarwinLogCaptureForSearch().catch((error) => {
            star.logger?.warn('Debug diagnostics capture flush failed', {
              error: error instanceof Error ? error.message : String(error),
            });
          });
        }

        return buildSuccessResponse(
          {
            received,
            accepted,
            ignored: received - accepted,
          },
          '',
        );
      },
    },
  };
}
