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

  it('restores a local service catalog entry after the local node is marked unavailable', async () => {
    const localBus = new EventEmitter();
    const localNode = { id: 'metrics-production-metrics', available: false, offlineSince: 123 };
    const serviceSpecification = { name: 'metrics', fullName: 'metrics' };
    const registryServices: Array<{ fullName: string }> = [];
    const star = {
      started: true,
      stopping: false,
      nodeID: 'metrics-production-metrics',
      services: [{ fullName: 'metrics', _serviceSpecification: serviceSpecification }],
      localBus,
      registry: {
        nodes: { localNode },
        services: { list: jest.fn(() => registryServices) },
        discoverer: { sendLocalNodeInfo: jest.fn(async () => undefined), discoverAllNodes: jest.fn(async () => undefined) },
      },
      registerLocalService: jest.fn((specification) => registryServices.push({ fullName: specification.fullName })),
      call: jest.fn(async () => undefined),
      stop: jest.fn(async () => undefined),
      logger: { warn: jest.fn() },
    } as unknown as Starlight;
    const bridge = installDarwinKafkaRecoveryLifecycle(star);

    localBus.emit('$node.disconnected', { node: { id: 'metrics-production-metrics' }, unexpected: true });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(localNode.available).toBe(true);
    expect((star as unknown as { registerLocalService: jest.Mock }).registerLocalService).toHaveBeenCalledWith(serviceSpecification);
    expect(registryServices).toEqual([{ fullName: 'metrics' }]);
    expect((star as unknown as { registry: { discoverer: { sendLocalNodeInfo: jest.Mock; discoverAllNodes: jest.Mock } } }).registry.discoverer.sendLocalNodeInfo).toHaveBeenCalledTimes(1);
    expect((star as unknown as { registry: { discoverer: { sendLocalNodeInfo: jest.Mock; discoverAllNodes: jest.Mock } } }).registry.discoverer.discoverAllNodes).toHaveBeenCalledTimes(1);

    bridge.stop();
  });
});
