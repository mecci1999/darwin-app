describe('logs stream action', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetModules();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('disables action timeout for the long-lived SSE connection', () => {
    const stream = require('../../src/apps/starlight/logs/actions/stream').default;
    const actions = stream({} as any);

    expect(actions['v1.stream'].timeout).toBe(0);
  });

  it('does not treat the gateway route service as a log service filter', async () => {
    const stream = require('../../src/apps/starlight/logs/actions/stream').default;
    const star = { logger: { info: jest.fn(), error: jest.fn() } };
    const action = stream(star as any)['v1.stream'];

    const responseStream = await action.handler({
      params: {
        service: 'logs',
        originType: 'darwin-app',
      },
      meta: {
        user: { isAdmin: true },
      },
    } as any);

    expect(star.logger.info).toHaveBeenCalledWith(
      'Log stream connected',
      expect.objectContaining({ tenantId: 'system', service: undefined }),
    );
    responseStream.destroy();
  });

  it('uses explicit logService as the stream service filter', async () => {
    const stream = require('../../src/apps/starlight/logs/actions/stream').default;
    const star = { logger: { info: jest.fn(), error: jest.fn() } };
    const action = stream(star as any)['v1.stream'];

    const responseStream = await action.handler({
      params: {
        service: 'logs',
        logService: 'gateway',
        originType: 'darwin-app',
      },
      meta: {
        user: { isAdmin: true },
      },
    } as any);

    expect(star.logger.info).toHaveBeenCalledWith(
      'Log stream connected',
      expect.objectContaining({ tenantId: 'system', service: 'gateway' }),
    );
    responseStream.destroy();
  });
});
