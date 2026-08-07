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
});
