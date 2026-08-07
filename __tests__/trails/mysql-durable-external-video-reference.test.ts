import { Actor } from '../../src/apps/starlight/trails/types';
import { ExternalVideoReferenceAuditModel, ExternalVideoReferenceModel, ExternalVideoReferenceMutationModel, ExternalVideoReferencePortfolioModel, MySqlDurableExternalVideoReferenceRepository, TrailsDurableExternalVideoReferenceStaleVersionError } from '../../src/apps/starlight/trails/repository/mysqlDurableExternalVideoReference';

const owner: Actor = { tenantId: 'tenant-a', userId: 'owner-a', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const editor: Actor = { tenantId: 'tenant-a', userId: 'editor-a', isAdmin: false, creatorSpaceRole: 'creator-space-editor', creatorSpaceOwnerUserId: 'owner-a' };
const input = (mutationId: string, expectedResourceVersion: string | null = null) => ({ id: 'video_1', portfolioId: 'portfolio_1', title: '晨雾', summary: '外部作品链接', canonicalUrl: 'https://www.bilibili.com/video/BV1Q541167Qg', sortOrder: 0, mutationId, expectedResourceVersion });

const setup = (portfolio: { ownerUserId: string; visibility: string; lifecycle: string } = { ownerUserId: owner.userId, visibility: 'public', lifecycle: 'published' }) => {
  const records = new Map<string, any>(); const mutations = new Map<string, any>(); const audits: any[] = [];
  const references: ExternalVideoReferenceModel = { create: async row => { records.set(`${row.tenantId}:${row.id}`, row); return row; }, find: async key => records.get(`${key.tenantId}:${key.id}`), list: async key => [...records.values()].filter(row => row.tenantId === key.tenantId && row.ownerUserId === key.ownerUserId && (!key.status || row.status === key.status)), cas: async ({ tenantId, id, expectedVersion, next }) => { const current = records.get(`${tenantId}:${id}`); if (!current || current.resourceVersion !== expectedVersion) return undefined; records.set(`${tenantId}:${id}`, next); return next; } };
  const ledger: ExternalVideoReferenceMutationModel = { find: async key => mutations.get(`${key.tenantId}:${key.actorUserId}:${key.mutationId}`), create: async row => { mutations.set(`${row.tenantId}:${row.actorUserId}:${row.mutationId}`, row); } };
  const audit: ExternalVideoReferenceAuditModel = { create: async row => { audits.push(row); } };
  const portfolios: ExternalVideoReferencePortfolioModel = { find: async key => key.tenantId === owner.tenantId && key.id === 'portfolio_1' ? portfolio : undefined };
  return { store: new MySqlDurableExternalVideoReferenceRepository({ transaction: async work => work({}) }, references, ledger, audit, portfolios, () => new Date('2026-01-01T00:00:00.000Z')), audits };
};

describe('v2 durable external video references', () => {
  it('validates exact canonical Bilibili metadata and trusted portfolio ownership', async () => {
    const { store } = setup();
    for (const invalid of [{ ...input('leading-space'), canonicalUrl: ' https://www.bilibili.com/video/BV1Q541167Qg' }, { ...input('trailing-space'), canonicalUrl: 'https://www.bilibili.com/video/BV1Q541167Qg ' }, { ...input('mixed-whitespace'), canonicalUrl: '\thttps://www.bilibili.com/video/BV1Q541167Qg\n' }, { ...input('http'), canonicalUrl: 'http://www.bilibili.com/video/BV1Q541167Qg' }, { ...input('host'), canonicalUrl: 'https://bilibili.com/video/BV1Q541167Qg' }, { ...input('port'), canonicalUrl: 'https://www.bilibili.com:443/video/BV1Q541167Qg' }, { ...input('short'), canonicalUrl: 'https://b23.tv/abc' }, { ...input('query'), canonicalUrl: 'https://www.bilibili.com/video/BV1Q541167Qg?x=1' }, { ...input('fragment'), canonicalUrl: 'https://www.bilibili.com/video/BV1Q541167Qg#reply' }, { ...input('slash'), canonicalUrl: 'https://www.bilibili.com/video/BV1Q541167Qg/' }, { ...input('deep-link'), canonicalUrl: 'bilibili://video/BV1Q541167Qg' }, { ...input('cover'), coverMediaId: 'media_1' }]) await expect(store.createDraft(owner, invalid)).rejects.toThrow();
    const created = await store.createDraft(owner, input('valid-create'));
    await expect(store.updateDraft(owner, { ...input('padded-update', created.resourceVersion), canonicalUrl: 'https://www.bilibili.com/video/BV1Q541167Qg ' })).rejects.toThrow();
    await expect(setup({ ownerUserId: 'other', visibility: 'public', lifecycle: 'published' }).store.createDraft(owner, input('wrong-owner'))).rejects.toThrow();
  });
  it('replays mutations, applies CAS lifecycle, and leaves archive terminal', async () => {
    const { store, audits } = setup(); const created = await store.createDraft(owner, input('create'));
    expect(await store.createDraft(owner, input('create'))).toEqual(created);
    await expect(store.createDraft(owner, { ...input('create'), title: 'changed' })).rejects.toThrow('mutationId不能用于不同的写入');
    const updated = await store.updateDraft(editor, { ...input('update', created.resourceVersion), title: '新标题' });
    const published = await store.publish(owner, { id: created.id, mutationId: 'publish', expectedResourceVersion: updated.resourceVersion });
    const archived = await store.archive(owner, { id: created.id, mutationId: 'archive', expectedResourceVersion: published.resourceVersion });
    await expect(store.unpublish(owner, { id: created.id, mutationId: 'terminal', expectedResourceVersion: archived.resourceVersion })).rejects.toThrow('当前外部视频引用不允许');
    await expect(store.publish(owner, { id: created.id, mutationId: 'stale', expectedResourceVersion: '1' })).rejects.toBeInstanceOf(TrailsDurableExternalVideoReferenceStaleVersionError);
    expect(audits.map(item => item.operation)).toEqual(['create-draft', 'update-draft', 'publish', 'archive']);
  });
  it('publishes only children of a publicly published durable portfolio', async () => {
    const visible = setup(); const created = await visible.store.createDraft(owner, input('create')); await visible.store.publish(owner, { id: created.id, mutationId: 'publish', expectedResourceVersion: created.resourceVersion });
    expect(await visible.store.listPublic({ tenantId: owner.tenantId, userId: owner.userId })).toHaveLength(1);
    const hidden = setup({ ownerUserId: owner.userId, visibility: 'private', lifecycle: 'draft' }); const hiddenCreated = await hidden.store.createDraft(owner, input('hidden-create')); await hidden.store.publish(owner, { id: hiddenCreated.id, mutationId: 'hidden-publish', expectedResourceVersion: hiddenCreated.resourceVersion });
    expect(await hidden.store.listPublic({ tenantId: owner.tenantId, userId: owner.userId })).toEqual([]);
  });
});
