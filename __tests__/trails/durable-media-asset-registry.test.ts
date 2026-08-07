import { Actor } from '../../src/apps/starlight/trails/types';
import { MediaAssetRegistryModels, MySqlMediaAssetRegistryRepository } from '../../src/apps/starlight/trails/repository/mysqlMediaAssetRegistry';
import { ITrailsMediaAssetRegistryTableAttributes } from '../../src/db/mysql/models/trailsMediaAssetRegistry';
import { ITrailsMediaAssetVariantTableAttributes } from '../../src/db/mysql/models/trailsMediaAssetVariant';
import { ITrailsMediaAssetArtifactTableAttributes } from '../../src/db/mysql/models/trailsMediaAssetArtifact';

const owner: Actor = { tenantId: 'tenant-a', userId: 'owner-a', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const other: Actor = { tenantId: 'tenant-a', userId: 'owner-b', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const crossTenant: Actor = { tenantId: 'tenant-b', userId: 'owner-a', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const at = new Date('2026-01-01T00:00:00.000Z');
type AssetFixture = Required<ITrailsMediaAssetRegistryTableAttributes>;
type VariantFixture = Required<ITrailsMediaAssetVariantTableAttributes>;
type ArtifactFixture = Required<ITrailsMediaAssetArtifactTableAttributes>;
const assets = new Map<string, AssetFixture>();
const variants = new Map<string, VariantFixture>();
const artifacts = new Map<string, ArtifactFixture>();
const mutations = new Map<string, { tenantId: string; actorUserId: string; mutationId: string; fingerprint: string; resultJson: string }>();
let mutationFailure: 'write' | 'race' | 'missing' | 'ledger-index' | undefined;
let assetFailure: 'duplicate' | undefined;
let variantFailure: 'deadlock' | undefined;
let artifactFailure: 'write' | undefined;
let remoteMutation: { tenantId: string; actorUserId: string; mutationId: string; fingerprint: string; resultJson: string } | undefined;
const key = (tenantId: string, assetId: string) => `${tenantId}:${assetId}`;
const clone = <T>(input: T): T => structuredClone(input);
const ledgerKey = (tenantId: string, actorUserId: string, mutationId: string) => `${tenantId}:${actorUserId}:${mutationId}`;
const duplicate = (table: string, index: string): Error => {
  const sqlMessage = `Duplicate entry 'fixture' for key '${index}'`;
  const parent = Object.assign(new Error(sqlMessage), { code: 'ER_DUP_ENTRY', errno: 1062, sqlState: '23000', sqlMessage, sql: `INSERT INTO \`${table}\` VALUES (...)` });
  return Object.assign(new Error(sqlMessage), { name: 'SequelizeUniqueConstraintError', parent, original: parent, fields: { [index]: 'fixture' }, sql: parent.sql });
};
const ledgerConflict = () => duplicate('TrailsMediaAssetRegistryMutation', 'PRIMARY');
const assetConflict = () => duplicate('TrailsMediaAssetRegistry', 'PRIMARY');
const deadlock = (table: string): Error => {
  const parent = Object.assign(new Error('Deadlock found when trying to get lock; try restarting transaction'), { code: 'ER_LOCK_DEADLOCK', errno: 1213, sqlState: '40001', sql: `UPDATE \`${table}\` SET value = value` });
  return Object.assign(new Error('Deadlock found when trying to get lock; try restarting transaction'), { name: 'SequelizeDatabaseError', parent, original: parent, sql: parent.sql });
};
const models = (): MediaAssetRegistryModels => ({
  assets: {
    async create(input) { if (assetFailure === 'duplicate') throw assetConflict(); assets.set(key(input.tenantId, input.id), input); return input; },
    async find(input) { return assets.get(key(input.tenantId, input.id)); },
    async list(input) { return [...assets.values()].filter(row => row.tenantId === input.tenantId && row.ownerUserId === input.ownerUserId).sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime() || left.id.localeCompare(right.id)); },
    async cas(input) { const current = assets.get(key(input.tenantId, input.id)); if (!current || current.resourceVersion !== input.expectedVersion) return undefined; assets.set(key(input.tenantId, input.id), input.next); return input.next; },
  },
  variants: {
    async upsert(input) { if (variantFailure === 'deadlock') throw deadlock('TrailsMediaAssetVariant'); variants.set(`${key(input.tenantId, input.assetId)}:${input.name}`, input); },
    async list(input) { return [...variants.values()].filter(row => row.tenantId === input.tenantId && row.assetId === input.assetId); },
  },
  artifacts: {
    async upsert(input) { if (artifactFailure === 'write') throw new Error('artifact write failed'); artifacts.set(`${key(input.tenantId, input.assetId)}:${input.logicalRendition}:${input.codec}`, input); },
    async list(input) { return [...artifacts.values()].filter(row => row.tenantId === input.tenantId && row.assetId === input.assetId); },
  },
  mutations: {
    async find(input) { return mutations.get(`${input.tenantId}:${input.actorUserId}:${input.mutationId}`); },
    async create(input) { if (mutationFailure === 'write') throw new Error('ledger write failed'); if (mutationFailure === 'race') { remoteMutation = clone(input); throw ledgerConflict(); } if (mutationFailure === 'missing') throw ledgerConflict(); if (mutationFailure === 'ledger-index') throw duplicate('TrailsMediaAssetRegistryMutation', 'future_unique_index'); mutations.set(`${input.tenantId}:${input.actorUserId}:${input.mutationId}`, input); },
  },
});
const repository = () => new MySqlMediaAssetRegistryRepository({ async transaction<T>(work: (transaction: object) => Promise<T>) { const snapshot = { assets: clone([...assets]), variants: clone([...variants]), artifacts: clone([...artifacts]), mutations: clone([...mutations]) }; try { return await work({}); } catch (error: unknown) { assets.clear(); variants.clear(); artifacts.clear(); mutations.clear(); snapshot.assets.forEach(([mapKey, row]) => assets.set(mapKey, row)); snapshot.variants.forEach(([mapKey, row]) => variants.set(mapKey, row)); snapshot.artifacts.forEach(([mapKey, row]) => artifacts.set(mapKey, row)); snapshot.mutations.forEach(([mapKey, row]) => mutations.set(mapKey, row)); if (remoteMutation) { mutations.set(ledgerKey(remoteMutation.tenantId, remoteMutation.actorUserId, remoteMutation.mutationId), remoteMutation); remoteMutation = undefined; } throw error; } } }, models(), () => at);
const nineArtifacts = () => (['grid-800', 'cover-1600', 'preview-2048'] as const).flatMap(logicalRendition => (['avif', 'webp', 'jpeg'] as const).map(codec => ({ logicalRendition, codec, mimeType: `image/${codec}` as const, privateLocator: `${logicalRendition}_${codec}`, width: 800, height: 600, byteLength: 100, sha256: 'a'.repeat(64) })));

describe('durable media asset registry', () => {
  beforeEach(() => { assets.clear(); variants.clear(); artifacts.clear(); mutations.clear(); mutationFailure = undefined; assetFailure = undefined; variantFailure = undefined; artifactFailure = undefined; remoteMutation = undefined; });
  it('atomically persists exactly nine private codec artifacts with CAS, idempotency, owner enforcement, and no public leakage', async () => {
    const store = repository();
    const registered = await store.register(owner, { mutationId: 'artifact-create', expectedResourceVersion: null, id: 'asset_1', mimeType: 'image/jpeg', privateMasterLocator: 'master_locator' });
    await expect(store.persistArtifacts(other, { mutationId: 'artifact-other', expectedResourceVersion: registered.resourceVersion, assetId: registered.id, artifacts: nineArtifacts() })).rejects.toThrow('不属于当前创作空间');
    await expect(store.persistArtifacts(owner, { mutationId: 'artifact-stale', expectedResourceVersion: '0', assetId: registered.id, artifacts: nineArtifacts() })).rejects.toThrow('版本已过期');
    const persisted = await store.persistArtifacts(owner, { mutationId: 'artifact-persist', expectedResourceVersion: registered.resourceVersion, assetId: registered.id, artifacts: nineArtifacts() });
    expect(artifacts.size).toBe(9);
    expect(variants.size).toBe(0);
    expect(JSON.stringify(persisted)).not.toMatch(/master_locator|grid-800_avif|https?:\/\//);
    await expect(store.persistArtifacts(owner, { mutationId: 'artifact-persist', expectedResourceVersion: registered.resourceVersion, assetId: registered.id, artifacts: nineArtifacts() })).resolves.toEqual(persisted);
    await expect(store.persistArtifacts(owner, { mutationId: 'artifact-persist', expectedResourceVersion: persisted.resourceVersion, assetId: registered.id, artifacts: nineArtifacts() })).rejects.toThrow('mutationId不能用于不同的写入');
  });
  it('replays a reordered exact artifact matrix without a second version mutation and rejects changed descriptor content', async () => {
    const store = repository();
    const registered = await store.register(owner, { mutationId: 'artifact-order-create', expectedResourceVersion: null, id: 'asset_1', mimeType: 'image/jpeg', privateMasterLocator: 'master_locator' });
    const descriptors = nineArtifacts();
    const persisted = await store.persistArtifacts(owner, { mutationId: 'artifact-order-persist', expectedResourceVersion: registered.resourceVersion, assetId: registered.id, artifacts: descriptors });
    const replay = await store.persistArtifacts(owner, { mutationId: 'artifact-order-persist', expectedResourceVersion: registered.resourceVersion, assetId: registered.id, artifacts: [...descriptors].reverse() });
    expect(replay).toEqual(persisted);
    expect(assets.get(key(owner.tenantId, registered.id))?.resourceVersion).toBe('2');
    const changed = [...descriptors];
    changed[0] = { ...changed[0], privateLocator: 'changed_locator' };
    await expect(store.persistArtifacts(owner, { mutationId: 'artifact-order-persist', expectedResourceVersion: registered.resourceVersion, assetId: registered.id, artifacts: changed })).rejects.toThrow('mutationId不能用于不同的写入');
    expect(assets.get(key(owner.tenantId, registered.id))?.resourceVersion).toBe('2');
  });
  it('rejects incomplete, unsafe, and noncanonical private artifact descriptors', async () => {
    const store = repository();
    const registered = await store.register(owner, { mutationId: 'artifact-validation-create', expectedResourceVersion: null, id: 'asset_1', mimeType: 'image/jpeg', privateMasterLocator: 'master_locator' });
    await expect(store.persistArtifacts(owner, { mutationId: 'artifact-incomplete', expectedResourceVersion: registered.resourceVersion, assetId: registered.id, artifacts: nineArtifacts().slice(0, 8) })).rejects.toThrow('精确九项矩阵');
    const invalid = nineArtifacts();
    invalid[0] = { ...invalid[0], privateLocator: 'https://private.example/artifact' };
    await expect(store.persistArtifacts(owner, { mutationId: 'artifact-url', expectedResourceVersion: registered.resourceVersion, assetId: registered.id, artifacts: invalid })).rejects.toThrow('不透明引用');
    const invalidHash = nineArtifacts();
    invalidHash[0] = { ...invalidHash[0], sha256: 'A'.repeat(64) };
    await expect(store.persistArtifacts(owner, { mutationId: 'artifact-hash', expectedResourceVersion: registered.resourceVersion, assetId: registered.id, artifacts: invalidHash })).rejects.toThrow('SHA-256');
  });
  it('rolls back all artifact upserts and the CAS when any artifact write fails', async () => {
    const store = repository();
    const registered = await store.register(owner, { mutationId: 'artifact-rollback-create', expectedResourceVersion: null, id: 'asset_1', mimeType: 'image/jpeg', privateMasterLocator: 'master_locator' });
    artifactFailure = 'write';
    await expect(store.persistArtifacts(owner, { mutationId: 'artifact-rollback', expectedResourceVersion: registered.resourceVersion, assetId: registered.id, artifacts: nineArtifacts() })).rejects.toThrow('artifact write failed');
    expect(artifacts.size).toBe(0);
    expect(assets.get(key(owner.tenantId, registered.id))?.resourceVersion).toBe('1');
    expect(mutations.has(ledgerKey(owner.tenantId, owner.userId, 'artifact-rollback'))).toBe(false);
  });
  it('rejects a cross-owner variant mutation and cannot publish incomplete assets', async () => {
    const store = repository();
    const created = await store.register(owner, { mutationId: 'create', expectedResourceVersion: null, id: 'asset_1', mimeType: 'image/jpeg', privateMasterLocator: 'deployment_master_1' });
    await expect(store.registerVariant(other, { mutationId: 'other', expectedResourceVersion: created.resourceVersion, assetId: created.id, name: 'cover-1600', publicReference: 'cover_ref', width: 1600, height: 1000, state: 'ready' })).rejects.toThrow('不属于当前创作空间');
    await expect(store.publish(owner, { mutationId: 'publish', expectedResourceVersion: created.resourceVersion, id: created.id })).rejects.toThrow('全部ready');
  });
  it('publishes only after all exact ready variants without exposing a public lookup', async () => {
    const store = repository();
    let record = await store.register(owner, { mutationId: 'create', expectedResourceVersion: null, id: 'asset_1', mimeType: 'image/jpeg', privateMasterLocator: 'deployment_master_1' });
    for (const name of ['grid-800', 'cover-1600', 'preview-2048'] as const) record = await store.registerVariant(owner, { mutationId: `variant_${name}`, expectedResourceVersion: record.resourceVersion, assetId: record.id, name, publicReference: `${name}_ref`, width: 800, height: 600, state: 'ready' });
    const published = await store.publish(owner, { mutationId: 'publish', expectedResourceVersion: record.resourceVersion, id: record.id });
    expect(published).toEqual(expect.objectContaining({ id: 'asset_1', status: 'published' }));
    expect(JSON.stringify(published)).not.toMatch(/deployment_master_1|https?:\/\/|publicReference|privateLocator/);
    expect('getPublicById' in store).toBe(false);
    expect('getById' in store).toBe(false);
  });
  it('lists only current-owner published media with complete ready rendition references and no storage metadata', async () => {
    const store = repository();
    let ready = await store.register(owner, { mutationId: 'picker-ready', expectedResourceVersion: null, id: 'asset_ready', mimeType: 'image/jpeg', privateMasterLocator: 'master_locator' });
    for (const name of ['grid-800', 'cover-1600', 'preview-2048'] as const) ready = await store.registerVariant(owner, { mutationId: `picker-${name}`, expectedResourceVersion: ready.resourceVersion, assetId: ready.id, name, publicReference: `${name}_ref`, width: 800, height: 600, state: 'ready' });
    await store.publish(owner, { mutationId: 'picker-publish', expectedResourceVersion: ready.resourceVersion, id: ready.id });
    await store.register(other, { mutationId: 'picker-other', expectedResourceVersion: null, id: 'asset_other', mimeType: 'image/jpeg', privateMasterLocator: 'other_master' });
    await store.register(owner, { mutationId: 'picker-draft', expectedResourceVersion: null, id: 'asset_draft', mimeType: 'image/jpeg', privateMasterLocator: 'draft_master' });
    const result = await store.listWorkspacePicker(owner);
    expect(result).toEqual([{ id: 'asset_ready', lifecycle: 'published', readiness: 'ready', mimeType: 'image/jpeg', renditions: [{ name: 'grid-800', width: 800, height: 600, reference: 'grid-800_ref' }, { name: 'cover-1600', width: 800, height: 600, reference: 'cover-1600_ref' }, { name: 'preview-2048', width: 800, height: 600, reference: 'preview-2048_ref' }] }]);
    expect(await store.listWorkspacePicker(other)).toEqual([]);
    expect(await store.listWorkspacePicker(crossTenant)).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/tenantId|ownerUserId|master_locator|privateLocator|objectKey|https?:\/\//);
    const corrupted = variants.get(`${key(owner.tenantId, 'asset_ready')}:grid-800`);
    if (!corrupted) throw new Error('picker fixture variant missing');
    corrupted.publicReference = 'https://invalid.example/image';
    await expect(store.listWorkspacePicker(owner)).rejects.toThrow('unsafe public reference');
  });
  it('projects configured public-owner ready assets through the same opaque picker boundary', async () => {
    const store = repository();
    let ready = await store.register(owner, { mutationId: 'public-create', expectedResourceVersion: null, id: 'asset_public', mimeType: 'image/jpeg', privateMasterLocator: 'master_locator' });
    for (const name of ['grid-800', 'cover-1600', 'preview-2048'] as const) ready = await store.registerVariant(owner, { mutationId: `public-${name}`, expectedResourceVersion: ready.resourceVersion, assetId: ready.id, name, publicReference: `${name}_reference`, width: 800, height: 600, state: 'ready' });
    await store.publish(owner, { mutationId: 'public-publish', expectedResourceVersion: ready.resourceVersion, id: ready.id });
    const publicAssets = await store.listPublic({ tenantId: owner.tenantId, userId: owner.userId });
    expect(publicAssets).toEqual([{ id: 'asset_public', lifecycle: 'published', readiness: 'ready', mimeType: 'image/jpeg', renditions: [{ name: 'grid-800', width: 800, height: 600, reference: 'grid-800_reference' }, { name: 'cover-1600', width: 800, height: 600, reference: 'cover-1600_reference' }, { name: 'preview-2048', width: 800, height: 600, reference: 'preview-2048_reference' }] }]);
    expect(JSON.stringify(publicAssets)).not.toMatch(/tenantId|ownerUserId|master_locator|privateLocator|objectKey|https?:\/\//);
  });
  it('rejects URLs, object keys, invalid MIME and non-positive dimensions', async () => {
    const store = repository();
    await expect(store.register(owner, { mutationId: 'bad', expectedResourceVersion: null, id: 'asset_1', mimeType: 'text/plain', privateMasterLocator: 'locator' })).rejects.toThrow('图片类型');
    const record = await store.register(owner, { mutationId: 'create', expectedResourceVersion: null, id: 'asset_1', mimeType: 'image/png', privateMasterLocator: 'locator' });
    await expect(store.registerVariant(owner, { mutationId: 'bad-reference', expectedResourceVersion: record.resourceVersion, assetId: record.id, name: 'grid-800', publicReference: 'https://bad.example/image', width: 1, height: 1, state: 'ready' })).rejects.toThrow('安全不透明引用');
    await expect(store.registerVariant(owner, { mutationId: 'bad-size', expectedResourceVersion: record.resourceVersion, assetId: record.id, name: 'grid-800', publicReference: 'safe_ref', width: 0, height: 1, state: 'ready' })).rejects.toThrow('正整数');
  });
  it('replays exact actor-scoped mutations and rejects altered reuse without mutating state', async () => {
    const store = repository();
    const first = await store.register(owner, { mutationId: 'create', expectedResourceVersion: null, id: 'asset_1', mimeType: 'image/jpeg', privateMasterLocator: 'locator' });
    const replay = await store.register(owner, { mutationId: 'create', expectedResourceVersion: null, id: 'asset_1', mimeType: 'image/jpeg', privateMasterLocator: 'locator' });
    expect(replay).toEqual(first);
    await expect(store.register(owner, { mutationId: 'create', expectedResourceVersion: null, id: 'asset_2', mimeType: 'image/jpeg', privateMasterLocator: 'locator' })).rejects.toThrow('mutationId不能用于不同的写入');
    expect(assets.has(key(owner.tenantId, 'asset_2'))).toBe(false);
    const changed = await store.registerVariant(owner, { mutationId: 'variant', expectedResourceVersion: first.resourceVersion, assetId: first.id, name: 'grid-800', publicReference: 'grid_ref', width: 800, height: 600, state: 'ready' });
    const changedReplay = await store.registerVariant(owner, { mutationId: 'variant', expectedResourceVersion: first.resourceVersion, assetId: first.id, name: 'grid-800', publicReference: 'grid_ref', width: 800, height: 600, state: 'ready' });
    expect(changedReplay).toEqual(changed);
    await expect(store.registerVariant(owner, { mutationId: 'variant', expectedResourceVersion: changed.resourceVersion, assetId: first.id, name: 'cover-1600', publicReference: 'cover_ref', width: 1600, height: 1000, state: 'ready' })).rejects.toThrow('mutationId不能用于不同的写入');
  });
  it.each(['register', 'variant', 'publish'] as const)('replays a committed ledger race for %s without rerunning the mutation work', async (operation) => {
    const store = repository();
    if (operation === 'register') {
      mutationFailure = 'race';
      const replay = await store.register(owner, { mutationId: 'register-race', expectedResourceVersion: null, id: 'asset_1', mimeType: 'image/jpeg', privateMasterLocator: 'locator' });
      expect(replay).toEqual(expect.objectContaining({ id: 'asset_1', resourceVersion: '1' }));
      expect(assets.size).toBe(0);
      return;
    }
    const created = await store.register(owner, { mutationId: `seed-${operation}`, expectedResourceVersion: null, id: 'asset_1', mimeType: 'image/jpeg', privateMasterLocator: 'locator' });
    if (operation === 'variant') {
      mutationFailure = 'race';
      const replay = await store.registerVariant(owner, { mutationId: 'variant-race', expectedResourceVersion: created.resourceVersion, assetId: created.id, name: 'grid-800', publicReference: 'grid_ref', width: 800, height: 600, state: 'ready' });
      expect(replay.resourceVersion).toBe('2');
      expect(variants.size).toBe(0);
      return;
    }
    let record = created;
    for (const name of ['grid-800', 'cover-1600', 'preview-2048'] as const) record = await store.registerVariant(owner, { mutationId: `seed-${name}`, expectedResourceVersion: record.resourceVersion, assetId: record.id, name, publicReference: `${name}_ref`, width: 800, height: 600, state: 'ready' });
    mutationFailure = 'race';
    const replay = await store.publish(owner, { mutationId: 'publish-race', expectedResourceVersion: record.resourceVersion, id: record.id });
    expect(replay).toEqual(expect.objectContaining({ status: 'published', resourceVersion: '5' }));
    expect(assets.get(key(owner.tenantId, created.id))?.status).toBe('draft');
  });
  it('rolls back resource changes on a ledger write failure and fails closed when a retry has no ledger row', async () => {
    const store = repository();
    mutationFailure = 'write';
    await expect(store.register(owner, { mutationId: 'rollback', expectedResourceVersion: null, id: 'asset_1', mimeType: 'image/jpeg', privateMasterLocator: 'locator' })).rejects.toThrow('ledger write failed');
    expect(assets.size).toBe(0);
    mutationFailure = 'missing';
    await expect(store.register(owner, { mutationId: 'missing', expectedResourceVersion: null, id: 'asset_1', mimeType: 'image/jpeg', privateMasterLocator: 'locator' })).rejects.toThrow('no committed ledger result');
    expect(assets.size).toBe(0);
  });
  it('propagates a non-ledger duplicate without opening replay ledger lookup', async () => {
    const store = repository();
    assetFailure = 'duplicate';
    await expect(store.register(owner, { mutationId: 'asset-duplicate', expectedResourceVersion: null, id: 'asset_1', mimeType: 'image/jpeg', privateMasterLocator: 'locator' })).rejects.toMatchObject({ name: 'SequelizeUniqueConstraintError' });
    expect(mutations.size).toBe(0);
    expect(assets.size).toBe(0);
  });
  it('propagates a non-primary duplicate on the ledger table without replaying', async () => {
    const store = repository();
    mutationFailure = 'ledger-index';
    await expect(store.register(owner, { mutationId: 'ledger-index', expectedResourceVersion: null, id: 'asset_1', mimeType: 'image/jpeg', privateMasterLocator: 'locator' })).rejects.toThrow('future_unique_index');
    expect(assets.size).toBe(0);
    expect(mutations.size).toBe(0);
  });
  it('propagates asset and variant deadlocks without opening replay ledger lookup', async () => {
    const store = repository();
    const originalCreate = models;
    const assetDeadlockStore = new MySqlMediaAssetRegistryRepository({ async transaction<T>(work: (transaction: object) => Promise<T>) { return work({}); } }, { ...originalCreate(), assets: { ...originalCreate().assets, async create() { throw deadlock('TrailsMediaAssetRegistry'); } } }, () => at);
    await expect(assetDeadlockStore.register(owner, { mutationId: 'asset-deadlock', expectedResourceVersion: null, id: 'asset_1', mimeType: 'image/jpeg', privateMasterLocator: 'locator' })).rejects.toMatchObject({ name: 'SequelizeDatabaseError' });
    expect(mutations.size).toBe(0);
    const created = await store.register(owner, { mutationId: 'seed-deadlock', expectedResourceVersion: null, id: 'asset_1', mimeType: 'image/jpeg', privateMasterLocator: 'locator' });
    variantFailure = 'deadlock';
    await expect(store.registerVariant(owner, { mutationId: 'variant-deadlock', expectedResourceVersion: created.resourceVersion, assetId: created.id, name: 'grid-800', publicReference: 'grid_ref', width: 800, height: 600, state: 'ready' })).rejects.toMatchObject({ name: 'SequelizeDatabaseError' });
    expect(mutations.has(ledgerKey(owner.tenantId, owner.userId, 'variant-deadlock'))).toBe(false);
  });
});
