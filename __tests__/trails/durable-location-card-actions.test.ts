import { HttpResponseItem, Starlight } from '../../src/typings';
import trailsActions from '../../src/apps/trails/actions';
import { InMemoryTrailsRepository } from '../../src/apps/trails/repository';
import { Actor, DurableLocationCard, DurableLocationCardStore, TrailsState } from '../../src/apps/trails/types';
import { TrailsDurableLocationCardStaleVersionError } from '../../src/apps/trails/repository/mysqlDurableLocationCard';

const owner: Actor = { tenantId: 'tenant-a', userId: 'owner-a', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const card: DurableLocationCard = { id: 'location_1', tenantId: owner.tenantId, ownerUserId: owner.userId, name: '雾岭', regionLabel: '山地地区', summary: '公开文字', status: 'draft', resourceVersion: '1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
const input = { id: card.id, mutationId: 'create_1', expectedResourceVersion: null, name: card.name, regionLabel: card.regionLabel, summary: card.summary };
const context = (params: Record<string, unknown>, actor: Actor | null = owner) => ({ params, meta: actor ? { tenantId: actor.tenantId, user: actor } : {} });
const resolver = { resolve: () => ({ tenantId: owner.tenantId, ownerUserId: owner.userId }) };
const durable = (overrides: Partial<DurableLocationCardStore> = {}): DurableLocationCardStore => ({ createDraft: jest.fn(async () => card), updateDraft: jest.fn(async () => card), publish: jest.fn(async () => ({ ...card, status: 'published' as const })), unpublish: jest.fn(async () => card), archive: jest.fn(async () => ({ ...card, status: 'archived' as const })), listWorkspace: jest.fn(async () => [card]), listPublic: jest.fn(async () => [{ ...card, status: 'published' as const }]), ...overrides });
const app = (store?: DurableLocationCardStore, publicOwnerResolver: TrailsState['publicOwnerResolver'] = resolver) => trailsActions({ emit: jest.fn() } as unknown as Starlight, { repository: new InMemoryTrailsRepository(), ...(store ? { durableLocationCardStore: store } : {}), publicOwnerResolver } as TrailsState);
type Action = 'v2.locations.workspace' | 'v2.locations.workspace.draft' | 'v2.locations.workspace.update' | 'v2.locations.workspace.publish' | 'v2.locations.workspace.unpublish' | 'v2.locations.workspace.archive' | 'v2.locations.public';
const handler = (actions: ReturnType<typeof app>, name: Action) => actions[name].handler as (context: unknown) => Promise<HttpResponseItem>;

describe('v2 durable location-card actions', () => {
  it('fails closed for missing durable storage and untrusted workspace callers', async () => {
    expect((await handler(app(), 'v2.locations.workspace')(context({}))).status).toBe(503); expect((await handler(app(), 'v2.locations.public')({ params: {}, meta: {} })).status).toBe(503);
    const store = durable(); for (const operation of ['v2.locations.workspace', 'v2.locations.workspace.draft', 'v2.locations.workspace.update', 'v2.locations.workspace.publish', 'v2.locations.workspace.unpublish', 'v2.locations.workspace.archive'] as Action[]) { expect((await handler(app(store), operation)(context({}, null))).status).toBe(401); expect((await handler(app(store), operation)(context({}, { tenantId: owner.tenantId, userId: 'participant', isAdmin: false, creatorSpaceRole: 'participant' }))).status).toBe(403); }
  });
  it('rejects every unexpected or nested draft/update field before invoking the durable store', async () => {
    const store = durable(); for (const [key, value] of Object.entries({ latitude: 30, longitude: 120, coordinates: [30, 120], geometry: { type: 'Point' }, route: 'private', directions: 'private', meeting: 'private', access: 'private', parking: 'private', capacity: 8, registration: 'private', mediaUrl: 'https://private.example', unexpected: { nested: true } })) { for (const operation of ['v2.locations.workspace.draft', 'v2.locations.workspace.update'] as Action[]) { const result = await handler(app(store), operation)(context({ ...input, expectedResourceVersion: operation.endsWith('update') ? '1' : null, [key]: value })); expect(result.status).toBe(400); } }
    expect(store.createDraft).not.toHaveBeenCalled(); expect(store.updateDraft).not.toHaveBeenCalled();
  });
  it('rejects non-enumerable and symbol own keys before params reconstruction or durable writes', async () => {
    const store = durable();
    for (const operation of ['v2.locations.workspace.draft', 'v2.locations.workspace.update'] as Action[]) {
      const nonEnumerable = { ...input, expectedResourceVersion: operation.endsWith('update') ? '1' : null };
      Object.defineProperty(nonEnumerable, 'latitude', { value: 30, enumerable: false });
      const symbolKey = { ...input, expectedResourceVersion: operation.endsWith('update') ? '1' : null };
      Object.defineProperty(symbolKey, Symbol('geometry'), { value: { coordinates: [30, 120] }, enumerable: true });
      expect((await handler(app(store), operation)(context(nonEnumerable))).status).toBe(400);
      expect((await handler(app(store), operation)(context(symbolKey))).status).toBe(400);
    }
    expect(store.createDraft).not.toHaveBeenCalled(); expect(store.updateDraft).not.toHaveBeenCalled();
  });
  it('maps stale writes to a workspace-safe current card and keeps workspace/public projections hygienic', async () => {
    const staleStore = durable({ publish: jest.fn(async () => { throw new TrailsDurableLocationCardStaleVersionError(card); }) }); const stale = await handler(app(staleStore), 'v2.locations.workspace.publish')(context({ id: card.id, mutationId: 'publish_1', expectedResourceVersion: '1' }));
    expect(stale.status).toBe(409); expect(stale.data.content).toEqual({ current: { id: card.id, name: card.name, regionLabel: card.regionLabel, summary: card.summary, status: 'draft', resourceVersion: '1' } });
    const store = durable(); const workspace = await handler(app(store), 'v2.locations.workspace')(context({})); const publicResult = await handler(app(store), 'v2.locations.public')({ params: { tenantId: 'spoofed' }, meta: {} });
    expect(workspace.status).toBe(200); expect(publicResult.status).toBe(200); expect(store.listPublic).toHaveBeenCalledWith({ tenantId: owner.tenantId, userId: owner.userId });
    for (const value of [(workspace.data.content as object[])[0], (publicResult.data.content as object[])[0]]) for (const key of ['tenantId', 'ownerUserId', 'createdAt', 'updatedAt', 'publishedAt', 'archivedAt']) expect(value).not.toHaveProperty(key);
    for (const key of ['status', 'resourceVersion']) expect((publicResult.data.content as object[])[0]).not.toHaveProperty(key);
    expect((await handler(app(store, { resolve: () => undefined }), 'v2.locations.public')({ params: {}, meta: {} })).status).toBe(404);
  });
});
