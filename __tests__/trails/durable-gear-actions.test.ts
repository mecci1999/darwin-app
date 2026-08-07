import { Starlight } from '../../src/typings';
import trailsActions from '../../src/apps/starlight/trails/actions';
import { InMemoryTrailsRepository } from '../../src/apps/starlight/trails/repository';
import { Actor, DurableGearItem, DurableGearStore } from '../../src/apps/starlight/trails/types';
import { TrailsDurableGearStaleVersionError } from '../../src/apps/starlight/trails/repository/mysqlDurableGear';

const actor: Actor = { tenantId: 'tenant-1', userId: 'field-user-1', isAdmin: false };
const sameTenantAdmin: Actor = { tenantId: actor.tenantId, userId: 'field-user-2', isAdmin: true, creatorSpaceRole: 'creator-space-owner' };
const star = { emit: jest.fn() } as unknown as Starlight;
const context = (trustedActor: Actor, params: object) => ({ meta: { tenantId: trustedActor.tenantId, user: trustedActor }, params });
const gear: DurableGearItem = { id: 'gear-1', tenantId: actor.tenantId, ownerUserId: actor.userId, name: 'Pack', weightGrams: 1000, quantity: 1, active: true, visibility: 'private', lifecycle: 'draft', resourceVersion: '1', createdAt: '2026-07-31T00:00:00.000Z', updatedAt: '2026-07-31T00:00:00.000Z' };
const durable = (overrides: Partial<DurableGearStore> = {}): DurableGearStore => ({ create: jest.fn(async () => gear), update: jest.fn(async () => gear), deactivate: jest.fn(async () => ({ ...gear, active: false, resourceVersion: '2' })), listWorkspace: jest.fn(async () => [gear]), ...overrides });

describe('v2 durable private gear actions', () => {
  it('rejects an unauthenticated Gear request with 401 before durable access', async () => {
    const store = durable();
    const response = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durableGearStore: store })['v2.gear.workspace'].handler({ meta: {}, params: {} } as never);
    expect(response.status).toBe(401);
    expect(store.listWorkspace).not.toHaveBeenCalled();
  });

  it('returns 503 without a durable store and never falls back to v1', async () => {
    const repository = new InMemoryTrailsRepository();
    const response = await trailsActions(star, { repository })['v2.gear.create'].handler(context(actor, { name: 'Pack', weightGrams: 1000, quantity: 1 }) as never);
    expect(response.status).toBe(503);
    expect(repository.listGear({ tenantId: actor.tenantId, ownerUserId: actor.userId })).toEqual([]);
  });

  it('uses the direct actor, rejects spoofed fields before persistence, and isolates same-tenant admins', async () => {
    const store = durable({ listWorkspace: jest.fn(async (trustedActor) => trustedActor.userId === actor.userId ? [gear] : []) });
    const actions = trailsActions(star, { repository: new InMemoryTrailsRepository(), durableGearStore: store });
    const created = await actions['v2.gear.create'].handler(context(actor, { name: 'Pack', weightGrams: 1000, quantity: 1 }) as never);
    const spoofed = await actions['v2.gear.create'].handler(context(actor, { name: 'Pack', weightGrams: 1000, quantity: 1, tenantId: 'spoofed' }) as never);
    const other = await actions['v2.gear.workspace'].handler(context(sameTenantAdmin, {}) as never);
    expect(created.status).toBe(201);
    expect(created.data.content).toEqual({ id: gear.id, name: gear.name, weightGrams: gear.weightGrams, quantity: gear.quantity, active: gear.active, resourceVersion: gear.resourceVersion, createdAt: gear.createdAt, updatedAt: gear.updatedAt });
    expect(spoofed.status).toBe(400);
    expect(store.create).toHaveBeenCalledTimes(1);
    expect(store.create).toHaveBeenCalledWith(actor, expect.objectContaining({ id: expect.stringMatching(/^gear_/), name: 'Pack', weightGrams: 1000, quantity: 1 }));
    expect(other.data.content).toEqual([]);
    expect(store.listWorkspace).toHaveBeenCalledWith(sameTenantAdmin);
  });

  it.each(['tenantId', 'ownerUserId', 'userId', 'active', 'visibility', 'lifecycle', 'creatorSpaceOwnerUserId', 'url', 'href', 'vendor', 'provider', 'purchaseUrl', 'media', 'serial', 'price', 'currency'])('rejects forbidden Gear create field %s before durable persistence', async (field) => {
    const store = durable();
    const response = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durableGearStore: store })['v2.gear.create'].handler(context(actor, { name: 'Pack', weightGrams: 1000, quantity: 1, [field]: 'blocked' }) as never);
    expect(response.status).toBe(400);
    expect(store.create).not.toHaveBeenCalled();
  });

  it('projects list, update, and deactivate results without durable metadata', async () => {
    const actions = trailsActions(star, { repository: new InMemoryTrailsRepository(), durableGearStore: durable() });
    const [listed, updated, deactivated] = await Promise.all([
      actions['v2.gear.workspace'].handler(context(actor, {}) as never),
      actions['v2.gear.update'].handler(context(actor, { id: gear.id, resourceVersion: gear.resourceVersion, name: gear.name, weightGrams: gear.weightGrams, quantity: gear.quantity }) as never),
      actions['v2.gear.deactivate'].handler(context(actor, { id: gear.id, resourceVersion: gear.resourceVersion }) as never),
    ]);
    const projected = { id: gear.id, name: gear.name, weightGrams: gear.weightGrams, quantity: gear.quantity, active: gear.active, resourceVersion: gear.resourceVersion, createdAt: gear.createdAt, updatedAt: gear.updatedAt };
    expect(listed.data.content).toEqual([projected]);
    expect(updated.data.content).toEqual(projected);
    expect(deactivated.data.content).toEqual({ ...projected, active: false, resourceVersion: '2' });
  });

  it('validates canonical versions and inventory limits, maps stale to 409, and hides storage failures behind 503', async () => {
    const invalid = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durableGearStore: durable() })['v2.gear.update'].handler(context(actor, { id: 'gear-1', resourceVersion: 1, name: 'Pack', weightGrams: 1, quantity: 1 }) as never);
    const quantity = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durableGearStore: durable() })['v2.gear.create'].handler(context(actor, { name: 'Pack', weightGrams: 1, quantity: 0 }) as never);
    const stale = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durableGearStore: durable({ update: jest.fn(async () => { throw new TrailsDurableGearStaleVersionError(); }) }) })['v2.gear.update'].handler(context(actor, { id: 'gear-1', resourceVersion: '1', name: 'Pack', weightGrams: 1, quantity: 1 }) as never);
    const unavailable = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durableGearStore: durable({ deactivate: jest.fn(async () => { throw new Error('ER_ACCESS_DENIED'); }) }) })['v2.gear.deactivate'].handler(context(actor, { id: 'gear-1', resourceVersion: '1' }) as never);
    expect(invalid.status).toBe(400);
    expect(quantity.status).toBe(400);
    expect(stale.status).toBe(409);
    expect(unavailable.status).toBe(503);
    expect(unavailable.data.message).toBe('耐久装备当前不可用');
  });
});
