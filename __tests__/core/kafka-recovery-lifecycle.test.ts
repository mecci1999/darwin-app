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

  it('periodically reannounces an otherwise healthy local service catalog without a discovery flood', async () => {
    jest.useFakeTimers();
    const localBus = new EventEmitter();
    const sendLocalNodeInfo = jest.fn(async () => undefined);
    const discoverAllNodes = jest.fn(async () => undefined);
    const star = {
      started: true,
      stopping: false,
      nodeID: 'metrics-production-metrics',
      services: [{ fullName: 'metrics', _serviceSpecification: { name: 'metrics', fullName: 'metrics' } }],
      localBus,
      registry: {
        nodes: { localNode: { id: 'metrics-production-metrics', available: true } },
        services: { list: jest.fn(() => [{ fullName: 'metrics' }]) },
        discoverer: { sendLocalNodeInfo, discoverAllNodes },
      },
      call: jest.fn(async () => undefined),
      stop: jest.fn(async () => undefined),
      logger: { warn: jest.fn() },
    } as unknown as Starlight;
    const bridge = installDarwinKafkaRecoveryLifecycle(star);

    jest.advanceTimersByTime(30_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(sendLocalNodeInfo).toHaveBeenCalledTimes(1);
    expect(discoverAllNodes).not.toHaveBeenCalled();
    bridge.stop();
    jest.useRealTimers();
  });

  it('terminates a recovered process when Kafka cannot complete a self PING/PONG round trip', async () => {
    const localBus = new EventEmitter();
    const exitProcess = jest.fn();
    const star = {
      started: true,
      stopping: false,
      nodeID: 'metrics-production-metrics',
      localBus,
      call: jest.fn(async () => undefined),
      stop: jest.fn(async () => undefined),
      logger: { warn: jest.fn(), info: jest.fn() },
    } as unknown as Starlight;
    const bridge = installDarwinKafkaRecoveryLifecycle(star, {
      livenessEnabled: true,
      recoveryProbeDelayMs: 0,
      recoveryProbeAttempts: 1,
      watchdogInitialDelayMs: 60_000,
      transportProbe: jest.fn(async () => { throw new Error('request timed out'); }),
      exitProcess,
    });

    localBus.emit('$transporter.consumer.recovery.succeeded', lifecyclePayload);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    expect(exitProcess).toHaveBeenCalledWith(1);
    bridge.stop();
  });

  it('keeps a recovered process running after an internal health RPC completes through Kafka', async () => {
    const localBus = new EventEmitter();
    const exitProcess = jest.fn();
    const endpoint = { id: 'metrics-production-metrics' };
    const context: { nodeID?: string } = {};
    const request = jest.fn(async () => ({ status: 'healthy' }));
    const star = {
      started: true,
      stopping: false,
      nodeID: 'metrics-production-metrics',
      localBus,
      registry: { getActionEndpointByNodeId: jest.fn(() => endpoint) },
      ContextFactory: { create: jest.fn(() => context) },
      transit: { request },
      call: jest.fn(async () => undefined),
      stop: jest.fn(async () => undefined),
      logger: { warn: jest.fn(), info: jest.fn() },
    } as unknown as Starlight;
    const bridge = installDarwinKafkaRecoveryLifecycle(star, {
      livenessEnabled: true,
      recoveryProbeDelayMs: 0,
      recoveryProbeAttempts: 1,
      watchdogInitialDelayMs: 60_000,
      exitProcess,
    });

    localBus.emit('$transporter.consumer.recovery.succeeded', lifecyclePayload);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    expect(exitProcess).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith(context);
    expect(context.nodeID).toBe('metrics-production-metrics');
    expect((star as unknown as { logger: { info: jest.Mock } }).logger.info).toHaveBeenCalledWith(
      'kafka.transport-liveness-verified',
      expect.objectContaining({ reason: 'consumer_recovered' }),
    );
    bridge.stop();
  });
});
