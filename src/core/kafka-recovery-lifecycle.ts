import { Starlight } from 'typings';

type LocalBus = {
  on(eventName: string, listener: (payload: unknown) => void): unknown;
  off?(eventName: string, listener: (payload: unknown) => void): unknown;
  removeListener?(eventName: string, listener: (payload: unknown) => void): unknown;
};

type LocalRegistryService = {
  fullName?: unknown;
};

type LocalServiceDefinition = {
  fullName?: unknown;
  _serviceSpecification?: unknown;
};

type LocalRegistry = {
  nodes?: {
    localNode?: {
      id?: unknown;
      available?: boolean;
      offlineSince?: unknown;
      lastHeartbeatTime?: number;
    };
  };
  services?: {
    list?: (options?: { onlyLocal?: boolean; onlyAvaliable?: boolean }) => LocalRegistryService[];
  };
  discoverer?: {
    sendLocalNodeInfo?: () => Promise<unknown> | unknown;
    discoverAllNodes?: () => Promise<unknown> | unknown;
  };
};

export type KafkaRecoveryLifecycleKind = 'scheduled' | 'succeeded' | 'failed' | 'kafka_js_restart_timed_out';

export type KafkaRecoveryLifecycleReport = {
  kind: KafkaRecoveryLifecycleKind;
  instanceID: string;
  service: string;
  generation: number;
  reason: string;
  attempt?: number;
  delay?: number;
  occurredAt: number;
};

export type DarwinKafkaRecoveryLifecycle = { stop(): void };

const MAX_INSTANCE_ID_LENGTH = 160;
const MAX_SERVICE_NAME_LENGTH = 96;
const MAX_REASON_LENGTH = 64;
const REGISTRY_RECONCILIATION_INTERVAL_MS = 30_000;
const EVENT_KINDS: Record<string, KafkaRecoveryLifecycleKind> = {
  '$transporter.consumer.recovery.scheduled': 'scheduled',
  '$transporter.consumer.recovery.succeeded': 'succeeded',
  '$transporter.consumer.recovery.failed': 'failed',
  '$transporter.consumer.kafkaJsRestart.timedOut': 'kafka_js_restart_timed_out',
};

const normalizedString = (value: unknown, maximumLength: number) => String(value || '').trim().slice(0, maximumLength);

const normalizeInstanceID = (value: unknown) => {
  const instanceID = normalizedString(value, MAX_INSTANCE_ID_LENGTH).toLowerCase();
  return /^[a-z0-9][a-z0-9.-]*$/.test(instanceID) ? instanceID : null;
};

const serviceFromInstanceID = (instanceID: string) => {
  const match = instanceID.match(/^(.*)-(development|production|test)-.+$/);
  const service = (match?.[1] || instanceID).slice(0, MAX_SERVICE_NAME_LENGTH);
  return /^[a-z0-9][a-z0-9.-]*$/.test(service) ? service : null;
};

const normalizeReason = (value: unknown) => {
  const reason = normalizedString(value, MAX_REASON_LENGTH).toLowerCase();
  return /^[a-z0-9_.-]+$/.test(reason) ? reason : 'unknown';
};

const positiveInteger = (value: unknown) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const nonNegativeInteger = (value: unknown) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

export const sanitizeKafkaRecoveryLifecycleReport = (kind: KafkaRecoveryLifecycleKind, payload: unknown): KafkaRecoveryLifecycleReport | null => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const lifecycle = payload as Record<string, unknown>;
  if (lifecycle.transporter !== 'kafka') return null;
  const instanceID = normalizeInstanceID(lifecycle.instanceID);
  const service = instanceID ? serviceFromInstanceID(instanceID) : null;
  const generation = positiveInteger(lifecycle.generation);
  if (!instanceID || !service || !generation) return null;

  const report: KafkaRecoveryLifecycleReport = {
    kind,
    instanceID,
    service,
    generation,
    reason: normalizeReason(lifecycle.reason),
    occurredAt: Date.now(),
  };
  const attempt = positiveInteger(lifecycle.attempt);
  const delay = nonNegativeInteger(lifecycle.delay);
  if (attempt) report.attempt = attempt;
  if (delay !== undefined) report.delay = delay;
  return report;
};

export const installDarwinKafkaRecoveryLifecycle = (star: Starlight): DarwinKafkaRecoveryLifecycle => {
  const localBus = star.localBus as LocalBus | undefined;
  const listeners: Array<{ eventName: string; listener: (payload: unknown) => void }> = [];
  const registry = star.registry as unknown as LocalRegistry | undefined;
  let reconciliationInFlight: Promise<void> | null = null;
  let stopped = false;

  const reconcileLocalRegistration = (reason: string): Promise<void> => {
    if (stopped || star.stopping || star.started !== true) return Promise.resolve();
    if (reconciliationInFlight) return reconciliationInFlight;

    reconciliationInFlight = Promise.resolve()
      .then(async () => {
        const localNode = registry?.nodes?.localNode;
        const nodeID = String(star.nodeID || '');
        if (!localNode || !nodeID || String(localNode.id || '') !== nodeID) return;

        let nodeReactivated = false;
        if (localNode.available !== true) {
          localNode.available = true;
          localNode.offlineSince = null;
          localNode.lastHeartbeatTime = Math.round(process.uptime());
          nodeReactivated = true;
        }

        const registered = new Set(
          (registry?.services?.list?.({ onlyLocal: true, onlyAvaliable: false }) || [])
            .map((service) => String(service.fullName || ''))
            .filter(Boolean),
        );
        const localServices = ((star.services || []) as unknown as LocalServiceDefinition[])
          .filter((service) => typeof service.fullName === 'string' && service._serviceSpecification);
        const missing = localServices.filter((service) => !registered.has(String(service.fullName)));

        for (const service of missing) {
          star.registerLocalService(service._serviceSpecification as never);
        }

        if (!nodeReactivated && missing.length === 0) return;

        await registry?.discoverer?.sendLocalNodeInfo?.();
        await registry?.discoverer?.discoverAllNodes?.();
        star.logger?.warn('registry.local-registration-reconciled', {
          reason,
          nodeReactivated,
          restoredServices: missing.map((service) => service.fullName),
        });
      })
      .catch((error) => {
        star.logger?.warn('registry.local-registration-reconciliation-failed', {
          reason,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        reconciliationInFlight = null;
      });

    return reconciliationInFlight;
  };

  const watchdog = setInterval(() => {
    void reconcileLocalRegistration('watchdog');
  }, REGISTRY_RECONCILIATION_INTERVAL_MS);
  watchdog.unref();

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(watchdog);
    for (const { eventName, listener } of listeners) {
      if (localBus?.off) localBus.off(eventName, listener);
      else localBus?.removeListener?.(eventName, listener);
    }
    listeners.length = 0;
  };

  for (const [eventName, kind] of Object.entries(EVENT_KINDS)) {
    const listener = (payload: unknown) => {
      const report = sanitizeKafkaRecoveryLifecycleReport(kind, payload);
      if (!report) {
        star.logger?.warn('kafka.recovery-lifecycle.invalid-payload', { eventName });
        return;
      }
      if (report.kind === 'scheduled') {
        star.logger?.info('kafka.recovery-lifecycle.scheduled', {
          service: report.service,
          generation: report.generation,
          reason: report.reason,
          attempt: report.attempt || 0,
          delay: report.delay || 0,
        });
      }
      if (report.kind === 'succeeded') void reconcileLocalRegistration('consumer_recovered');
      void star.call('gateway.kafkaRecovery.report', report, {
        meta: { internal: true, system: 'darwin-kafka-recovery' },
      }).catch(() => {
        star.logger?.warn('kafka.recovery-lifecycle.report-failed', {
          kind: report.kind,
          service: report.service,
          generation: report.generation,
        });
      });
    };
    if (!localBus?.on) continue;
    localBus.on(eventName, listener);
    listeners.push({ eventName, listener });
  }

  const reconcileOnLocalNodeLoss = (payload: unknown) => {
    const nodeID = (payload as { node?: { id?: unknown } } | undefined)?.node?.id;
    if (String(nodeID || '') === String(star.nodeID || '')) {
      void reconcileLocalRegistration('local_node_disconnected');
    }
  };
  const reconcileAfterStartup = () => {
    void reconcileLocalRegistration('star_started');
  };
  if (localBus?.on) {
    localBus.on('$node.disconnected', reconcileOnLocalNodeLoss);
    listeners.push({ eventName: '$node.disconnected', listener: reconcileOnLocalNodeLoss });
    localBus.on('$star.started', reconcileAfterStartup);
    listeners.push({ eventName: '$star.started', listener: reconcileAfterStartup });
  }

  const originalStop = star.stop.bind(star);
  star.stop = async () => {
    stop();
    return originalStop();
  };

  return { stop };
};
