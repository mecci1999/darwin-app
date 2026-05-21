import { describe, expect, it } from 'vitest';
import { LogLevel, LogSource } from '../../src/apps/starlight/logs/types';
import { isAdminContext, isDarwinLogRequest, resolveLogTenantId } from '../../src/apps/starlight/logs/utils/access-control';
import { LogProcessor } from '../../src/apps/starlight/logs/utils/log-processor';

describe('Darwin log contract', () => {
  it('normalizes Darwin app logs as admin-only system logs', () => {
    const processor = new LogProcessor();
    const log = processor.normalizeLog(
      {
        message: 'Logs service started',
        level: LogLevel.INFO,
        source: LogSource.SYSTEM,
        originType: 'darwin-app',
        visibility: 'admin',
        service: 'logs',
        nodeID: 'logs-development',
        namespace: 'darwin-app',
        mod: 'logs',
        svc: 'logs',
        version: '1',
      },
      'system',
    );

    expect(log.tenantId).toBe('system');
    expect(log.originType).toBe('darwin-app');
    expect(log.visibility).toBe('admin');
    expect(log.source).toBe('system');
    expect(log.service).toBe('logs');
    expect(log.namespace).toBe('darwin-app');
  });

  it('keeps user microservice logs tenant visible by default', () => {
    const processor = new LogProcessor();
    const log = processor.normalizeLog(
      {
        message: 'User service log',
        level: LogLevel.INFO,
        service: 'checkout',
      },
      'tenant-1',
    );

    expect(log.tenantId).toBe('tenant-1');
    expect(log.originType).toBe('microservice');
    expect(log.visibility).toBe('tenant');
  });

  it('identifies Darwin log requests as system admin-only scope', () => {
    const ctx = {
      params: { originType: 'darwin-app' },
      meta: { tenantId: 'tenant-1', user: { isAdmin: false } },
    };

    expect(isDarwinLogRequest(ctx.params.originType)).toBe(true);
    expect(isAdminContext(ctx)).toBe(false);
    expect(resolveLogTenantId(ctx, 'darwin-app')).toBe('system');
  });

});
