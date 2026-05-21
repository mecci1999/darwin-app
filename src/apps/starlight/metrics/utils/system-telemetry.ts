import type { Context } from 'node-universe';

export type MetricsDatasetScope = 'tenant' | 'system';

export type SystemServiceIdentity = {
  serviceId: string;
  serviceName: string;
  owner: string;
  team: string;
  env: string;
  region: string;
  runtime: string;
  tags: string[];
};

const DEFAULT_SYSTEM_SERVICE_IDENTITIES: Record<
  string,
  Omit<SystemServiceIdentity, 'serviceId' | 'serviceName'>
> = {
  gateway: {
    owner: 'Platform',
    team: 'platform',
    env: 'prod',
    region: '华东-1',
    runtime: 'nodejs',
    tags: ['system', 'darwin-app', 'edge'],
  },
  auth: {
    owner: 'Platform',
    team: 'platform',
    env: 'prod',
    region: '华东-1',
    runtime: 'nodejs',
    tags: ['system', 'darwin-app', 'auth'],
  },
  user: {
    owner: 'Platform',
    team: 'platform',
    env: 'prod',
    region: '华东-1',
    runtime: 'nodejs',
    tags: ['system', 'darwin-app', 'identity'],
  },
  file: {
    owner: 'Platform',
    team: 'platform',
    env: 'prod',
    region: '华东-1',
    runtime: 'nodejs',
    tags: ['system', 'darwin-app', 'storage'],
  },
  metrics: {
    owner: 'Observability',
    team: 'platform',
    env: 'prod',
    region: '华东-1',
    runtime: 'nodejs',
    tags: ['system', 'darwin-app', 'observability'],
  },
  'metrics-lifecycle': {
    owner: 'Observability',
    team: 'platform',
    env: 'prod',
    region: '华东-1',
    runtime: 'nodejs',
    tags: ['system', 'darwin-app', 'observability'],
  },
  'metrics-alerts': {
    owner: 'Observability',
    team: 'platform',
    env: 'prod',
    region: '华东-1',
    runtime: 'nodejs',
    tags: ['system', 'darwin-app', 'alerting'],
  },
  'metrics-compat': {
    owner: 'Observability',
    team: 'platform',
    env: 'prod',
    region: '华东-1',
    runtime: 'nodejs',
    tags: ['system', 'darwin-app', 'compat'],
  },
  logs: {
    owner: 'Observability',
    team: 'platform',
    env: 'prod',
    region: '华东-1',
    runtime: 'nodejs',
    tags: ['system', 'darwin-app', 'logs'],
  },
  subscription: {
    owner: 'Platform',
    team: 'platform',
    env: 'prod',
    region: '华东-1',
    runtime: 'nodejs',
    tags: ['system', 'darwin-app', 'billing'],
  },
  'subscription-billing': {
    owner: 'Platform',
    team: 'platform',
    env: 'prod',
    region: '华东-1',
    runtime: 'nodejs',
    tags: ['system', 'darwin-app', 'billing'],
  },
};

export const DARWIN_SYSTEM_SERVICE_NAMES = new Set(Object.keys(DEFAULT_SYSTEM_SERVICE_IDENTITIES));

export const CANONICAL_SYSTEM_METRICS_EVENT = '$metrics.snapshot';
export const LEGACY_SYSTEM_METRICS_EVENTS = [
  'metrics.report',
  'logs.metrics.report',
  'metrics-compat.report',
  'subscription.metrics',
];
export const SYSTEM_TENANT_ID = 'system';
export const SYSTEM_APP_KEY_ID = 'system';
export const SYSTEM_VISIBILITY_SCOPE = 'system-admin';
export const TENANT_VISIBILITY_SCOPE = 'tenant';

export const isAdminMetricsRequest = (ctx: Context | any) =>
  Boolean((ctx?.meta as any)?.user?.isAdmin || (ctx?.meta as any)?.adminMetrics);

export const normalizeMetricsScope = (value?: unknown): MetricsDatasetScope => {
  if (typeof value === 'string' && value.trim() === 'system') return 'system';
  return 'tenant';
};

export const resolveRequestedMetricsScope = (ctx: Context | any): MetricsDatasetScope => {
  const requested = normalizeMetricsScope(ctx?.params?.scope);
  if (requested === 'system' && isAdminMetricsRequest(ctx)) {
    return 'system';
  }
  return 'tenant';
};

export const assertSystemScopeAllowed = (ctx: Context | any) => {
  if (normalizeMetricsScope(ctx?.params?.scope) === 'system' && !isAdminMetricsRequest(ctx)) {
    throw new Error('system_metrics_admin_only');
  }
};

export const isDarwinSystemService = (serviceName?: string | null) => {
  if (!serviceName) return false;
  const normalized = String(serviceName).trim();
  if (!normalized) return false;
  if (DARWIN_SYSTEM_SERVICE_NAMES.has(normalized)) return true;
  return normalized.startsWith('system:');
};

export const buildSystemServiceId = (serviceName: string) => `system:${String(serviceName).trim()}`;

export const resolveSystemServiceIdentity = (serviceName: string): SystemServiceIdentity => {
  const normalized = String(serviceName || '').trim() || 'unknown';
  const base = DEFAULT_SYSTEM_SERVICE_IDENTITIES[normalized] || {
    owner: 'Platform',
    team: 'platform',
    env: 'prod',
    region: '华东-1',
    runtime: 'nodejs',
    tags: ['system', 'darwin-app'],
  };
  return {
    serviceId: buildSystemServiceId(normalized),
    serviceName: normalized,
    ...base,
  };
};

export const filterServicesByScope = <T extends { id?: string; name?: string }>(
  services: T[],
  scope: MetricsDatasetScope,
) => {
  if (scope === 'system') {
    return services.filter(
      (service) => isDarwinSystemService(service.id) || isDarwinSystemService(service.name),
    );
  }
  return services.filter(
    (service) => !isDarwinSystemService(service.id) && !isDarwinSystemService(service.name),
  );
};
