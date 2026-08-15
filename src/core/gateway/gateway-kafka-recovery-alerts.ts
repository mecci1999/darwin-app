import type { DeliveryChannel } from 'apps/starlight/metrics-alerts/alert-outbox';
import { KafkaRecoveryLifecycleReport } from 'core/kafka-recovery-lifecycle';

type NotificationOutbox = {
  saveInstanceAndCreateNotificationEvent(input: {
    tenantId: string;
    alertId: string;
    ruleId: string;
    status: 'active' | 'resolved';
    payload: Record<string, unknown>;
    eventKey?: string;
    channels?: Array<{ channel: DeliveryChannel; target: unknown }>;
  }): Promise<boolean>;
};

export type GatewayKafkaRecoveryAlertConfiguration = {
  channels: DeliveryChannel[];
  emailRecipients: string[];
  notifyOnRecovery: boolean;
};

export type GatewayKafkaRecoveryAlertAdapter = {
  record(report: KafkaRecoveryLifecycleReport): Promise<void>;
};

export type GatewayKafkaRecoveryReportHandler = {
  report(params: unknown, meta: unknown): Promise<{ accepted: boolean }>;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RULE_ID = 'gateway-kafka-consumer-recovery';

const normalizeChannels = (value: string | undefined): DeliveryChannel[] =>
  Array.from(new Set((value || '').split(',').map(channel => channel.trim()).filter((channel): channel is DeliveryChannel => channel === 'Email' || channel === 'InApp')));

const normalizeRecipients = (value: string | undefined): string[] =>
  Array.from(new Set((value || '').split(',').map(recipient => recipient.trim().toLowerCase()).filter(recipient => EMAIL.test(recipient)))).sort();

export const gatewayKafkaRecoveryAlertConfigurationFromEnvironment = (environment: NodeJS.ProcessEnv = process.env): GatewayKafkaRecoveryAlertConfiguration => {
  const emailRecipients = normalizeRecipients(environment.GATEWAY_KAFKA_RECOVERY_ALERT_EMAIL_RECIPIENTS);
  const channels = normalizeChannels(environment.GATEWAY_KAFKA_RECOVERY_ALERT_CHANNELS);
  return {
    channels: channels.filter(channel => channel !== 'Email' || emailRecipients.length > 0),
    emailRecipients,
    notifyOnRecovery: environment.GATEWAY_KAFKA_RECOVERY_ALERT_NOTIFY_ON_RECOVERY !== 'false',
  };
};

const targetsForConfiguration = (configuration: GatewayKafkaRecoveryAlertConfiguration) => {
  const targets: Array<{ channel: DeliveryChannel; target: unknown }> = [];
  for (const channel of configuration.channels) {
    if (channel === 'InApp') targets.push({ channel, target: 'in-app' });
    if (channel === 'Email') configuration.emailRecipients.forEach(target => targets.push({ channel, target }));
  }
  return targets;
};

const alertIdFor = (report: KafkaRecoveryLifecycleReport) => `${RULE_ID}-${report.instanceID}-${report.generation}`;

const validReport = (value: unknown): KafkaRecoveryLifecycleReport | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const report = value as Record<string, unknown>;
  const kind = report.kind;
  const instanceID = typeof report.instanceID === 'string' ? report.instanceID : '';
  const service = typeof report.service === 'string' ? report.service : '';
  const generation = Number(report.generation);
  const reason = typeof report.reason === 'string' ? report.reason : '';
  const occurredAt = Number(report.occurredAt);
  if (
    (kind !== 'scheduled' && kind !== 'succeeded' && kind !== 'failed' && kind !== 'kafka_js_restart_timed_out') ||
    !/^[a-z0-9][a-z0-9.-]{0,159}$/.test(instanceID) ||
    !/^[a-z0-9][a-z0-9.-]{0,95}$/.test(service) ||
    !Number.isSafeInteger(generation) || generation <= 0 ||
    !/^[a-z0-9_.-]{1,64}$/.test(reason) ||
    !Number.isSafeInteger(occurredAt) || occurredAt <= 0
  ) return null;
  const sanitized: KafkaRecoveryLifecycleReport = { kind, instanceID, service, generation, reason, occurredAt };
  if (Number.isSafeInteger(report.attempt) && Number(report.attempt) > 0) sanitized.attempt = Number(report.attempt);
  if (Number.isSafeInteger(report.delay) && Number(report.delay) >= 0) sanitized.delay = Number(report.delay);
  return sanitized;
};

export const createGatewayKafkaRecoveryReportHandler = (adapter: GatewayKafkaRecoveryAlertAdapter): GatewayKafkaRecoveryReportHandler => ({
  async report(params, meta) {
    const marker = meta && typeof meta === 'object' ? (meta as Record<string, unknown>).system : undefined;
    if (marker !== 'darwin-kafka-recovery') throw new Error('Gateway Kafka recovery reporting is internal only');
    const report = validReport(params);
    if (!report) throw new Error('Invalid Kafka recovery lifecycle report');
    await adapter.record(report);
    return { accepted: true };
  },
});

const payloadFor = (report: KafkaRecoveryLifecycleReport, status: 'active' | 'resolved') => ({
  ruleId: RULE_ID,
  service: report.service,
  serviceId: `system:${report.instanceID}`,
  level: 'critical',
  status,
  message: status === 'resolved'
    ? `Kafka consumer recovery completed for ${report.service}`
    : `Kafka consumer recovery requires attention for ${report.service}`,
  time: new Date(report.occurredAt).toISOString(),
  reason: report.reason,
  generation: report.generation,
  lifecycle: report.kind,
  attempt: report.attempt || 0,
  delay: report.delay || 0,
});

export const createGatewayKafkaRecoveryAlertAdapter = (
  outbox: NotificationOutbox,
  configuration = gatewayKafkaRecoveryAlertConfigurationFromEnvironment(),
): GatewayKafkaRecoveryAlertAdapter => {
  let pending = Promise.resolve();
  return {
    record(report) {
      const operation = pending.then(async () => {
        const alertId = alertIdFor(report);
        if (report.kind === 'scheduled') {
          await outbox.saveInstanceAndCreateNotificationEvent({
            tenantId: 'system', alertId, ruleId: RULE_ID, status: 'active', payload: payloadFor(report, 'active'),
          });
          return;
        }
        if (report.kind === 'succeeded') {
          await outbox.saveInstanceAndCreateNotificationEvent({
            tenantId: 'system', alertId, ruleId: RULE_ID, status: 'resolved', payload: payloadFor(report, 'resolved'),
            eventKey: `resolved:${report.generation}`,
            channels: configuration.notifyOnRecovery ? targetsForConfiguration(configuration) : undefined,
          });
          return;
        }
        const eventKey = `paged:${report.generation}`;
        await outbox.saveInstanceAndCreateNotificationEvent({
          tenantId: 'system', alertId, ruleId: RULE_ID, status: 'active', payload: payloadFor(report, 'active'),
          eventKey, channels: targetsForConfiguration(configuration),
        });
      });
      pending = operation.catch(() => undefined);
      return operation;
    },
  };
};
