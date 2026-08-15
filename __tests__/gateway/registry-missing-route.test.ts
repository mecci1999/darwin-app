import { isInternalOnlyPublicService, remapMetricsPublicRoute, resolveGatewayErrorStatus } from '../../src/core/gateway/metrics-route-remap';

describe('registry-missing gateway facade', () => {
  it.each([
    ['registry-missing-alert-rules', 'registry-missing-alert-rules', undefined],
    ['registry-missing-alert-rules/create', 'registry-missing-alert-rules/create', undefined],
    ['registry-missing-alert-rules/auth-rule', 'registry-missing-alert-rules/:id', 'auth-rule'],
    ['registry-missing-alert-rules/auth-rule/delete', 'registry-missing-alert-rules/:id/delete', 'auth-rule'],
  ])('remaps /api/metrics/v1/%s to its narrow metrics-alerts action', (rawAction, action, id) => {
    const remapped = remapMetricsPublicRoute('metrics', 'v1', rawAction, {});
    expect(remapped.service).toBe('metrics-alerts');
    expect(remapped.action).toBe(action);
    expect(remapped.params.id).toBe(id);
  });

  it('does not remap arbitrary metrics routes to metrics-alerts', () => {
    expect(remapMetricsPublicRoute('metrics', 'v1', 'registry-missing-alert-rules/auth-rule/extra', {}).service).toBe('metrics');
  });

  it('keeps the raw metrics-alerts service outside the public route facade', () => {
    expect(isInternalOnlyPublicService('metrics-alerts')).toBe(true);
    expect(isInternalOnlyPublicService('metrics')).toBe(false);
  });

  it('preserves the explicit 404 status for raw internal-service rejection', () => {
    expect(resolveGatewayErrorStatus({ code: 404, data: { status: 404 } })).toBe(404);
    expect(resolveGatewayErrorStatus({ code: 'BAD_GATEWAY', data: { status: 404 } })).toBe(404);
    expect(resolveGatewayErrorStatus({ code: 500, message: { code: 404, data: { status: 404 } } })).toBe(404);
    expect(resolveGatewayErrorStatus(new Error('unexpected'))).toBe(500);
  });
});
