import { Actor } from '../../src/apps/starlight/trails/types';
import { MySqlDurablePublishingPackageRepository, PublishingAuditModel, PublishingMutationModel, PublishingPackageModel, TrailsDurablePublishingPackageStaleVersionError } from '../../src/apps/starlight/trails/repository/mysqlDurablePublishingPackage';

const actor: Actor = { tenantId: 'tenant-a', userId: 'owner-a', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const editor: Actor = { tenantId: 'tenant-a', userId: 'editor-a', isAdmin: false, creatorSpaceRole: 'creator-space-editor', creatorSpaceOwnerUserId: 'owner-a' };
const otherTenant: Actor = { tenantId: 'tenant-b', userId: 'owner-b', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const input = (mutationId: string, expectedResourceVersion: string | null = null) => ({ mutationId, expectedResourceVersion, id: 'package_1', sourceWorkId: 'work_1', platform: 'instagram', copy: 'private copy', contentOrigin: 'human' as const, exportVariants: [{ mediaId: 'media_1', cropIntent: 'square' as const, intendedUse: 'feed' }], locationPolicy: 'withheld' as const, containsGpsOrRouteHints: false, rightsStatus: 'cleared' as const, factualClaims: [{ text: 'verified', verification: 'verified' as const }], approvals: { copyApproved: true, mediaSelectionApproved: true, rightsApproved: true, locationPrivacyApproved: true, factualClaimsApproved: true } });

const setup = () => {
  const records = new Map<string, any>(); const mutations = new Map<string, any>(); const audits: any[] = [];
  const packages: PublishingPackageModel = { create: async row => { records.set(`${row.tenantId}:${row.id}`, row); return row; }, find: async key => records.get(`${key.tenantId}:${key.id}`), list: async key => [...records.values()].filter(row => row.tenantId === key.tenantId && row.ownerUserId === key.ownerUserId), cas: async ({ tenantId, id, expectedVersion, next }) => { const current = records.get(`${tenantId}:${id}`); if (!current || current.resourceVersion !== expectedVersion) return undefined; records.set(`${tenantId}:${id}`, next); return next; } };
  const ledger: PublishingMutationModel = { find: async key => mutations.get(`${key.tenantId}:${key.actorUserId}:${key.mutationId}`), create: async row => { mutations.set(`${row.tenantId}:${row.actorUserId}:${row.mutationId}`, row); } };
  const audit: PublishingAuditModel = { create: async row => { audits.push(row); } };
  const store = new MySqlDurablePublishingPackageRepository({ transaction: async work => work({}) }, packages, ledger, audit, () => new Date('2026-01-01T00:00:00.000Z'));
  return { store, records, audits };
};

describe('durable private publishing packages', () => {
  it('uses the manual-only state graph, approval gate, and internal manual attestation', async () => {
    const { store } = setup(); const created = await store.create(actor, input('create'));
    await expect(store.transition(actor, { mutationId: 'bad-approval', expectedResourceVersion: '1', id: created.id, status: 'approved' })).rejects.toThrow('当前发布包状态不允许该转换');
    let current = created;
    for (const status of ['prepared', 'reviewed', 'approved', 'ready_manual_handoff'] as const) current = await store.transition(actor, { mutationId: `to-${status}`, expectedResourceVersion: current.resourceVersion, id: current.id, status });
    await expect(store.transition(actor, { mutationId: 'publish-no', expectedResourceVersion: current.resourceVersion, id: current.id, status: 'manually_published' })).rejects.toThrow('手动发布必须由人工确认');
    const published = await store.transition(editor, { mutationId: 'publish-yes', expectedResourceVersion: current.resourceVersion, id: current.id, status: 'manually_published', manualConfirmation: true });
    expect(published.manuallyPublishedByUserId).toBe(editor.userId); expect(published.manuallyPublishedAt).toBe('2026-01-01T00:00:00.000Z');
  });
  it('replays matching actor mutation, rejects mismatch, protects CAS, and writes minimal audits', async () => {
    const { store, audits } = setup(); const created = await store.create(actor, input('create'));
    expect(await store.create(actor, input('create'))).toEqual(created);
    await expect(store.create(actor, { ...input('create'), copy: 'different' })).rejects.toThrow('mutationId不能用于不同的写入');
    await expect(store.transition(actor, { mutationId: 'stale', expectedResourceVersion: '0', id: created.id, status: 'prepared' })).rejects.toBeInstanceOf(TrailsDurablePublishingPackageStaleVersionError);
    expect(audits).toHaveLength(1); expect(Object.keys(audits[0]).sort()).toEqual(['actorUserId', 'eventId', 'mutationId', 'occurredAt', 'operation', 'ownerUserId', 'packageId', 'resourceVersion', 'tenantId', 'toStatus'].sort()); expect(JSON.stringify(audits[0])).not.toContain('private copy');
  });
  it('isolates identical mutation IDs by authenticated actor and replays the original actor record', async () => {
    const { store, records } = setup();
    const ownerFirst = await store.create(actor, { ...input('shared-mutation'), id: 'package_owner' });
    const editorFirst = await store.create(editor, { ...input('shared-mutation'), id: 'package_editor' });
    const ownerRetry = await store.create(actor, { ...input('shared-mutation'), id: 'package_owner' });

    expect(ownerFirst).toMatchObject({ id: 'package_owner', tenantId: actor.tenantId, ownerUserId: actor.userId });
    expect(editorFirst).toMatchObject({ id: 'package_editor', tenantId: actor.tenantId, ownerUserId: actor.userId });
    expect(ownerRetry).toEqual(ownerFirst);
    expect(ownerRetry).not.toEqual(editorFirst);
    expect(records.size).toBe(2);
    expect(records).toHaveProperty('size', 2);
  });
  it('derives creator owner and keeps tenant/owner workspaces private', async () => {
    const { store } = setup(); await store.create(actor, input('create'));
    expect((await store.listWorkspace(editor)).map(x => x.id)).toEqual(['package_1']);
    expect(await store.listWorkspace(otherTenant)).toEqual([]);
    await expect(store.transition(otherTenant, { mutationId: 'cross', expectedResourceVersion: '1', id: 'package_1', status: 'prepared' })).rejects.toThrow('发布包不存在');
  });
});
