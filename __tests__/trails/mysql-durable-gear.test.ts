import { Actor, DurableGearItem } from '../../src/apps/trails/types';
import { DurableGearModel, MySqlDurableGearRepository, TrailsDurableGearStaleVersionError } from '../../src/apps/trails/repository/mysqlDurableGear';

const actor: Actor = { tenantId: 'tenant-1', userId: 'owner-1', isAdmin: false };
const sameTenantAdmin: Actor = { tenantId: actor.tenantId, userId: 'owner-2', isAdmin: true, creatorSpaceRole: 'creator-space-owner' };
const crossTenant: Actor = { tenantId: 'tenant-2', userId: actor.userId, isAdmin: true };
const timestamp = new Date('2026-07-31T00:00:00.000Z');
const row = (overrides: Partial<Parameters<DurableGearModel['create']>[0]> = {}): Parameters<DurableGearModel['create']>[0] => ({ id: 'gear-1', tenantId: actor.tenantId, ownerUserId: actor.userId, name: 'Pack', weightGrams: 1000, quantity: 1, active: true, visibility: 'private', lifecycle: 'draft', resourceVersion: '1', createdAt: timestamp, updatedAt: timestamp, ...overrides });

describe('MySqlDurableGearRepository', () => {
  it('forces direct actor ownership/private lifecycle and includes inactive history only for the exact actor', async () => {
    const rows: Array<Parameters<DurableGearModel['create']>[0]> = [];
    const model: DurableGearModel = {
      create: jest.fn(async (created) => { rows.push(created); return created; }),
      find: jest.fn(async ({ tenantId, id }) => rows.find((item) => item.tenantId === tenantId && item.id === id)),
      list: jest.fn(async ({ tenantId, ownerUserId }) => rows.filter((item) => item.tenantId === tenantId && item.ownerUserId === ownerUserId)),
      compareAndSwap: jest.fn(async ({ next }) => next),
    };
    const repository = new MySqlDurableGearRepository({ transaction: async (work) => work({}) }, model, () => timestamp);
    const created = await repository.create(actor, { id: 'gear-1', name: 'Pack', weightGrams: 0, quantity: 2 });
    rows.push(row({ id: 'gear-inactive', active: false }));

    expect(created).toEqual(expect.objectContaining({ tenantId: actor.tenantId, ownerUserId: actor.userId, active: true, visibility: 'private', lifecycle: 'draft', resourceVersion: '1' }));
    expect((await repository.listWorkspace(actor)).map((item) => item.id)).toEqual(['gear-1', 'gear-inactive']);
    expect(await repository.listWorkspace(sameTenantAdmin)).toEqual([]);
    expect(await repository.listWorkspace(crossTenant)).toEqual([]);
  });

  it('updates with a canonical CAS version and deactivates once while rejecting stale or inactive mutations', async () => {
    const rows = [row()];
    const model: DurableGearModel = {
      create: jest.fn(),
      find: jest.fn(async ({ tenantId, id }) => rows.find((item) => item.tenantId === tenantId && item.id === id)),
      list: jest.fn(async () => rows),
      compareAndSwap: jest.fn(async ({ expectedVersion, next }) => {
        const index = rows.findIndex((item) => item.resourceVersion === expectedVersion);
        if (index === -1) return undefined;
        rows[index] = next;
        return next;
      }),
    };
    const repository = new MySqlDurableGearRepository({ transaction: async (work) => work({}) }, model, () => timestamp);
    const updated = await repository.update(actor, { id: 'gear-1', resourceVersion: '1', name: 'Tent', weightGrams: 1200, quantity: 3 });
    const deactivated = await repository.deactivate(actor, { id: 'gear-1', resourceVersion: '2' });

    expect(updated).toEqual(expect.objectContaining({ name: 'Tent', resourceVersion: '2' }));
    expect(deactivated).toEqual(expect.objectContaining({ active: false, resourceVersion: '3' }));
    await expect(repository.update(actor, { id: 'gear-1', resourceVersion: '2', name: 'Tent', weightGrams: 1200, quantity: 3 })).rejects.toThrow('装备版本已过期');
    await expect(repository.deactivate(actor, { id: 'gear-1', resourceVersion: '3' })).rejects.toThrow('装备已停用');
    await expect(repository.update(actor, { id: 'gear-1', resourceVersion: 3 as never, name: 'Tent', weightGrams: 1200, quantity: 3 })).rejects.toThrow('resourceVersion必须是规范十进制字符串');
    expect(TrailsDurableGearStaleVersionError).toBeDefined();
  });

  it('rejects invalid quantities and the unsigned BIGINT ceiling without persisting a mutation', async () => {
    const ceiling = '18446744073709551615';
    const model: DurableGearModel = {
      create: jest.fn(),
      find: jest.fn(async () => row({ resourceVersion: ceiling })),
      list: jest.fn(async () => []),
      compareAndSwap: jest.fn(),
    };
    const repository = new MySqlDurableGearRepository({ transaction: async (work) => work({}) }, model, () => timestamp);

    await expect(repository.create(actor, { id: 'bad', name: 'Bad', weightGrams: 1, quantity: 0 })).rejects.toThrow('quantity必须是1至1000000的整数');
    await expect(repository.deactivate(actor, { id: 'gear-1', resourceVersion: ceiling })).rejects.toThrow('装备版本已达到存储上限');
    expect(model.compareAndSwap).not.toHaveBeenCalled();
  });
});
