import { Context } from 'node-universe';
import { LogOriginType } from '../types';

export const SYSTEM_LOG_TENANT_ID = 'system';

export function isDarwinLogRequest(originType?: string): originType is 'darwin-app' {
  return originType === 'darwin-app';
}

export function isAdminContext(ctx: Context): boolean {
  const meta = ctx.meta as Record<string, unknown>;
  const user = meta.user as { isAdmin?: boolean } | undefined;
  return Boolean(user?.isAdmin || meta.isAdmin);
}

export function resolveLogTenantId(ctx: Context, originType?: LogOriginType): string | undefined {
  if (originType === 'darwin-app') return SYSTEM_LOG_TENANT_ID;
  const meta = ctx.meta as Record<string, unknown>;
  const params = ctx.params as Record<string, unknown>;
  const user = meta.user as
    | { tenantId?: unknown; tenantID?: unknown; tenant_id?: unknown; userId?: unknown }
    | undefined;
  const userTenantId = user?.tenantId || user?.tenantID || user?.tenant_id || user?.userId;
  return typeof meta.tenantId === 'string'
    ? meta.tenantId
    : typeof params.tenantId === 'string'
      ? params.tenantId
      : typeof userTenantId === 'string' || typeof userTenantId === 'number'
        ? String(userTenantId)
        : undefined;
}
