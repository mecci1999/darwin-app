import { EventEmitter } from 'events';
import { get } from 'http';
import { Starlight } from '../../src/typings';
import { createServiceReadiness } from '../../src/core/readiness/service-readiness';

const requestStatus = (port: number) =>
  new Promise<number>((resolve, reject) => {
    const request = get(`http://127.0.0.1:${port}/readyz`, (response) => {
      response.resume();
      resolve(response.statusCode || 0);
    });
    request.on('error', reject);
  });

describe('service readiness', () => {
  it('transitions from starting to ready and back to unavailable on transport loss', async () => {
    const localBus = new EventEmitter();
    const star = {
      transit: { connected: true },
      localBus,
      registry: { services: { list: jest.fn(() => [{ name: 'metrics' }]) } },
    } as unknown as Starlight;
    const port = 17699;
    const readiness = createServiceReadiness(star, { serviceName: 'metrics', port });

    await readiness.start();
    expect(await requestStatus(port)).toBe(503);
    expect(readiness.snapshot()).toMatchObject({ ready: false, reason: 'starting' });
    readiness.markStarted();
    expect(await requestStatus(port)).toBe(200);
    expect(readiness.snapshot()).toMatchObject({ ready: true, reason: 'ready' });
    localBus.emit('$transporter.error');
    expect(await requestStatus(port)).toBe(503);
    expect(readiness.snapshot()).toMatchObject({ ready: false, reason: 'transport-disconnected' });
    await readiness.stop();
  });

  it('requires local registration and becomes unavailable while stopping', () => {
    const star = {
      transit: { connected: true },
      localBus: new EventEmitter(),
      registry: { services: { list: jest.fn(() => []) } },
    } as unknown as Starlight;
    const readiness = createServiceReadiness(star, { serviceName: 'auth' });

    readiness.markStarted();
    expect(readiness.snapshot()).toMatchObject({ ready: false, reason: 'local-registration-missing' });
    readiness.markStopping();
    expect(readiness.snapshot()).toMatchObject({ ready: false, reason: 'stopping' });
  });

  it('does not accept a remote service registration as local readiness', () => {
    const list = jest.fn((options?: { onlyLocal?: boolean }) =>
      options?.onlyLocal ? [] : [{ name: 'auth' }],
    );
    const star = {
      transit: { connected: true },
      localBus: new EventEmitter(),
      registry: { services: { list } },
    } as unknown as Starlight;
    const readiness = createServiceReadiness(star, { serviceName: 'auth' });

    readiness.markStarted();
    expect(readiness.snapshot()).toMatchObject({ ready: false, reason: 'local-registration-missing' });
    expect(list).toHaveBeenCalledWith({ onlyLocal: true, onlyAvaliable: true });
  });
});
