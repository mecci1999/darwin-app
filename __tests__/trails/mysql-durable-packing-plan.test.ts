import { Actor } from '../../src/apps/trails/types';
import { DurablePackingPlanModels, MySqlDurablePackingPlanRepository, TrailsDurablePackingPlanStaleVersionError } from '../../src/apps/trails/repository/mysqlDurablePackingPlan';

type PlanRow = Parameters<DurablePackingPlanModels['createPlan']>[0];
type ItemRow = Parameters<DurablePackingPlanModels['replaceItems']>[0]['items'][number];

const actor: Actor = { tenantId: 'tenant-1', userId: 'owner-1', isAdmin: false };
const other: Actor = { tenantId: actor.tenantId, userId: 'owner-2', isAdmin: true };
const timestamp = new Date('2026-07-31T00:00:00.000Z');
const gear = (id: string, overrides: Partial<{ ownerUserId: string; weightGrams: number; active: boolean }> = {}) => ({ id, tenantId: actor.tenantId, ownerUserId: actor.userId, name: id, weightGrams: 1000, quantity: 1, active: true, visibility: 'private' as const, lifecycle: 'draft' as const, resourceVersion: '1', createdAt: timestamp, updatedAt: timestamp, ...overrides });

describe('MySqlDurablePackingPlanRepository', () => {
  it('creates direct-owner private plans with ordered immutable gear snapshots and rejects inactive/cross-owner selections', async () => {
    const plans: PlanRow[] = [];
    const items: ItemRow[] = [];
    const models: DurablePackingPlanModels = {
      createPlan: jest.fn(async (created) => { plans.push(created); return created; }),
      findPlan: jest.fn(async ({ id }) => plans.find((current) => current.id === id)),
      listPlans: jest.fn(async ({ ownerUserId }) => plans.filter((current) => current.ownerUserId === ownerUserId)),
      listItems: jest.fn(async ({ planIds }) => items.filter((current) => planIds.includes(current.planId))),
      lockGear: jest.fn(async ({ ownerUserId, ids }) => ids.flatMap((gearId) => gearId === 'other' || ownerUserId !== actor.userId ? [] : [gearId === 'inactive' ? gear(gearId, { active: false }) : gear(gearId, { weightGrams: gearId === 'gear-2' ? 2000 : 1000 })])),
      replaceItems: jest.fn(async ({ planId, items: next }) => { const remaining = items.filter((current) => current.planId !== planId); items.splice(0, items.length, ...remaining, ...next); }),
      compareAndSwapPlan: jest.fn(),
    };
    const repository = new MySqlDurablePackingPlanRepository({ transaction: async (work) => work({}) }, models, () => timestamp);
    const created = await repository.create(actor, { id: 'plan-1', name: 'Overnight', gearIds: ['gear-2', 'gear-1'] });
    expect(created).toEqual(expect.objectContaining({ visibility: 'private', lifecycle: 'draft', resourceVersion: '1', snapshotWeightGrams: 3000, items: [{ gearId: 'gear-2', snapshotWeightGrams: 2000, sortOrder: 0 }, { gearId: 'gear-1', snapshotWeightGrams: 1000, sortOrder: 1 }] }));
    await expect(repository.create(actor, { id: 'bad', name: 'Bad', gearIds: ['inactive'] })).rejects.toThrow('装备已停用');
    await expect(repository.create(actor, { id: 'bad', name: 'Bad', gearIds: ['other'] })).rejects.toThrow('装备不存在');
    expect(models.lockGear).toHaveBeenCalledWith({ tenantId: actor.tenantId, ownerUserId: actor.userId, ids: ['gear-1', 'gear-2'] }, expect.any(Object));
  });

  it('captures one unit weight per unique selected Gear despite inventory quantity, and retains snapshots after later changes', async () => {
    const plans: PlanRow[] = [];
    const items: ItemRow[] = [];
    const gearRows = new Map([['gear-1', gear('gear-1', { weightGrams: 500 })]]);
    const models: DurablePackingPlanModels = {
      createPlan: jest.fn(async created => { plans.push(created); return created; }), findPlan: jest.fn(), listPlans: jest.fn(async () => plans), listItems: jest.fn(async () => items),
      lockGear: jest.fn(async ({ ids }) => ids.flatMap(id => gearRows.get(id) ? [gearRows.get(id)!] : [])), replaceItems: jest.fn(async ({ items: next }) => { items.splice(0, items.length, ...next); }), compareAndSwapPlan: jest.fn(),
    };
    const repository = new MySqlDurablePackingPlanRepository({ transaction: async work => work({}) }, models, () => timestamp);
    const created = await repository.create(actor, { id: 'plan-1', name: 'One unit', gearIds: ['gear-1'] });
    expect(created.snapshotWeightGrams).toBe(500); expect(created.items).toEqual([{ gearId: 'gear-1', snapshotWeightGrams: 500, sortOrder: 0 }]);
    await expect(repository.create(actor, { id: 'duplicate', name: 'No duplicate', gearIds: ['gear-1', 'gear-1'] })).rejects.toThrow('gearIds不能包含重复装备');
    gearRows.set('gear-1', { ...gearRows.get('gear-1')!, weightGrams: 900, quantity: 3, active: false });
    expect(await repository.listWorkspace(actor)).toEqual([expect.objectContaining({ snapshotWeightGrams: 500, items: [{ gearId: 'gear-1', snapshotWeightGrams: 500, sortOrder: 0 }] })]);
    await expect(repository.create(actor, { id: 'inactive', name: 'Inactive', gearIds: ['gear-1'] })).rejects.toThrow('装备已停用');
  });

  it('uses canonical CAS and full item replacement atomically, retaining prior snapshots despite later gear deactivation', async () => {
    const plans: PlanRow[] = [{ id: 'plan-1', tenantId: actor.tenantId, ownerUserId: actor.userId, name: 'Old', visibility: 'private', lifecycle: 'draft', resourceVersion: '1', createdAt: timestamp, updatedAt: timestamp }];
    const items: ItemRow[] = [{ tenantId: actor.tenantId, planId: 'plan-1', gearId: 'old', snapshotWeightGrams: 500, sortOrder: 0, createdAt: timestamp, updatedAt: timestamp }];
    const models: DurablePackingPlanModels = {
      createPlan: jest.fn(), findPlan: jest.fn(async () => plans[0]), listPlans: jest.fn(async ({ ownerUserId }) => ownerUserId === actor.userId ? plans : []), listItems: jest.fn(async () => items), lockGear: jest.fn(async ({ ids }) => ids.map((id) => gear(id, { weightGrams: 700 }))), replaceItems: jest.fn(async ({ items: next }) => { items.splice(0, items.length, ...next); }), compareAndSwapPlan: jest.fn(async ({ expectedVersion, next }) => { if (plans[0].resourceVersion !== expectedVersion) return undefined; plans[0] = next; return next; }),
    };
    const repository = new MySqlDurablePackingPlanRepository({ transaction: async (work) => work({}) }, models, () => timestamp);
    const updated = await repository.update(actor, { id: 'plan-1', resourceVersion: '1', name: 'New', gearIds: ['fresh'] });
    expect(updated).toEqual(expect.objectContaining({ name: 'New', resourceVersion: '2', snapshotWeightGrams: 700 }));
    await expect(repository.update(actor, { id: 'plan-1', resourceVersion: '1', name: 'Stale', gearIds: ['fresh'] })).rejects.toBeInstanceOf(TrailsDurablePackingPlanStaleVersionError);
    expect(await repository.listWorkspace(actor)).toEqual([expect.objectContaining({ snapshotWeightGrams: 700, items: [expect.objectContaining({ gearId: 'fresh' })] })]);
    expect(await repository.listWorkspace(other)).toEqual([]);
  });

  it('rejects invalid selection/version and stops before changing parent or items at the unsigned BIGINT ceiling', async () => {
    const models: DurablePackingPlanModels = { createPlan: jest.fn(), findPlan: jest.fn(async () => ({ id: 'plan', tenantId: actor.tenantId, ownerUserId: actor.userId, name: 'Plan', visibility: 'private' as const, lifecycle: 'draft' as const, resourceVersion: '18446744073709551615', createdAt: timestamp, updatedAt: timestamp })), listPlans: jest.fn(async () => []), listItems: jest.fn(async () => []), lockGear: jest.fn(), replaceItems: jest.fn(), compareAndSwapPlan: jest.fn() };
    const repository = new MySqlDurablePackingPlanRepository({ transaction: async (work) => work({}) }, models, () => timestamp);
    await expect(repository.create(actor, { id: 'bad', name: 'Bad', gearIds: [] })).rejects.toThrow('gearIds必须是1至100项数组');
    await expect(repository.update(actor, { id: 'plan', resourceVersion: '18446744073709551615', name: 'Plan', gearIds: ['gear'] })).rejects.toThrow('装包方案版本已达到存储上限');
    expect(models.lockGear).not.toHaveBeenCalled(); expect(models.replaceItems).not.toHaveBeenCalled();
  });
});
