import { Starlight } from '../../src/typings';
import { GatewayRegistryWatchdog } from '../../src/core/gateway/registry-readiness';

const createStar = (services: string[]) => {
  const discoverAllNodes = jest.fn(async () => undefined);
  const list = jest.fn(() => services.map((name) => ({ name })));
  const star = {
    transit: { connected: true },
    logger: { warn: jest.fn() },
    registry: {
      services: { list },
      discoverer: { discoverAllNodes },
    },
  };
  return { star: star as unknown as Starlight, discoverAllNodes, list };
};

describe('gateway registry readiness', () => {
  const requiredServices = ['gateway', 'metrics'];

  it('reports ready only when transport and all required services are present', async () => {
    const { star } = createStar(['gateway', 'metrics']);
    const watchdog = new GatewayRegistryWatchdog(star, { requiredServices });

    await expect(watchdog.inspect()).resolves.toMatchObject({ ready: true, status: 'healthy', missingServices: [] });
  });

  it('requires two missing observations before requesting discovery reconciliation', async () => {
    const { star, discoverAllNodes } = createStar(['gateway']);
    const watchdog = new GatewayRegistryWatchdog(star, { requiredServices, reconciliationCooldownMs: 60_000, registryStalenessMs: 0 });

    await watchdog.tick();
    expect(discoverAllNodes).not.toHaveBeenCalled();
    await watchdog.tick();
    expect(discoverAllNodes).toHaveBeenCalledTimes(1);
  });

  it('does not issue repeated reconciliation requests during cooldown', async () => {
    const { star, discoverAllNodes } = createStar(['gateway']);
    const watchdog = new GatewayRegistryWatchdog(star, { requiredServices, reconciliationCooldownMs: 60_000, registryStalenessMs: 0 });

    await watchdog.tick();
    await watchdog.tick();
    await watchdog.tick();
    expect(discoverAllNodes).toHaveBeenCalledTimes(1);
  });

  it('treats unavailable registry service records as missing', async () => {
    const { star } = createStar(['gateway', 'metrics']);
    const list = jest.fn((options?: { onlyAvaliable?: boolean }) =>
      options?.onlyAvaliable ? [{ name: 'gateway' }] : [{ name: 'gateway' }, { name: 'metrics' }],
    );
    (star.registry?.services as unknown as { list: typeof list }).list = list;
    const watchdog = new GatewayRegistryWatchdog(star, { requiredServices, criticalServices: requiredServices });

    await expect(watchdog.inspect()).resolves.toMatchObject({ ready: false, missingServices: ['metrics'] });
    expect(list).toHaveBeenCalledWith({ onlyAvaliable: true });
  });

  it('keeps the previous healthy state during one unconfirmed critical-service observation', async () => {
    const { star, list } = createStar(['gateway', 'metrics']);
    const watchdog = new GatewayRegistryWatchdog(star, {
      requiredServices,
      criticalServices: requiredServices,
      reconciliationCooldownMs: 60_000,
      registryStalenessMs: 0,
    });

    await expect(watchdog.tick()).resolves.toMatchObject({ ready: true, status: 'healthy' });
    list.mockReturnValue([{ name: 'gateway' }]);

    await expect(watchdog.tick()).resolves.toMatchObject({
      ready: true,
      status: 'healthy',
      missingCriticalServices: ['metrics'],
      consecutiveMissingObservations: 1,
    });
  });

  it('does not degrade readiness when a previously seen critical service is briefly absent from Kafka discovery', async () => {
    const { star, list } = createStar(['gateway', 'metrics']);
    let now = 0;
    const watchdog = new GatewayRegistryWatchdog(star, {
      requiredServices,
      criticalServices: requiredServices,
      registryStalenessMs: 45_000,
      now: () => now,
    });

    await expect(watchdog.tick()).resolves.toMatchObject({ ready: true, missingCriticalServices: [] });
    list.mockReturnValue([{ name: 'gateway' }]);
    now = 30_000;

    await expect(watchdog.tick()).resolves.toMatchObject({
      ready: true,
      missingServices: ['metrics'],
      missingCriticalServices: [],
    });
    now = 45_000;

    await expect(watchdog.inspect()).resolves.toMatchObject({ missingCriticalServices: ['metrics'] });
  });

  it('reconciles a recently seen missing target before a request is rejected', async () => {
    const services = ['gateway', 'metrics'];
    const { star, discoverAllNodes, list } = createStar(services);
    let now = 0;
    discoverAllNodes.mockImplementation(async () => {
      services.push('metrics');
    });
    const watchdog = new GatewayRegistryWatchdog(star, {
      requiredServices,
      criticalServices: requiredServices,
      registryStalenessMs: 45_000,
      transientServiceRefreshTimeoutMs: 200,
      transientServiceRefreshIntervalMs: 50,
      now: () => now,
      wait: async () => {
        now += 50;
      },
    });

    await watchdog.inspect();
    services.splice(services.indexOf('metrics'), 1);
    list.mockImplementation(() => services.map((name) => ({ name })));
    now = 1;

    expect(watchdog.isTransientlyMissing('metrics')).toBe(true);
    await expect(watchdog.refreshTransientService('metrics')).resolves.toBe(true);
    expect(discoverAllNodes).toHaveBeenCalledTimes(1);
  });

  it('does not discover a target that has never appeared in the Gateway directory', async () => {
    const { star, discoverAllNodes } = createStar(['gateway']);
    const watchdog = new GatewayRegistryWatchdog(star, {
      requiredServices,
      criticalServices: requiredServices,
      registryStalenessMs: 45_000,
    });

    expect(watchdog.isTransientlyMissing('metrics')).toBe(false);
    await expect(watchdog.refreshTransientService('metrics')).resolves.toBe(false);
    expect(discoverAllNodes).not.toHaveBeenCalled();
  });

  it('keeps a recently seen target unavailable when discovery does not repopulate the registry', async () => {
    const services = ['gateway', 'metrics'];
    const { star, discoverAllNodes } = createStar(services);
    let now = 0;
    const watchdog = new GatewayRegistryWatchdog(star, {
      requiredServices,
      criticalServices: requiredServices,
      registryStalenessMs: 45_000,
      transientServiceRefreshTimeoutMs: 200,
      transientServiceRefreshIntervalMs: 50,
      now: () => now,
      wait: async () => {
        now += 50;
      },
    });

    await watchdog.inspect();
    services.splice(services.indexOf('metrics'), 1);
    now = 1;

    await expect(watchdog.refreshTransientService('metrics')).resolves.toBe(false);
    expect(discoverAllNodes).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent transient target refreshes into one discovery broadcast', async () => {
    const services = ['gateway', 'metrics'];
    const { star, discoverAllNodes } = createStar(services);
    let resolveDiscovery: (() => void) | undefined;
    discoverAllNodes.mockImplementation(
      () => new Promise<undefined>((resolve) => {
        resolveDiscovery = () => {
          services.push('metrics');
          resolve(undefined);
        };
      }),
    );
    const watchdog = new GatewayRegistryWatchdog(star, {
      requiredServices,
      criticalServices: requiredServices,
      registryStalenessMs: 45_000,
      transientServiceRefreshTimeoutMs: 200,
      transientServiceRefreshIntervalMs: 50,
      wait: async () => undefined,
    });

    await watchdog.inspect();
    services.splice(services.indexOf('metrics'), 1);

    const first = watchdog.refreshTransientService('metrics');
    const second = watchdog.refreshTransientService('metrics');
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(discoverAllNodes).toHaveBeenCalledTimes(1);

    resolveDiscovery?.();
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(discoverAllNodes).toHaveBeenCalledTimes(1);
  });

  it('shares one discovery broadcast when different services disappear from the local directory together', async () => {
    const services = ['gateway', 'metrics', 'metrics-query'];
    const { star, discoverAllNodes } = createStar(services);
    let resolveDiscovery: (() => void) | undefined;
    discoverAllNodes.mockImplementation(
      () => new Promise<undefined>((resolve) => {
        resolveDiscovery = () => {
          services.push('metrics', 'metrics-query');
          resolve(undefined);
        };
      }),
    );
    const watchdog = new GatewayRegistryWatchdog(star, {
      requiredServices: ['gateway', 'metrics', 'metrics-query'],
      criticalServices: ['gateway', 'metrics', 'metrics-query'],
      registryStalenessMs: 45_000,
      transientServiceRefreshTimeoutMs: 200,
      transientServiceRefreshIntervalMs: 50,
      wait: async () => undefined,
    });

    await watchdog.inspect();
    services.splice(services.indexOf('metrics'), 1);
    services.splice(services.indexOf('metrics-query'), 1);

    const metricsRefresh = watchdog.refreshTransientService('metrics');
    const queryRefresh = watchdog.refreshTransientService('metrics-query');
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(discoverAllNodes).toHaveBeenCalledTimes(1);

    resolveDiscovery?.();
    await expect(Promise.all([metricsRefresh, queryRefresh])).resolves.toEqual([true, true]);
    expect(discoverAllNodes).toHaveBeenCalledTimes(1);
  });

  it('does not make optional service loss a gateway readiness failure', async () => {
    const watchdog = new GatewayRegistryWatchdog(createStar(['gateway']).star, {
      requiredServices: ['gateway', 'video'],
      criticalServices: ['gateway'],
    });

    await expect(watchdog.tick()).resolves.toMatchObject({
      ready: true,
      status: 'healthy',
      missingServices: ['video'],
      missingCriticalServices: [],
    });
  });

  it('coalesces concurrent missing-service checks into one reconciliation request', async () => {
    const { star, discoverAllNodes } = createStar(['gateway']);
    let resolveDiscovery: (() => void) | undefined;
    discoverAllNodes.mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          resolveDiscovery = () => resolve(undefined);
        }),
    );
    const watchdog = new GatewayRegistryWatchdog(star, { requiredServices, confirmationThreshold: 1, registryStalenessMs: 0 });

    const first = watchdog.tick();
    const second = watchdog.tick();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(discoverAllNodes).toHaveBeenCalledTimes(1);
    resolveDiscovery?.();
    await Promise.all([first, second]);
    expect(discoverAllNodes).toHaveBeenCalledTimes(1);
  });

  it('restarts a connected gateway only after the same non-critical registry gap survives repeated successful discovery', async () => {
    const services = ['gateway', 'metrics'];
    const { star } = createStar(services);
    const exitProcess = jest.fn();
    let now = 0;
    const watchdog = new GatewayRegistryWatchdog(star, {
      requiredServices,
      criticalServices: ['gateway'],
      confirmationThreshold: 1,
      reconciliationCooldownMs: 1,
      registryStalenessMs: 0,
      registryRecoveryExitThreshold: 2,
      transientServiceRefreshTimeoutMs: 200,
      transientServiceRefreshIntervalMs: 50,
      now: () => now,
      wait: async (duration) => { now += duration; },
      exitProcess,
    });

    await watchdog.tick();
    services.splice(services.indexOf('metrics'), 1);
    now += 1;
    await watchdog.tick();
    expect(exitProcess).not.toHaveBeenCalled();
    now += 1;
    await watchdog.tick();

    expect(exitProcess).toHaveBeenCalledWith(1);
    expect(watchdog.getReadiness()).toMatchObject({ persistentMissingReconciliations: 2, missingServices: ['metrics'] });
  });

  it('never restarts gateway for a persistent critical-service outage', async () => {
    const services = ['gateway', 'metrics'];
    const { star } = createStar(services);
    const exitProcess = jest.fn();
    let now = 0;
    const watchdog = new GatewayRegistryWatchdog(star, {
      requiredServices,
      criticalServices: requiredServices,
      confirmationThreshold: 1,
      reconciliationCooldownMs: 1,
      registryStalenessMs: 0,
      registryRecoveryExitThreshold: 1,
      transientServiceRefreshTimeoutMs: 200,
      transientServiceRefreshIntervalMs: 50,
      now: () => now,
      wait: async (duration) => { now += duration; },
      exitProcess,
    });

    await watchdog.tick();
    services.splice(services.indexOf('metrics'), 1);
    now += 1;
    await watchdog.tick();
    now += 1;
    await watchdog.tick();

    expect(exitProcess).not.toHaveBeenCalled();
    expect(watchdog.getReadiness()).toMatchObject({ persistentMissingReconciliations: 0, missingCriticalServices: ['metrics'] });
  });

  it('never restarts during incomplete startup even when several independently observed critical services are absent', async () => {
    const services = ['gateway', 'auth'];
    const { star } = createStar(services);
    const exitProcess = jest.fn();
    let now = 0;
    const required = ['gateway', 'auth', 'metrics', 'logs'];
    const watchdog = new GatewayRegistryWatchdog(star, {
      requiredServices: required,
      criticalServices: required,
      confirmationThreshold: 1,
      reconciliationCooldownMs: 1,
      registryStalenessMs: 1_000,
      registryRecoveryExitThreshold: 1,
      registryDirectoryDriftMissingServiceThreshold: 3,
      transientServiceRefreshTimeoutMs: 200,
      transientServiceRefreshIntervalMs: 50,
      now: () => now,
      wait: async (duration) => { now += duration; },
      exitProcess,
    });

    await watchdog.tick();
    services.splice(services.indexOf('auth'), 1, 'metrics');
    now += 1;
    await watchdog.tick();
    services.splice(services.indexOf('metrics'), 1, 'logs');
    now += 1;
    await watchdog.tick();
    services.splice(services.indexOf('logs'), 1);
    now += 1;
    await watchdog.tick();

    expect(exitProcess).not.toHaveBeenCalled();
    expect(watchdog.getReadiness()).toMatchObject({
      missingServices: ['auth', 'metrics', 'logs'],
      persistentMissingReconciliations: 0,
    });
  });

  it('restarts only Gateway when several recently seen critical services disappear from its local directory together', async () => {
    const services = ['gateway', 'auth', 'metrics', 'logs'];
    const { star } = createStar(services);
    const exitProcess = jest.fn();
    let now = 0;
    const watchdog = new GatewayRegistryWatchdog(star, {
      requiredServices: [...services],
      criticalServices: [...services],
      confirmationThreshold: 1,
      reconciliationCooldownMs: 1,
      registryStalenessMs: 1_000,
      registryRecoveryExitThreshold: 2,
      registryDirectoryDriftMissingServiceThreshold: 3,
      transientServiceRefreshTimeoutMs: 200,
      transientServiceRefreshIntervalMs: 50,
      now: () => now,
      wait: async (duration) => { now += duration; },
      exitProcess,
    });

    await watchdog.tick();
    services.splice(services.indexOf('auth'), 1);
    services.splice(services.indexOf('metrics'), 1);
    services.splice(services.indexOf('logs'), 1);
    now = 1;
    await watchdog.tick();
    expect(exitProcess).not.toHaveBeenCalled();

    now += 1;
    await watchdog.tick();
    expect(exitProcess).toHaveBeenCalledWith(1);
    expect(watchdog.getReadiness()).toMatchObject({
      missingServices: ['auth', 'metrics', 'logs'],
      persistentMissingReconciliations: 2,
    });
  });

  it('clears persistent-registry recovery state as soon as discovery sees the missing service again', async () => {
    const services = ['gateway', 'metrics'];
    const { star, list } = createStar(services);
    const exitProcess = jest.fn();
    let now = 0;
    const watchdog = new GatewayRegistryWatchdog(star, {
      requiredServices,
      criticalServices: ['gateway'],
      confirmationThreshold: 1,
      reconciliationCooldownMs: 1,
      registryStalenessMs: 0,
      registryRecoveryExitThreshold: 2,
      transientServiceRefreshTimeoutMs: 200,
      transientServiceRefreshIntervalMs: 50,
      now: () => now,
      wait: async (duration) => { now += duration; },
      exitProcess,
    });

    await watchdog.tick();
    list.mockReturnValue([{ name: 'gateway' }]);
    now += 1;
    await watchdog.tick();
    expect(watchdog.getReadiness()).toMatchObject({ persistentMissingReconciliations: 1 });
    list.mockReturnValue([{ name: 'gateway' }, { name: 'metrics' }]);
    now += 1;
    await watchdog.tick();

    expect(exitProcess).not.toHaveBeenCalled();
    expect(watchdog.getReadiness()).toMatchObject({ persistentMissingReconciliations: 0, missingServices: [] });
  });

  it('does not treat a registry read failure as a successfully reconciled registry', async () => {
    const { star, discoverAllNodes, list } = createStar(['gateway', 'metrics']);
    list.mockImplementation(() => {
      throw new Error('registry unavailable');
    });
    const watchdog = new GatewayRegistryWatchdog(star, { requiredServices });

    await expect(watchdog.tick()).resolves.toMatchObject({ ready: false, registryReadable: false });
    expect(discoverAllNodes).not.toHaveBeenCalled();
  });

  it('retains a directory reconciliation failure until every affected service is visible again', async () => {
    const services = ['gateway', 'metrics'];
    const { star } = createStar(services);
    let now = 0;
    const watchdog = new GatewayRegistryWatchdog(star, {
      requiredServices,
      criticalServices: requiredServices,
      confirmationThreshold: 1,
      reconciliationCooldownMs: 1,
      registryStalenessMs: 0,
      transientServiceRefreshTimeoutMs: 200,
      transientServiceRefreshIntervalMs: 50,
      now: () => now,
      wait: async (duration) => { now += duration; },
    });

    await watchdog.tick();
    services.splice(services.indexOf('metrics'), 1);
    now += 1;
    await expect(watchdog.tick()).resolves.toMatchObject({
      lastError: 'Gateway registry reconciliation did not repopulate the local directory',
      missingServices: ['metrics'],
    });

    services.push('metrics');
    now += 1;
    await expect(watchdog.tick()).resolves.toMatchObject({ lastError: null, missingServices: [] });
  });

  it('releases a stalled reconciliation and retries after the cooldown', async () => {
    const services = ['gateway', 'metrics'];
    const { star, discoverAllNodes } = createStar(services);
    let now = 0;
    discoverAllNodes
      .mockImplementationOnce(() => new Promise<undefined>(() => undefined))
      .mockResolvedValueOnce(undefined);
    const watchdog = new GatewayRegistryWatchdog(star, {
      requiredServices,
      criticalServices: requiredServices,
      confirmationThreshold: 1,
      reconciliationCooldownMs: 1,
      registryStalenessMs: 0,
      transientServiceRefreshTimeoutMs: 20,
      transientServiceRefreshIntervalMs: 10,
      now: () => now,
      wait: async (duration) => { now += duration; },
    });

    await watchdog.tick();
    services.splice(services.indexOf('metrics'), 1);
    now += 1;
    await expect(watchdog.tick()).resolves.toMatchObject({
      lastError: 'Gateway registry reconciliation broadcast timed out',
    });
    now += 1;
    await watchdog.tick();

    expect(discoverAllNodes).toHaveBeenCalledTimes(2);
  });

  it('emits one diagnostic transition and a bounded reconciliation lifecycle', async () => {
    const services = ['gateway'];
    const { star, discoverAllNodes } = createStar(services);
    discoverAllNodes.mockImplementation(async () => {
      services.push('metrics');
    });
    const onDiagnostic = jest.fn();
    const watchdog = new GatewayRegistryWatchdog(star, {
      requiredServices,
      criticalServices: requiredServices,
      confirmationThreshold: 1,
      onDiagnostic,
    });

    await watchdog.tick();

    expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ kind: 'reconciliation_requested' }));
    expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ kind: 'reconciliation_succeeded' }));
    expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ kind: 'readiness_transition', outcome: 'healthy' }));
  });
});
