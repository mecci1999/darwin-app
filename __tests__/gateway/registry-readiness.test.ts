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
    const watchdog = new GatewayRegistryWatchdog(star, { requiredServices, reconciliationCooldownMs: 60_000 });

    await watchdog.tick();
    expect(discoverAllNodes).not.toHaveBeenCalled();
    await watchdog.tick();
    expect(discoverAllNodes).toHaveBeenCalledTimes(1);
  });

  it('does not issue repeated reconciliation requests during cooldown', async () => {
    const { star, discoverAllNodes } = createStar(['gateway']);
    const watchdog = new GatewayRegistryWatchdog(star, { requiredServices, reconciliationCooldownMs: 60_000 });

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
    const watchdog = new GatewayRegistryWatchdog(star, { requiredServices, confirmationThreshold: 1 });

    const first = watchdog.tick();
    const second = watchdog.tick();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(discoverAllNodes).toHaveBeenCalledTimes(1);
    resolveDiscovery?.();
    await Promise.all([first, second]);
    expect(discoverAllNodes).toHaveBeenCalledTimes(1);
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

  it('emits one diagnostic transition and a bounded reconciliation lifecycle', async () => {
    const { star } = createStar(['gateway']);
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
    expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ kind: 'readiness_transition', outcome: 'degraded' }));
  });
});
