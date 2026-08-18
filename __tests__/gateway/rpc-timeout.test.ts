import { resolveGatewayRpcTimeout } from '../../src/core/gateway/rpc-timeout';

describe('gateway RPC timeout policy', () => {
  it('allows micro-app completion to finish its server-side scan and persistence work', () => {
    expect(resolveGatewayRpcTimeout('micro-app', 'v1', 'completeUpload', {}, 15000)).toBe(300000);
    expect(resolveGatewayRpcTimeout('micro-app', 'v1', 'scoped-api', { operation: 'photoshop-ingestion.complete-upload' }, 15000)).toBe(300000);
  });

  it('keeps the default timeout for all other routes', () => {
    expect(resolveGatewayRpcTimeout('micro-app', 'v1', 'scoped-api', { operation: 'catalog.workspace' }, 15000)).toBe(15000);
    expect(resolveGatewayRpcTimeout('micro-app', 'v1', 'uploadChunk', {}, 15000)).toBe(15000);
    expect(resolveGatewayRpcTimeout('metrics', 'v1', 'overview', {}, 15000)).toBe(15000);
  });
});
