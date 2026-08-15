import { Starlight } from 'typings';

export const DEFAULT_GATEWAY_REQUIRED_SERVICES = [
  'auth',
  'file',
  'gateway',
  'logs',
  'metrics',
  'metrics-alerts',
  'metrics-compat',
  'metrics-lifecycle',
  'metrics-query',
  'micro-app',
  'subscription',
  'subscription-billing',
  'trails-durable-content',
  'trails-durable-media',
  'trails-durable-workspace',
  'trails-durable-trips',
  'trails-durable-site',
  'trails-durable-site-public',
  'user',
  'video',
] as const;

type RegistryService = { name?: unknown };
type RegistryListOptions = { onlyAvaliable?: boolean };
type RegistryServices = { list?: (options?: RegistryListOptions) => unknown | Promise<unknown> };
type RegistryDiscoverer = { discoverAllNodes?: () => Promise<unknown> | unknown };

export type GatewayRegistryReadiness = {
  checkedAt: number;
  registryReadable: boolean;
  registeredServiceCount: number;
  missingServices: string[];
  transportConnected: boolean;
  ready: boolean;
  status: 'healthy' | 'degraded' | 'reconciling';
  consecutiveMissingObservations: number;
  reconciliationAttempts: number;
  lastReconciliationAt: number | null;
  lastError: string | null;
};

export type GatewayRegistryDiagnosticEvent = {
  kind:
    | 'readiness_transition'
    | 'reconciliation_requested'
    | 'reconciliation_succeeded'
    | 'reconciliation_failed'
    | 'node_reconnected'
    | 'node_disconnected'
    | 'transporter_connected'
    | 'transporter_disconnected'
    | 'transporter_error'
    | 'transit_error';
  occurredAt: number;
  outcome?: 'success' | 'failure' | 'healthy' | 'degraded';
  reason?: string;
  service?: string;
  missingServiceCount?: number;
  registeredServiceCount?: number;
  transportConnected?: boolean;
  durationMs?: number;
  unexpected?: boolean;
};

export type GatewayRegistryWatchdogOptions = {
  requiredServices?: readonly string[];
  confirmationThreshold?: number;
  reconciliationCooldownMs?: number;
  now?: () => number;
  onDiagnostic?: (event: GatewayRegistryDiagnosticEvent) => void;
};

const DEFAULT_CONFIRMATION_THRESHOLD = 2;
const DEFAULT_RECONCILIATION_COOLDOWN_MS = 30_000;

export const requiredGatewayServicesFromEnvironment = (
  value = process.env.GATEWAY_REQUIRED_SERVICES,
): readonly string[] => {
  if (!value?.trim()) return DEFAULT_GATEWAY_REQUIRED_SERVICES;
  const services = Array.from(new Set(value.split(',').map((service) => service.trim()).filter(Boolean))).sort();
  if (services.length === 0) throw new Error('GATEWAY_REQUIRED_SERVICES must contain at least one service name');
  return services;
};

const normalizeServiceNames = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;
  return Array.from(
    new Set(
      value
        .map((item) => (typeof item === 'string' ? item : String((item as RegistryService)?.name || '')))
        .filter(Boolean),
    ),
  ).sort();
};

const toErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class GatewayRegistryWatchdog {
  private consecutiveMissingObservations = 0;
  private reconciliationAttempts = 0;
  private reconciliationInFlight: Promise<void> | null = null;
  private tickInFlight: Promise<GatewayRegistryReadiness> | null = null;
  private lastReconciliationAt: number | null = null;
  private lastError: string | null = null;
  private latestReadiness: GatewayRegistryReadiness;

  private readonly requiredServices: readonly string[];
  private readonly confirmationThreshold: number;
  private readonly reconciliationCooldownMs: number;
  private readonly now: () => number;
  private readonly onDiagnostic?: (event: GatewayRegistryDiagnosticEvent) => void;

  constructor(private readonly star: Starlight, options: GatewayRegistryWatchdogOptions = {}) {
    this.requiredServices = options.requiredServices || requiredGatewayServicesFromEnvironment();
    this.confirmationThreshold = options.confirmationThreshold ?? DEFAULT_CONFIRMATION_THRESHOLD;
    this.reconciliationCooldownMs = options.reconciliationCooldownMs ?? DEFAULT_RECONCILIATION_COOLDOWN_MS;
    this.now = options.now || Date.now;
    this.onDiagnostic = options.onDiagnostic;
    if (!Number.isInteger(this.confirmationThreshold) || this.confirmationThreshold < 1) {
      throw new Error('confirmationThreshold must be a positive integer');
    }
    if (!Number.isInteger(this.reconciliationCooldownMs) || this.reconciliationCooldownMs < 1) {
      throw new Error('reconciliationCooldownMs must be a positive integer');
    }
    this.latestReadiness = this.snapshot(this.now(), false, 0, [...this.requiredServices], false);
  }

  getReadiness(): GatewayRegistryReadiness {
    return this.latestReadiness;
  }

  async inspect(): Promise<GatewayRegistryReadiness> {
    const checkedAt = this.now();
    const transportConnected = this.star.transit?.connected === true;

    try {
      const services = normalizeServiceNames(
        await Promise.resolve(
          (this.star.registry?.services as RegistryServices | undefined)?.list?.({ onlyAvaliable: true }),
        ),
      );
      if (!services) {
        this.lastError = 'Gateway registry returned an invalid service list';
        return this.snapshot(checkedAt, false, 0, this.requiredServices.slice(), transportConnected);
      }

      const registered = new Set(services);
      const missingServices = this.requiredServices.filter((service) => !registered.has(service));
      this.lastError = null;
      return this.snapshot(checkedAt, true, services.length, missingServices, transportConnected);
    } catch (error) {
      this.lastError = toErrorMessage(error);
      return this.snapshot(checkedAt, false, 0, this.requiredServices.slice(), transportConnected);
    }
  }

  async tick(): Promise<GatewayRegistryReadiness> {
    if (this.tickInFlight) return this.tickInFlight;
    this.tickInFlight = this.tickOnce().finally(() => {
      this.tickInFlight = null;
    });
    return this.tickInFlight;
  }

  private async tickOnce(): Promise<GatewayRegistryReadiness> {
    const readiness = await this.inspect();
    if (!readiness.registryReadable || readiness.missingServices.length === 0) {
      this.consecutiveMissingObservations = 0;
      return this.store(readiness);
    }

    this.consecutiveMissingObservations += 1;
    if (this.consecutiveMissingObservations < this.confirmationThreshold) {
      return this.store(this.withCurrentState(readiness));
    }

    await this.reconcileIfEligible(readiness.missingServices);
    return this.store(await this.inspect());
  }

  private store(readiness: GatewayRegistryReadiness): GatewayRegistryReadiness {
    const previous = this.latestReadiness;
    this.latestReadiness = readiness;
    if (
      previous.ready !== readiness.ready ||
      previous.status !== readiness.status ||
      previous.transportConnected !== readiness.transportConnected ||
      previous.registryReadable !== readiness.registryReadable ||
      previous.missingServices.join(',') !== readiness.missingServices.join(',')
    ) {
      this.onDiagnostic?.({
        kind: 'readiness_transition',
        occurredAt: readiness.checkedAt,
        outcome: readiness.ready ? 'healthy' : 'degraded',
        reason: readiness.registryReadable ? 'registry_membership' : 'registry_unreadable',
        service: 'gateway',
        missingServiceCount: readiness.missingServices.length,
        registeredServiceCount: readiness.registeredServiceCount,
        transportConnected: readiness.transportConnected,
      });
    }
    return readiness;
  }

  private withCurrentState(readiness: GatewayRegistryReadiness): GatewayRegistryReadiness {
    return {
      ...readiness,
      consecutiveMissingObservations: this.consecutiveMissingObservations,
      reconciliationAttempts: this.reconciliationAttempts,
      lastReconciliationAt: this.lastReconciliationAt,
      lastError: this.lastError,
    };
  }

  private snapshot(
    checkedAt: number,
    registryReadable: boolean,
    registeredServiceCount: number,
    missingServices: string[],
    transportConnected: boolean,
  ): GatewayRegistryReadiness {
    const reconciling = this.reconciliationInFlight !== null;
    const ready = registryReadable && transportConnected && missingServices.length === 0 && !reconciling;
    return {
      checkedAt,
      registryReadable,
      registeredServiceCount,
      missingServices,
      transportConnected,
      ready,
      status: reconciling ? 'reconciling' : ready ? 'healthy' : 'degraded',
      consecutiveMissingObservations: this.consecutiveMissingObservations,
      reconciliationAttempts: this.reconciliationAttempts,
      lastReconciliationAt: this.lastReconciliationAt,
      lastError: this.lastError,
    };
  }

  private async reconcileIfEligible(missingServices: string[]): Promise<void> {
    if (this.reconciliationInFlight) return this.reconciliationInFlight;
    const now = this.now();
    if (this.lastReconciliationAt !== null && now - this.lastReconciliationAt < this.reconciliationCooldownMs) return;

    const discoverer = this.star.registry?.discoverer as RegistryDiscoverer | undefined;
    if (!discoverer?.discoverAllNodes) {
      this.lastError = 'Gateway registry discoverer is unavailable';
      return;
    }

    this.lastReconciliationAt = now;
    this.reconciliationAttempts += 1;
    const startedAt = this.now();
    this.onDiagnostic?.({
      kind: 'reconciliation_requested',
      occurredAt: startedAt,
      outcome: 'degraded',
      reason: 'required_service_missing',
      service: 'gateway',
      missingServiceCount: missingServices.length,
    });
    this.reconciliationInFlight = Promise.resolve(discoverer.discoverAllNodes())
      .then(() => {
        this.star.logger?.warn('Gateway registry reconciliation requested', {
          missingServices,
          attempt: this.reconciliationAttempts,
        });
        this.onDiagnostic?.({
          kind: 'reconciliation_succeeded',
          occurredAt: this.now(),
          outcome: 'success',
          reason: 'discover_broadcast',
          service: 'gateway',
          missingServiceCount: missingServices.length,
          durationMs: this.now() - startedAt,
        });
      })
      .catch((error) => {
        this.lastError = toErrorMessage(error);
        this.star.logger?.warn('Gateway registry reconciliation failed', {
          attempt: this.reconciliationAttempts,
          error: this.lastError,
        });
        this.onDiagnostic?.({
          kind: 'reconciliation_failed',
          occurredAt: this.now(),
          outcome: 'failure',
          reason: 'discover_broadcast',
          service: 'gateway',
          missingServiceCount: missingServices.length,
          durationMs: this.now() - startedAt,
        });
      })
      .finally(() => {
        this.reconciliationInFlight = null;
      });
    return this.reconciliationInFlight;
  }
}
