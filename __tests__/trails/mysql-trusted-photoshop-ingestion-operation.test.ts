import { ITrailsTrustedPhotoshopIngestionArtifactTableAttributes } from '../../src/db/mysql/models/trailsTrustedPhotoshopIngestionArtifact';
import { ITrailsTrustedPhotoshopIngestionOperationTableAttributes } from '../../src/db/mysql/models/trailsTrustedPhotoshopIngestionOperation';
import { ITrailsTrustedPhotoshopStorageWriteFenceTableAttributes } from '../../src/db/mysql/models/trailsTrustedPhotoshopStorageWriteFence';
import { MySqlTrustedPhotoshopIngestionOperationRepository, TrustedPhotoshopIngestionModels } from '../../src/apps/starlight/trails/repository/mysqlTrustedPhotoshopIngestionOperation';

type Operation = ITrailsTrustedPhotoshopIngestionOperationTableAttributes & { createdAt: Date; updatedAt: Date };
type Artifact = ITrailsTrustedPhotoshopIngestionArtifactTableAttributes & { createdAt: Date; updatedAt: Date };
type Fence = ITrailsTrustedPhotoshopStorageWriteFenceTableAttributes & { createdAt: Date; updatedAt: Date };
const at = new Date('2026-01-01T00:00:00.000Z');
const operations = new Map<string, Operation>();
const artifacts = new Map<string, Artifact>();
const fences = new Map<string, Fence>();
let artifactFailure = false;
const key = (tenantId: string, operationId: string) => `${tenantId}:${operationId}`;
const artifactKey = (input: Pick<Artifact, 'tenantId' | 'operationId' | 'logicalRendition' | 'codec'>) => `${key(input.tenantId, input.operationId)}:${input.logicalRendition}:${input.codec}`;
const fenceKey = (input: Pick<Fence, 'tenantId' | 'operationId' | 'slot'>) => `${key(input.tenantId, input.operationId)}:${input.slot}`;
const clone = <T>(input: T): T => structuredClone(input);
const descriptors = () => (['grid-800', 'cover-1600', 'preview-2048'] as const).flatMap(logicalRendition => (['avif', 'webp', 'jpeg'] as const).map(codec => ({ logicalRendition, codec, mimeType: `image/${codec}` as const, width: 800, height: 600, byteLength: 100, sha256: 'a'.repeat(64) })));
const models = (): TrustedPhotoshopIngestionModels => ({
  operations: {
    async create(input) { operations.set(key(input.tenantId, input.operationId), input); return input; },
    async find(input) { return operations.get(key(input.tenantId, input.operationId)); },
    async cas(input) { const current = operations.get(key(input.tenantId, input.operationId)); if (!current || current.resourceVersion !== input.expectedVersion) return undefined; operations.set(key(input.tenantId, input.operationId), input.next); return input.next; },
  },
  artifacts: {
    async bulkCreate(input) { for (const item of input) { if (artifactFailure) throw new Error('artifact write failed'); artifacts.set(artifactKey(item), item); } },
    async list(input) { return [...artifacts.values()].filter(item => item.tenantId === input.tenantId && item.operationId === input.operationId); },
    async upsert(input) { if (artifactFailure) throw new Error('artifact write failed'); artifacts.set(artifactKey(input), input); },
  },
  fences: {
    async bulkCreate(input) { for (const item of input) fences.set(fenceKey(item), item); },
    async find(input) { return fences.get(fenceKey(input)); },
    async list(input) { return [...fences.values()].filter(item => item.tenantId === input.tenantId && item.operationId === input.operationId); },
    async update(input) { fences.set(fenceKey(input), input); },
  },
});
const repository = (now: () => Date = () => at) => new MySqlTrustedPhotoshopIngestionOperationRepository({ async transaction<T>(work: (transaction: object) => Promise<T>) { const snapshot = { operations: clone([...operations]), artifacts: clone([...artifacts]), fences: clone([...fences]) }; try { return await work({}); } catch (error: unknown) { operations.clear(); artifacts.clear(); fences.clear(); snapshot.operations.forEach(([mapKey, item]) => operations.set(mapKey, item)); snapshot.artifacts.forEach(([mapKey, item]) => artifacts.set(mapKey, item)); snapshot.fences.forEach(([mapKey, item]) => fences.set(mapKey, item)); throw error; } } }, models(), now);
const create = (store = repository()) => store.create({ tenantId: 'tenant-a', operationId: 'operation-1', ownerUserId: 'owner-a', assetId: 'asset-a', assetFingerprint: 'b'.repeat(64), registerMutationId: 'register-1', artifactMutationId: 'artifacts-1', master: { mimeType: 'image/jpeg', byteLength: 200, sha256: 'c'.repeat(64) }, artifacts: descriptors() });

describe('trusted Photoshop ingestion operation aggregate', () => {
  beforeEach(() => { operations.clear(); artifacts.clear(); fences.clear(); artifactFailure = false; });
  it('creates and replays immutable metadata-only intent with exactly the canonical 3x3 plan', async () => {
    const store = repository();
    const first = await create(store);
    const replay = await create(store);
    expect(replay).toEqual(first);
    expect(first.phase).toBe('prepared');
    expect(first.resourceVersion).toBe('1');
    expect(first.artifacts.map(item => `${item.logicalRendition}:${item.codec}`)).toEqual(['grid-800:avif', 'grid-800:webp', 'grid-800:jpeg', 'cover-1600:avif', 'cover-1600:webp', 'cover-1600:jpeg', 'preview-2048:avif', 'preview-2048:webp', 'preview-2048:jpeg']);
    expect(first.artifacts.every(item => item.writeState === 'pending' && item.locator === undefined)).toBe(true);
    expect(fences.size).toBe(10);
    expect([...fences.values()]).toEqual(expect.arrayContaining([expect.objectContaining({ slot: 'master', state: 'pending', mimeType: 'image/jpeg', byteLength: '200', sha256: 'c'.repeat(64) })]));
    expect([...fences.values()].every(item => item.objectIdentity.match(/^[a-f0-9]{64}$/) && !item.fenceToken)).toBe(true);
    await expect(store.create({ tenantId: 'tenant-a', operationId: 'operation-1', ownerUserId: 'other-owner', assetId: 'asset-a', assetFingerprint: 'b'.repeat(64), registerMutationId: 'register-1', artifactMutationId: 'artifacts-1', master: { mimeType: 'image/jpeg', byteLength: 200, sha256: 'c'.repeat(64) }, artifacts: descriptors() })).rejects.toThrow('不同的actor、asset或fingerprint');
  });
  it('rejects noncanonical and prohibited persistence input without retaining it', async () => {
    const store = repository();
    await expect(store.create({ tenantId: 'tenant-a', operationId: 'bad-url', ownerUserId: 'owner-a', assetId: 'asset-a', assetFingerprint: 'b'.repeat(64), registerMutationId: 'register-1', artifactMutationId: 'artifacts-1', master: { mimeType: 'image/jpeg', byteLength: 200, sha256: 'c'.repeat(64) }, artifacts: descriptors().slice(0, 8) })).rejects.toThrow('精确九项矩阵');
    const created = await create(store);
    const claim = await store.claim({ tenantId: created.tenantId, operationId: created.operationId, owner: 'worker-a', leaseMs: 1_000 });
    const pending = await store.transition({ tenantId: created.tenantId, operationId: created.operationId, leaseOwner: 'worker-a', expectedVersion: claim.resourceVersion, phase: 'storage_pending' });
    await expect(store.recordMaster({ tenantId: created.tenantId, operationId: created.operationId, leaseOwner: 'worker-a', expectedVersion: pending.resourceVersion, fenceToken: 'a'.repeat(64), locator: 'https://forbidden.example/object', mimeType: 'image/jpeg', byteLength: 200, sha256: 'c'.repeat(64) })).rejects.toThrow('不透明引用');
    expect(JSON.stringify([...operations.values(), ...artifacts.values()])).not.toContain('https://forbidden.example');
  });
  it('enforces legal phase transitions, lease ownership, expiry, and version CAS', async () => {
    const store = repository(); await create(store); const claim = await store.claim({ tenantId: 'tenant-a', operationId: 'operation-1', owner: 'worker-a', leaseMs: 1_000 });
    await expect(store.transition({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-a', expectedVersion: claim.resourceVersion, phase: 'completed' })).rejects.toThrow('transition非法');
    const pending = await store.transition({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-a', expectedVersion: claim.resourceVersion, phase: 'storage_pending' });
    await expect(store.transition({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-b', expectedVersion: pending.resourceVersion, phase: 'storage_recorded' })).rejects.toThrow('lease lost');
    await expect(store.transition({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-a', expectedVersion: claim.resourceVersion, phase: 'storage_recorded' })).rejects.toThrow('version stale');
    const expired = new MySqlTrustedPhotoshopIngestionOperationRepository({ async transaction<T>(work: (transaction: object) => Promise<T>) { return work({}); } }, models(), () => new Date(at.getTime() + 2_000));
    const renewed = await expired.claim({ tenantId: 'tenant-a', operationId: 'operation-1', owner: 'worker-b', leaseMs: 1_000 });
    expect(renewed.lease?.owner).toBe('worker-b');
  });
  it('records only confirmed opaque locators, preserves fixed metadata, and rolls back failed child writes', async () => {
    const store = repository(); await create(store); const claim = await store.claim({ tenantId: 'tenant-a', operationId: 'operation-1', owner: 'worker-a', leaseMs: 1_000 }); const pending = await store.transition({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-a', expectedVersion: claim.resourceVersion, phase: 'storage_pending' });
    const masterGrant = await store.acquireStorageWriteFence({ tenantId: 'tenant-a', operationId: 'operation-1', slot: 'master', leaseOwner: 'worker-a', expectedVersion: pending.resourceVersion });
    const master = await store.recordMaster({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-a', expectedVersion: '4', fenceToken: masterGrant.fenceToken, locator: 'master_locator', mimeType: 'image/jpeg', byteLength: 200, sha256: 'c'.repeat(64) });
    expect(master.master.locator).toBe('master_locator');
    const artifactGrant = await store.acquireStorageWriteFence({ tenantId: 'tenant-a', operationId: 'operation-1', slot: 'grid-800:avif', leaseOwner: 'worker-a', expectedVersion: master.resourceVersion });
    artifactFailure = true;
    await expect(store.recordArtifact({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-a', expectedVersion: '6', fenceToken: artifactGrant.fenceToken, logicalRendition: 'grid-800', codec: 'avif', locator: 'artifact_locator', mimeType: 'image/avif', width: 800, height: 600, byteLength: 100, sha256: 'a'.repeat(64) })).rejects.toThrow('artifact write failed');
    expect(operations.get(key('tenant-a', 'operation-1'))?.resourceVersion).toBe('6');
    expect(artifacts.get(`${key('tenant-a', 'operation-1')}:grid-800:avif`)?.locator).toBeUndefined();
  });
  it('issues each durable storage write authority once and records only its matching token', async () => {
    const store = repository(); await create(store); const claimed = await store.claim({ tenantId: 'tenant-a', operationId: 'operation-1', owner: 'worker-a', leaseMs: 1_000 }); const pending = await store.transition({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-a', expectedVersion: claimed.resourceVersion, phase: 'storage_pending' });
    const grant = await store.acquireStorageWriteFence({ tenantId: 'tenant-a', operationId: 'operation-1', slot: 'master', leaseOwner: 'worker-a', expectedVersion: pending.resourceVersion });
    expect(grant).toEqual(expect.objectContaining({ slot: 'master', mimeType: 'image/jpeg', byteLength: '200', sha256: 'c'.repeat(64), objectIdentity: expect.stringMatching(/^[a-f0-9]{64}$/), fenceToken: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    await expect(store.acquireStorageWriteFence({ tenantId: 'tenant-a', operationId: 'operation-1', slot: 'master', leaseOwner: 'worker-a', expectedVersion: '4' })).rejects.toThrow('already consumed');
    await expect(store.recordMaster({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-a', expectedVersion: '4', fenceToken: 'a'.repeat(64), locator: 'master_locator', mimeType: 'image/jpeg', byteLength: 200, sha256: 'c'.repeat(64) })).rejects.toThrow('token rejected');
    const recorded = await store.recordMaster({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-a', expectedVersion: '4', fenceToken: grant.fenceToken, locator: 'master_locator', mimeType: 'image/jpeg', byteLength: 200, sha256: 'c'.repeat(64) });
    expect(recorded.master.locator).toBe('master_locator');
    expect(fences.get(`${key('tenant-a', 'operation-1')}:master`)).toEqual(expect.objectContaining({ state: 'recorded', fenceToken: grant.fenceToken }));
  });
  it('does not reissue an expired lease holder’s consumed fence to a new worker', async () => {
    const store = repository(); await create(store); const claimed = await store.claim({ tenantId: 'tenant-a', operationId: 'operation-1', owner: 'worker-a', leaseMs: 1_000 }); const pending = await store.transition({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-a', expectedVersion: claimed.resourceVersion, phase: 'storage_pending' }); const grant = await store.acquireStorageWriteFence({ tenantId: 'tenant-a', operationId: 'operation-1', slot: 'master', leaseOwner: 'worker-a', expectedVersion: pending.resourceVersion });
    const reclaimed = repository(() => new Date(at.getTime() + 2_000)); const newClaim = await reclaimed.claim({ tenantId: 'tenant-a', operationId: 'operation-1', owner: 'worker-b', leaseMs: 1_000 });
    await expect(reclaimed.acquireStorageWriteFence({ tenantId: 'tenant-a', operationId: 'operation-1', slot: 'master', leaseOwner: 'worker-b', expectedVersion: newClaim.resourceVersion })).rejects.toThrow('already consumed');
    await expect(reclaimed.recordMaster({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-a', expectedVersion: newClaim.resourceVersion, fenceToken: grant.fenceToken, locator: 'master_locator', mimeType: 'image/jpeg', byteLength: 200, sha256: 'c'.repeat(64) })).rejects.toThrow('lease lost');
  });
  it('blocks ambiguous outcomes as terminal automation states', async () => {
    const store = repository(); await create(store); const claim = await store.claim({ tenantId: 'tenant-a', operationId: 'operation-1', owner: 'worker-a', leaseMs: 1_000 }); const pending = await store.transition({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-a', expectedVersion: claim.resourceVersion, phase: 'storage_pending' }); const blocked = await store.transition({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-a', expectedVersion: pending.resourceVersion, phase: 'blocked_ambiguous', failureClass: 'storage' });
    expect(blocked.lease).toBeUndefined();
    await expect(store.claim({ tenantId: 'tenant-a', operationId: 'operation-1', owner: 'worker-b', leaseMs: 1_000 })).rejects.toThrow('lease unavailable');
  });
  it('rejects every unsafe cleanup or failure bypass after storage work starts', async () => {
    const store = repository(); await create(store); const claim = await store.claim({ tenantId: 'tenant-a', operationId: 'operation-1', owner: 'worker-a', leaseMs: 1_000 }); const pending = await store.transition({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-a', expectedVersion: claim.resourceVersion, phase: 'storage_pending' });
    await expect(store.transition({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-a', expectedVersion: pending.resourceVersion, phase: 'cleanup_pending' })).rejects.toThrow('transition非法');
    await expect(store.transition({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-a', expectedVersion: pending.resourceVersion, phase: 'failed', failureClass: 'storage' })).rejects.toThrow('transition非法');
    const row = operations.get(key('tenant-a', 'operation-1')); if (!row) throw new Error('fixture missing operation'); row.masterLocator = 'master_locator'; for (const artifact of artifacts.values()) { artifact.locator = `${artifact.logicalRendition}_${artifact.codec}`; artifact.writeState = 'recorded'; } for (const fence of fences.values()) { fence.state = 'recorded'; }
    const recorded = await store.transition({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-a', expectedVersion: pending.resourceVersion, phase: 'storage_recorded' });
    await expect(store.transition({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-a', expectedVersion: recorded.resourceVersion, phase: 'failed', failureClass: 'storage' })).rejects.toThrow('transition非法');
    const masterPending = await store.transition({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-a', expectedVersion: recorded.resourceVersion, phase: 'registry_master_pending' });
    await expect(store.transition({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-a', expectedVersion: masterPending.resourceVersion, phase: 'cleanup_pending' })).rejects.toThrow('transition非法');
    await expect(store.transition({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-a', expectedVersion: masterPending.resourceVersion, phase: 'failed', failureClass: 'registry' })).rejects.toThrow('transition非法');
    const masterRecorded = await store.transition({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-a', expectedVersion: masterPending.resourceVersion, phase: 'registry_master_recorded', registryMasterVersion: '4' });
    await expect(store.transition({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-a', expectedVersion: masterRecorded.resourceVersion, phase: 'cleanup_pending' })).rejects.toThrow('transition非法');
    const artifactsPending = await store.transition({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-a', expectedVersion: masterRecorded.resourceVersion, phase: 'registry_artifacts_pending' });
    await expect(store.transition({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-a', expectedVersion: artifactsPending.resourceVersion, phase: 'cleanup_pending' })).rejects.toThrow('transition非法');
    await expect(store.transition({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-a', expectedVersion: artifactsPending.resourceVersion, phase: 'failed', failureClass: 'registry' })).rejects.toThrow('transition非法');
  });
  it('accepts registry versions only in their recorded phases and requires both before completion', async () => {
    const store = repository(); await create(store); const claim = await store.claim({ tenantId: 'tenant-a', operationId: 'operation-1', owner: 'worker-a', leaseMs: 1_000 });
    await expect(store.transition({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-a', expectedVersion: claim.resourceVersion, phase: 'storage_pending', registryMasterVersion: '1' })).rejects.toThrow('registryMasterVersion只能');
    await expect(store.transition({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-a', expectedVersion: claim.resourceVersion, phase: 'storage_pending', registryArtifactsVersion: '1' })).rejects.toThrow('registryArtifactsVersion只能');
    const row = operations.get(key('tenant-a', 'operation-1')); if (!row) throw new Error('fixture missing operation'); row.masterLocator = 'master_locator'; for (const artifact of artifacts.values()) { artifact.locator = `${artifact.logicalRendition}_${artifact.codec}`; artifact.writeState = 'recorded'; } for (const fence of fences.values()) { fence.state = 'recorded'; }
    const pending = await store.transition({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-a', expectedVersion: claim.resourceVersion, phase: 'storage_pending' }); const recorded = await store.transition({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-a', expectedVersion: pending.resourceVersion, phase: 'storage_recorded' }); const masterPending = await store.transition({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-a', expectedVersion: recorded.resourceVersion, phase: 'registry_master_pending' });
    await expect(store.transition({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-a', expectedVersion: masterPending.resourceVersion, phase: 'registry_master_recorded' })).rejects.toThrow('requires registryMasterVersion');
    const masterRecorded = await store.transition({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-a', expectedVersion: masterPending.resourceVersion, phase: 'registry_master_recorded', registryMasterVersion: '4' }); const artifactsPending = await store.transition({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-a', expectedVersion: masterRecorded.resourceVersion, phase: 'registry_artifacts_pending' });
    await expect(store.transition({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-a', expectedVersion: artifactsPending.resourceVersion, phase: 'completed' })).rejects.toThrow('requires recorded registry master and artifact versions');
    await expect(store.transition({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-a', expectedVersion: artifactsPending.resourceVersion, phase: 'completed', registryMasterVersion: '5' })).rejects.toThrow('registryMasterVersion只能');
    await expect(store.transition({ tenantId: 'tenant-a', operationId: 'operation-1', leaseOwner: 'worker-a', expectedVersion: artifactsPending.resourceVersion, phase: 'completed', registryArtifactsVersion: '5' })).resolves.toEqual(expect.objectContaining({ phase: 'completed', registryMasterVersion: '4', registryArtifactsVersion: '5' }));
  });
});
