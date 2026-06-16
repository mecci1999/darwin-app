import { instrumentServiceActions } from '../../src/apps/starlight/metrics/utils/action-metrics';

const createStar = () => ({
  emit: jest.fn<Promise<void>, [string, any]>((_eventName: string, _payload: any) => Promise.resolve()),
  logger: {
    warn: jest.fn(),
  },
});

describe('action metrics instrumentation', () => {
  it('emits count and duration metrics for successful actions', async () => {
    const star = createStar();
    const actions = instrumentServiceActions(star as any, 'auth', {
      'v1.login': {
        async handler() {
          return { status: 200, data: { success: true } };
        },
      },
    });

    await (actions['v1.login'] as any).handler({ params: {}, meta: { user: { userId: 'u-1' } } });

    expect(star.emit).toHaveBeenCalledTimes(2);
    const firstPayload = star.emit.mock.calls[0][1];
    const secondPayload = star.emit.mock.calls[1][1];
    expect(star.emit.mock.calls[0][0]).toBe('metrics.raw');
    expect(firstPayload.data).toEqual(expect.objectContaining({
      measurement: 'http_requests_total',
      tags: expect.objectContaining({
        service: 'auth',
        serviceId: 'system:auth',
        action: 'v1.login',
        status: '200',
        outcome: 'success',
      }),
      fields: { value: 1, count: 1 },
    }));
    expect(secondPayload.data).toEqual(expect.objectContaining({
      measurement: 'http_request_duration_ms',
      fields: expect.objectContaining({ duration: expect.any(Number) }),
    }));
  });

  it('marks business failure responses as error metrics', async () => {
    const star = createStar();
    const actions = instrumentServiceActions(star as any, 'user', {
      'v1.update': {
        async handler() {
          return { status: 200, data: { success: false } };
        },
      },
    });

    await (actions['v1.update'] as any).handler({ params: {}, meta: {} });

    const payload = star.emit.mock.calls[0][1];
    expect(payload.data.tags).toEqual(expect.objectContaining({
      service: 'user',
      status: '500',
      outcome: 'error',
    }));
  });

  it('emits error metrics and rethrows handler exceptions', async () => {
    const star = createStar();
    const actions = instrumentServiceActions(star as any, 'file', {
      'v1.uploadFile': {
        async handler() {
          throw new Error('upload failed');
        },
      },
    });

    await expect((actions['v1.uploadFile'] as any).handler({ params: {}, meta: {} })).rejects.toThrow('upload failed');
    const payload = star.emit.mock.calls[0][1];
    expect(payload.data.tags).toEqual(expect.objectContaining({
      service: 'file',
      status: '500',
      outcome: 'error',
    }));
  });
});
