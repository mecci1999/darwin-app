import { Starlight } from 'typings';
import { GatewayRegistryDiagnosticEvent } from './registry-readiness';

type LocalBus = {
  on(eventName: string, listener: (payload: unknown) => void): unknown;
  off?(eventName: string, listener: (payload: unknown) => void): unknown;
  removeListener?(eventName: string, listener: (payload: unknown) => void): unknown;
};

type NodeEvent = {
  node?: { id?: unknown };
  reconnected?: unknown;
  unexpected?: unknown;
};

type FrameworkErrorEvent = {
  type?: unknown;
  module?: unknown;
};

const DIAGNOSTIC_COOLDOWN_MS = 30_000;
const MAX_SERVICE_NAME_LENGTH = 96;

const normalizeReason = (value: unknown) => {
  const normalized = String(value || 'unknown').trim().toLowerCase();
  return /^[a-z0-9_.-]{1,64}$/.test(normalized) ? normalized : 'unknown';
};

const serviceFromNodeID = (nodeID: unknown) => {
  const normalized = String(nodeID || '').trim();
  const match = normalized.match(/^(.*)-(development|production|test)-[^-]+$/);
  const service = match?.[1] || normalized;
  return service.slice(0, MAX_SERVICE_NAME_LENGTH) || 'unknown';
};

export type GatewayRegistryObservability = {
  record(event: GatewayRegistryDiagnosticEvent): void;
  stop(): void;
};

export const createGatewayRegistryObservability = (star: Starlight): GatewayRegistryObservability => {
  const localBus = star.localBus as LocalBus | undefined;
  const lastLoggedAt = new Map<string, number>();
  const listeners: Array<{ eventName: string; listener: (payload: unknown) => void }> = [];

  const record = (event: GatewayRegistryDiagnosticEvent) => {
    const key = [event.kind, event.outcome || 'unknown', event.reason || 'unknown', event.service || 'gateway'].join(':');
    const now = event.occurredAt;
    const previous = lastLoggedAt.get(key) || 0;
    if (now - previous < DIAGNOSTIC_COOLDOWN_MS) return;
    lastLoggedAt.set(key, now);

    const details = {
      event: event.kind,
      outcome: event.outcome || 'unknown',
      reason: event.reason || 'unknown',
      service: event.service || 'gateway',
      missingServiceCount: event.missingServiceCount || 0,
      registeredServiceCount: event.registeredServiceCount || 0,
      durationMs: event.durationMs || 0,
      unexpected: event.unexpected === true,
    };
    if (event.outcome === 'failure' || event.kind.includes('disconnected') || event.kind.includes('error')) {
      star.logger?.warn('gateway.registry-diagnostic', details);
      return;
    }
    star.logger?.info('gateway.registry-diagnostic', details);
  };

  const subscribe = (eventName: string, listener: (payload: unknown) => void) => {
    if (!localBus?.on) return;
    localBus.on(eventName, listener);
    listeners.push({ eventName, listener });
  };

  subscribe('$node.connected', (payload) => {
    const event = payload as NodeEvent;
    if (event.reconnected !== true) return;
    record({
      kind: 'node_reconnected',
      occurredAt: Date.now(),
      outcome: 'success',
      reason: 'node_info',
      service: serviceFromNodeID(event.node?.id),
    });
  });
  subscribe('$node.disconnected', (payload) => {
    const event = payload as NodeEvent;
    if (event.unexpected !== true) return;
    record({
      kind: 'node_disconnected',
      occurredAt: Date.now(),
      outcome: 'failure',
      reason: 'heartbeat_or_transport',
      service: serviceFromNodeID(event.node?.id),
      unexpected: true,
    });
  });
  subscribe('$transporter.connected', () => {
    record({ kind: 'transporter_connected', occurredAt: Date.now(), outcome: 'success', reason: 'kafka', service: 'gateway' });
  });
  subscribe('$transporter.disconnected', () => {
    record({ kind: 'transporter_disconnected', occurredAt: Date.now(), outcome: 'failure', reason: 'kafka', service: 'gateway' });
  });
  subscribe('$transporter.error', (payload) => {
    const event = payload as FrameworkErrorEvent;
    record({ kind: 'transporter_error', occurredAt: Date.now(), outcome: 'failure', reason: normalizeReason(event.type), service: 'gateway' });
  });
  subscribe('$transit.error', (payload) => {
    const event = payload as FrameworkErrorEvent;
    record({ kind: 'transit_error', occurredAt: Date.now(), outcome: 'failure', reason: normalizeReason(event.type), service: 'gateway' });
  });

  return {
    record,
    stop() {
      for (const { eventName, listener } of listeners) {
        if (localBus?.off) localBus.off(eventName, listener);
        else localBus?.removeListener?.(eventName, listener);
      }
      listeners.length = 0;
      lastLoggedAt.clear();
    },
  };
};
