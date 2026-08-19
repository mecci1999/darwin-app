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
  'trails-durable-sales',
  'user',
  'video',
] as const;

// These services are required to keep authenticated desktop and Trails workspace
// traffic available. Observability and optional product services retain their own
// targeted health checks instead of turning the entire gateway unavailable.
export const DEFAULT_GATEWAY_CRITICAL_SERVICES = [
  'auth',
  'file',
  'gateway',
  'micro-app',
  'trails-durable-content',
  'trails-durable-media',
  'trails-durable-workspace',
  'trails-durable-trips',
  'trails-durable-site',
  'trails-durable-site-public',
  'trails-durable-sales',
  'user',
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
  missingCriticalServices: string[];
  transportConnected: boolean;
  ready: boolean;
  status: 'healthy' | 'degraded' | 'reconciling';
  consecutiveMissingObservations: number;
  reconciliationAttempts: number;
  persistentMissingReconciliations: number;
  lastReconciliationAt: number | null;
  lastError: string | null;
};

export type GatewayRegistryDiagnosticEvent = {
  kind:
    | 'readiness_transition'
    | 'reconciliation_requested'
    | 'reconciliation_succeeded'
    | 'reconciliation_failed'
    | 'registry_self_heal_exit'
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
  criticalServices?: readonly string[];
  confirmationThreshold?: number;
  reconciliationCooldownMs?: number;
  registryStalenessMs?: number;
  registryRecoveryExitThreshold?: number;
  exitProcess?: (code: number) => void;
  now?: () => number;
  onDiagnostic?: (event: GatewayRegistryDiagnosticEvent) => void;
};

const DEFAULT_CONFIRMATION_THRESHOLD = 2;
const DEFAULT_RECONCILIATION_COOLDOWN_MS = 30_000;
const DEFAULT_REGISTRY_STALENESS_MS = 45_000;
const DEFAULT_REGISTRY_RECOVERY_EXIT_THRESHOLD = 4;

const serviceNamesFromEnvironment = (value: string | undefined, defaults: readonly string[]): readonly string[] => {
  if (!value?.trim()) return defaults;
  const services = Array.from(new Set(value.split(',').map((service) => service.trim()).filter(Boolean))).sort();
  if (services.length === 0) throw new Error('Gateway service configuration must contain at least one service name');
  return services;
};

export const requiredGatewayServicesFromEnvironment = (value = process.env.GATEWAY_REQUIRED_SERVICES): readonly string[] =>
  serviceNamesFromEnvironment(value, DEFAULT_GATEWAY_REQUIRED_SERVICES);

export const criticalGatewayServicesFromEnvironment = (value = process.env.GATEWAY_CRITICAL_SERVICES): readonly string[] =>
  serviceNamesFromEnvironment(value, DEFAULT_GATEWAY_CRITICAL_SERVICES);

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
  private reconciliationInFlight: Promise<boolean> | null = null;
  private tickInFlight: Promise<GatewayRegistryReadiness> | null = null;
  private lastReconciliationAt: number | null = null;
  private lastError: string | null = null;
  private latestReadiness: GatewayRegistryReadiness;

  private readonly requiredServices: readonly string[];
  private readonly criticalServices: readonly string[];
  private readonly confirmationThreshold: number;
  private readonly reconciliationCooldownMs: number;
  private readonly registryStalenessMs: number;
  private readonly registryRecoveryExitThreshold: number;
  private readonly exitProcess: (code: number) => void;
  private readonly now: () => number;
  private readonly onDiagnostic?: (event: GatewayRegistryDiagnosticEvent) => void;
  private readonly lastSeenAtByService = new Map<string, number>();
  private persistentMissingSignature: string | null = null;
  private persistentMissingReconciliations = 0;
  private selfHealing = false;

  constructor(private readonly star: Starlight, options: GatewayRegistryWatchdogOptions = {}) {
    this.requiredServices = options.requiredServices || requiredGatewayServicesFromEnvironment();
    const criticalServices = options.criticalServices || criticalGatewayServicesFromEnvironment();
    this.criticalServices = criticalServices.filter((service) => this.requiredServices.includes(service));
    this.confirmationThreshold = options.confirmationThreshold ?? DEFAULT_CONFIRMATION_THRESHOLD;
    this.reconciliationCooldownMs = options.reconciliationCooldownMs ?? DEFAULT_RECONCILIATION_COOLDOWN_MS;
    this.registryStalenessMs = options.registryStalenessMs ?? DEFAULT_REGISTRY_STALENESS_MS;
    this.registryRecoveryExitThreshold = options.registryRecoveryExitThreshold ?? DEFAULT_REGISTRY_RECOVERY_EXIT_THRESHOLD;
    this.exitProcess = options.exitProcess ?? process.exit.bind(process);
    this.now = options.now || Date.now;
    this.onDiagnostic = options.onDiagnostic;
    if (!Number.isInteger(this.confirmationThreshold) || this.confirmationThreshold < 1) {
      throw new Error('confirmationThreshold must be a positive integer');
    }
    if (!Number.isInteger(this.reconciliationCooldownMs) || this.reconciliationCooldownMs < 1) {
      throw new Error('reconciliationCooldownMs must be a positive integer');
    }
    if (!Number.isInteger(this.registryStalenessMs) || this.registryStalenessMs < 0) {
      throw new Error('registryStalenessMs must be a non-negative integer');
    }
    if (!Number.isInteger(this.registryRecoveryExitThreshold) || this.registryRecoveryExitThreshold < 1) {
      throw new Error('registryRecoveryExitThreshold must be a positive integer');
    }
    this.latestReadiness = this.snapshot(this.now(), false, 0, [...this.requiredServices], [...this.criticalServices], false);
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
        return this.snapshot(checkedAt, false, 0, this.requiredServices.slice(), this.criticalServices.slice(), transportConnected);
      }

      const registered = new Set(services);
      const missingServices = this.requiredServices.filter((service) => !registered.has(service));
      for (const service of registered) this.lastSeenAtByService.set(service, checkedAt);
      const missingCriticalServices = this.criticalServices.filter((service) => {
        if (registered.has(service)) return false;
        const lastSeenAt = this.lastSeenAtByService.get(service);
        return lastSeenAt === undefined || checkedAt - lastSeenAt >= this.registryStalenessMs;
      });
      this.lastError = null;
      return this.snapshot(checkedAt, true, services.length, missingServices, missingCriticalServices, transportConnected);
    } catch (error) {
      this.lastError = toErrorMessage(error);
      return this.snapshot(checkedAt, false, 0, this.requiredServices.slice(), this.criticalServices.slice(), transportConnected);
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
      this.clearPersistentMissingReconciliations();
      return this.store({
        ...readiness,
        consecutiveMissingObservations: this.consecutiveMissingObservations,
        persistentMissingReconciliations: this.persistentMissingReconciliations,
      });
    }

    this.consecutiveMissingObservations += 1;
    if (this.consecutiveMissingObservations < this.confirmationThreshold) {
      return this.store(this.withUnconfirmedState(readiness));
    }

    const reconciled = await this.reconcileIfEligible(readiness.missingServices);
    const afterReconciliation = await this.inspect();
    if (!afterReconciliation.registryReadable || afterReconciliation.missingServices.length === 0) {
      this.clearPersistentMissingReconciliations();
    } else if (reconciled) {
      this.observePersistentMissingReconciliations(afterReconciliation);
    }
    return this.store({
      ...afterReconciliation,
      persistentMissingReconciliations: this.persistentMissingReconciliations,
    });
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
        missingServiceCount: readiness.missingCriticalServices.length,
        registeredServiceCount: readiness.registeredServiceCount,
        transportConnected: readiness.transportConnected,
      });
    }
    return readiness;
  }

  private withUnconfirmedState(readiness: GatewayRegistryReadiness): GatewayRegistryReadiness {
    if (readiness.missingCriticalServices.length === 0 && readiness.registryReadable && readiness.transportConnected) {
      return {
        ...readiness,
        ready: true,
        status: 'healthy',
        consecutiveMissingObservations: this.consecutiveMissingObservations,
        reconciliationAttempts: this.reconciliationAttempts,
        persistentMissingReconciliations: this.persistentMissingReconciliations,
        lastReconciliationAt: this.lastReconciliationAt,
        lastError: this.lastError,
      };
    }
    return {
      ...readiness,
      // Do not drop readiness on a single stale Kafka registry observation.
      ready: this.latestReadiness.ready && readiness.registryReadable && readiness.transportConnected,
      status: this.latestReadiness.ready && readiness.registryReadable && readiness.transportConnected ? 'healthy' : readiness.status,
      consecutiveMissingObservations: this.consecutiveMissingObservations,
      reconciliationAttempts: this.reconciliationAttempts,
      persistentMissingReconciliations: this.persistentMissingReconciliations,
      lastReconciliationAt: this.lastReconciliationAt,
      lastError: this.lastError,
    };
  }

  private snapshot(
    checkedAt: number,
    registryReadable: boolean,
    registeredServiceCount: number,
    missingServices: string[],
    missingCriticalServices: string[],
    transportConnected: boolean,
  ): GatewayRegistryReadiness {
    const reconciling = this.reconciliationInFlight !== null;
    const ready = registryReadable && transportConnected && missingCriticalServices.length === 0 && !reconciling;
    return {
      checkedAt,
      registryReadable,
      registeredServiceCount,
      missingServices,
      missingCriticalServices,
      transportConnected,
      ready,
      status: reconciling ? 'reconciling' : ready ? 'healthy' : 'degraded',
      consecutiveMissingObservations: this.consecutiveMissingObservations,
      reconciliationAttempts: this.reconciliationAttempts,
      persistentMissingReconciliations: this.persistentMissingReconciliations,
      lastReconciliationAt: this.lastReconciliationAt,
      lastError: this.lastError,
    };
  }

  private clearPersistentMissingReconciliations(): void {
    this.persistentMissingSignature = null;
    this.persistentMissingReconciliations = 0;
  }

  private observePersistentMissingReconciliations(readiness: GatewayRegistryReadiness): void {
    // A missing core service is a downstream incident. Restarting Gateway cannot repair it
    // and would turn the incident into a restart loop. This escape hatch is only for a
    // connected Gateway whose own non-critical directory view has remained stale.
    if (!readiness.transportConnected || readiness.missingCriticalServices.length > 0 || this.selfHealing) {
      this.clearPersistentMissingReconciliations();
      return;
    }

    const signature = readiness.missingServices.slice().sort().join(',');
    if (this.persistentMissingSignature !== signature) {
      this.persistentMissingSignature = signature;
      this.persistentMissingReconciliations = 0;
    }
    this.persistentMissingReconciliations += 1;
    if (this.persistentMissingReconciliations < this.registryRecoveryExitThreshold) return;

    this.selfHealing = true;
    this.star.logger?.warn('gateway.registry-self-heal-terminal-failure', {
      missingServices: readiness.missingServices,
      successfulReconciliations: this.persistentMissingReconciliations,
      threshold: this.registryRecoveryExitThreshold,
      action: 'exit_for_compose_restart',
    });
    this.onDiagnostic?.({
      kind: 'registry_self_heal_exit',
      occurredAt: this.now(),
      outcome: 'failure',
      reason: 'persistent_noncritical_registry_staleness',
      service: 'gateway',
      missingServiceCount: readiness.missingServices.length,
      registeredServiceCount: readiness.registeredServiceCount,
      transportConnected: true,
    });
    this.exitProcess(1);
  }

  private async reconcileIfEligible(missingServices: string[]): Promise<boolean> {
    if (this.reconciliationInFlight) return this.reconciliationInFlight;
    const now = this.now();
    if (this.lastReconciliationAt !== null && now - this.lastReconciliationAt < this.reconciliationCooldownMs) return false;

    const discoverer = this.star.registry?.discoverer as RegistryDiscoverer | undefined;
    if (!discoverer?.discoverAllNodes) {
      this.lastError = 'Gateway registry discoverer is unavailable';
      return false;
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
        return true;
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
        return false;
      })
      .finally(() => {
        this.reconciliationInFlight = null;
      });
    return this.reconciliationInFlight;
  }
}
