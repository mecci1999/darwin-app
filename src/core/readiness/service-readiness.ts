import { createServer, Server } from 'http';
import { Starlight } from 'typings';

type LocalBus = {
  on(eventName: string, listener: () => void): unknown;
  off?(eventName: string, listener: () => void): unknown;
  removeListener?(eventName: string, listener: () => void): unknown;
};

type RegistryServices = { list?: (options?: { onlyLocal?: boolean; onlyAvaliable?: boolean }) => Array<{ name?: unknown }> };

export type ServiceReadinessSnapshot = {
  service: string;
  ready: boolean;
  reason: 'starting' | 'transport-disconnected' | 'local-registration-missing' | 'stopping' | 'ready';
  checkedAt: number;
};

export type ServiceReadiness = {
  start(): Promise<void>;
  markStarted(): void;
  markStopping(): void;
  snapshot(): ServiceReadinessSnapshot;
  stop(): Promise<void>;
};

export type ServiceReadinessOptions = {
  serviceName: string;
  port?: number;
};

const DEFAULT_PORT = 6699;

const hasLocalServiceRegistration = (star: Starlight, serviceName: string) => {
  const services = (star.registry?.services as RegistryServices | undefined)?.list?.({
    onlyLocal: true,
    onlyAvaliable: true,
  }) || [];
  return services.some((service) => service?.name === serviceName);
};

export const createServiceReadiness = (star: Starlight, options: ServiceReadinessOptions): ServiceReadiness => {
  const serviceName = options.serviceName;
  const port = options.port ?? DEFAULT_PORT;
  const localBus = star.localBus as LocalBus | undefined;
  let applicationStarted = false;
  let transportHealthy = star.transit?.connected === true;
  let stopping = false;
  let server: Server | null = null;
  const listeners: Array<{ eventName: string; listener: () => void }> = [];

  const snapshot = (): ServiceReadinessSnapshot => {
    const checkedAt = Date.now();
    if (stopping) return { service: serviceName, ready: false, reason: 'stopping', checkedAt };
    if (!applicationStarted) return { service: serviceName, ready: false, reason: 'starting', checkedAt };
    if (!transportHealthy || star.transit?.connected !== true) {
      return { service: serviceName, ready: false, reason: 'transport-disconnected', checkedAt };
    }
    if (!hasLocalServiceRegistration(star, serviceName)) {
      return { service: serviceName, ready: false, reason: 'local-registration-missing', checkedAt };
    }
    return { service: serviceName, ready: true, reason: 'ready', checkedAt };
  };

  const subscribe = (eventName: string, listener: () => void) => {
    if (!localBus?.on) return;
    localBus.on(eventName, listener);
    listeners.push({ eventName, listener });
  };

  subscribe('$transporter.connected', () => {
    transportHealthy = true;
  });
  subscribe('$transporter.disconnected', () => {
    transportHealthy = false;
  });
  subscribe('$transporter.error', () => {
    transportHealthy = false;
  });

  return {
    async start() {
      if (server) return;
      server = createServer((request, response) => {
        if (request.url !== '/readyz') {
          response.writeHead(404);
          response.end();
          return;
        }
        const readiness = snapshot();
        response.writeHead(readiness.ready ? 200 : 503, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(readiness));
      });
      await new Promise<void>((resolve, reject) => {
        server?.once('error', reject);
        server?.listen(port, '127.0.0.1', () => {
          server?.off('error', reject);
          resolve();
        });
      });
    },
    markStarted() {
      applicationStarted = true;
    },
    markStopping() {
      stopping = true;
      transportHealthy = false;
    },
    snapshot,
    async stop() {
      this.markStopping();
      for (const { eventName, listener } of listeners) {
        if (localBus?.off) localBus.off(eventName, listener);
        else localBus?.removeListener?.(eventName, listener);
      }
      listeners.length = 0;
      if (!server) return;
      const closingServer = server;
      server = null;
      await new Promise<void>((resolve, reject) => {
        closingServer.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
};
