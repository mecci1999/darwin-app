import { EventEmitter } from 'events';
import { installDarwinKafkaRecoveryLifecycle, sanitizeKafkaRecoveryLifecycleReport } from '../../src/core/kafka-recovery-lifecycle';
import { Starlight } from '../../src/typings';

const lifecyclePayload = {
  transporter: 'kafka',
  instanceID: 'metrics-production-worker-1',
  groupId: 'metrics-production-worker-1',
  generation: 7,
  reason: 'heartbeat_stalled',
  attempt: 2,
  delay: 1000,
  error: { message: 'password=must-not-leak' },
};

describe('Darwin Kafka recovery lifecycle bridge', () => {
  it('sanitizes serializable lifecycle facts without forwarding errors', () => {
    const report = sanitizeKafkaRecoveryLifecycleReport('failed', lifecyclePayload);

    expect(report).toEqual(expect.objectContaining({
      kind: 'failed', instanceID: 'metrics-production-worker-1', service: 'metrics', generation: 7,
      reason: 'heartbeat_stalled', attempt: 2, delay: 1000,
    }));
    expect(JSON.stringify(report)).not.toContain('must-not-leak');
    expect(sanitizeKafkaRecoveryLifecycleReport('failed', { ...lifecyclePayload, transporter: 'redis' })).toBeNull();
    expect(sanitizeKafkaRecoveryLifecycleReport('failed', { ...lifecyclePayload, instanceID: '../../bad' })).toBeNull();
  });

  it('reports local events through Gateway RPC and detaches every listener on stop', async () => {
    const localBus = new EventEmitter();
    const star = {
      localBus,
      call: jest.fn(async () => undefined),
      stop: jest.fn(async () => undefined),
      logger: { warn: jest.fn() },
    } as unknown as Starlight;
    const bridge = installDarwinKafkaRecoveryLifecycle(star);

    localBus.emit('$transporter.consumer.recovery.failed', lifecyclePayload);
    await Promise.resolve();
    expect(star.call).toHaveBeenCalledWith('gateway.kafkaRecovery.report', expect.objectContaining({ kind: 'failed', service: 'metrics' }), {
      meta: { internal: true, system: 'darwin-kafka-recovery' },
    });

    bridge.stop();
    localBus.emit('$transporter.consumer.recovery.failed', lifecyclePayload);
    expect(star.call).toHaveBeenCalledTimes(1);
    await star.stop();
    expect(localBus.listenerCount('$transporter.consumer.recovery.scheduled')).toBe(0);
    expect(localBus.listenerCount('$transporter.consumer.recovery.succeeded')).toBe(0);
    expect(localBus.listenerCount('$transporter.consumer.recovery.failed')).toBe(0);
    expect(localBus.listenerCount('$transporter.consumer.kafkaJsRestart.timedOut')).toBe(0);
  });
});
