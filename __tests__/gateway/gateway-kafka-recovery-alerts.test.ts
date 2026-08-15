import {
  createGatewayKafkaRecoveryAlertAdapter,
  createGatewayKafkaRecoveryReportHandler,
  gatewayKafkaRecoveryAlertConfigurationFromEnvironment,
} from '../../src/core/gateway/gateway-kafka-recovery-alerts';

const scheduled = {
  kind: 'scheduled' as const,
  instanceID: 'metrics-production-worker-1',
  service: 'metrics',
  generation: 4,
  reason: 'disconnect',
  attempt: 1,
  delay: 1000,
  occurredAt: Date.parse('2026-08-14T00:00:00.000Z'),
};

describe('gateway Kafka recovery durable alerts', () => {
  it('uses safe delivery defaults and configured valid targets only', () => {
    expect(gatewayKafkaRecoveryAlertConfigurationFromEnvironment({})).toEqual({ channels: [], emailRecipients: [], notifyOnRecovery: true });
    expect(gatewayKafkaRecoveryAlertConfigurationFromEnvironment({
      GATEWAY_KAFKA_RECOVERY_ALERT_CHANNELS: 'Email,InApp,Webhook',
      GATEWAY_KAFKA_RECOVERY_ALERT_EMAIL_RECIPIENTS: 'ops@example.test,invalid',
      GATEWAY_KAFKA_RECOVERY_ALERT_NOTIFY_ON_RECOVERY: 'false',
    })).toEqual({ channels: ['Email', 'InApp'], emailRecipients: ['ops@example.test'], notifyOnRecovery: false });
  });

  it('persists one active incident per generation, pages critical lifecycle events once, and resolves success', async () => {
    const outbox = { saveInstanceAndCreateNotificationEvent: jest.fn(async () => true) };
    const adapter = createGatewayKafkaRecoveryAlertAdapter(outbox, {
      channels: ['Email', 'InApp'], emailRecipients: ['ops@example.test'], notifyOnRecovery: true,
    });

    await adapter.record(scheduled);
    await adapter.record(scheduled);
    await adapter.record({ ...scheduled, kind: 'failed', attempt: 1 });
    await adapter.record({ ...scheduled, kind: 'failed', attempt: 2 });
    await adapter.record({ ...scheduled, kind: 'kafka_js_restart_timed_out' });
    await adapter.record({ ...scheduled, kind: 'succeeded' });

    expect(outbox.saveInstanceAndCreateNotificationEvent).toHaveBeenCalledTimes(6);
    expect(outbox.saveInstanceAndCreateNotificationEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      tenantId: 'system', status: 'active',
      alertId: 'gateway-kafka-consumer-recovery-metrics-production-worker-1-4',
    }));
    expect(outbox.saveInstanceAndCreateNotificationEvent).toHaveBeenNthCalledWith(3, expect.objectContaining({
      eventKey: 'paged:4', channels: [{ channel: 'Email', target: 'ops@example.test' }, { channel: 'InApp', target: 'in-app' }],
      payload: expect.objectContaining({ level: 'critical', lifecycle: 'failed' }),
    }));
    expect(outbox.saveInstanceAndCreateNotificationEvent).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'resolved', eventKey: 'resolved:4', payload: expect.objectContaining({ lifecycle: 'succeeded' }),
    }));
  });

  it('requires system-only authorization and rejects malformed reports', async () => {
    const adapter = { record: jest.fn(async () => undefined) };
    const handler = createGatewayKafkaRecoveryReportHandler(adapter);

    await expect(handler.report(scheduled, {})).rejects.toThrow('internal only');
    await expect(handler.report({ ...scheduled, service: 'invalid/service' }, { system: 'darwin-kafka-recovery' })).rejects.toThrow('Invalid Kafka recovery');
    await expect(handler.report(scheduled, { system: 'darwin-kafka-recovery' })).resolves.toEqual({ accepted: true });
    expect(adapter.record).toHaveBeenCalledWith(scheduled);
  });
});
