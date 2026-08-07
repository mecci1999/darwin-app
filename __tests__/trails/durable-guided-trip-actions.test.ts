import { HttpResponseItem, Starlight } from '../../src/typings';
import trailsActions from '../../src/apps/starlight/trails/actions';
import { InMemoryTrailsRepository } from '../../src/apps/starlight/trails/repository';
import { Actor, DurableGuidedTrip, DurableGuidedTripStore, TrailsState } from '../../src/apps/starlight/trails/types';
import { TrailsDurableGuidedTripStaleVersionError } from '../../src/apps/starlight/trails/repository/mysqlDurableGuidedTrip';

const owner: Actor = { tenantId: 'tenant-a', userId: 'owner-a', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const editor: Actor = { tenantId: 'tenant-a', userId: 'editor-a', isAdmin: false, creatorSpaceRole: 'creator-space-editor', creatorSpaceOwnerUserId: owner.userId };
const star = { emit: jest.fn() } as unknown as Starlight;
const trip: DurableGuidedTrip = { id: 'trip_1', tenantId: owner.tenantId, ownerUserId: owner.userId, title: '晨雾', summary: '文字计划', locationLabel: '山地地区', startsOn: '2026-08-10', endsOn: '2026-08-12', itinerary: [{ dayLabel: '第一日', summary: '观察光线' }], checklist: ['笔记本'], materialReferences: [{ label: '阅读材料', reference: 'reading_1' }], publicContingencyMessage: '可能调整。', status: 'draft', resourceVersion: '1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
const createInput = { id: trip.id, mutationId: 'create_1', expectedResourceVersion: null, title: trip.title, summary: trip.summary, locationLabel: trip.locationLabel, startsOn: trip.startsOn, endsOn: trip.endsOn, itinerary: trip.itinerary, checklist: trip.checklist, materialReferences: trip.materialReferences, publicContingencyMessage: trip.publicContingencyMessage };
const context = (params: Record<string, unknown>, actor: Actor | null = owner) => ({ params, meta: actor ? { tenantId: actor.tenantId, user: actor } : {} });
const publicResolver = { resolve: () => ({ tenantId: owner.tenantId, ownerUserId: owner.userId }) };
const durable = (overrides: Partial<DurableGuidedTripStore> = {}): DurableGuidedTripStore => ({ createDraft: jest.fn(async () => trip), updateDraft: jest.fn(async () => trip), publish: jest.fn(async () => ({ ...trip, status: 'published' as const })), unpublish: jest.fn(async () => trip), cancel: jest.fn(async () => ({ ...trip, status: 'cancelled' as const })), listWorkspace: jest.fn(async () => [trip]), listPublic: jest.fn(async () => [{ ...trip, status: 'published' as const }]), readPublic: jest.fn(async () => ({ ...trip, status: 'published' as const })), ...overrides });
const actions = (store?: DurableGuidedTripStore, resolver: NonNullable<TrailsState['publicOwnerResolver']> = publicResolver) => trailsActions(star, { repository: new InMemoryTrailsRepository(), ...(store ? { durableGuidedTripStore: store } : {}), publicOwnerResolver: resolver } as TrailsState);
type GuidedTripAction = 'v2.trips.workspace' | 'v2.trips.workspace.draft' | 'v2.trips.workspace.update' | 'v2.trips.workspace.publish' | 'v2.trips.workspace.unpublish' | 'v2.trips.workspace.cancel' | 'v2.trips.public' | 'v2.trips.public-detail';
const handler = (value: ReturnType<typeof actions>, name: GuidedTripAction) => value[name].handler as (context: unknown) => Promise<HttpResponseItem>;

describe('v2 durable guided trip actions', () => {
  it('fails closed without durable storage and never consults the legacy repository', async () => {
    const app = trailsActions(star, { repository: new InMemoryTrailsRepository() } as TrailsState);
    expect((await handler(app, 'v2.trips.workspace')(context({}))).status).toBe(503);
    expect((await handler(app, 'v2.trips.public')({ params: {}, meta: {} })).status).toBe(503);
  });
  it('requires trusted creator-space identity for every workspace operation', async () => {
    const app = actions(durable());
    for (const operation of ['v2.trips.workspace', 'v2.trips.workspace.draft', 'v2.trips.workspace.update', 'v2.trips.workspace.publish', 'v2.trips.workspace.unpublish', 'v2.trips.workspace.cancel']) {
      expect((await handler(app, operation as GuidedTripAction)(context({}, null))).status).toBe(401);
      expect((await handler(app, operation as GuidedTripAction)(context({}, { tenantId: owner.tenantId, userId: 'participant', isAdmin: false, creatorSpaceRole: 'participant' }))).status).toBe(403);
    }
  });
  it('validates drafts before delegation, forwards trusted actors, and strips identity spoofing from projections', async () => {
    const store = durable(); const app = actions(store);
    const invalid = await handler(app, 'v2.trips.workspace.draft')(context({ ...createInput, expectedResourceVersion: '01' }));
    expect(invalid.status).toBe(400); expect(store.createDraft).not.toHaveBeenCalled();
    const saved = await handler(app, 'v2.trips.workspace.draft')(context({ ...createInput, tenantId: 'spoofed', ownerUserId: 'spoofed', status: 'published', resourceVersion: '999' }, editor));
    expect(saved.status).toBe(201); expect(store.createDraft).toHaveBeenCalledWith(editor, expect.objectContaining(createInput));
    expect(saved.data.content).toEqual(expect.objectContaining({ id: trip.id, status: 'draft', resourceVersion: '1' }));
    expect(saved.data.content).not.toHaveProperty('tenantId'); expect(saved.data.content).not.toHaveProperty('ownerUserId'); expect(saved.data.content).not.toHaveProperty('createdAt');
  });
  it('maps stale versions to a workspace-safe current record and invalid update versions to 400', async () => {
    const store = durable({ publish: jest.fn(async () => { throw new TrailsDurableGuidedTripStaleVersionError(trip); }) }); const app = actions(store);
    const stale = await handler(app, 'v2.trips.workspace.publish')(context({ id: trip.id, mutationId: 'publish_1', expectedResourceVersion: '1' }));
    expect(stale.status).toBe(409); expect(stale.data.content).toEqual({ current: expect.objectContaining({ id: trip.id, status: 'draft', resourceVersion: '1' }) }); expect((stale.data.content as { current: object }).current).not.toHaveProperty('tenantId');
    const invalid = await handler(app, 'v2.trips.workspace.update')(context({ ...createInput, expectedResourceVersion: '01' }));
    expect(invalid.status).toBe(400); expect(store.updateDraft).not.toHaveBeenCalled();
  });
  it('uses only the resolver owner for public reads and returns public-safe projections', async () => {
    const store = durable(); const app = actions(store);
    const listed = await handler(app, 'v2.trips.public')({ params: { tenantId: 'spoofed', ownerUserId: 'spoofed' }, meta: {} });
    const detail = await handler(app, 'v2.trips.public-detail')({ params: { id: trip.id, ownerUserId: 'spoofed' }, meta: {} });
    expect(listed.status).toBe(200); expect(detail.status).toBe(200); expect(store.listPublic).toHaveBeenCalledWith({ tenantId: owner.tenantId, userId: owner.userId }); expect(store.readPublic).toHaveBeenCalledWith({ tenantId: owner.tenantId, userId: owner.userId }, trip.id);
    for (const result of [(listed.data.content as object[])[0], detail.data.content]) { expect(result).toEqual(expect.objectContaining({ id: trip.id, title: trip.title })); for (const key of ['tenantId', 'ownerUserId', 'status', 'resourceVersion', 'createdAt', 'updatedAt', 'publishedAt', 'cancelledAt']) expect(result).not.toHaveProperty(key); }
    const absent = await handler(actions(store, { resolve: () => undefined }), 'v2.trips.public')({ params: {}, meta: {} });
    const missing = await handler(actions(durable({ readPublic: jest.fn(async () => undefined) })), 'v2.trips.public-detail')({ params: { id: trip.id }, meta: {} });
    expect(absent.status).toBe(404); expect(missing.status).toBe(404);
  });
});
