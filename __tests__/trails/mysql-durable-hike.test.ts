import { Actor } from '../../src/apps/starlight/trails/types';
import { MySqlDurableHikeRepository, DurableHikeModel } from '../../src/apps/starlight/trails/repository/mysqlDurableHike';

const actor: Actor = { tenantId: 'tenant-1', userId: 'owner-1', isAdmin: false };
const sameTenantOther: Actor = { tenantId: actor.tenantId, userId: 'owner-2', isAdmin: true };
const crossTenant: Actor = { tenantId: 'tenant-2', userId: actor.userId, isAdmin: true };

describe('MySqlDurableHikeRepository', () => {
  it('forces private draft ownership from the actor and scopes listings by both tenant and owner', async () => {
    const rows: Array<Parameters<DurableHikeModel['create']>[0]> = [];
    const model: DurableHikeModel = {
      create: jest.fn(async (row) => { rows.push(row); return row; }),
      list: jest.fn(async ({ tenantId, ownerUserId }) => rows.filter((row) => row.tenantId === tenantId && row.ownerUserId === ownerUserId)),
    };
    const repository = new MySqlDurableHikeRepository({ transaction: async (work) => work({}) }, model, () => new Date('2026-07-31T00:00:00.000Z'));
    const created = await repository.create(actor, { id: 'hike-1', title: 'Ridge', startedAt: '2026-07-30T00:00:00.000Z', route: { provider: 'provider', externalId: 'external', label: 'Ridge' }, privateGeometry: 'PRIVATE' });

    expect(created).toEqual(expect.objectContaining({ tenantId: actor.tenantId, ownerUserId: actor.userId, visibility: 'private', lifecycle: 'draft', resourceVersion: '1', privateGeometry: 'PRIVATE' }));
    expect(await repository.listWorkspace(sameTenantOther)).toEqual([]);
    expect(await repository.listWorkspace(crossTenant)).toEqual([]);
    expect(model.list).toHaveBeenNthCalledWith(1, { tenantId: actor.tenantId, ownerUserId: sameTenantOther.userId }, expect.any(Object));
    expect(model.list).toHaveBeenNthCalledWith(2, { tenantId: crossTenant.tenantId, ownerUserId: crossTenant.userId }, expect.any(Object));
  });

  it('omits SQL-null optional fields instead of converting them to zero or null', async () => {
    const createdAt = new Date('2026-07-31T00:00:00.000Z');
    const model: DurableHikeModel = {
      create: jest.fn(),
      list: jest.fn(async () => [{ id: 'hike-nullable', tenantId: actor.tenantId, ownerUserId: actor.userId, title: 'No measurements', startedAt: createdAt, distanceKm: null, elevationGainM: null, routeProvider: 'provider', routeExternalId: 'external', routeLabel: 'Label', privateGeometry: null, visibility: 'private' as const, lifecycle: 'draft' as const, resourceVersion: '1', createdAt, updatedAt: createdAt }]),
    };
    const repository = new MySqlDurableHikeRepository({ transaction: async (work) => work({}) }, model);

    const [hike] = await repository.listWorkspace(actor);

    expect(hike).not.toHaveProperty('distanceKm');
    expect(hike).not.toHaveProperty('elevationGainM');
    expect(hike).not.toHaveProperty('privateGeometry');
  });
});
