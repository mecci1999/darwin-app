import { normalizeTrailsGatewayRequestParams, prepareGatewayDispatch, stripTrailsGatewayRouteFields } from '../../src/core/gateway/dispatch-meta';

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

  it('does not forward gateway routing or fallback identity fields to Trails', () => {
    const params = stripTrailsGatewayRouteFields({
      routeService: 'trails',
      service: 'trails',
      version: 'v5',
      action: 'field-plans/workspace',
      userId: 'user-trusted',
    });

    expect(params).toEqual({});
  });

  it.each([
    ['v5', 'field-plans/workspace'],
    ['v2', 'field-records/workspace'],
    ['v2', 'shooting-locations/workspace'],
    ['v1', 'shooting-scenes/workspace'],
    ['v2', 'trip-registrations/mine-list'],
    ['v2', 'trip-payments/workspace'],
    ['v2', 'portfolios/workspace'],
  ])('forces the parameterless Trails workspace protocol to an empty payload: %s %s', (version, action) => {
    const params = normalizeTrailsGatewayRequestParams({
      routeService: 'trails',
      service: 'trails',
      version,
      action,
      userId: 'user-trusted',
      unexpectedTransportField: 'must-not-reach-trails',
    }, version, action);

    expect(params).toEqual({});
  });

  it('strips all known route fields from the parameterless registration list request', () => {
    const params = normalizeTrailsGatewayRequestParams({
      routeService: 'trails',
      service: 'trails',
      version: 'v2',
      action: 'trip-registrations/mine-list',
      userId: 'user-trusted',
      unexpectedTransportField: 'must-not-reach-trails',
    }, 'v2', 'trip-registrations/mine-list');

    expect(params).toEqual({});
  });

  it('rebuilds the photography-knowledge workspace payload from its allowed fields only', () => {
    const params = normalizeTrailsGatewayRequestParams({
      routeService: 'trails',
      service: 'trails',
      version: 'v2',
      action: 'shooting-knowledge/workspace',
      userId: 'user-trusted',
      kind: 'note',
      cursor: 'page_cursor-2',
      unexpectedTransportField: 'must-not-reach-trails',
    }, 'v2', 'shooting-knowledge/workspace');

    expect(params).toEqual({ kind: 'note', cursor: 'page_cursor-2' });
  });

  it('rebuilds photography-knowledge mutations from their allowed fields only', () => {
    const params = normalizeTrailsGatewayRequestParams({
      routeService: 'trails',
      service: 'trails',
      version: 'v2',
      action: 'shooting-knowledge/mutate',
      userId: 'user-trusted',
      operation: 'create',
      id: 'note-1',
      kind: 'note',
      title: '晨光观察',
      body: '记录云层变化。',
      tags: ['风光'],
      scenes: [],
      pinned: false,
      mutationId: 'mutation-1',
      expectedResourceVersion: null,
      unexpectedTransportField: 'must-not-reach-trails',
    }, 'v2', 'shooting-knowledge/mutate');

    expect(params).toEqual({
      operation: 'create', id: 'note-1', kind: 'note', title: '晨光观察', body: '记录云层变化。',
      tags: ['风光'], scenes: [], pinned: false, mutationId: 'mutation-1', expectedResourceVersion: null,
    });
  });

  it.each([
    ['v1', 'weather/forecast', { latitude: 30.1, longitude: 120.2 }],
    ['v1', 'night-sky/forecast', { latitude: 30.1, longitude: 120.2, date: '2026-08-24', timeZone: 'Asia/Shanghai' }],
    ['v1', 'field-record-events/append', { id: 'event-1', fieldPlanId: 'plan-1', type: 'observation', occurredAt: '2026-08-24T00:00:00.000Z', expectedPlanResourceVersion: '1', mutationId: 'mutation-1' }],
    ['v2', 'field-records/save', { fieldPlanId: 'plan-1', mutationId: 'mutation-1', expectedResourceVersion: null }],
    ['v2', 'shooting-locations/archive', { id: 'location-1', mutationId: 'mutation-1', expectedResourceVersion: '1' }],
    ['v5', 'field-plans/archive', { id: 'plan-1', mutationId: 'mutation-1', expectedResourceVersion: '1' }],
  ])('removes an unexpected transport field from native Trails request %s %s', (version, action, body) => {
    const params = normalizeTrailsGatewayRequestParams({
      routeService: 'trails', service: 'trails', version, action, userId: 'user-trusted',
      ...body, unexpectedTransportField: 'must-not-reach-trails',
    }, version, action);

    expect(params).toEqual(body);
  });

  it('rebuilds the field-event workspace payload from its allowed plan id only', () => {
    const params = normalizeTrailsGatewayRequestParams({
      routeService: 'trails',
      service: 'trails',
      version: 'v1',
      action: 'field-record-events/workspace',
      userId: 'user-trusted',
      fieldPlanId: 'field-plan-1',
      unexpectedTransportField: 'must-not-reach-trails',
    }, 'v1', 'field-record-events/workspace');

    expect(params).toEqual({ fieldPlanId: 'field-plan-1' });
  });

  it.each([
    ['analytics/workspace', { from: '2026-08-01', to: '2026-08-31' }],
    ['operations/workspace', { from: '2026-08-01', to: '2026-08-31' }],
    ['portfolios/public', { categorySlug: 'landscape' }],
  ])('rebuilds the strict Trails payload for %s', (action, body) => {
    const params = normalizeTrailsGatewayRequestParams({
      routeService: 'trails',
      service: 'trails',
      version: 'v2',
      action,
      userId: 'user-trusted',
      meta: { traceId: 'gateway-only' },
      ...body,
      unexpectedTransportField: 'must-not-reach-trails',
    }, 'v2', action);

    expect(params).toEqual(body);
  });
});
