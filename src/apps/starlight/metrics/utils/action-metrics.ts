import { Context } from 'node-universe';
import { Starlight } from 'typings';
import {
  SYSTEM_APP_KEY_ID,
  SYSTEM_TENANT_ID,
  SYSTEM_VISIBILITY_SCOPE,
  buildSystemServiceId,
  isDarwinSystemService,
  resolveSystemServiceIdentity,
} from './system-telemetry';

type ActionDefinition = {
  handler?: (ctx: Context) => Promise<unknown> | unknown;
  [key: string]: unknown;
};

type ActionDefinitionWithHandler = ActionDefinition & {
  handler: (this: unknown, ctx: Context) => Promise<unknown> | unknown;
};

const normalizeServiceName = (serviceName: string) => String(serviceName || '').trim();

const isActionDefinition = (value: unknown): value is ActionDefinitionWithHandler =>
  Boolean(value && typeof value === 'object' && typeof (value as ActionDefinition).handler === 'function');

const shouldSkipActionMetric = (serviceName: string, actionName: string, ctx: Context) =>
  serviceName === 'metrics' && actionName === 'v1.topology' && ctx.params?.type === 'observed';

const resolveStatus = (result: unknown, thrown: boolean) => {
  if (thrown) return '500';
  const response = result as { status?: unknown; data?: { success?: unknown } } | null;
  if (response?.data?.success === false) return '500';
  const status = Number(response?.status || 200);
  return Number.isFinite(status) ? String(status) : '200';
};

const emitActionMetric = (
  star: Starlight,
  params: {
    serviceName: string;
    actionName: string;
    status: string;
    durationMs: number;
    timestamp: number;
    userId?: string;
  },
) => {
  const serviceName = normalizeServiceName(params.serviceName);
  if (!serviceName || serviceName.startsWith('$')) return;

  const identity = resolveSystemServiceIdentity(serviceName);
  const serviceId = isDarwinSystemService(serviceName) ? buildSystemServiceId(serviceName) : serviceName;
  const outcome = params.status.startsWith('5') ? 'error' : 'success';
  const tags = {
    tenantId: SYSTEM_TENANT_ID,
    appKeyId: SYSTEM_APP_KEY_ID,
    visibilityScope: SYSTEM_VISIBILITY_SCOPE,
    sourceType: 'darwin-system',
    source: 'darwin-action',
    service: serviceName,
    serviceId,
    target_service: serviceName,
    targetService: serviceName,
    destination_service: serviceName,
    peer_service: serviceName,
    owner: identity.owner,
    team: identity.team,
    env: identity.env,
    region: identity.region,
    runtime: identity.runtime,
    action: params.actionName,
    route: params.actionName,
    protocol: 'darwin-action',
    'rpc.system': 'node-universe',
    method: 'ACTION',
    status: params.status,
    outcome,
    userId: params.userId || '',
  };

  const emitMetric = (measurement: string, fields: Record<string, number>) => {
    const emit = star.emit;
    if (typeof emit !== 'function') return;
    const emitResult = emit.call(star, 'metrics.raw', {
      tenantId: SYSTEM_TENANT_ID,
      data: {
        measurement,
        tags,
        fields,
        timestamp: params.timestamp,
        source: 'darwin-action',
        format: 'custom',
      },
    });
    if (!emitResult || typeof emitResult.catch !== 'function') return;
    void emitResult.catch((error: Error) => {
      star.logger?.warn('darwin.action-metrics.emit-failed', {
        service: serviceName,
        action: params.actionName,
        message: error.message,
      });
    });
  };

  emitMetric('http_requests_total', { value: 1, count: 1 });
  emitMetric('http_request_duration_ms', { value: params.durationMs, duration: params.durationMs });
};

export const instrumentServiceActions = <T extends Record<string, unknown>>(
  star: Starlight,
  serviceName: string,
  actions: T,
): T => {
  const wrappedEntries = Object.entries(actions).map(([actionName, action]) => {
    if (!isActionDefinition(action)) return [actionName, action];
    const actionWithHandler = action as ActionDefinitionWithHandler;
    const originalHandler = actionWithHandler.handler;

    return [
      actionName,
      {
        ...actionWithHandler,
        async handler(this: unknown, ctx: Context) {
          if (shouldSkipActionMetric(serviceName, actionName, ctx)) {
            return originalHandler.call(this, ctx);
          }
          const startedAt = Date.now();
          try {
            const result = await originalHandler.call(this, ctx);
            emitActionMetric(star, {
              serviceName,
              actionName,
              status: resolveStatus(result, false),
              durationMs: Date.now() - startedAt,
              timestamp: Date.now(),
              userId: String((ctx.meta as any)?.user?.userId || ctx.params?.userId || ''),
            });
            return result;
          } catch (error) {
            emitActionMetric(star, {
              serviceName,
              actionName,
              status: '500',
              durationMs: Date.now() - startedAt,
              timestamp: Date.now(),
              userId: String((ctx.meta as any)?.user?.userId || ctx.params?.userId || ''),
            });
            throw error;
          }
        },
      },
    ];
  });

  return Object.fromEntries(wrappedEntries) as T;
};
