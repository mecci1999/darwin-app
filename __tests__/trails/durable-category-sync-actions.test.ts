import { Starlight } from '../../src/typings';
import trailsActions from '../../src/apps/trails/actions';
import { InMemoryTrailsRepository } from '../../src/apps/trails/repository';
import { TrailsSyncDuplicateSlugError, TrailsSyncPersistenceError } from '../../src/apps/trails/repository/mysqlPortfolioCategorySync';
import { Actor, DurablePortfolioCategoryPushConflict, DurablePortfolioCategoryPushResult, DurablePortfolioCategorySync, TrailsState } from '../../src/apps/trails/types';

const owner: Actor = { tenantId: 'tenant-1', userId: 'owner-1', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const participant: Actor = { tenantId: owner.tenantId, userId: 'participant-1', isAdmin: false };
const star = { emit: jest.fn() } as unknown as Starlight;
const context = (actor: Actor, actionParams: object) => ({ meta: { tenantId: actor.tenantId, user: actor }, params: actionParams });
const createPayload = { mutationId: 'mutation-1', resourceId: 'category-1', baseVersion: null, payload: { slug: 'mountains', nameZh: '山岳' } };
const category = { id: 'category-1', tenantId: owner.tenantId, ownerUserId: owner.userId, slug: 'mountains', nameZh: '山岳', description: '', sortOrder: 0, visibility: 'private' as const, status: 'active' as const, lifecycle: 'draft' as const, resourceVersion: '1', createdAt: '2026-07-31T00:00:00.000Z', updatedAt: '2026-07-31T00:00:00.000Z' };

const appliedResult = (): DurablePortfolioCategoryPushResult => ({ kind: 'applied', mutationId: 'mutation-1', resource: category });
const durable = (overrides: Partial<DurablePortfolioCategorySync> = {}): DurablePortfolioCategorySync => ({
  push: jest.fn(() => Promise.resolve(appliedResult())),
  create: jest.fn(() => Promise.resolve(appliedResult())),
  archive: jest.fn(() => Promise.resolve(appliedResult())),
  pull: jest.fn(async () => ({ changes: [], nextCursor: '0' })),
  listWorkspace: jest.fn(async () => [category]),
  listPublic: jest.fn(async () => [category]),
  resolvePublic: jest.fn(async () => undefined),
  reorder: jest.fn(async () => [appliedResult()]),
  ...overrides,
});

describe('v2.category-sync durable-only actions', () => {
  it('returns 503 when the durable adapter is unavailable and does not mutate v1 memory', async () => {
    const repository = new InMemoryTrailsRepository();
    const response = await trailsActions(star, { repository })['v2.category-sync.push'].handler(context(owner, createPayload) as never);
    expect(response.status).toBe(503);
    expect(repository.getPortfolioCategory('category-1')).toBeUndefined();
  });

  it('reads the durable dependency at request time after lifecycle composition', async () => {
    const state: TrailsState = { repository: new InMemoryTrailsRepository() };
    const actions = trailsActions(star, state);
    const sync = durable();
    state.durablePortfolioCategorySync = sync;

    const response = await actions['v2.category-sync.pull'].handler(context(owner, {}) as never);

    expect(response.data.success).toBe(true);
    expect(sync.pull).toHaveBeenCalledWith(owner, undefined);
  });

  it('passes canonical decimal strings to the durable adapter without coercion', async () => {
    const sync = durable();
    const response = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durablePortfolioCategorySync: sync })['v2.category-sync.push'].handler(context(owner, { ...createPayload, baseVersion: '9007199254740993' }) as never);
    expect(response.data.success).toBe(true);
    expect(sync.push).toHaveBeenCalledWith(owner, expect.objectContaining({ baseVersion: '9007199254740993' }));
  });

  it.each([{ baseVersion: 1 }, { baseVersion: '01' }, { baseVersion: undefined }])('rejects non-canonical v2 baseVersion %# without calling the durable adapter', async (input) => {
    const sync = durable();
    const response = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durablePortfolioCategorySync: sync })['v2.category-sync.push'].handler(context(owner, { ...createPayload, ...input }) as never);
    expect(response.status).toBe(400);
    expect(response.data.success).toBe(false);
    expect(sync.push).not.toHaveBeenCalled();
  });

  it('requires trusted creator capability before accessing the durable adapter', async () => {
    const sync = durable();
    const response = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durablePortfolioCategorySync: sync })['v2.category-sync.pull'].handler(context(participant, {}) as never);
    expect(response.status).toBe(403);
    expect(sync.pull).not.toHaveBeenCalled();
  });

  it('maps durable stale conflicts to 409 and persistence failures to 503', async () => {
    const conflictResult: DurablePortfolioCategoryPushConflict = { kind: 'conflict', mutationId: 'mutation-1', code: 'STALE_VERSION', resourceId: 'category-1', baseVersion: '0', current: category };
    const conflictSync = durable({ push: jest.fn(() => Promise.resolve(conflictResult)) });
    const conflict = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durablePortfolioCategorySync: conflictSync })['v2.category-sync.push'].handler(context(owner, { ...createPayload, baseVersion: '0' }) as never);
    const unavailableSync = durable({ push: jest.fn(async () => { throw new TrailsSyncPersistenceError('storage unavailable'); }) });
    const unavailable = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durablePortfolioCategorySync: unavailableSync })['v2.category-sync.push'].handler(context(owner, createPayload) as never);
    expect(conflict.status).toBe(409);
    expect(unavailable.status).toBe(503);
  });

  it('maps duplicate-slug adapter errors to a safe client failure and validates pull cursors as strings', async () => {
    const sync = durable({ push: jest.fn(async () => { throw new TrailsSyncDuplicateSlugError('duplicate slug'); }) });
    const actions = trailsActions(star, { repository: new InMemoryTrailsRepository(), durablePortfolioCategorySync: sync });
    const duplicate = await actions['v2.category-sync.push'].handler(context(owner, createPayload) as never);
    const cursor = await actions['v2.category-sync.pull'].handler(context(owner, { cursor: 1 }) as never);
    expect(duplicate.data.success).toBe(false);
    expect(cursor.data.success).toBe(false);
    expect(sync.pull).not.toHaveBeenCalled();
  });

  it('maps unexpected durable adapter failures to 503 without returning database details', async () => {
    const sync = durable({ listWorkspace: jest.fn(async () => { throw new Error('ER_ACCESS_DENIED_ERROR private database detail'); }) });
    const response = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durablePortfolioCategorySync: sync })['v2.categories.workspace'].handler(context(owner, {}) as never);

    expect(response.status).toBe(503);
    expect(response.data.message).toBe('耐久分类当前不可用');
  });

  it('leaves v1 sync backed by its unchanged in-memory repository even when durable sync exists', async () => {
    const repository = new InMemoryTrailsRepository(); const sync = durable();
    const response = await trailsActions(star, { repository, durablePortfolioCategorySync: sync } satisfies TrailsState)['v1.sync.push'].handler(context(owner, { ...createPayload, deviceId: 'device-1', resourceType: 'portfolio-category', operation: 'upsert', baseVersion: null }) as never);
    expect(response.data.success).toBe(true);
    expect(repository.getPortfolioCategory('category-1')).toEqual(expect.objectContaining({ slug: 'mountains' }));
    expect(sync.push).not.toHaveBeenCalled();
  });

  it('keeps v2 category workspace unavailable without mutating v1 memory', async () => {
    const repository = new InMemoryTrailsRepository();
    const response = await trailsActions(star, { repository })['v2.categories.create'].handler(context(owner, { slug: 'durable-only', nameZh: '仅耐久' }) as never);
    expect(response.status).toBe(503);
    expect(repository.getPortfolioCategory('durable-only')).toBeUndefined();
  });

  it('uses the trusted editor owner space and server-generated mutation identifiers for category CRUD', async () => {
    const editor: Actor = { tenantId: owner.tenantId, userId: 'editor-1', isAdmin: false, creatorSpaceRole: 'creator-space-editor', creatorSpaceOwnerUserId: owner.userId };
    const sync = durable();
    const response = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durablePortfolioCategorySync: sync })['v2.categories.create'].handler(context(editor, { slug: 'editor-category', nameZh: '编辑分类', tenantId: 'spoofed', ownerUserId: 'spoofed' }) as never);
    expect(response.status).toBe(201);
    expect(sync.create).toHaveBeenCalledWith(editor, expect.objectContaining({ mutationId: expect.stringMatching(/^v2-category-mutation_/), baseVersion: null, payload: { slug: 'editor-category', nameZh: '编辑分类' } }));
  });

  it('maps category update and archive stale conflicts to 409 without reading v1 memory', async () => {
    const conflict: DurablePortfolioCategoryPushConflict = { kind: 'conflict', mutationId: 'generated', code: 'STALE_VERSION', resourceId: category.id, baseVersion: '1', current: category };
    const sync = durable({ push: jest.fn(async () => conflict), archive: jest.fn(async () => conflict) });
    const actions = trailsActions(star, { repository: new InMemoryTrailsRepository(), durablePortfolioCategorySync: sync });
    const update = await actions['v2.categories.update'].handler(context(owner, { id: category.id, resourceVersion: '1', nameZh: '新名称' }) as never);
    const archive = await actions['v2.categories.archive'].handler(context(owner, { id: category.id, resourceVersion: '1' }) as never);
    expect(update.status).toBe(409);
    expect(archive.status).toBe(409);
  });

  it('exposes only the durable public projection and delegates atomic reorder with canonical versions', async () => {
    const publicCategory = { ...category, visibility: 'public' as const, lifecycle: 'published' as const };
    const privateCategory = { ...category, id: 'private-category', visibility: 'private' as const };
    const draftCategory = { ...publicCategory, id: 'draft-category', lifecycle: 'draft' as const };
    const sync = durable({ listPublic: jest.fn(async () => [publicCategory, privateCategory, draftCategory]) });
    const actions = trailsActions(star, { repository: new InMemoryTrailsRepository(), durablePortfolioCategorySync: sync });
    const publicResponse = await actions['v2.categories.public'].handler({ meta: {}, params: {} } as never);
    const reordered = await actions['v2.categories.reorder'].handler(context(owner, { mutationId: 'reorder-batch-1', items: [{ id: 'category-2', resourceVersion: '2' }, { id: 'category-1', resourceVersion: '1' }] }) as never);
    expect(publicResponse.data.content).toEqual([expect.objectContaining({ id: category.id })]);
    expect((publicResponse.data.content as Array<Record<string, unknown>>)[0]).not.toHaveProperty('resourceVersion');
    expect(reordered.data.success).toBe(true);
    expect(sync.reorder).toHaveBeenCalledWith(owner, [expect.objectContaining({ mutationId: 'reorder-batch-1:0', resourceId: 'category-2', baseVersion: '2', payload: { sortOrder: 0 } }), expect.objectContaining({ mutationId: 'reorder-batch-1:1', resourceId: 'category-1', baseVersion: '1', payload: { sortOrder: 1 } })]);
  });
  it('uses only its configured server-side public owner and keeps public categories allowlisted and ordered', async () => {
    const first = { ...category, id: 'first', slug: 'alps', sortOrder: 1, visibility: 'public' as const, lifecycle: 'published' as const };
    const second = { ...category, id: 'second', slug: 'coast', sortOrder: 2, visibility: 'public' as const, lifecycle: 'published' as const };
    const sync = durable({ listPublic: jest.fn(async () => [first, second]) });
    const resolver = { resolve: jest.fn(() => ({ tenantId: 'configured-tenant', ownerUserId: 'configured-owner' })) };
    const actions = trailsActions(star, { repository: new InMemoryTrailsRepository(), durablePortfolioCategorySync: sync, publicOwnerResolver: resolver });
    const response = await actions['v2.categories.public'].handler({ meta: { tenantId: 'spoofed-tenant', user: participant }, params: { tenantId: 'spoofed', ownerUserId: 'spoofed' } } as never);

    expect(response.data.content).toEqual([expect.objectContaining({ id: first.id }), expect.objectContaining({ id: second.id })]);
    expect(sync.listPublic).toHaveBeenCalledWith({ tenantId: 'configured-tenant', userId: 'configured-owner' });
  });
  it('fails closed when production owner configuration is unavailable', async () => {
    const response = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durablePortfolioCategorySync: durable(), publicOwnerResolver: { resolve: () => undefined } })['v2.categories.public'].handler({ meta: {}, params: {} } as never);
    expect(response.status).toBe(404);
  });
  it('maps typed input errors to 400 and unknown sync errors to fixed 503 without message leakage', async () => {
    const inputSync = durable();
    const invalid = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durablePortfolioCategorySync: inputSync })['v2.categories.reorder'].handler(context(owner, { mutationId: 'reorder-batch-invalid', items: [] }) as never);
    const unknownSync = durable({ push: jest.fn(async () => { throw new Error('必须 not leak'); }) });
    const unavailable = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durablePortfolioCategorySync: unknownSync })['v2.category-sync.push'].handler(context(owner, createPayload) as never);
    expect(invalid.status).toBe(400);
    expect(unavailable.status).toBe(503);
    expect(unavailable.data.message).toBe('耐久分类当前不可用');
  });

  it('rejects an overlong reorder batch identity before calling the durable store', async () => {
    const sync = durable();
    const response = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durablePortfolioCategorySync: sync })['v2.categories.reorder'].handler(context(owner, { mutationId: 'x'.repeat(158), items: [{ id: 'category-1', resourceVersion: '1' }] }) as never);

    expect(response.status).toBe(400);
    expect(sync.reorder).not.toHaveBeenCalled();
  });
});
