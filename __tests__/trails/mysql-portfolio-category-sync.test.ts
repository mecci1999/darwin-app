import { Actor } from '../../src/apps/starlight/trails/types';
import { AsyncPortfolioCategoryMutation, CategoryRow, ChangeRow, ChangeWrite, MySqlPortfolioCategorySyncRepository, MutationRow, TrailsPortfolioCategorySyncModels, TrailsSyncConnection, TrailsSyncTransaction } from '../../src/apps/starlight/trails/repository/mysqlPortfolioCategorySync';

const owner: Actor = { tenantId: 'tenant-1', userId: 'owner-1', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const otherOwner: Actor = { tenantId: 'tenant-2', userId: 'owner-2', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const editor: Actor = { tenantId: 'tenant-1', userId: 'editor-1', isAdmin: false, creatorSpaceRole: 'creator-space-editor', creatorSpaceOwnerUserId: owner.userId };
const mutation = (mutationId: string, resourceId: string, slug: string, baseVersion: string | null = null): AsyncPortfolioCategoryMutation => ({ mutationId, resourceId, baseVersion, payload: { slug, nameZh: slug } });
const clone = <T>(value: T): T => structuredClone(value);
const unique = (): Error & { name: string; code: string } => Object.assign(new Error('duplicate'), { name: 'SequelizeUniqueConstraintError', code: 'ER_DUP_ENTRY' });

class FakeConnection implements TrailsSyncConnection {
  readonly activeTransaction: TrailsSyncTransaction = { lock: 'FOR UPDATE' };
  commits = 0; rollbacks = 0; attempts = 0;
  constructor(private readonly snapshot: () => unknown, private readonly restore: (snapshot: unknown) => void, private readonly afterRollback: () => void) {}
  async transaction<T>(work: (transaction: TrailsSyncTransaction) => Promise<T>): Promise<T> {
    const before = this.snapshot(); this.attempts += 1;
    try { const result = await work(this.activeTransaction); this.commits += 1; return result; }
    catch (error) { this.restore(before); this.rollbacks += 1; this.afterRollback(); throw error; }
  }
}

const setup = (failure?: 'category' | 'change' | 'mutation' | 'mutation-race' | 'slug-race' | 'resource-id-race') => {
  let categories = new Map<string, CategoryRow>(); let mutations = new Map<string, MutationRow>(); let changes: ChangeRow[] = []; let cursor = BigInt('9007199254740993');
  let remoteMutation: MutationRow | undefined; const transactions: TrailsSyncTransaction[] = [];
  const key = (tenantId: string, actorUserId: string, mutationId: string) => `${tenantId}:${actorUserId}:${mutationId}`;
  const categoryKey = (tenantId: string, resourceId: string) => `${tenantId}:${resourceId}`;
  const connection = new FakeConnection(
    () => ({ categories: clone([...categories]), mutations: clone([...mutations]), changes: clone(changes), cursor }),
    (snapshot) => { const state = snapshot as { categories: Array<[string, CategoryRow]>; mutations: Array<[string, MutationRow]>; changes: ChangeRow[]; cursor: bigint }; categories = new Map(state.categories); mutations = new Map(state.mutations); changes = state.changes; cursor = state.cursor; },
    () => { if (remoteMutation) mutations.set(key(remoteMutation.tenantId, remoteMutation.actorUserId, remoteMutation.mutationId), remoteMutation); remoteMutation = undefined; },
  );
  const checked = (transaction: TrailsSyncTransaction) => { expect(transaction).toBe(connection.activeTransaction); transactions.push(transaction); };
  const models: TrailsPortfolioCategorySyncModels = {
    categories: {
      async findByTenantResource(input, options) { checked(options.transaction); return clone(categories.get(categoryKey(input.tenantId, input.resourceId))); },
      async findByOwnerSlug(input, options) { checked(options.transaction); const row = [...categories.values()].find((item) => item.tenantId === input.tenantId && item.ownerUserId === input.ownerUserId && item.slug === input.slug); return row ? { id: row.id } : undefined; },
      async create(row, options) { checked(options.transaction); if (failure === 'category') throw new Error('category write failed'); if (failure === 'slug-race' || failure === 'resource-id-race') throw unique(); if (categories.has(categoryKey(row.tenantId, row.id))) throw unique(); categories.set(categoryKey(row.tenantId, row.id), clone(row)); return clone(row); },
      async compareAndSwap(input, options) {
        checked(options.transaction); const current = categories.get(categoryKey(input.tenantId, input.resourceId));
        if (!current || current.tenantId !== input.tenantId || current.resourceVersion !== input.expectedVersion) return { kind: 'stale', ...(current ? { current: clone(current) } : {}) };
        if (failure === 'category') throw new Error('category write failed'); categories.set(categoryKey(input.tenantId, input.resourceId), clone(input.next)); return { kind: 'updated', row: clone(input.next) };
      },
      async listByOwner(input, options) {
        checked(options.transaction);
        return [...categories.values()].filter((item) => item.tenantId === input.tenantId && item.ownerUserId === input.ownerUserId && (!input.publicOnly || item.visibility === 'public' && item.status === 'active' && item.lifecycle === 'published')).sort((left, right) => left.sortOrder - right.sortOrder || left.slug.localeCompare(right.slug)).map(clone);
      },
      async findPublicByOwnerSlug(input, options) {
        checked(options.transaction);
        const category = [...categories.values()].find((item) => item.tenantId === input.tenantId && item.ownerUserId === input.ownerUserId && item.slug === input.slug && item.visibility === 'public' && item.status === 'active' && item.lifecycle === 'published');
        return clone(category);
      },
    },
    changes: {
      async create(row: ChangeWrite, options) { checked(options.transaction); if (failure === 'change') throw new Error('change write failed'); cursor += BigInt(1); changes.push({ cursor: cursor.toString(), resourceId: row.resourceId, resourceJson: row.resourceJson, createdAt: new Date('2026-07-31T00:00:00.000Z') }); return { cursor: cursor.toString() }; },
      async listAfter(input, options) { checked(options.transaction); return changes.filter((item) => BigInt(item.cursor) > BigInt(input.after)).slice(0, input.limit).map(clone); },
      async latestCursor(_input, options) { checked(options.transaction); return changes.length ? changes[changes.length - 1].cursor : undefined; },
    },
    mutations: {
      async findByActorMutation(input, options) { checked(options.transaction); return clone(mutations.get(key(input.tenantId, input.actorUserId, input.mutationId))); },
      async create(row, options) {
        checked(options.transaction); if (failure === 'mutation') throw new Error('mutation write failed');
        if (failure === 'mutation-race') { remoteMutation = clone(row); throw unique(); }
        mutations.set(key(row.tenantId, row.actorUserId, row.mutationId), clone(row));
      },
    },
  };
  return { repository: new MySqlPortfolioCategorySyncRepository(connection, models, { pullLimit: 1, now: () => new Date('2026-07-31T00:00:00.000Z') }), connection, categories: () => categories, mutations: () => mutations, changes: () => changes, transactions };
};

describe('MySqlPortfolioCategorySyncRepository', () => {
  it('uses one locked transaction attempt for editor-owned create, resource/change/mutation writes, and decimal versions', async () => {
    const fake = setup(); const result = await fake.repository.push(editor, mutation('m-1', 'category-1', 'mountains'));
    expect(result).toEqual(expect.objectContaining({ kind: 'applied', resource: expect.objectContaining({ ownerUserId: owner.userId, resourceVersion: '1' }) }));
    expect(fake.changes()).toHaveLength(1); expect(fake.mutations().size).toBe(1); expect(fake.connection.attempts).toBe(1); expect(fake.transactions).not.toHaveLength(0);
  });
  it('uses tenant-scoped resource lookup when resource IDs collide across tenants', async () => {
    const fake = setup(); await fake.repository.push(otherOwner, mutation('other', 'same-id', 'other'));
    const result = await fake.repository.push(owner, mutation('mine', 'same-id', 'mine'));
    expect(result.kind).toBe('applied'); expect(fake.categories().get('tenant-1:same-id')?.tenantId).toBe('tenant-1'); expect(fake.categories().get('tenant-2:same-id')?.tenantId).toBe('tenant-2');
  });
  it('replays an identical mutation and rejects a different fingerprint', async () => {
    const fake = setup(); await fake.repository.push(owner, mutation('same', 'category-1', 'mountains'));
    expect((await fake.repository.push(owner, mutation('same', 'category-1', 'mountains'))).kind).toBe('duplicate');
    await expect(fake.repository.push(owner, mutation('same', 'category-1', 'coast'))).rejects.toThrow('mutationId不能用于不同的同步变更'); expect(fake.changes()).toHaveLength(1);
  });
  it('recovers a duplicate mutation-key race only by replaying after the original attempt rolls back', async () => {
    const fake = setup('mutation-race'); const result = await fake.repository.push(owner, mutation('race', 'category-1', 'mountains'));
    expect(result.kind).toBe('duplicate'); expect(fake.connection.rollbacks).toBe(1); expect(fake.connection.attempts).toBe(2); expect(fake.changes()).toHaveLength(0); expect(fake.categories().size).toBe(0);
  });
  it('returns a CAS stale conflict with reread current row and no change', async () => {
    const fake = setup(); await fake.repository.push(owner, mutation('create', 'category-1', 'mountains'));
    const stale = await fake.repository.push(owner, mutation('stale', 'category-1', 'coast', '0'));
    expect(stale).toEqual(expect.objectContaining({ kind: 'conflict', current: expect.objectContaining({ resourceVersion: '1', slug: 'mountains' }) })); expect(fake.changes()).toHaveLength(1);
  });
  it('maps preflight or write-time slug uniqueness to the domain error and rolls back', async () => {
    const fake = setup(); await fake.repository.push(owner, mutation('seed', 'category-1', 'mountains'));
    await expect(fake.repository.push(owner, mutation('slug', 'category-2', 'mountains'))).rejects.toThrow('slug已被当前所有者使用'); expect(fake.connection.rollbacks).toBe(1);
  });
  it('maps a new resource primary-key collision to a safe persistence error rather than a slug error', async () => {
    const fake = setup('resource-id-race');
    await expect(fake.repository.push(owner, mutation('resource-race', 'category-1', 'mountains'))).rejects.toThrow('同步资源编号已存在或写入冲突');
    expect(fake.connection.rollbacks).toBe(1);
  });
  it.each(['category', 'change', 'mutation'] as const)('rolls back and propagates %s failure without divergence', async (failure) => {
    const fake = setup(failure); await expect(fake.repository.push(owner, mutation('m-1', 'category-1', 'mountains'))).rejects.toThrow(`${failure} write failed`);
    expect(fake.connection.rollbacks).toBe(1); expect(fake.categories().size).toBe(0); expect(fake.changes()).toHaveLength(0); expect(fake.mutations().size).toBe(0);
  });
  it('returns strictly bounded cursor ordering and scoped maximum on an empty page', async () => {
    const fake = setup(); await fake.repository.push(owner, mutation('one', 'category-1', 'mountains')); await fake.repository.push(owner, mutation('two', 'category-2', 'coast'));
    const page = await fake.repository.pull(editor, '0'); const empty = await fake.repository.pull(editor, '999999999999999999999');
    expect(page.changes).toHaveLength(1); expect(page.nextCursor).toBe('9007199254740994'); expect(empty.changes).toHaveLength(0); expect(empty.nextCursor).toBe('9007199254740995');
  });
  it('lists workspace and public categories deterministically without crossing tenant or owner boundaries', async () => {
    const fake = setup();
    await fake.repository.create(owner, { ...mutation('one', 'category-1', 'coast'), payload: { slug: 'coast', nameZh: '海岸', sortOrder: 1, visibility: 'public' } });
    await fake.repository.push(owner, { ...mutation('two', 'category-2', 'alps'), payload: { slug: 'alps', nameZh: '山岳', sortOrder: 1, visibility: 'private' } });
    await fake.repository.push(owner, { ...mutation('draft', 'category-4', 'draft'), payload: { slug: 'draft', nameZh: '草稿', visibility: 'public' } });
    await fake.repository.archive(owner, { mutationId: 'archive', resourceId: 'category-1', baseVersion: '1', payload: {} });
    await fake.repository.push(otherOwner, mutation('three', 'category-3', 'other'));
    expect((await fake.repository.listWorkspace(owner)).map((item) => item.slug)).toEqual(['draft', 'alps', 'coast']);
    expect(await fake.repository.listPublic({ tenantId: owner.tenantId, userId: owner.userId })).toEqual([]);
  });
  it('preserves generic sync state, archives only through the explicit transition, and never reactivates an archived category', async () => {
    const fake = setup();
    const created = await fake.repository.create(owner, mutation('create', 'category-1', 'coast'));
    expect(created).toEqual(expect.objectContaining({ resource: expect.objectContaining({ status: 'active', lifecycle: 'published' }) }));
    const archived = await fake.repository.archive(owner, { mutationId: 'archive', resourceId: 'category-1', baseVersion: '1', payload: {} });
    expect(archived).toEqual(expect.objectContaining({ resource: expect.objectContaining({ status: 'archived', lifecycle: 'archived' }) }));
    await expect(fake.repository.push(owner, { mutationId: 'revive', resourceId: 'category-1', baseVersion: '2', payload: { visibility: 'public' } })).rejects.toThrow('已归档分类不能更新或恢复');
  });
  it('reorders all active owner categories atomically and returns a stale conflict without partial writes', async () => {
    const fake = setup();
    await fake.repository.push(owner, mutation('one', 'category-1', 'coast'));
    await fake.repository.push(owner, mutation('two', 'category-2', 'alps'));
    const stale = await fake.repository.reorder(owner, [
      { mutationId: 'reorder-1', resourceId: 'category-1', baseVersion: '1', payload: { sortOrder: 0 } },
      { mutationId: 'reorder-2', resourceId: 'category-2', baseVersion: '0', payload: { sortOrder: 1 } },
    ]);
    expect(stale[0]).toEqual(expect.objectContaining({ kind: 'conflict', resourceId: 'category-2' }));
    expect(fake.categories().get('tenant-1:category-1')?.sortOrder).toBe(0);
    expect(fake.categories().get('tenant-1:category-2')?.sortOrder).toBe(0);
    const reordered = await fake.repository.reorder(owner, [
      { mutationId: 'reorder-3', resourceId: 'category-2', baseVersion: '1', payload: { sortOrder: 0 } },
      { mutationId: 'reorder-4', resourceId: 'category-1', baseVersion: '1', payload: { sortOrder: 1 } },
    ]);
    expect(reordered.every((result) => result.kind === 'applied')).toBe(true);
    expect(fake.categories().get('tenant-1:category-2')?.sortOrder).toBe(0);
    expect(fake.categories().get('tenant-1:category-1')?.sortOrder).toBe(1);
  });
  it('replays a complete reorder with ordered duplicate results before stale-version validation', async () => {
    const fake = setup();
    await fake.repository.push(owner, mutation('one', 'category-1', 'coast'));
    await fake.repository.push(owner, mutation('two', 'category-2', 'alps'));
    const reorder = [
      { mutationId: 'reorder-1', resourceId: 'category-2', baseVersion: '1', payload: { sortOrder: 0 } },
      { mutationId: 'reorder-2', resourceId: 'category-1', baseVersion: '1', payload: { sortOrder: 1 } },
    ];
    await fake.repository.reorder(owner, reorder);
    const replay = await fake.repository.reorder(owner, reorder);
    expect(replay).toHaveLength(2);
    expect(replay.map((result) => result.kind)).toEqual(['duplicate', 'duplicate']);
    expect(fake.changes()).toHaveLength(4);
  });
  it('validates direct adapter inputs before opening a transaction', async () => {
    const fake = setup(); await expect(fake.repository.push(owner, { mutationId: '', resourceId: 'category-1', baseVersion: null, payload: { slug: 'valid' } })).rejects.toThrow('mutationId');
    await expect(fake.repository.push(owner, { mutationId: 'm', resourceId: 'category-1', baseVersion: null, payload: { slug: 'valid' } })).rejects.toThrow('payload.slug和payload.nameZh');
    expect(fake.connection.attempts).toBe(1);
  });
  it('rejects non-string protocol IDs, versions, and cursors without coercion', async () => {
    const fake = setup();
    const invokePush = (input: unknown) => Reflect.apply(fake.repository.push, fake.repository, [owner, input]);
    const invokePull = (cursor: unknown) => Reflect.apply(fake.repository.pull, fake.repository, [owner, cursor]);
    await expect(invokePush({ mutationId: 123, resourceId: 'category-1', baseVersion: null, payload: { slug: 'valid', nameZh: 'Valid' } })).rejects.toThrow('mutationId');
    await expect(invokePush({ mutationId: 'm', resourceId: 'category-1', baseVersion: 1, payload: { slug: 'valid', nameZh: 'Valid' } })).rejects.toThrow('baseVersion');
    await expect(invokePull(1)).rejects.toThrow('cursor');
    expect(fake.connection.attempts).toBe(0);
  });
});
