import { Starlight } from 'typings';
import { TRAILS_SHARD_NAMES } from '../../../../shared/trails-contract';

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
  ...TRAILS_SHARD_NAMES,
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
  ...TRAILS_SHARD_NAMES,
  'user',
] as const;

type RegistryService = { name?: unknown };
type RegistryListOptions = { onlyAvaliable?: boolean };
type RegistryServices = { list?: (options?: RegistryListOptions) => unknown | Promise<unknown> };
type RegistryDiscoverer = { discoverAllNodes?: () => Promise<unknown> | unknown };
type Wait = (durationMs: number) => Promise<void>;
type DiscoveryPublication = 'published' | 'failed' | 'timed_out';
type DirectoryReconciliation = 'recovered' | 'directory_not_recovered' | 'broadcast_failed' | 'broadcast_timed_out';
type PersistentMissingScope = 'noncritical' | 'directory_drift';

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
    | 'transit_error'
    | 'transient_service_refresh_requested'
    | 'transient_service_refresh_recovered'
    | 'transient_service_refresh_failed';
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
  registryDirectoryDriftMissingServiceThreshold?: number;
  transientServiceRefreshTimeoutMs?: number;
  transientServiceRefreshIntervalMs?: number;
  transientServiceRefreshCooldownMs?: number;
  exitProcess?: (code: number) => void;
  now?: () => number;
  wait?: Wait;
  onDiagnostic?: (event: GatewayRegistryDiagnosticEvent) => void;
};

const DEFAULT_CONFIRMATION_THRESHOLD = 2;
const DEFAULT_RECONCILIATION_COOLDOWN_MS = 30_000;
const DEFAULT_REGISTRY_STALENESS_MS = 45_000;
const DEFAULT_REGISTRY_RECOVERY_EXIT_THRESHOLD = 4;
const DEFAULT_REGISTRY_DIRECTORY_DRIFT_MISSING_SERVICE_THRESHOLD = 3;
// Gateway passes the production values explicitly. Keep the exported watchdog's
// standalone default short so callers that omit configuration cannot block an
// event loop on a stale directory for seconds at a time.
const DEFAULT_TRANSIENT_SERVICE_REFRESH_TIMEOUT_MS = 250;
const DEFAULT_TRANSIENT_SERVICE_REFRESH_INTERVAL_MS = 100;
const DEFAULT_TRANSIENT_SERVICE_REFRESH_COOLDOWN_MS = 1_000;

const waitFor = (durationMs: number): Promise<void> => new Promise((resolve) => {
  const timer = setTimeout(resolve, durationMs);
  timer.unref?.();
});

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
  private reconciliationInFlight: Promise<DirectoryReconciliation> | null = null;
  private tickInFlight: Promise<GatewayRegistryReadiness> | null = null;
  private lastReconciliationAt: number | null = null;
  private lastError: string | null = null;
  // A multi-service gap is eligible for local-directory self healing only after
  // this process has once observed the entire required catalog. Without that
  // baseline, an incomplete startup can look indistinguishable from drift.
  private hasObservedFullHealthyDirectory = false;
  private reconciliationErrorServices: string[] | null = null;
  private latestReadiness: GatewayRegistryReadiness;

  private readonly requiredServices: readonly string[];
  private readonly criticalServices: readonly string[];
  private readonly confirmationThreshold: number;
  private readonly reconciliationCooldownMs: number;
  private readonly registryStalenessMs: number;
  private readonly registryRecoveryExitThreshold: number;
  private readonly registryDirectoryDriftMissingServiceThreshold: number;
  private readonly transientServiceRefreshTimeoutMs: number;
  private readonly transientServiceRefreshIntervalMs: number;
  private readonly transientServiceRefreshCooldownMs: number;
  private readonly exitProcess: (code: number) => void;
  private readonly now: () => number;
  private readonly wait: Wait;
  private readonly onDiagnostic?: (event: GatewayRegistryDiagnosticEvent) => void;
  private readonly lastSeenAtByService = new Map<string, number>();
  private readonly transientServiceRefreshes = new Map<string, Promise<boolean>>();
  private transientDirectoryDiscoveryInFlight: Promise<DiscoveryPublication> | null = null;
  private lastTransientDirectoryDiscoveryAt: number | null = null;
  private lastTransientDirectoryDiscoveryOutcome: DiscoveryPublication | null = null;
  private persistentMissingSignature: string | null = null;
  private persistentMissingScope: PersistentMissingScope | null = null;
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
    this.registryDirectoryDriftMissingServiceThreshold = options.registryDirectoryDriftMissingServiceThreshold
      ?? DEFAULT_REGISTRY_DIRECTORY_DRIFT_MISSING_SERVICE_THRESHOLD;
    this.transientServiceRefreshTimeoutMs = options.transientServiceRefreshTimeoutMs ?? DEFAULT_TRANSIENT_SERVICE_REFRESH_TIMEOUT_MS;
    this.transientServiceRefreshIntervalMs = options.transientServiceRefreshIntervalMs ?? DEFAULT_TRANSIENT_SERVICE_REFRESH_INTERVAL_MS;
    this.transientServiceRefreshCooldownMs = options.transientServiceRefreshCooldownMs ?? DEFAULT_TRANSIENT_SERVICE_REFRESH_COOLDOWN_MS;
    this.exitProcess = options.exitProcess ?? process.exit.bind(process);
    this.now = options.now || Date.now;
    this.wait = options.wait || waitFor;
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
    if (
      !Number.isInteger(this.registryDirectoryDriftMissingServiceThreshold)
      || this.registryDirectoryDriftMissingServiceThreshold < 2
    ) {
      throw new Error('registryDirectoryDriftMissingServiceThreshold must be an integer of at least 2');
    }
    if (!Number.isInteger(this.transientServiceRefreshTimeoutMs) || this.transientServiceRefreshTimeoutMs < 1) {
      throw new Error('transientServiceRefreshTimeoutMs must be a positive integer');
    }
    if (!Number.isInteger(this.transientServiceRefreshIntervalMs) || this.transientServiceRefreshIntervalMs < 1) {
      throw new Error('transientServiceRefreshIntervalMs must be a positive integer');
    }
    if (!Number.isInteger(this.transientServiceRefreshCooldownMs) || this.transientServiceRefreshCooldownMs < 0) {
      throw new Error('transientServiceRefreshCooldownMs must be a non-negative integer');
    }
    this.latestReadiness = this.snapshot(this.now(), false, 0, [...this.requiredServices], [...this.criticalServices], false);
  }

  getReadiness(): GatewayRegistryReadiness {
    return this.latestReadiness;
  }

  // A service that was recently present but is absent from this Gateway's local
  // registry may be a transient Kafka directory gap. It is deliberately not
  // treated as registered; callers must still wait for an actual registry entry.
  isTransientlyMissing(service: string): boolean {
    if (this.star.transit?.connected !== true) return false;
    const lastSeenAt = this.lastSeenAtByService.get(service);
    if (lastSeenAt === undefined) return false;
    return Math.max(0, this.now() - lastSeenAt) < this.registryStalenessMs;
  }

  // Concurrent requests for the same target share one polling sequence. The
  // DISCOVER packet itself is additionally shared by all target services below.
  async refreshTransientService(service: string): Promise<boolean> {
    const inFlight = this.transientServiceRefreshes.get(service);
    if (inFlight) return inFlight;
    if (!this.isTransientlyMissing(service)) return false;
    const refresh = this.refreshTransientServiceOnce(service).finally(() => {
      this.transientServiceRefreshes.delete(service);
    });
    this.transientServiceRefreshes.set(service, refresh);
    return refresh;
  }

  async inspect(): Promise<GatewayRegistryReadiness> {
    const checkedAt = this.now();
    const transportConnected = this.star.transit?.connected === true;
    const services = await this.readRegisteredServiceNames(checkedAt);
    if (!services) {
      return this.snapshot(checkedAt, false, 0, this.requiredServices.slice(), this.criticalServices.slice(), transportConnected);
    }

    const registered = new Set(services);
    const missingServices = this.requiredServices.filter((service) => !registered.has(service));
    const missingCriticalServices = this.criticalServices.filter((service) => {
      if (registered.has(service)) return false;
      const lastSeenAt = this.lastSeenAtByService.get(service);
      return lastSeenAt === undefined || checkedAt - lastSeenAt >= this.registryStalenessMs;
    });
    if (transportConnected && missingServices.length === 0) {
      this.hasObservedFullHealthyDirectory = true;
    }
    this.clearResolvedReconciliationError(registered);
    return this.snapshot(checkedAt, true, services.length, missingServices, missingCriticalServices, transportConnected);
  }

  private clearResolvedReconciliationError(registered: ReadonlySet<string>): void {
    if (!this.reconciliationErrorServices) {
      this.lastError = null;
      return;
    }
    if (this.reconciliationErrorServices.some((service) => !registered.has(service))) return;
    this.reconciliationErrorServices = null;
    this.lastError = null;
  }

  private setReconciliationError(message: string, missingServices: readonly string[]): void {
    this.lastError = message;
    this.reconciliationErrorServices = Array.from(new Set(missingServices)).sort();
  }

  private async readRegisteredServiceNames(observedAt = this.now()): Promise<string[] | null> {
    try {
      const services = normalizeServiceNames(
        await Promise.resolve(
          (this.star.registry?.services as RegistryServices | undefined)?.list?.({ onlyAvaliable: true }),
        ),
      );
      if (!services) {
        this.lastError = 'Gateway registry returned an invalid service list';
        return null;
      }
      for (const service of services) this.lastSeenAtByService.set(service, observedAt);
      return services;
    } catch (error) {
      this.lastError = toErrorMessage(error);
      return null;
    }
  }

  private async refreshTransientServiceOnce(service: string): Promise<boolean> {
    if (!this.isTransientlyMissing(service)) return false;

    const initiallyRegistered = await this.readRegisteredServiceNames(this.now());
    if (!initiallyRegistered) {
      this.onDiagnostic?.({
        kind: 'transient_service_refresh_failed',
        occurredAt: this.now(),
        outcome: 'failure',
        reason: 'registry_unreadable',
        service,
        transportConnected: this.star.transit?.connected === true,
      });
      return false;
    }
    if (initiallyRegistered.includes(service)) {
      return true;
    }

    const discoverer = this.star.registry?.discoverer as RegistryDiscoverer | undefined;
    const startedAt = this.now();
    if (!discoverer?.discoverAllNodes) {
      this.lastError = 'Gateway registry discoverer is unavailable';
      this.onDiagnostic?.({
        kind: 'transient_service_refresh_failed',
        occurredAt: startedAt,
        outcome: 'failure',
        reason: 'discoverer_unavailable',
        service,
        transportConnected: true,
      });
      return false;
    }

    this.onDiagnostic?.({
      kind: 'transient_service_refresh_requested',
      occurredAt: startedAt,
      outcome: 'degraded',
      reason: 'recently_seen_service_missing',
      service,
      transportConnected: true,
    });

    const publication = await this.requestTransientDirectoryDiscovery(discoverer);
    if (publication !== 'published') {
      this.lastError = publication === 'timed_out'
        ? `Gateway registry discovery timed out for ${service}`
        : `Gateway registry discovery failed for ${service}`;
      this.star.logger?.warn('Gateway transient service directory refresh failed', {
        service,
        outcome: publication,
        error: publication === 'failed' ? this.lastError : undefined,
      });
      this.onDiagnostic?.({
        kind: 'transient_service_refresh_failed',
        occurredAt: this.now(),
        outcome: 'failure',
        reason: publication === 'timed_out' ? 'discover_timeout' : 'discover_broadcast',
        service,
        transportConnected: true,
        durationMs: Math.max(0, this.now() - startedAt),
      });
      return false;
    }

    const deadlineAt = startedAt + this.transientServiceRefreshTimeoutMs;
    const maximumPolls = Math.max(1, Math.ceil(this.transientServiceRefreshTimeoutMs / this.transientServiceRefreshIntervalMs) + 1);
    for (let poll = 0; poll < maximumPolls; poll += 1) {
      const registeredServices = await this.readRegisteredServiceNames(this.now());
      if (!registeredServices) {
        this.onDiagnostic?.({
          kind: 'transient_service_refresh_failed',
          occurredAt: this.now(),
          outcome: 'failure',
          reason: 'registry_unreadable',
          service,
          transportConnected: this.star.transit?.connected === true,
          durationMs: Math.max(0, this.now() - startedAt),
        });
        return false;
      }
      if (registeredServices.includes(service)) {
        this.lastError = null;
        this.star.logger?.info?.('Gateway transient service directory refresh recovered', {
          service,
          durationMs: Math.max(0, this.now() - startedAt),
        });
        this.onDiagnostic?.({
          kind: 'transient_service_refresh_recovered',
          occurredAt: this.now(),
          outcome: 'success',
          reason: 'service_reappeared',
          service,
          transportConnected: true,
          durationMs: Math.max(0, this.now() - startedAt),
        });
        return true;
      }

      const remainingMs = deadlineAt - this.now();
      if (poll + 1 >= maximumPolls || remainingMs <= 0) break;
      await this.wait(Math.min(this.transientServiceRefreshIntervalMs, remainingMs));
    }

    this.lastError = `Gateway registry directory refresh timed out for ${service}`;
    this.star.logger?.warn('Gateway transient service directory refresh timed out', {
      service,
      timeoutMs: this.transientServiceRefreshTimeoutMs,
    });
    this.onDiagnostic?.({
      kind: 'transient_service_refresh_failed',
      occurredAt: this.now(),
      outcome: 'failure',
      reason: 'service_not_reannounced',
      service,
      transportConnected: this.star.transit?.connected === true,
      durationMs: Math.max(0, this.now() - startedAt),
    });
    return false;
  }

  // One local registry gap can hide many service names at once. A single
  // DISCOVER packet asks every peer to re-announce its complete directory, so
  // this state is global to the Gateway rather than scoped to one service.
  private requestTransientDirectoryDiscovery(discoverer: RegistryDiscoverer): Promise<DiscoveryPublication> {
    if (this.transientDirectoryDiscoveryInFlight) return this.transientDirectoryDiscoveryInFlight;

    const now = this.now();
    if (
      this.lastTransientDirectoryDiscoveryAt !== null
      && now - this.lastTransientDirectoryDiscoveryAt < this.transientServiceRefreshCooldownMs
      && this.lastTransientDirectoryDiscoveryOutcome
    ) {
      return Promise.resolve(this.lastTransientDirectoryDiscoveryOutcome);
    }

    this.lastTransientDirectoryDiscoveryAt = now;
    const discovery = this.publishDiscovery(discoverer, this.transientServiceRefreshTimeoutMs)
      .then((outcome) => {
        this.lastTransientDirectoryDiscoveryOutcome = outcome;
        return outcome;
      })
      .finally(() => {
        this.transientDirectoryDiscoveryInFlight = null;
      });
    this.transientDirectoryDiscoveryInFlight = discovery;
    return discovery;
  }

  private async publishDiscovery(discoverer: RegistryDiscoverer, timeoutMs: number): Promise<DiscoveryPublication> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: DiscoveryPublication) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => finish('timed_out'), timeoutMs);
      timer.unref?.();
      Promise.resolve()
        .then(() => discoverer.discoverAllNodes?.())
        .then(() => finish('published'))
        .catch(() => finish('failed'));
    });
  }

  private async waitForDirectoryEntries(
    expectedServices: readonly string[],
    startedAt: number,
  ): Promise<boolean> {
    const expected = new Set(expectedServices);
    const deadlineAt = startedAt + this.transientServiceRefreshTimeoutMs;
    const maximumPolls = Math.max(
      1,
      Math.ceil(this.transientServiceRefreshTimeoutMs / this.transientServiceRefreshIntervalMs) + 1,
    );
    for (let poll = 0; poll < maximumPolls; poll += 1) {
      const services = await this.readRegisteredServiceNames(this.now());
      if (!services) return false;
      const registered = new Set(services);
      if (Array.from(expected).every((service) => registered.has(service))) return true;

      const remainingMs = deadlineAt - this.now();
      if (poll + 1 >= maximumPolls || remainingMs <= 0) break;
      await this.wait(Math.min(this.transientServiceRefreshIntervalMs, remainingMs));
    }
    return false;
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

    const reconciliation = await this.reconcileIfEligible(readiness.missingServices);
    const afterReconciliation = await this.inspect();
    if (!afterReconciliation.registryReadable || afterReconciliation.missingServices.length === 0) {
      this.clearPersistentMissingReconciliations();
    } else if (reconciliation === 'directory_not_recovered') {
      this.observePersistentMissingReconciliations(afterReconciliation, readiness.missingServices);
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
    this.persistentMissingScope = null;
    this.persistentMissingReconciliations = 0;
  }

  private observePersistentMissingReconciliations(
    readiness: GatewayRegistryReadiness,
    missingBeforeReconciliation: string[],
  ): void {
    // One critical service can be a real downstream outage. In contrast, several
    // previously seen services disappearing together is a local Gateway directory
    // black hole: restarting only Gateway is the narrowest safe repair.
    const existingDirectoryDrift = this.persistentMissingScope === 'directory_drift'
      && this.persistentMissingSignature === readiness.missingServices.slice().sort().join(',');
    const directoryDrift = this.hasObservedFullHealthyDirectory && (existingDirectoryDrift || (
      missingBeforeReconciliation.length >= this.registryDirectoryDriftMissingServiceThreshold
      && missingBeforeReconciliation.every((service) => {
        const lastSeenAt = this.lastSeenAtByService.get(service);
        return lastSeenAt !== undefined && this.now() - lastSeenAt < this.registryStalenessMs;
      })
    ));
    if (!readiness.transportConnected || !this.hasObservedFullHealthyDirectory || this.selfHealing) {
      this.clearPersistentMissingReconciliations();
      return;
    }
    const scope: PersistentMissingScope | null = directoryDrift
      ? 'directory_drift'
      : readiness.missingCriticalServices.length === 0
        ? 'noncritical'
        : null;
    if (!scope) {
      this.clearPersistentMissingReconciliations();
      return;
    }

    const signature = readiness.missingServices.slice().sort().join(',');
    if (this.persistentMissingSignature !== signature || this.persistentMissingScope !== scope) {
      this.persistentMissingSignature = signature;
      this.persistentMissingScope = scope;
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
      reason: scope === 'directory_drift'
        ? 'persistent_multi_service_registry_directory_drift'
        : 'persistent_noncritical_registry_staleness',
      service: 'gateway',
      missingServiceCount: readiness.missingServices.length,
      registeredServiceCount: readiness.registeredServiceCount,
      transportConnected: true,
    });
    this.exitProcess(1);
  }

  private async reconcileIfEligible(missingServices: string[]): Promise<DirectoryReconciliation | null> {
    if (this.reconciliationInFlight) return this.reconciliationInFlight;
    const now = this.now();
    if (this.lastReconciliationAt !== null && now - this.lastReconciliationAt < this.reconciliationCooldownMs) return null;

    const discoverer = this.star.registry?.discoverer as RegistryDiscoverer | undefined;
    if (!discoverer?.discoverAllNodes) {
      this.setReconciliationError('Gateway registry discoverer is unavailable', missingServices);
      return null;
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
    this.reconciliationInFlight = this.publishDiscovery(discoverer, this.transientServiceRefreshTimeoutMs)
      .then(async (publication) => {
        if (publication !== 'published') {
          this.setReconciliationError(publication === 'timed_out'
            ? 'Gateway registry reconciliation broadcast timed out'
            : 'Gateway registry reconciliation broadcast failed', missingServices);
          this.star.logger?.warn('Gateway registry reconciliation failed', {
            attempt: this.reconciliationAttempts,
            outcome: publication,
          });
          this.onDiagnostic?.({
            kind: 'reconciliation_failed',
            occurredAt: this.now(),
            outcome: 'failure',
            reason: publication === 'timed_out' ? 'discover_timeout' : 'discover_broadcast',
            service: 'gateway',
            missingServiceCount: missingServices.length,
            durationMs: this.now() - startedAt,
          });
          return publication === 'timed_out' ? 'broadcast_timed_out' : 'broadcast_failed';
        }
        this.star.logger?.warn('Gateway registry reconciliation broadcast requested', {
          missingServices,
          attempt: this.reconciliationAttempts,
        });
        // DISCOVER only asks peers to emit INFO. A delivery acknowledgement is
        // not recovery: wait until the local directory contains each missing
        // service before declaring the reconciliation successful.
        const recovered = await this.waitForDirectoryEntries(missingServices, startedAt);
        if (!recovered) {
          this.setReconciliationError(
            'Gateway registry reconciliation did not repopulate the local directory',
            missingServices,
          );
          this.onDiagnostic?.({
            kind: 'reconciliation_failed',
            occurredAt: this.now(),
            outcome: 'failure',
            reason: 'directory_not_recovered',
            service: 'gateway',
            missingServiceCount: missingServices.length,
            durationMs: this.now() - startedAt,
          });
          return 'directory_not_recovered';
        }
        this.clearResolvedReconciliationError(new Set(missingServices));
        this.onDiagnostic?.({
          kind: 'reconciliation_succeeded',
          occurredAt: this.now(),
          outcome: 'success',
          reason: 'directory_recovered',
          service: 'gateway',
          missingServiceCount: missingServices.length,
          durationMs: this.now() - startedAt,
        });
        return 'recovered';
      })
      .finally(() => {
        this.reconciliationInFlight = null;
      });
    return this.reconciliationInFlight;
  }
}
