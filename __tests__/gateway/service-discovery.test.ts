import { Starlight } from '../../src/typings';
import { waitForRegisteredService } from '../../src/core/gateway/service-discovery';

const createStar = (registered: boolean) => {
  let isRegistered = registered;
  const waitForServices = jest.fn(async () => {
    isRegistered = true;
  });
  const star = {
    logger: { warn: jest.fn() },
    registry: {
      services: {
        list: () => (isRegistered ? [{ name: 'metrics-alerts' }] : []),
      },
    },
    waitForServices,
  };

  return { star: star as unknown as Starlight, waitForServices };
};

describe('gateway service discovery', () => {
  it('fails fast when the target service is not in the registry by default', async () => {
    const { star, waitForServices } = createStar(false);

    await expect(waitForRegisteredService(star, 'metrics-alerts')).resolves.toBe(false);
    expect(waitForServices).not.toHaveBeenCalled();
  });

  it('does not wait when the target service is already registered', async () => {
    const { star, waitForServices } = createStar(true);

    await expect(waitForRegisteredService(star, 'metrics-alerts')).resolves.toBe(true);
    expect(waitForServices).not.toHaveBeenCalled();
  });

  it('refreshes a recently seen missing target through the watchdog directory', async () => {
    const { star, waitForServices } = createStar(false);
    const transientDirectory = {
      isTransientlyMissing: jest.fn(() => true),
      refreshTransientService: jest.fn(async () => {
        await star.waitForServices('metrics-alerts', 0, 0);
        return true;
      }),
    };

    await expect(waitForRegisteredService(star, 'metrics-alerts', { transientDirectory })).resolves.toBe(true);
    expect(transientDirectory.refreshTransientService).toHaveBeenCalledWith('metrics-alerts');
    expect(waitForServices).toHaveBeenCalledTimes(1);
  });

  it('does not refresh a target that has never appeared in the Gateway directory', async () => {
    const { star, waitForServices } = createStar(false);
    const transientDirectory = {
      isTransientlyMissing: jest.fn(() => false),
      refreshTransientService: jest.fn(async () => true),
    };

    await expect(waitForRegisteredService(star, 'metrics-alerts', { transientDirectory })).resolves.toBe(false);
    expect(transientDirectory.refreshTransientService).not.toHaveBeenCalled();
    expect(waitForServices).not.toHaveBeenCalled();
  });
});
