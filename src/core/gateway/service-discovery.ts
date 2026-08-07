import { Starlight } from 'typings';

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

export const waitForRegisteredService = async (star: Starlight, service: string) => {
  const hasService = () =>
    star.registry?.services?.list?.().some((item: { name: string }) => item.name === service);

  if (hasService()) return true;
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

  return hasService();
};
