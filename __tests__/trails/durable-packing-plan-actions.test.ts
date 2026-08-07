import { Starlight } from '../../src/typings';
import trailsActions from '../../src/apps/starlight/trails/actions';
import { InMemoryTrailsRepository } from '../../src/apps/starlight/trails/repository';
import { Actor, DurablePackingPlan, DurablePackingPlanStore } from '../../src/apps/starlight/trails/types';
import { TrailsDurablePackingPlanStaleVersionError } from '../../src/apps/starlight/trails/repository/mysqlDurablePackingPlan';

const actor: Actor = { tenantId: 'tenant-1', userId: 'field-user-1', isAdmin: false };
const admin: Actor = { tenantId: actor.tenantId, userId: 'field-user-2', isAdmin: true, creatorSpaceRole: 'creator-space-owner' };
const star = { emit: jest.fn() } as unknown as Starlight;
const context = (trustedActor: Actor, params: object) => ({ meta: { tenantId: trustedActor.tenantId, user: trustedActor }, params });
const plan: DurablePackingPlan = { id: 'plan-1', tenantId: actor.tenantId, ownerUserId: actor.userId, name: 'Overnight', visibility: 'private', lifecycle: 'draft', resourceVersion: '1', createdAt: '2026-07-31T00:00:00.000Z', updatedAt: '2026-07-31T00:00:00.000Z', items: [{ gearId: 'gear-1', snapshotWeightGrams: 1000, sortOrder: 0 }], snapshotWeightGrams: 1000 };
const durable = (overrides: Partial<DurablePackingPlanStore> = {}): DurablePackingPlanStore => ({ create: jest.fn(async () => plan), update: jest.fn(async () => plan), listWorkspace: jest.fn(async () => [plan]), ...overrides });

describe('v2 durable private packing plan actions', () => {
  it('returns 503 with no v1 fallback and rejects spoofed server fields before the store', async () => {
    const repository = new InMemoryTrailsRepository();
    expect((await trailsActions(star, { repository })['v2.packing-plans.create'].handler(context(actor, { name: 'Overnight', gearIds: ['gear-1'] }) as never)).status).toBe(503);
    const store = durable(); const response = await trailsActions(star, { repository, durablePackingPlanStore: store })['v2.packing-plans.create'].handler(context(actor, { name: 'Overnight', gearIds: ['gear-1'], tenantId: 'spoofed', ownerUserId: 'spoofed', visibility: 'public', lifecycle: 'published', snapshotWeightGrams: 9 }) as never);
    expect(response.status).toBe(400); expect(store.create).not.toHaveBeenCalled();
  });
  it('projects workspace/create/update to the closed DTO and sends only approved store inputs', async () => {
    const store = durable(); const actions = trailsActions(star, { repository: new InMemoryTrailsRepository(), durablePackingPlanStore: store });
    const workspace = await actions['v2.packing-plans.workspace'].handler(context(actor, {}) as never);
    const created = await actions['v2.packing-plans.create'].handler(context(actor, { name: 'Overnight', gearIds: ['gear-1'] }) as never);
    const updated = await actions['v2.packing-plans.update'].handler(context(actor, { id: 'plan-1', resourceVersion: '1', name: 'New', gearIds: ['gear-1'] }) as never);
    const expected = { id: 'plan-1', name: 'Overnight', items: [{ gearId: 'gear-1', snapshotWeightGrams: 1000, sortOrder: 0 }], snapshotWeightGrams: 1000, resourceVersion: '1', createdAt: plan.createdAt, updatedAt: plan.updatedAt };
    expect(workspace.data.content).toEqual([expected]); expect(created.data.content).toEqual(expected); expect(updated.data.content).toEqual(expected);
    expect(store.create).toHaveBeenCalledWith(actor, { id: expect.stringMatching(/^packing-plan_/), name: 'Overnight', gearIds: ['gear-1'] });
    expect(store.update).toHaveBeenCalledWith(actor, { id: 'plan-1', resourceVersion: '1', name: 'New', gearIds: ['gear-1'] });
  });
  it.each([
    ['v2.packing-plans.workspace', { unexpected: true }],
    ['v2.packing-plans.create', { name: 'Overnight', gearIds: ['gear-1'], quantity: 2 }],
    ['v2.packing-plans.create', { name: 'Overnight', gearIds: ['gear-1'], url: 'https://unsafe.example' }],
    ['v2.packing-plans.update', { id: 'plan-1', resourceVersion: '1', name: 'Overnight', gearIds: ['gear-1'], currentWeightGrams: 9 }],
  ])('rejects extra %s payload fields before store invocation', async (actionName, params) => {
    const store = durable(); const actions = trailsActions(star, { repository: new InMemoryTrailsRepository(), durablePackingPlanStore: store }); const response = await actions[actionName as 'v2.packing-plans.workspace' | 'v2.packing-plans.create' | 'v2.packing-plans.update'].handler(context(actor, params) as never);
    expect(response.status).toBe(400); expect(store.create).not.toHaveBeenCalled(); expect(store.update).not.toHaveBeenCalled(); expect(store.listWorkspace).not.toHaveBeenCalled();
  });
  it('uses direct actor workspace ownership, validates input, maps stale to 409, and sanitizes persistence errors', async () => {
    const isolated = durable({ listWorkspace: jest.fn(async (trusted) => trusted.userId === actor.userId ? [plan] : []) });
    const workspace = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durablePackingPlanStore: isolated })['v2.packing-plans.workspace'].handler(context(admin, {}) as never);
    const invalid = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durablePackingPlanStore: durable() })['v2.packing-plans.update'].handler(context(actor, { id: 'plan-1', resourceVersion: 1, name: 'Plan', gearIds: ['gear-1'] }) as never);
    const stale = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durablePackingPlanStore: durable({ update: jest.fn(async () => { throw new TrailsDurablePackingPlanStaleVersionError(); }) }) })['v2.packing-plans.update'].handler(context(actor, { id: 'plan-1', resourceVersion: '1', name: 'Plan', gearIds: ['gear-1'] }) as never);
    const unavailable = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durablePackingPlanStore: durable({ create: jest.fn(async () => { throw new Error('ER_ACCESS_DENIED'); }) }) })['v2.packing-plans.create'].handler(context(actor, { name: 'Plan', gearIds: ['gear-1'] }) as never);
    expect(workspace.data.content).toEqual([]); expect(invalid.status).toBe(400); expect(stale.status).toBe(409); expect(unavailable.status).toBe(503); expect(unavailable.data.message).toBe('耐久装包方案当前不可用');
  });
});
