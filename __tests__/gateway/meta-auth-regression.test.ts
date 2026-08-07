import { prepareGatewayDispatch } from '../../src/core/gateway/dispatch-meta';

describe('gateway dispatch metadata', () => {
  it('does not allow request metadata to override authenticated user or tenant context', () => {
    const trustedMeta = {
      req: { ip: '127.0.0.1' },
      tenantId: 'tenant-trusted',
      user: { isAdmin: false, userId: 'user-trusted' },
    };
    const params = {
      meta: {
        adminMetrics: true,
        tenantId: 'tenant-attacker',
        traceLabel: 'client-request',
        user: { isAdmin: true, userId: 'user-attacker' },
      },
      metric: 'cpu.usage',
    };

    const dispatch = prepareGatewayDispatch(trustedMeta, params);

    expect(dispatch.meta).toEqual(trustedMeta);
    expect(dispatch.meta).not.toHaveProperty('adminMetrics');
    expect(dispatch.meta.tenantId).toBe('tenant-trusted');
    expect(dispatch.meta.user).toEqual({ isAdmin: false, userId: 'user-trusted' });
    expect(dispatch.params.meta).toEqual(params.meta);
  });
});
