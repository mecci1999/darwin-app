import { Starlight } from 'typings';

export type GatewayTransientServiceDirectory = {
  isTransientlyMissing(service: string): boolean;
  refreshTransientService(service: string): Promise<boolean>;
};

export type RegisteredServiceWaitOptions = {
  // The Gateway watchdog owns the recent-directory view. Supplying it lets request
  // dispatch repair a short-lived local registry gap without treating a never-seen
  // target as healthy.
  transientDirectory?: GatewayTransientServiceDirectory | null;
};

const parseNonNegativeTimeout = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const parsePositiveTimeout = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const serviceWaitTimeoutMs = parseNonNegativeTimeout(
  process.env.GATEWAY_SERVICE_WAIT_TIMEOUT_MS,
  0,
);
const serviceWaitIntervalMs = parsePositiveTimeout(
  process.env.GATEWAY_SERVICE_WAIT_INTERVAL_MS,
  500,
);

type RegistryServices = {
  list?: (options?: { onlyAvaliable?: boolean }) => unknown | Promise<unknown>;
};

const hasRegisteredService = async (star: Starlight, service: string): Promise<boolean> => {
  try {
    const services = await Promise.resolve(
      (star.registry?.services as RegistryServices | undefined)?.list?.({ onlyAvaliable: true }),
    );
    return Array.isArray(services) && services.some((item: { name?: unknown }) => item?.name === service);
  } catch (error) {
    star.logger?.warn('Gateway target service registry lookup failed', {
      service,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
};

export const waitForRegisteredService = async (
  star: Starlight,
  service: string,
  options: RegisteredServiceWaitOptions = {},
) => {
  if (await hasRegisteredService(star, service)) return true;

  const transientDirectory = options.transientDirectory;
  if (transientDirectory) {
    if (!transientDirectory.isTransientlyMissing(service)) return false;

    try {
      const recovered = await transientDirectory.refreshTransientService(service);
      return recovered && await hasRegisteredService(star, service);
    } catch (error) {
      star.logger?.warn('Gateway target service directory refresh failed', {
        service,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  if (serviceWaitTimeoutMs === 0) return false;

  try {
    await star.waitForServices(service, serviceWaitTimeoutMs, serviceWaitIntervalMs);
  } catch (error) {
    star.logger?.warn('Gateway target service wait timed out', {
      service,
      timeoutMs: serviceWaitTimeoutMs,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return hasRegisteredService(star, service);
};
