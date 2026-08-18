import trailsActions from '../../src/apps/trails/actions';
import { InMemoryTrailsRepository } from '../../src/apps/trails/repository';
import { DurableAnalyticsStore, TrailsState } from '../../src/apps/trails/types';
import { Starlight } from '../../src/typings';

const owner = { tenantId: 'tenant-public', ownerUserId: 'owner-public' };
const event = {
  eventId: '6f9619ff-8b86-4011-b42d-00c04fc964ff',
  eventName: 'page-view',
  contentType: 'site',
  occurredAt: '2026-08-17T00:00:00.000Z',
  visitorId: 'visitor-opaque-1',
  acquisitionChannel: 'direct',
  deviceClass: 'desktop',
};

const analytics = (): DurableAnalyticsStore => ({
  ingest: jest.fn(async () => undefined),
  readWorkspace: jest.fn(async () => ({
    enabled: true,
    range: { from: '2026-08-17', to: '2026-08-17' },
    totals: { pageViews: 0, visitors: 0, contentViews: 0, outboundClicks: 0 },
    trend: [],
    topContent: [],
    acquisition: [],
    devices: [],
    unavailableDomains: ['trip-registration', 'revenue'] as Array<'trip-registration' | 'revenue'>,
  })),
  readContentMetrics: jest.fn(async () => ({ range: { from: '2026-08-17', to: '2026-08-17' }, metrics: [] })),
});

const state = (store: DurableAnalyticsStore): TrailsState => ({
  repository: new InMemoryTrailsRepository(),
  durableAnalyticsStore: store,
  publicOwnerResolver: { resolve: () => owner },
});

describe('Trails public analytics actions', () => {
  it('removes gateway route metadata and records the configured public-site owner', async () => {
    const store = analytics();
    const action = trailsActions({ emit: jest.fn() } as unknown as Starlight, state(store))['v2.analytics.ingest'];
    const response = await action.handler({
      meta: {},
      params: {
        ...event,
        routeService: 'trails',
        service: 'trails',
        version: 'v2',
        action: 'analytics/ingest',
        meta: { req: { method: 'POST' } },
      },
    } as never);

    expect(response.status).toBe(200);
    expect(store.ingest).toHaveBeenCalledWith(
      { tenantId: owner.tenantId, userId: owner.ownerUserId },
      event,
    );
  });

  it('fails closed when no public-site owner is configured', async () => {
    const store = analytics();
    const actions = trailsActions({ emit: jest.fn() } as unknown as Starlight, {
      ...state(store),
      publicOwnerResolver: { resolve: () => undefined },
    });
    const response = await actions['v2.analytics.ingest'].handler({ meta: {}, params: event } as never);

    expect(response.status).toBe(404);
    expect(store.ingest).not.toHaveBeenCalled();
  });
});
