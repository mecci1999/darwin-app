import { Actor } from '../../src/apps/trails/types';
import { LocationCardAuditModel, LocationCardModel, LocationCardMutationModel, MySqlDurableLocationCardRepository, TrailsDurableLocationCardStaleVersionError } from '../../src/apps/trails/repository/mysqlDurableLocationCard';

const owner: Actor = { tenantId: 'tenant-a', userId: 'owner-a', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const editor: Actor = { tenantId: owner.tenantId, userId: 'editor-a', isAdmin: false, creatorSpaceRole: 'creator-space-editor', creatorSpaceOwnerUserId: owner.userId };
const outsider: Actor = { tenantId: owner.tenantId, userId: 'outsider-a', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const otherTenant: Actor = { tenantId: 'tenant-b', userId: 'owner-b', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const input = (mutationId: string, expectedResourceVersion: string | null = null, id = 'location_1') => ({ id, mutationId, expectedResourceVersion, name: '雾岭', regionLabel: '山地地区', summary: '仅含公开文字描述。' });
const setup = () => {
  const records = new Map<string, any>(); const mutations = new Map<string, any>(); const audits: any[] = [];
  const cards: LocationCardModel = {
    create: async row => { records.set(`${row.tenantId}:${row.id}`, row); return row; },
    find: async key => records.get(`${key.tenantId}:${key.id}`),
    list: async key => [...records.values()].filter(row => row.tenantId === key.tenantId && row.ownerUserId === key.ownerUserId && (!key.status || row.status === key.status)),
    cas: async ({ tenantId, id, expectedVersion, next }) => { const current = records.get(`${tenantId}:${id}`); if (!current || current.resourceVersion !== expectedVersion) return undefined; records.set(`${tenantId}:${id}`, next); return next; },
  };
  const ledger: LocationCardMutationModel = { find: async key => mutations.get(`${key.tenantId}:${key.actorUserId}:${key.mutationId}`), create: async row => { mutations.set(`${row.tenantId}:${row.actorUserId}:${row.mutationId}`, row); } };
  const audit: LocationCardAuditModel = { create: async row => { audits.push(row); } };
  return { store: new MySqlDurableLocationCardRepository({ transaction: async work => work({}) }, cards, ledger, audit, () => new Date('2026-01-01T00:00:00.000Z')), cards, records, mutations, audits };
};

describe('v2 durable location cards', () => {
  it('rejects every prohibited field class, nested values, markup, URLs, coordinates, and operational terminology before persistence', async () => {
    const { store, records } = setup();
    for (const invalid of [
      { ...input('bad-id'), id: '../location' }, { ...input('unknown'), latitude: 30 }, { ...input('nested'), geometry: { coordinates: [1, 2] } }, { ...input('route'), route: 'private' }, { ...input('media'), mediaUrl: 'https://private.example' },
      { ...input('markup'), name: '<b>unsafe</b>' }, { ...input('control'), summary: 'bad\u0000text' }, { ...input('url'), summary: 'https://private.example' }, { ...input('coordinate'), regionLabel: '30.123, 120.123' },
      ...['meeting point', 'access road', 'parking', 'directions', 'capacity', 'registration', '集合点', '停车', '导航', '名额', '报名'].map((summary, index) => ({ ...input(`term-${index}`), summary })),
    ]) await expect(store.createDraft(owner, invalid as any)).rejects.toThrow();
    expect(records).toHaveProperty('size', 0);
  });

  it('replays matching mutations once, rejects conflicting reuse, records only minimal audits, and enforces the lifecycle graph', async () => {
    const { store, audits } = setup(); const created = await store.createDraft(owner, input('create'));
    expect(await store.createDraft(owner, input('create'))).toEqual(created);
    await expect(store.createDraft(owner, { ...input('create'), name: 'changed' })).rejects.toThrow('mutationId不能用于不同的写入');
    const updated = await store.updateDraft(editor, { ...input('update', created.resourceVersion), name: '晨岭' });
    const published = await store.publish(owner, { id: created.id, mutationId: 'publish', expectedResourceVersion: updated.resourceVersion });
    await expect(store.updateDraft(owner, input('published-update', published.resourceVersion))).rejects.toThrow('当前地点卡片不允许');
    const draft = await store.unpublish(owner, { id: created.id, mutationId: 'unpublish', expectedResourceVersion: published.resourceVersion });
    const archived = await store.archive(owner, { id: created.id, mutationId: 'archive', expectedResourceVersion: draft.resourceVersion });
    await expect(store.publish(owner, { id: archived.id, mutationId: 'terminal', expectedResourceVersion: archived.resourceVersion })).rejects.toThrow('当前地点卡片不允许');
    expect(audits.map(audit => audit.operation)).toEqual(['create-draft', 'update-draft', 'publish', 'unpublish', 'archive']);
    expect(Object.keys(audits[0]).sort()).toEqual(['actorUserId', 'eventId', 'locationCardId', 'mutationId', 'occurredAt', 'operation', 'ownerUserId', 'tenantId', 'toVersion'].sort());
    expect(JSON.stringify(audits)).not.toContain('公开文字描述');
  });

  it('returns the safe canonical winner after a CAS race without recording a losing mutation or audit', async () => {
    const { store, cards, records, mutations, audits } = setup(); const created = await store.createDraft(owner, input('create'));
    const key = `${owner.tenantId}:${created.id}`; const current = records.get(key);
    const winner = { ...current, resourceVersion: '2', payloadJson: JSON.stringify({ name: '并发胜者', regionLabel: '山地地区', summary: '安全文字' }), updatedAt: new Date('2026-01-02T00:00:00.000Z') };
    cards.cas = async () => { records.set(key, winner); return undefined; };
    const error = await store.updateDraft(owner, { ...input('race', created.resourceVersion), name: '丢失写入' }).catch(reason => reason);
    expect(error).toBeInstanceOf(TrailsDurableLocationCardStaleVersionError);
    const stale = error as TrailsDurableLocationCardStaleVersionError;
    expect(stale.current).toMatchObject({ id: created.id, name: '并发胜者', regionLabel: '山地地区', summary: '安全文字', status: 'draft', resourceVersion: '2' });
    expect(stale.current).not.toHaveProperty('payloadJson'); expect(mutations).toHaveProperty('size', 1); expect(audits).toHaveLength(1);
  });

  it('isolates owners and tenants and exposes only published cards to a public owner in deterministic name/id order', async () => {
    const { store } = setup(); const zulu = await store.createDraft(owner, { ...input('zulu', null, 'zulu'), name: 'Zulu' }); const alphaTwo = await store.createDraft(owner, { ...input('alpha-2', null, 'alpha_2'), name: 'Alpha' }); const alphaOne = await store.createDraft(owner, { ...input('alpha-1', null, 'alpha_1'), name: 'Alpha' });
    await store.publish(owner, { id: zulu.id, mutationId: 'publish-zulu', expectedResourceVersion: zulu.resourceVersion }); await store.publish(owner, { id: alphaTwo.id, mutationId: 'publish-alpha-2', expectedResourceVersion: alphaTwo.resourceVersion }); await store.publish(owner, { id: alphaOne.id, mutationId: 'publish-alpha-1', expectedResourceVersion: alphaOne.resourceVersion });
    await store.createDraft(owner, input('draft-only', null, 'draft_only'));
    expect((await store.listWorkspace(editor)).map(value => value.id)).toHaveLength(4); expect(await store.listWorkspace(outsider)).toEqual([]);
    await expect(store.publish(outsider, { id: zulu.id, mutationId: 'cross-owner', expectedResourceVersion: '2' })).rejects.toThrow('不存在或不属于'); await expect(store.publish(otherTenant, { id: zulu.id, mutationId: 'cross-tenant', expectedResourceVersion: '2' })).rejects.toThrow('不存在或不属于');
    expect((await store.listPublic({ tenantId: owner.tenantId, userId: owner.userId })).sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)).map(value => value.id)).toEqual(['alpha_1', 'alpha_2', 'zulu']);
    expect(await store.listPublic({ tenantId: owner.tenantId, userId: outsider.userId })).toEqual([]);
  });
});
