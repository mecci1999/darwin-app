// A complete Photoshop package produces nine 4K-derived files and persists each
// artifact to private storage. This is deliberately the sole long-running RPC.
export const MICRO_APP_COMPLETE_UPLOAD_TIMEOUT_MS = 5 * 60_000;

const isPhotoshopCompleteUpload = (params: unknown): boolean => (
  typeof params === 'object'
  && params !== null
  && !Array.isArray(params)
  && (params as Record<string, unknown>).operation === 'photoshop-ingestion.complete-upload'
);

export const resolveGatewayRpcTimeout = (
  service: string,
  version: string,
  action: string,
  params: unknown,
  defaultTimeout: number,
) => service === 'micro-app'
  && version === 'v1'
  && (action === 'completeUpload' || (action === 'scoped-api' && isPhotoshopCompleteUpload(params)))
  ? MICRO_APP_COMPLETE_UPLOAD_TIMEOUT_MS
  : defaultTimeout;
