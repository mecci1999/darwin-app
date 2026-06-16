import { getLogServiceFilter } from '../../src/apps/starlight/logs/utils/log-service-filter';

describe('Log explorer read model filters', () => {
  it('does not treat the gateway route service as a log service filter', () => {
    expect(getLogServiceFilter({
      routeService: 'logs',
      service: 'logs',
      originType: 'darwin-app',
      excludeServices: ['logs'],
    })).toBeUndefined();
  });

  it('keeps explicit logService filters for Darwin log searches', () => {
    expect(getLogServiceFilter({
      routeService: 'logs',
      service: 'logs',
      logService: 'gateway',
      originType: 'darwin-app',
    })).toBe('gateway');
  });

  it('keeps non-route service filters for legacy callers', () => {
    expect(getLogServiceFilter({
      routeService: 'logs',
      service: 'auth',
      originType: 'darwin-app',
    })).toBe('auth');
  });
});
