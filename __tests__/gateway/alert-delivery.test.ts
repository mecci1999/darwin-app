import {
  canReceiveGatewayAlert,
  isGatewayAlertPayload,
} from '../../src/core/gateway/methods/alert-delivery';

const alert = {
  alertId: 'alert-1',
  ruleId: 'rule-1',
  tenantId: 'tenant-a',
  level: 'critical' as const,
  service: 'gateway',
  metric: 'service.cpu.usage',
  value: 95,
  threshold: 90,
  operator: '>' as const,
  status: 'active' as const,
  message: 'CPU 超过阈值',
  time: '2026-08-11T12:00:00.000Z',
};

describe('gateway alert delivery', () => {
  it('accepts a complete tenant-scoped alert payload', () => {
    expect(isGatewayAlertPayload(alert)).toBe(true);
  });

  it('rejects malformed or unscoped alert payloads', () => {
    expect(isGatewayAlertPayload({ ...alert, tenantId: '' })).toBe(false);
    expect(isGatewayAlertPayload({ ...alert, value: Number.NaN })).toBe(false);
    expect(isGatewayAlertPayload({ ...alert, status: 'pending' })).toBe(false);
  });

  it('delivers only to authenticated clients in the intended tenant', () => {
    expect(canReceiveGatewayAlert({ isAuthenticated: true, tenantId: 'tenant-a', userId: 'user-a' }, alert)).toBe(true);
    expect(canReceiveGatewayAlert({ isAuthenticated: false, tenantId: 'tenant-a', userId: 'user-a' }, alert)).toBe(false);
    expect(canReceiveGatewayAlert({ isAuthenticated: true, tenantId: 'tenant-b', userId: 'user-b' }, alert)).toBe(false);
  });

  it('honors optional recipient user scope across a tenant', () => {
    const userAlert = { ...alert, recipientUserId: 'user-a' };
    expect(canReceiveGatewayAlert({ isAuthenticated: true, tenantId: 'tenant-a', userId: 'user-a' }, userAlert)).toBe(true);
    expect(canReceiveGatewayAlert({ isAuthenticated: true, tenantId: 'tenant-a', userId: 'user-b' }, userAlert)).toBe(false);
  });
});
