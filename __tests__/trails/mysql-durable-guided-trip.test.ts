import { Actor } from '../../src/apps/trails/types';
import { GuidedTripAuditModel, GuidedTripModel, GuidedTripMutationModel, MySqlDurableGuidedTripRepository, TrailsDurableGuidedTripStaleVersionError } from '../../src/apps/trails/repository/mysqlDurableGuidedTrip';

const owner: Actor = { tenantId: 'tenant-a', userId: 'owner-a', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const editor: Actor = { tenantId: 'tenant-a', userId: 'editor-a', isAdmin: false, creatorSpaceRole: 'creator-space-editor', creatorSpaceOwnerUserId: 'owner-a' };
const outsider: Actor = { tenantId: 'tenant-a', userId: 'outsider-a', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const otherTenant: Actor = { tenantId: 'tenant-b', userId: 'owner-b', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const input = (mutationId: string, expectedResourceVersion: string | null = null, id = 'trip_1') => ({ mutationId, expectedResourceVersion, id, title: '晨雾', summary: '文字计划', locationLabel: '山地地区', startsOn: '2026-08-10', endsOn: '2026-08-12', itinerary: [{ dayLabel: '第一日', summary: '观察光线' }], checklist: ['笔记本'], materialReferences: [{ label: '阅读材料', reference: 'reading_1' }], publicContingencyMessage: '计划可能调整。' });

const setup = () => {
  const records = new Map<string, any>(); const mutations = new Map<string, any>(); const audits: any[] = [];
  const trips: GuidedTripModel = {
    create: async row => { records.set(`${row.tenantId}:${row.id}`, row); return row; },
    find: async key => records.get(`${key.tenantId}:${key.id}`),
    list: async key => [...records.values()].filter(row => row.tenantId === key.tenantId && row.ownerUserId === key.ownerUserId && (!key.status || row.status === key.status)),
    cas: async ({ tenantId, id, expectedVersion, next }) => { const current = records.get(`${tenantId}:${id}`); if (!current || current.resourceVersion !== expectedVersion) return undefined; records.set(`${tenantId}:${id}`, next); return next; },
  };
  const ledger: GuidedTripMutationModel = { find: async key => mutations.get(`${key.tenantId}:${key.actorUserId}:${key.mutationId}`), create: async row => { mutations.set(`${row.tenantId}:${row.actorUserId}:${row.mutationId}`, row); } };
  const audit: GuidedTripAuditModel = { create: async row => { audits.push(row); } };
  return { store: new MySqlDurableGuidedTripRepository({ transaction: async work => work({}) }, trips, ledger, audit, () => new Date('2026-01-01T00:00:00.000Z')), trips, records, mutations, audits };
};

describe('v2 durable guided trips', () => {
  it('validates editorial-only bounded data before persistence', async () => {
    const { store, records } = setup();
    for (const invalid of [
      { ...input('bad-id'), id: '../trip' }, { ...input('bad-date'), startsOn: '2026-02-30' }, { ...input('bad-order'), endsOn: '2026-08-01' },
      { ...input('bad-create-version', '1'), expectedResourceVersion: '1' },
      { ...input('bad-location'), locationLabel: '35.123, 120.123' }, { ...input('bad-meeting'), locationLabel: '集合点附近' },
      { ...input('bad-markup'), title: '<b>unsafe</b>' }, { ...input('bad-reference'), materialReferences: [{ label: '资料', reference: 'https://private.example' }] },
      { ...input('duplicate-checklist'), checklist: ['笔记本', '笔记本'] }, { ...input('duplicate-material'), materialReferences: [{ label: 'a', reference: 'same_1' }, { label: 'b', reference: 'same_1' }] },
      { ...input('too-many-checklist'), checklist: Array.from({ length: 51 }, (_, index) => `item-${index}`) },
    ]) await expect(store.createDraft(owner, invalid)).rejects.toThrow();
    expect(records).toHaveProperty('size', 0);
  });

  it('enforces draft/published/cancelled state graph with canonical CAS versions', async () => {
    const { store, audits } = setup(); const created = await store.createDraft(owner, input('create'));
    const updated = await store.updateDraft(editor, { ...input('update', created.resourceVersion), title: '新标题' });
    const published = await store.publish(owner, { id: created.id, mutationId: 'publish', expectedResourceVersion: updated.resourceVersion });
    expect(published).toMatchObject({ status: 'published', resourceVersion: '3', publishedAt: '2026-01-01T00:00:00.000Z' });
    await expect(store.updateDraft(owner, { ...input('published-update', published.resourceVersion) })).rejects.toThrow('当前行摄计划不允许');
    const draft = await store.unpublish(owner, { id: created.id, mutationId: 'unpublish', expectedResourceVersion: published.resourceVersion });
    expect(draft).toMatchObject({ status: 'draft', resourceVersion: '4' }); expect(draft).not.toHaveProperty('publishedAt');
    const cancelled = await store.cancel(owner, { id: created.id, mutationId: 'cancel', expectedResourceVersion: draft.resourceVersion });
    expect(cancelled).toMatchObject({ status: 'cancelled', resourceVersion: '5', cancelledAt: '2026-01-01T00:00:00.000Z' });
    await expect(store.publish(owner, { id: created.id, mutationId: 'terminal', expectedResourceVersion: cancelled.resourceVersion })).rejects.toThrow('当前行摄计划不允许');
    expect(audits.map(audit => audit.operation)).toEqual(['create-draft', 'update-draft', 'publish', 'unpublish', 'cancel']);
    expect(audits.map(audit => audit.toVersion)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('replays same fingerprints once, rejects mutation mismatch, detects CAS staleness, and writes minimal audits', async () => {
    const { store, audits } = setup(); const created = await store.createDraft(owner, input('create'));
    expect(await store.createDraft(owner, input('create'))).toEqual(created);
    await expect(store.createDraft(owner, { ...input('create'), title: 'changed' })).rejects.toThrow('mutationId不能用于不同的写入');
    await expect(store.publish(owner, { id: created.id, mutationId: 'stale', expectedResourceVersion: '0' })).rejects.toBeInstanceOf(TrailsDurableGuidedTripStaleVersionError);
    expect(audits).toHaveLength(1);
    expect(Object.keys(audits[0]).sort()).toEqual(['actorUserId', 'eventId', 'mutationId', 'occurredAt', 'operation', 'ownerUserId', 'tenantId', 'toVersion', 'tripId'].sort());
    expect(JSON.stringify(audits[0])).not.toContain('晨雾');
  });

  it('rereads the canonical winner after a valid-version CAS race without recording the losing mutation or audit', async () => {
    const { store, trips, records, mutations, audits } = setup(); const created = await store.createDraft(owner, input('create'));
    const key = `${owner.tenantId}:${created.id}`; const original = records.get(key);
    const winner = { ...original, resourceVersion: '2', payloadJson: JSON.stringify({ ...JSON.parse(original.payloadJson), title: '并发更新后的标题' }), updatedAt: new Date('2026-01-02T00:00:00.000Z') };
    trips.cas = async () => { records.set(key, winner); return undefined; };

    const error = await store.updateDraft(owner, { ...input('race-update', created.resourceVersion), title: '丢失的更新' }).catch(reason => reason);

    expect(error).toBeInstanceOf(TrailsDurableGuidedTripStaleVersionError);
    const stale = error as TrailsDurableGuidedTripStaleVersionError;
    expect(stale.current).toMatchObject({ id: created.id, status: 'draft', resourceVersion: '2', title: '并发更新后的标题', summary: created.summary, locationLabel: created.locationLabel, startsOn: created.startsOn, endsOn: created.endsOn, itinerary: created.itinerary, checklist: created.checklist, materialReferences: created.materialReferences });
    expect(stale.current.updatedAt).toBe('2026-01-02T00:00:00.000Z');
    expect(mutations).toHaveProperty('size', 1);
    expect(mutations.has(`${owner.tenantId}:${owner.userId}:race-update`)).toBe(false);
    expect(audits).toHaveLength(1);
  });

  it('isolates creator tenants and owners while exposing published records only to the configured owner', async () => {
    const { store } = setup(); const published = await store.createDraft(owner, input('create', null, 'trip_published'));
    await store.publish(owner, { id: published.id, mutationId: 'publish', expectedResourceVersion: published.resourceVersion });
    await store.createDraft(owner, input('draft', null, 'trip_draft'));
    const cancelled = await store.createDraft(owner, input('cancel-create', null, 'trip_cancelled'));
    await store.cancel(owner, { id: cancelled.id, mutationId: 'cancel', expectedResourceVersion: cancelled.resourceVersion });
    expect((await store.listWorkspace(editor)).map(item => item.id)).toEqual(['trip_published', 'trip_draft', 'trip_cancelled']);
    expect(await store.listWorkspace(outsider)).toEqual([]);
    await expect(store.publish(outsider, { id: 'trip_published', mutationId: 'cross-owner', expectedResourceVersion: '2' })).rejects.toThrow('不存在或不属于');
    await expect(store.publish(otherTenant, { id: 'trip_published', mutationId: 'cross-tenant', expectedResourceVersion: '2' })).rejects.toThrow('不存在或不属于');
    expect((await store.listPublic({ tenantId: owner.tenantId, userId: owner.userId })).map(item => item.id)).toEqual(['trip_published']);
    expect(await store.readPublic({ tenantId: owner.tenantId, userId: outsider.userId }, 'trip_published')).toBeUndefined();
    expect(await store.readPublic({ tenantId: otherTenant.tenantId, userId: otherTenant.userId }, 'trip_published')).toBeUndefined();
  });
});
