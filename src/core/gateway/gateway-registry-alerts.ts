import type { DeliveryChannel } from 'apps/starlight/metrics-alerts/alert-outbox';
import type { GatewayRegistryDiagnosticEvent } from './registry-readiness';

type NotificationOutbox = {
  createNotificationEvent(input: {
    tenantId?: string;
    alertId: string;
    eventKey: string;
    payload: Record<string, unknown>;
    channels: Array<{ channel: DeliveryChannel; target: unknown }>;
  }): Promise<boolean>;
};

export type GatewayRegistryAlertConfiguration = {
  channels: DeliveryChannel[];
  emailRecipients: string[];
  notifyOnRecovery: boolean;
};

export type GatewayRegistryAlertAdapter = {
  record(event: GatewayRegistryDiagnosticEvent): Promise<void>;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeChannels = (value: string | undefined): DeliveryChannel[] =>
  Array.from(new Set((value || '').split(',').map(channel => channel.trim()).filter((channel): channel is DeliveryChannel => channel === 'Email' || channel === 'InApp')));

export const normalizeGatewayRegistryAlertRecipients = (value: string | undefined): string[] =>
  Array.from(new Set((value || '').split(',').map(recipient => recipient.trim().toLowerCase()).filter(recipient => EMAIL.test(recipient)))).sort();

export const gatewayRegistryAlertConfigurationFromEnvironment = (environment: NodeJS.ProcessEnv = process.env): GatewayRegistryAlertConfiguration => {
  const channels = normalizeChannels(environment.GATEWAY_REGISTRY_ALERT_CHANNELS);
  const emailRecipients = normalizeGatewayRegistryAlertRecipients(environment.GATEWAY_REGISTRY_ALERT_EMAIL_RECIPIENTS);
  return {
    channels: channels.filter(channel => channel !== 'Email' || emailRecipients.length > 0),
    emailRecipients,
    notifyOnRecovery: environment.GATEWAY_REGISTRY_ALERT_NOTIFY_ON_RECOVERY !== 'false',
  };
};

const targetsForConfiguration = (configuration: GatewayRegistryAlertConfiguration): Array<{ channel: DeliveryChannel; target: unknown }> => {
  const targets: Array<{ channel: DeliveryChannel; target: unknown }> = [];
  for (const channel of configuration.channels) {
    if (channel === 'InApp') targets.push({ channel, target: 'in-app' });
    if (channel === 'Email') configuration.emailRecipients.forEach(target => targets.push({ channel, target }));
  }
  return targets;
};

const messageForEvent = (event: GatewayRegistryDiagnosticEvent, status: 'active' | 'resolved') => {
  const reason = event.reason || 'unknown';
  const missingServices = event.missingServiceCount || 0;
  return status === 'active'
    ? `服务注册表异常：${missingServices} 个必需服务未注册（原因：${reason}）`
    : '服务注册表已恢复，所有必需服务均已重新注册。';
};

export const createGatewayRegistryAlertAdapter = (
  outbox: NotificationOutbox,
  configuration = gatewayRegistryAlertConfigurationFromEnvironment(),
): GatewayRegistryAlertAdapter => {
  let activeGeneration: number | null = null;
  let active = false;
  let pending = Promise.resolve();

  return {
    record(event) {
      const operation = pending.then(async () => {
      if (event.kind !== 'readiness_transition') return;
      const channels = targetsForConfiguration(configuration);
      if (channels.length === 0) return;

      if (event.outcome === 'degraded') {
        if (active) return;
        active = true;
        activeGeneration = event.occurredAt;
        await outbox.createNotificationEvent({
          tenantId: 'system',
          alertId: `gateway-registry-readiness-${activeGeneration}`,
          eventKey: `opened:${activeGeneration}`,
          payload: {
            ruleId: 'gateway-registry-readiness',
            service: 'gateway',
            serviceId: 'system:gateway',
            level: 'critical',
            status: 'active',
            message: messageForEvent(event, 'active'),
            time: new Date(event.occurredAt).toISOString(),
            reason: event.reason || 'unknown',
            missingServiceCount: event.missingServiceCount || 0,
            registeredServiceCount: event.registeredServiceCount || 0,
            transportConnected: event.transportConnected === true,
          },
          channels,
        });
        return;
      }

      if (event.outcome !== 'healthy' || !active) return;
      active = false;
      if (!configuration.notifyOnRecovery) return;
      await outbox.createNotificationEvent({
        tenantId: 'system',
        alertId: `gateway-registry-readiness-${activeGeneration}`,
        eventKey: `recovered:${activeGeneration}`,
        payload: {
          ruleId: 'gateway-registry-readiness',
          service: 'gateway',
          serviceId: 'system:gateway',
          level: 'critical',
          status: 'resolved',
          message: messageForEvent(event, 'resolved'),
          time: new Date(event.occurredAt).toISOString(),
          reason: event.reason || 'unknown',
          missingServiceCount: event.missingServiceCount || 0,
          registeredServiceCount: event.registeredServiceCount || 0,
          transportConnected: event.transportConnected === true,
        },
        channels,
      });
      });
      pending = operation.catch(() => undefined);
      return operation;
    },
  };
};
