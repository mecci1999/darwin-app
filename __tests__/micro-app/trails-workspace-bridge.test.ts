import microAppActions from '../../src/apps/starlight/micro-app/actions';
import { createHmac } from 'crypto';

const app = { appId: 'starlight-trails-workspace', status: 'active', visibility: 'public' };
const version = {
  appId: app.appId,
  version: '1.0.1',
  status: 'published',
  manifestJson: JSON.stringify({ appId: app.appId, version: '1.0.1', permissions: { starlightApiScopes: ['untrusted.scope'] } }),
  packageSha256: 'package-hash',
};

const canonicalUser = { userId: 'creator-trusted', tenantId: 'tenant-canonical', status: 'active', power: 0 };
const canonicalOwnerMembership = { tenantId: 'tenant-canonical', userId: 'creator-trusted', role: 'creator-space-owner', status: 'active' };

const createActions = (options: {
  user?: Record<string, unknown> | null;
  membership?: Record<string, unknown> | null;
  owner?: Record<string, unknown> | null;
  ownerMembership?: Record<string, unknown> | null;
} = {}) => {
  const consumed = new Set<string>();
  const cacher = {
    setIfNotExists: jest.fn(async (key: string) => {
      if (consumed.has(key)) return false;
      consumed.add(key);
      return true;
    }),
  };
  const star = {
    cacher,
    db: {
      microApp: {
        findMicroAppByAppId: jest.fn(async () => app),
        findMicroAppVersion: jest.fn(async (_appId: string, requestedVersion: string) => ({ ...version, version: requestedVersion })),
        findLatestPublishedVersion: jest.fn(async () => version),
        upsertMicroAppInstall: jest.fn(async () => undefined),
      },
      user: {
        findUserByUserId: jest.fn(async (userId: string) => {
          if (userId === 'creator-trusted') return options.user === undefined ? canonicalUser : options.user;
          if (userId === 'assigned-owner') return options.owner === undefined ? canonicalUser : options.owner;
          return null;
        }),
      },
      creatorSpaceMembership: {
        findCreatorSpaceMembership: jest.fn(async (_tenantId: string, userId: string) => {
          if (userId === 'creator-trusted') return options.membership === undefined ? canonicalOwnerMembership : options.membership;
          if (userId === 'assigned-owner') return options.ownerMembership === undefined ? canonicalOwnerMembership : options.ownerMembership;
          return null;
        }),
      },
    },
  };
  return { actions: microAppActions(star as never), cacher };
};

const authenticatedContext = (params: Record<string, unknown>) => ({
  params,
  meta: {
    tenantId: 'tenant-ticket',
    user: {
      userId: 'creator-trusted',
      creatorSpaceRole: 'participant',
    },
  },
});

const signSession = (claims: Record<string, unknown>) => {
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${body}.${createHmac('sha256', 'bridge-test-secret').update(body).digest('base64url')}`;
};

const issueAndExchange = async () => {
  const { actions, cacher } = createActions();
  const ticketResponse = await actions['v1.runtime-ticket'].handler(authenticatedContext({ appId: app.appId, appVersion: version.version }) as never);
  const ticket = (ticketResponse.data.content as { ticket: string }).ticket;
  const sessionResponse = await actions['v1.exchange-session'].handler({ params: { ticket }, meta: {} } as never);
  return { actions, cacher, ticket, sessionResponse };
};

describe('Trails Workspace micro-app bridge', () => {
  const originalSecret = process.env.MICRO_APP_TICKET_SECRET;

  beforeEach(() => {
    process.env.MICRO_APP_TICKET_SECRET = 'bridge-test-secret';
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.MICRO_APP_TICKET_SECRET;
    else process.env.MICRO_APP_TICKET_SECRET = originalSecret;
  });

  it('uses a server grant rather than manifest permissions and dispatches only mapped Trails v2 actions with fresh canonical metadata', async () => {
    const { actions, sessionResponse } = await issueAndExchange();
    expect(sessionResponse.data.success).toBe(true);
    const sessionToken = (sessionResponse.data.content as { sessionToken: string }).sessionToken;
    const call = jest.fn(async () => ({ status: 201, data: { success: true } }));

    const response = await actions['v1.scoped-api'].handler({
      params: { sessionToken, operation: 'categories.create', payload: { slug: 'alps', nameZh: '阿尔卑斯' } },
      meta: { tenantId: 'spoofed', user: { userId: 'spoofed', isAdmin: true } },
      call,
    } as never);

    expect(response.status).toBe(201);
    expect(call).toHaveBeenCalledWith('trails.v2.categories.create', { slug: 'alps', nameZh: '阿尔卑斯' }, {
      meta: { tenantId: 'tenant-canonical', user: { userId: 'creator-trusted', isAdmin: false, power: 0 }, creatorSpaceRole: 'creator-space-owner' },
    });
  });

  it.each([
    ['media-assets.workspace-picker', 'trails.v2.media-assets.workspace-picker', 'trails.v2.media-assets.workspace-picker', {}],
    ['catalog.workspace', 'trails.v2.commerce.catalog.workspace', 'trails.v2.commerce.catalog.workspace', {}],
    ['media.create', 'trails.v2.commerce.catalog.media.create', 'trails.v2.commerce.catalog.media.create', { assetId: 'asset_1', title: 'Night', summary: 'Sky', mutationId: 'media_create_1', expectedResourceVersion: null }],
    ['media.transition', 'trails.v2.commerce.catalog.media.transition', 'trails.v2.commerce.catalog.media.transition', { id: 'media_1', status: 'published', mutationId: 'media_publish_1', expectedResourceVersion: '1' }],
    ['editions.create', 'trails.v2.commerce.catalog.editions.create', 'trails.v2.commerce.catalog.editions.create', { mediaId: 'media_1', title: 'Paper', description: 'Fine', mutationId: 'edition_create_1', expectedResourceVersion: null }],
    ['editions.transition', 'trails.v2.commerce.catalog.editions.transition', 'trails.v2.commerce.catalog.editions.transition', { id: 'edition_1', status: 'sellable', mutationId: 'edition_sellable_1', expectedResourceVersion: '1' }],
    ['portfolios.rich-document.read', 'trails.v2.portfolios.rich-document.read', 'trails.v2.portfolios.rich-document.read', { id: 'portfolio-1' }],
    ['portfolios.rich-document.save', 'trails.v2.portfolios.rich-document.save', 'trails.v2.portfolios.rich-document.save', { id: 'portfolio-1', baseRevision: '0', document: { type: 'doc' } }],
    ['portfolios.rich-document.preview', 'trails.v2.portfolios.rich-document.preview', 'trails.v2.portfolios.rich-document.preview', { id: 'portfolio-1', document: { type: 'doc' } }],
    ['journals.rich-document.read', 'trails.v2.journals.rich-document.read', 'trails.v2.journals.rich-document.read', { id: 'journal-1' }],
    ['journals.rich-document.save', 'trails.v2.journals.rich-document.save', 'trails.v2.journals.rich-document.save', { id: 'journal-1', baseRevision: '0', document: { type: 'doc' } }],
    ['journals.rich-document.preview', 'trails.v2.journals.rich-document.preview', 'trails.v2.journals.rich-document.preview', { id: 'journal-1', document: { type: 'doc' } }],
    ['journals.pin', 'trails.v2.journals.pin', 'trails.v2.journals.pin', { id: 'journal-1', resourceVersion: '1', isPinned: true }],
    ['site-content.workspace', 'trails.v2.site-content.workspace', 'trails.v2.site-content.workspace', {}],
    ['site-content.draft', 'trails.v2.site-content.draft', 'trails.v2.site-content.draft', { displayName: 'StarLight', biography: { plainText: 'Quiet work.' }, contactLinks: [], licensingCopy: 'Rights reserved.', seo: { title: 'StarLight', description: 'Field work.' }, resourceVersion: '1' }],
    ['site-content.publish', 'trails.v2.site-content.publish', 'trails.v2.site-content.publish', { resourceVersion: '1' }],
    ['site-content.unpublish', 'trails.v2.site-content.unpublish', 'trails.v2.site-content.unpublish', { resourceVersion: '1' }],
    ['trips.workspace', 'trails.v2.trips.workspace', 'trails.v2.trips.workspace', {}],
    ['trips.draft', 'trails.v2.trips.workspace.draft', 'trails.v2.trips.workspace.draft', { id: 'trip_1', mutationId: 'create_1', expectedResourceVersion: null, title: '晨雾', summary: '文字计划', locationLabel: '山地地区', startsOn: '2026-08-10', endsOn: '2026-08-12', itinerary: [], checklist: [], materialReferences: [] }],
    ['trips.update', 'trails.v2.trips.workspace.update', 'trails.v2.trips.workspace.update', { id: 'trip_1', mutationId: 'update_1', expectedResourceVersion: '1', title: '晨雾', summary: '文字计划', locationLabel: '山地地区', startsOn: '2026-08-10', endsOn: '2026-08-12', itinerary: [], checklist: [], materialReferences: [] }],
    ['trips.publish', 'trails.v2.trips.workspace.publish', 'trails.v2.trips.workspace.publish', { id: 'trip_1', mutationId: 'publish_1', expectedResourceVersion: '1' }],
    ['trips.unpublish', 'trails.v2.trips.workspace.unpublish', 'trails.v2.trips.workspace.unpublish', { id: 'trip_1', mutationId: 'unpublish_1', expectedResourceVersion: '1' }],
    ['trips.cancel', 'trails.v2.trips.workspace.cancel', 'trails.v2.trips.workspace.cancel', { id: 'trip_1', mutationId: 'cancel_1', expectedResourceVersion: '1' }],
    ['comments.moderation-queue', 'trails.v2.comments.moderation-queue', 'trails.v2.comments.moderation-queue', {}],
    ['comments.moderate', 'trails.v2.comments.moderate', 'trails.v2.comments.moderate', { id: 'comment-1', status: 'approved', resourceVersion: '1' }],
    ['analytics.content-metrics', 'trails.v2.analytics.content-metrics', 'trails.v2.analytics.content-metrics', { from: '2026-08-01', to: '2026-08-05', content: { portfolioIds: ['portfolio_1'], journalIds: ['journal_1'] } }],
    ['hikes.workspace', 'trails.v2.hikes.workspace', 'trails.v2.hikes.workspace', {}],
    ['hikes.create', 'trails.v2.hikes.create', 'trails.v2.hikes.create', { title: 'Ridge', startedAt: '2026-08-01T08:00:00.000Z', distanceKm: 8.5, elevationGainM: 300, routeLabel: 'North Ridge' }],
    ['gear.workspace', 'trails.v2.gear.workspace', 'trails.v2.gear.workspace', {}],
    ['gear.create', 'trails.v2.gear.create', 'trails.v2.gear.create', { name: 'Pack', weightGrams: 1000, quantity: 1 }],
    ['gear.update', 'trails.v2.gear.update', 'trails.v2.gear.update', { id: 'gear_1', resourceVersion: '1', name: 'Pack', weightGrams: 1000, quantity: 1 }],
    ['gear.deactivate', 'trails.v2.gear.deactivate', 'trails.v2.gear.deactivate', { id: 'gear_1', resourceVersion: '1' }],
    ['finance.workspace', 'trails.v2.finance.workspace', 'trails.v2.finance.workspace', {}],
    ['finance.create', 'trails.v2.finance.create', 'trails.v2.finance.create', { occurredOn: '2026-08-01', category: 'equipment', amountCents: -1200, currency: 'CNY' }],
    ['finance.update', 'trails.v2.finance.update', 'trails.v2.finance.update', { id: 'finance_1', resourceVersion: '1', occurredOn: '2026-08-01', category: 'equipment', amountCents: -1200, currency: 'CNY' }],
    ['finance.balance.record', 'trails.v2.finance.balance.record', 'trails.v2.finance.balance.record', { balanceCents: 1234, currency: 'USD' }],
    ['finance.balance.current', 'trails.v2.finance.balance.current', 'trails.v2.finance.balance.current', {}],
    ['shooting-locations.workspace', 'trails.v2.shooting-locations.workspace', 'trails.v2.shooting-locations.workspace', {}],
    ['shooting-locations.create', 'trails.v2.shooting-locations.create', 'trails.v2.shooting-locations.create', { id: 'shoot_1', name: 'Ridge', latitude: 30.1, longitude: 120.1, notes: 'Private note', mutationId: 'create_1', expectedResourceVersion: null }],
    ['shooting-locations.update', 'trails.v2.shooting-locations.update', 'trails.v2.shooting-locations.update', { id: 'shoot_1', name: 'Ridge', latitude: 30.1, longitude: 120.1, notes: 'Private note', mutationId: 'update_1', expectedResourceVersion: '1' }],
    ['shooting-locations.archive', 'trails.v2.shooting-locations.archive', 'trails.v2.shooting-locations.archive', { id: 'shoot_1', mutationId: 'archive_1', expectedResourceVersion: '1' }],
  ])('maps %s one-to-one to its server action and scope', async (operation, action, scope, payload) => {
    const { actions, sessionResponse } = await issueAndExchange();
    const sessionToken = (sessionResponse.data.content as { sessionToken: string }).sessionToken;
    const call = jest.fn(async () => ({ status: 200, data: { success: true } }));

    const response = await actions['v1.scoped-api'].handler({ params: { sessionToken, operation, payload }, meta: {}, call } as never);

    expect(response.status).toBe(200);
    expect(call).toHaveBeenCalledWith(action, payload, expect.objectContaining({ meta: expect.objectContaining({ tenantId: 'tenant-canonical' }) }));
    expect((sessionResponse.data.content as { app: { scopes: string[] } }).app.scopes).toContain(scope);
  });

  it('grants exactly the five ordinary Finance scopes and omits retention disposal', async () => {
    const { sessionResponse } = await issueAndExchange();
    const scopes = (sessionResponse.data.content as { app: { scopes: string[] } }).app.scopes;
    expect(scopes.filter((scope) => scope.startsWith('trails.v2.finance.')).sort()).toEqual([
      'trails.v2.finance.balance.current', 'trails.v2.finance.balance.record', 'trails.v2.finance.create', 'trails.v2.finance.update', 'trails.v2.finance.workspace',
    ]);
    expect(scopes).not.toContain('trails.v2.finance.dispose-retained');
  });

  it('rejects ticket replay through the atomic cacher', async () => {
    const { actions, ticket, cacher } = await issueAndExchange();
    const replay = await actions['v1.exchange-session'].handler({ params: { ticket }, meta: {} } as never);

    expect(replay.status).toBe(401);
    expect(cacher.setIfNotExists).toHaveBeenCalledTimes(2);
  });

  it('rejects an expired runtime ticket before attempting an exchange', async () => {
    const { actions, cacher } = createActions();
    const expiredTicket = signSession({ appId: app.appId, version: version.version, aud: 'darwin:micro-app:trails-workspace', jti: 'expired-jti', tenantId: 'tenant-ticket', userId: 'creator-trusted', scopes: [], exp: Date.now() - 1 });
    const response = await actions['v1.exchange-session'].handler({ params: { ticket: expiredTicket }, meta: {} } as never);

    expect(response.status).toBe(401);
    expect(cacher.setIfNotExists).not.toHaveBeenCalled();
  });

  it('rejects the exact app when its version is not in the server-owned grant registry', async () => {
    const { actions } = createActions();
    const response = await actions['v1.runtime-ticket'].handler(authenticatedContext({ appId: app.appId, appVersion: '2.0.0' }) as never);

    expect(response.status).toBe(403);
  });

  it.each([
    ['unknown operation', { operation: 'hikes.delete', payload: {} }],
    ['broad owner commerce operation', { operation: 'commerce.owner.workspace', payload: {} }],
    ['forbidden top-level identity field', { operation: 'portfolios.draft', payload: { tenantId: 'attacker', title: 'x' } }],
    ['forbidden nested identity field', { operation: 'categories.reorder', payload: { items: [{ id: 'one', ownerUserId: 'attacker' }] } }],
    ['forbidden identity field in a media picker request', { operation: 'media-assets.workspace-picker', payload: { filters: [{ creatorSpaceOwnerUserId: 'attacker' }] } }],
    ['forbidden nested identity field in a rich document request', { operation: 'portfolios.rich-document.save', payload: { id: 'portfolio-1', baseRevision: '0', document: { type: 'doc', content: [{ type: 'paragraph', attrs: { tenantId: 'attacker' } }] } } }],
    ['forbidden identity field in a trip request', { operation: 'trips.draft', payload: { id: 'trip_1', tenantId: 'attacker' } }],
    ['forbidden identity field in a Gear request', { operation: 'gear.create', payload: { name: 'Pack', weightGrams: 1000, quantity: 1, ownerUserId: 'attacker' } }],
    ['retention disposal operation', { operation: 'finance.dispose-retained', payload: {} }],
    ['shooting location route payload', { operation: 'shooting-locations.create', payload: { id: 'shoot_1', name: 'Ridge', latitude: 30.1, longitude: 120.1, mutationId: 'create_1', expectedResourceVersion: null, route: 'secret' } }],
    ['content metrics foreign field', { operation: 'analytics.content-metrics', payload: { from: '2026-08-01', to: '2026-08-05', content: { portfolioIds: ['portfolio_1'], journalIds: [] }, ownerUserId: 'attacker' } }],
    ['content metrics duplicate ID', { operation: 'analytics.content-metrics', payload: { from: '2026-08-01', to: '2026-08-05', content: { portfolioIds: ['portfolio_1', 'portfolio_1'], journalIds: [] } } }],
    ['content metrics empty lists', { operation: 'analytics.content-metrics', payload: { from: '2026-08-01', to: '2026-08-05', content: { portfolioIds: [], journalIds: [] } } }],
  ])('rejects %s without calling Trails', async (_label, request) => {
    const { actions, sessionResponse } = await issueAndExchange();
    const sessionToken = (sessionResponse.data.content as { sessionToken: string }).sessionToken;
    const call = jest.fn();
    const response = await actions['v1.scoped-api'].handler({ params: { sessionToken, ...request }, meta: {}, call } as never);

    expect(response.status).toBe(403);
    expect(call).not.toHaveBeenCalled();
  });

  it.each(['tenantId', 'ownerUserId', 'userId', 'routeProvider', 'routeId', 'externalId', 'route', 'privateGeometry', 'geometry', 'coordinates', 'url', 'href', 'locator', 'objectKey'])('rejects Hikes create payload field %s before calling Trails', async (field) => {
    const { actions, sessionResponse } = await issueAndExchange();
    const sessionToken = (sessionResponse.data.content as { sessionToken: string }).sessionToken;
    const call = jest.fn();
    const response = await actions['v1.scoped-api'].handler({ params: { sessionToken, operation: 'hikes.create', payload: { title: 'Ridge', startedAt: '2026-08-01T08:00:00.000Z', routeLabel: 'North Ridge', [field]: field === 'route' ? {} : 'blocked' } }, meta: {}, call } as never);
    expect(response.status).toBe(403);
    expect(call).not.toHaveBeenCalled();
  });

  it.each([
    ['gear.workspace', {}, 'name'], ['gear.create', { name: 'Pack', weightGrams: 1000, quantity: 1 }, 'vendor'], ['gear.update', { id: 'gear_1', resourceVersion: '1', name: 'Pack', weightGrams: 1000, quantity: 1 }, 'currency'], ['gear.deactivate', { id: 'gear_1', resourceVersion: '1' }, 'restore'],
  ])('rejects extra Gear %s payload field %s before calling Trails', async (operation, payload, field) => {
    const { actions, sessionResponse } = await issueAndExchange();
    const sessionToken = (sessionResponse.data.content as { sessionToken: string }).sessionToken;
    const call = jest.fn();
    const response = await actions['v1.scoped-api'].handler({ params: { sessionToken, operation, payload: { ...payload, [field]: 'blocked' } }, meta: {}, call } as never);
    expect(response.status).toBe(403);
    expect(call).not.toHaveBeenCalled();
  });

  it.each([
    ['finance.workspace', {}, 'retentionExpiresAt'], ['finance.create', { occurredOn: '2026-08-01', category: 'equipment', amountCents: 1, currency: 'CNY' }, 'receipt'], ['finance.update', { id: 'finance_1', resourceVersion: '1', occurredOn: '2026-08-01', category: 'equipment', amountCents: 1, currency: 'CNY' }, 'payment'], ['finance.balance.record', { balanceCents: 1, currency: 'CNY' }, 'bank'], ['finance.balance.current', {}, 'export'],
  ])('rejects extra Finance %s payload field %s before calling Trails', async (operation, payload, field) => {
    const { actions, sessionResponse } = await issueAndExchange(); const sessionToken = (sessionResponse.data.content as { sessionToken: string }).sessionToken; const call = jest.fn();
    const response = await actions['v1.scoped-api'].handler({ params: { sessionToken, operation, payload: { ...payload, [field]: 'blocked' } }, meta: {}, call } as never);
    expect(response.status).toBe(403); expect(call).not.toHaveBeenCalled();
  });

  it.each([
    ['packing-plans.workspace', {}, 'unexpected'], ['packing-plans.create', { name: 'Overnight', gearIds: ['gear_1'] }, 'quantity'], ['packing-plans.create', { name: 'Overnight', gearIds: ['gear_1'] }, 'snapshotWeightGrams'], ['packing-plans.update', { id: 'plan_1', resourceVersion: '1', name: 'Overnight', gearIds: ['gear_1'] }, 'vendor'],
  ])('rejects extra Packing Plan %s payload field %s before calling Trails', async (operation, payload, field) => {
    const { actions, sessionResponse } = await issueAndExchange();
    const sessionToken = (sessionResponse.data.content as { sessionToken: string }).sessionToken;
    const call = jest.fn();
    const response = await actions['v1.scoped-api'].handler({ params: { sessionToken, operation, payload: { ...payload, [field]: 'blocked' } }, meta: {}, call } as never);
    expect(response.status).toBe(403); expect(call).not.toHaveBeenCalled();
  });

  it('rejects a signed session missing the requested Gear scope', async () => {
    const { actions } = createActions();
    const sessionToken = signSession({ kind: 'micro-app-session', appId: app.appId, version: version.version, aud: 'darwin:micro-app:trails-workspace', jti: 'gear-scope-jti', tenantId: 'tenant-ticket', userId: 'creator-trusted', scopes: ['trails.v2.gear.workspace'], exp: Date.now() + 60_000 });
    const call = jest.fn();
    const response = await actions['v1.scoped-api'].handler({ params: { sessionToken, operation: 'gear.create', payload: { name: 'Pack', weightGrams: 1000, quantity: 1 } }, meta: {}, call } as never);
    expect(response.status).toBe(403);
    expect(call).not.toHaveBeenCalled();
  });

  it('rejects a signed session missing the requested Packing Plan scope', async () => {
    const { actions } = createActions();
    const sessionToken = signSession({ kind: 'micro-app-session', appId: app.appId, version: version.version, aud: 'darwin:micro-app:trails-workspace', jti: 'packing-plan-scope-jti', tenantId: 'tenant-ticket', userId: 'creator-trusted', scopes: ['trails.v2.packing-plans.workspace'], exp: Date.now() + 60_000 });
    const call = jest.fn();
    const response = await actions['v1.scoped-api'].handler({ params: { sessionToken, operation: 'packing-plans.create', payload: { name: 'Overnight', gearIds: ['gear_1'] } }, meta: {}, call } as never);
    expect(response.status).toBe(403); expect(call).not.toHaveBeenCalled();
  });

  it('rejects a session whose signed audience is not the Trails workspace audience', async () => {
    const { actions } = createActions();
    const invalidToken = signSession({ kind: 'micro-app-session', appId: app.appId, version: version.version, aud: 'wrong-audience', jti: 'jti', tenantId: 'tenant-ticket', userId: 'creator-trusted', scopes: ['trails.v2.categories.workspace'], exp: Date.now() + 60_000 });
    const response = await actions['v1.scoped-api'].handler({ params: { sessionToken: invalidToken, operation: 'categories.workspace', payload: {} }, meta: {}, call: jest.fn() } as never);

    expect(response.status).toBe(401);
  });

  it('rejects a signed session whose scope set does not grant the requested operation', async () => {
    const { actions } = createActions();
    const narrowedToken = signSession({ kind: 'micro-app-session', appId: app.appId, version: version.version, aud: 'darwin:micro-app:trails-workspace', jti: 'scope-jti', tenantId: 'tenant-ticket', userId: 'creator-trusted', scopes: ['trails.v2.categories.workspace'], exp: Date.now() + 60_000 });
    const call = jest.fn();
    const response = await actions['v1.scoped-api'].handler({ params: { sessionToken: narrowedToken, operation: 'media-assets.workspace-picker', payload: {} }, meta: {}, call } as never);

    expect(response.status).toBe(403);
    expect(call).not.toHaveBeenCalled();
  });

  it('does not allow stale ticket tenant, role, owner, or admin claims to override canonical records', async () => {
    const { actions } = createActions({
      user: { ...canonicalUser, tenantId: 'tenant-refreshed', power: 999 },
      membership: { tenantId: 'tenant-refreshed', userId: 'creator-trusted', role: 'participant', status: 'active' },
    });
    const sessionToken = signSession({ kind: 'micro-app-session', appId: app.appId, version: version.version, aud: 'darwin:micro-app:trails-workspace', jti: 'stale-claims', tenantId: 'tenant-stale', userId: 'creator-trusted', creatorSpaceRole: 'creator-space-owner', creatorSpaceOwnerUserId: 'attacker', isAdmin: false, scopes: ['trails.v2.categories.create'], exp: Date.now() + 60_000 });
    const call = jest.fn(async () => ({ status: 201, data: { success: true } }));

    const response = await actions['v1.scoped-api'].handler({ params: { sessionToken, operation: 'categories.create', payload: { slug: 'alps', nameZh: '阿尔卑斯' } }, meta: {}, call } as never);

    expect(response.status).toBe(201);
    expect(call).toHaveBeenCalledWith('trails.v2.categories.create', expect.any(Object), {
      meta: { tenantId: 'tenant-refreshed', user: { userId: 'creator-trusted', isAdmin: true, power: 999 }, creatorSpaceRole: 'participant' },
    });
  });

  it('fails closed when the canonical creator-space membership is absent or disabled', async () => {
    for (const membership of [null, { ...canonicalOwnerMembership, status: 'disabled' }]) {
      const { actions } = createActions({ membership });
      const sessionToken = signSession({ kind: 'micro-app-session', appId: app.appId, version: version.version, aud: 'darwin:micro-app:trails-workspace', jti: `missing-${String(membership)}`, userId: 'creator-trusted', scopes: ['trails.v2.categories.create'], exp: Date.now() + 60_000 });
      const call = jest.fn();
      const response = await actions['v1.scoped-api'].handler({ params: { sessionToken, operation: 'categories.create', payload: {} }, meta: {}, call } as never);
      expect(response.status).toBe(403);
      expect(call).not.toHaveBeenCalled();
    }
  });

  it('fails closed when an editor assignment points at an owner in another tenant', async () => {
    const { actions } = createActions({
      membership: { tenantId: 'tenant-canonical', userId: 'creator-trusted', role: 'creator-space-editor', assignedOwnerUserId: 'assigned-owner', status: 'active' },
      owner: { userId: 'assigned-owner', tenantId: 'other-tenant', status: 'active', power: 0 },
    });
    const sessionToken = signSession({ kind: 'micro-app-session', appId: app.appId, version: version.version, aud: 'darwin:micro-app:trails-workspace', jti: 'cross-tenant-editor', userId: 'creator-trusted', scopes: ['trails.v2.categories.create'], exp: Date.now() + 60_000 });
    const call = jest.fn();
    const response = await actions['v1.scoped-api'].handler({ params: { sessionToken, operation: 'categories.create', payload: {} }, meta: {}, call } as never);
    expect(response.status).toBe(403);
    expect(call).not.toHaveBeenCalled();
  });

  it('preserves the signed-in actor for Hikes despite a valid creator-space editor assignment', async () => {
    const { actions } = createActions({
      membership: { tenantId: 'tenant-canonical', userId: 'creator-trusted', role: 'creator-space-editor', assignedOwnerUserId: 'assigned-owner', status: 'active' },
      owner: { userId: 'assigned-owner', tenantId: 'tenant-canonical', status: 'active', power: 0 },
      ownerMembership: { tenantId: 'tenant-canonical', userId: 'assigned-owner', role: 'creator-space-owner', status: 'active' },
    });
    const sessionToken = signSession({ kind: 'micro-app-session', appId: app.appId, version: version.version, aud: 'darwin:micro-app:trails-workspace', jti: 'hike-editor-actor', userId: 'creator-trusted', scopes: ['trails.v2.hikes.workspace'], exp: Date.now() + 60_000 });
    const call = jest.fn(async () => ({ status: 200, data: { success: true } }));
    const response = await actions['v1.scoped-api'].handler({ params: { sessionToken, operation: 'hikes.workspace', payload: {} }, meta: {}, call } as never);
    expect(response.status).toBe(200);
    expect(call).toHaveBeenCalledWith('trails.v2.hikes.workspace', {}, { meta: { tenantId: 'tenant-canonical', user: { userId: 'creator-trusted', isAdmin: false, power: 0 }, creatorSpaceRole: 'creator-space-editor', creatorSpaceOwnerUserId: 'assigned-owner' } });
  });

  it('preserves the signed-in actor for Gear despite a valid creator-space editor assignment', async () => {
    const { actions } = createActions({
      membership: { tenantId: 'tenant-canonical', userId: 'creator-trusted', role: 'creator-space-editor', assignedOwnerUserId: 'assigned-owner', status: 'active' },
      owner: { userId: 'assigned-owner', tenantId: 'tenant-canonical', status: 'active', power: 0 },
      ownerMembership: { tenantId: 'tenant-canonical', userId: 'assigned-owner', role: 'creator-space-owner', status: 'active' },
    });
    const sessionToken = signSession({ kind: 'micro-app-session', appId: app.appId, version: version.version, aud: 'darwin:micro-app:trails-workspace', jti: 'gear-editor-actor', userId: 'creator-trusted', scopes: ['trails.v2.gear.workspace'], exp: Date.now() + 60_000 });
    const call = jest.fn(async () => ({ status: 200, data: { success: true } }));
    const response = await actions['v1.scoped-api'].handler({ params: { sessionToken, operation: 'gear.workspace', payload: {} }, meta: {}, call } as never);
    expect(response.status).toBe(200);
    expect(call).toHaveBeenCalledWith('trails.v2.gear.workspace', {}, { meta: { tenantId: 'tenant-canonical', user: { userId: 'creator-trusted', isAdmin: false, power: 0 }, creatorSpaceRole: 'creator-space-editor', creatorSpaceOwnerUserId: 'assigned-owner' } });
  });

  it('preserves the signed-in actor for Packing Plans despite a valid creator-space editor assignment', async () => {
    const { actions } = createActions({
      membership: { tenantId: 'tenant-canonical', userId: 'creator-trusted', role: 'creator-space-editor', assignedOwnerUserId: 'assigned-owner', status: 'active' },
      owner: { userId: 'assigned-owner', tenantId: 'tenant-canonical', status: 'active', power: 0 },
      ownerMembership: { tenantId: 'tenant-canonical', userId: 'assigned-owner', role: 'creator-space-owner', status: 'active' },
    });
    const sessionToken = signSession({ kind: 'micro-app-session', appId: app.appId, version: version.version, aud: 'darwin:micro-app:trails-workspace', jti: 'packing-plan-editor-actor', userId: 'creator-trusted', scopes: ['trails.v2.packing-plans.workspace'], exp: Date.now() + 60_000 });
    const call = jest.fn(async () => ({ status: 200, data: { success: true } }));
    const response = await actions['v1.scoped-api'].handler({ params: { sessionToken, operation: 'packing-plans.workspace', payload: {} }, meta: {}, call } as never);
    expect(response.status).toBe(200);
    expect(call).toHaveBeenCalledWith('trails.v2.packing-plans.workspace', {}, { meta: { tenantId: 'tenant-canonical', user: { userId: 'creator-trusted', isAdmin: false, power: 0 }, creatorSpaceRole: 'creator-space-editor', creatorSpaceOwnerUserId: 'assigned-owner' } });
  });

  it('preserves the signed-in actor for Finance despite a valid creator-space editor assignment', async () => {
    const { actions } = createActions({ membership: { tenantId: 'tenant-canonical', userId: 'creator-trusted', role: 'creator-space-editor', assignedOwnerUserId: 'assigned-owner', status: 'active' }, owner: { userId: 'assigned-owner', tenantId: 'tenant-canonical', status: 'active', power: 0 }, ownerMembership: { tenantId: 'tenant-canonical', userId: 'assigned-owner', role: 'creator-space-owner', status: 'active' } });
    const sessionToken = signSession({ kind: 'micro-app-session', appId: app.appId, version: version.version, aud: 'darwin:micro-app:trails-workspace', jti: 'finance-editor-actor', userId: 'creator-trusted', scopes: ['trails.v2.finance.workspace'], exp: Date.now() + 60_000 }); const call = jest.fn(async () => ({ status: 200, data: { success: true } }));
    const response = await actions['v1.scoped-api'].handler({ params: { sessionToken, operation: 'finance.workspace', payload: {} }, meta: {}, call } as never);
    expect(response.status).toBe(200); expect(call).toHaveBeenCalledWith('trails.v2.finance.workspace', {}, { meta: { tenantId: 'tenant-canonical', user: { userId: 'creator-trusted', isAdmin: false, power: 0 }, creatorSpaceRole: 'creator-space-editor', creatorSpaceOwnerUserId: 'assigned-owner' } });
  });
});
