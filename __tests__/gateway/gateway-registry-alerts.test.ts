import {
  createGatewayRegistryAlertAdapter,
  gatewayRegistryAlertConfigurationFromEnvironment,
  normalizeGatewayRegistryAlertRecipients,
} from '../../src/core/gateway/gateway-registry-alerts';

const degraded = {
  kind: 'readiness_transition' as const,
  occurredAt: Date.parse('2026-08-14T00:00:00.000Z'),
  outcome: 'degraded' as const,
  reason: 'registry_membership',
  missingServiceCount: 2,
  registeredServiceCount: 18,
  transportConnected: true,
};

const healthy = {
  ...degraded,
  occurredAt: Date.parse('2026-08-14T00:01:00.000Z'),
  outcome: 'healthy' as const,
  missingServiceCount: 0,
  registeredServiceCount: 20,
};

describe('gateway registry durable alerts', () => {
  it('uses safe defaults and only enables configured valid delivery targets', () => {
    expect(gatewayRegistryAlertConfigurationFromEnvironment({})).toEqual({ channels: [], emailRecipients: [], notifyOnRecovery: true });
    expect(normalizeGatewayRegistryAlertRecipients(' OPS@example.test,invalid,ops@example.test ')).toEqual(['ops@example.test']);
    expect(gatewayRegistryAlertConfigurationFromEnvironment({
      GATEWAY_REGISTRY_ALERT_CHANNELS: 'Email,Webhook,InApp',
      GATEWAY_REGISTRY_ALERT_EMAIL_RECIPIENTS: 'invalid',
      GATEWAY_REGISTRY_ALERT_NOTIFY_ON_RECOVERY: 'false',
    })).toEqual({ channels: ['InApp'], emailRecipients: [], notifyOnRecovery: false });
  });

  it('queues exactly one active and recovery event per degradation generation', async () => {
    const outbox = { createNotificationEvent: jest.fn(async () => true) };
    const adapter = createGatewayRegistryAlertAdapter(outbox, {
      channels: ['Email', 'InApp'],
      emailRecipients: ['ops@example.test'],
      notifyOnRecovery: true,
    });

    await adapter.record({ ...degraded, kind: 'transporter_disconnected', outcome: 'failure' });
    await adapter.record(degraded);
    await adapter.record(degraded);
    await adapter.record(healthy);
    await adapter.record(healthy);
    const nextDegradation = { ...degraded, occurredAt: Date.parse('2026-08-14T00:02:00.000Z') };
    await adapter.record(nextDegradation);

    expect(outbox.createNotificationEvent).toHaveBeenCalledTimes(3);
    expect(outbox.createNotificationEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      tenantId: 'system',
      alertId: `gateway-registry-readiness-${degraded.occurredAt}`,
      eventKey: `opened:${degraded.occurredAt}`,
      channels: [{ channel: 'Email', target: 'ops@example.test' }, { channel: 'InApp', target: 'in-app' }],
      payload: expect.objectContaining({ status: 'active', level: 'critical', transportConnected: true }),
    }));
    expect(outbox.createNotificationEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      alertId: `gateway-registry-readiness-${degraded.occurredAt}`,
      eventKey: `recovered:${degraded.occurredAt}`,
      payload: expect.objectContaining({ status: 'resolved' }),
    }));
    expect(outbox.createNotificationEvent).toHaveBeenNthCalledWith(3, expect.objectContaining({
      alertId: `gateway-registry-readiness-${nextDegradation.occurredAt}`,
      eventKey: `opened:${nextDegradation.occurredAt}`,
    }));
  });

  it('does not queue recovery when recovery delivery is disabled', async () => {
    const outbox = { createNotificationEvent: jest.fn(async () => true) };
    const adapter = createGatewayRegistryAlertAdapter(outbox, {
      channels: ['InApp'],
      emailRecipients: [],
      notifyOnRecovery: false,
    });

    await adapter.record(degraded);
    await adapter.record(healthy);

    expect(outbox.createNotificationEvent).toHaveBeenCalledTimes(1);
    expect(outbox.createNotificationEvent).toHaveBeenCalledWith(expect.objectContaining({ eventKey: `opened:${degraded.occurredAt}` }));
  });

  it('does not queue alert events without a configured valid target', async () => {
    const outbox = { createNotificationEvent: jest.fn(async () => true) };
    const adapter = createGatewayRegistryAlertAdapter(outbox, { channels: ['Email'], emailRecipients: [], notifyOnRecovery: true });

    await adapter.record(degraded);
    await adapter.record(healthy);

    expect(outbox.createNotificationEvent).not.toHaveBeenCalled();
  });
});
