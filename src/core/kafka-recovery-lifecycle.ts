import { Starlight } from 'typings';

type LocalBus = {
  on(eventName: string, listener: (payload: unknown) => void): unknown;
  off?(eventName: string, listener: (payload: unknown) => void): unknown;
  removeListener?(eventName: string, listener: (payload: unknown) => void): unknown;
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
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
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

  const originalStop = star.stop.bind(star);
  star.stop = async () => {
    stop();
    return originalStop();
  };

  return { stop };
};
