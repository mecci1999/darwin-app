import { Actor } from '../../src/apps/starlight/trails/types';
import { MySqlShootingLocationRepository, ShootingLocationAuditModel, ShootingLocationModel, ShootingLocationMutationModel, TrailsShootingLocationStaleVersionError } from '../../src/apps/starlight/trails/repository/mysqlShootingLocation';

const owner: Actor = { tenantId: 'tenant-a', userId: 'owner-a', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const editor: Actor = { tenantId: owner.tenantId, userId: 'editor-a', isAdmin: false, creatorSpaceRole: 'creator-space-editor', creatorSpaceOwnerUserId: owner.userId };
const input = (mutationId: string, expectedResourceVersion: string | null = null) => ({ id: 'shoot_1', name: 'Ridge overlook', latitude: 30.123456, longitude: 120.654321, notes: 'Park after dusk.', mutationId, expectedResourceVersion });
const setup = () => {
  const records = new Map<string, any>(); const mutations = new Map<string, any>(); const audits: any[] = [];
  const locations: ShootingLocationModel = { create: async row => { records.set(`${row.tenantId}:${row.id}`, row); return row; }, find: async key => records.get(`${key.tenantId}:${key.id}`), list: async key => [...records.values()].filter(row => row.tenantId === key.tenantId && row.ownerUserId === key.ownerUserId), cas: async ({ tenantId, id, expectedVersion, next }) => { const current = records.get(`${tenantId}:${id}`); if (!current || current.resourceVersion !== expectedVersion) return undefined; records.set(`${tenantId}:${id}`, next); return next; } };
  const ledger: ShootingLocationMutationModel = { find: async key => mutations.get(`${key.tenantId}:${key.actorUserId}:${key.mutationId}`), create: async row => { mutations.set(`${row.tenantId}:${row.actorUserId}:${row.mutationId}`, row); } };
  const audit: ShootingLocationAuditModel = { create: async row => { audits.push(row); } };
  return { store: new MySqlShootingLocationRepository({ transaction: async work => work({}) }, locations, ledger, audit, () => new Date('2026-01-01T00:00:00.000Z')), locations, records, mutations, audits };
};

describe('v2 private shooting locations', () => {
  it('persists precise owner-only payloads, replays exact mutations, and keeps audits payload-free', async () => {
    const { store, audits } = setup(); const created = await store.create(owner, input('create'));
    expect(await store.create(owner, input('create'))).toEqual(created);
    await expect(store.create(owner, { ...input('create'), latitude: 31 })).rejects.toThrow('mutationId不能用于不同的写入');
    const updated = await store.update(owner, { ...input('update', '1'), notes: 'Use the upper turnout.' });
    const archived = await store.archive(owner, { id: updated.id, mutationId: 'archive', expectedResourceVersion: updated.resourceVersion });
    expect(archived.status).toBe('archived'); expect(audits.map(item => item.operation)).toEqual(['create', 'update', 'archive']);
    expect(JSON.stringify(audits)).not.toContain('30.123456'); expect(JSON.stringify(audits)).not.toContain('upper turnout');
  });

  it('requires direct owner authority, exact versions, and does not record a losing CAS mutation', async () => {
    const { store, locations, records, mutations, audits } = setup(); const created = await store.create(owner, input('create')); const key = `${owner.tenantId}:${created.id}`;
    await expect(store.listWorkspace(editor)).rejects.toThrow('没有拍摄地点管理权限');
    await expect(store.update(owner, { ...input('stale', '0') })).rejects.toBeInstanceOf(TrailsShootingLocationStaleVersionError);
    locations.cas = async () => { records.set(key, { ...records.get(key), resourceVersion: '2', payloadJson: JSON.stringify({ name: 'Winner', latitude: 1, longitude: 2 }) }); return undefined; };
    await expect(store.update(owner, { ...input('race', '1') })).rejects.toBeInstanceOf(TrailsShootingLocationStaleVersionError);
    expect(mutations.size).toBe(1); expect(audits).toHaveLength(1);
  });
});
