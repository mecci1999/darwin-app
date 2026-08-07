import { Starlight } from '../../src/typings';
import trailsActions from '../../src/apps/starlight/trails/actions';
import { InMemoryTrailsRepository } from '../../src/apps/starlight/trails/repository';
import { Actor, DurableHike, DurableHikeStore } from '../../src/apps/starlight/trails/types';

const actor: Actor = { tenantId: 'tenant-1', userId: 'field-user-1', isAdmin: false };
const sameTenantActor: Actor = { tenantId: actor.tenantId, userId: 'field-user-2', isAdmin: true, creatorSpaceRole: 'creator-space-owner' };
const crossTenantActor: Actor = { tenantId: 'tenant-2', userId: actor.userId, isAdmin: true };
const star = { emit: jest.fn() } as unknown as Starlight;
const context = (trustedActor: Actor, params: object) => ({ meta: { tenantId: trustedActor.tenantId, user: trustedActor }, params });
const hike: DurableHike = { id: 'hike-1', tenantId: actor.tenantId, ownerUserId: actor.userId, title: 'Ridge', startedAt: '2026-07-31T00:00:00.000Z', distanceKm: 8.5, elevationGainM: 300, route: { provider: 'route-provider', externalId: 'route-1', label: 'North Ridge' }, privateGeometry: 'LINESTRING PRIVATE', visibility: 'private', lifecycle: 'draft', resourceVersion: '1', createdAt: '2026-07-31T00:00:00.000Z', updatedAt: '2026-07-31T00:00:00.000Z' };
const durable = (overrides: Partial<DurableHikeStore> = {}): DurableHikeStore => ({ create: jest.fn(async () => hike), listWorkspace: jest.fn(async () => [hike]), ...overrides });

describe('v2 durable private hike actions', () => {
  it('returns 503 without a durable store and never falls back to v1', async () => {
    const repository = new InMemoryTrailsRepository();
    const response = await trailsActions(star, { repository })['v2.hikes.create'].handler(context(actor, { title: 'Ridge' }) as never);
    expect(response.status).toBe(503);
    expect(repository.getHike('hike-1')).toBeUndefined();
  });

  it('allows an authenticated non-creator actor, creates server-owned manual route identity, and returns only the workspace projection', async () => {
    const store = durable();
    const response = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durableHikeStore: store })['v2.hikes.create'].handler(context(actor, { title: 'Ridge', startedAt: hike.startedAt, distanceKm: 8.5, elevationGainM: 300, routeLabel: 'North Ridge' }) as never);
    expect(response.status).toBe(201);
    expect(store.create).toHaveBeenCalledWith(actor, expect.objectContaining({ id: expect.stringMatching(/^hike_/), title: 'Ridge', route: { provider: 'manual', externalId: expect.stringMatching(/^hike_/), label: 'North Ridge' } }));
    expect(response.data.content).toEqual({ id: hike.id, title: hike.title, startedAt: hike.startedAt, distanceKm: hike.distanceKm, elevationGainM: hike.elevationGainM, routeLabel: hike.route.label, resourceVersion: hike.resourceVersion, createdAt: hike.createdAt, updatedAt: hike.updatedAt });
  });

  it.each(['tenantId', 'ownerUserId', 'userId', 'visibility', 'lifecycle', 'routeProvider', 'routeId', 'externalId', 'route', 'privateGeometry', 'geometry', 'coordinates', 'url', 'href', 'locator', 'objectKey'])('rejects forbidden create field %s before durable persistence', async (field) => {
    const store = durable();
    const response = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durableHikeStore: store })['v2.hikes.create'].handler(context(actor, { title: 'Ridge', startedAt: hike.startedAt, routeLabel: 'North Ridge', [field]: field === 'route' ? {} : 'blocked' }) as never);
    expect(response.status).toBe(400);
    expect(store.create).not.toHaveBeenCalled();
  });

  it('passes the trusted actor unchanged for same-tenant and cross-tenant workspace isolation', async () => {
    const store = durable({ listWorkspace: jest.fn(async (trustedActor) => trustedActor.tenantId === actor.tenantId && trustedActor.userId === actor.userId ? [hike] : []) });
    const actions = trailsActions(star, { repository: new InMemoryTrailsRepository(), durableHikeStore: store });
    const sameTenant = await actions['v2.hikes.workspace'].handler(context(sameTenantActor, {}) as never);
    const crossTenant = await actions['v2.hikes.workspace'].handler(context(crossTenantActor, {}) as never);
    expect(sameTenant.status).toBe(200);
    expect(crossTenant.status).toBe(200);
    expect(sameTenant.data.content).toEqual([]);
    expect(crossTenant.data.content).toEqual([]);
    expect(store.listWorkspace).toHaveBeenNthCalledWith(1, sameTenantActor);
    expect(store.listWorkspace).toHaveBeenNthCalledWith(2, crossTenantActor);
    expect(sameTenant.data.content).toEqual([]);
  });

  it('projects listed records without private identity, route identity, geometry, or lifecycle fields', async () => {
    const response = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durableHikeStore: durable() })['v2.hikes.workspace'].handler(context(actor, {}) as never);
    expect(response.data.content).toEqual([{ id: hike.id, title: hike.title, startedAt: hike.startedAt, distanceKm: hike.distanceKm, elevationGainM: hike.elevationGainM, routeLabel: hike.route.label, resourceVersion: hike.resourceVersion, createdAt: hike.createdAt, updatedAt: hike.updatedAt }]);
  });

  it('rejects invalid private-hike inputs and maps unexpected durable errors to the fixed 503', async () => {
    const input = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durableHikeStore: durable() })['v2.hikes.create'].handler(context(actor, { title: 'Ridge', startedAt: 'not-a-date', routeProvider: 'provider', routeId: 'id', routeLabel: 'label' }) as never);
    const unavailable = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durableHikeStore: durable({ listWorkspace: jest.fn(async () => { throw new Error('ER_ACCESS_DENIED private SQL'); }) }) })['v2.hikes.workspace'].handler(context(actor, {}) as never);
    expect(input.status).toBe(400);
    expect(unavailable.status).toBe(503);
    expect(unavailable.data.message).toBe('耐久徒步记录当前不可用');
  });
});
