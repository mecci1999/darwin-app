import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import sharp from 'sharp';
import { Actor, DurableMediaAsset, DurableMediaAssetRegistryStore } from '../../src/apps/trails/types';
import { TrustedPhotoshopIngestionOperation, TrustedPhotoshopIngestionPhase, TrustedPhotoshopStorageWriteFenceGrant, TrustedPhotoshopStorageWriteFenceSlot } from '../../src/apps/trails/repository/mysqlTrustedPhotoshopIngestionOperation';
import { TrustedPhotoshopIngestionOperationStore } from '../../src/apps/trails/repository/trustedPhotoshopIngestionOperationStore';
import { InMemoryTrustedPhotoshopIngestionPrivateStorage, TrustedPhotoshopIngestionPrivateStorage } from '../../src/apps/trails/utils/trusted-photoshop-ingestion-private-storage';
import { ingestTrustedPhotoshopPublication, TrustedPhotoshopPublicationIngestionCoordinatorError } from '../../src/apps/trails/utils/trusted-photoshop-publication-ingestion-coordinator';

const actor: Actor = { tenantId: 'tenant_a', userId: 'owner_a', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const hash = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
const image = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: 'navy' } }).jpeg().toBuffer();
const packageEntries = async () => [
  { name: 'manifest.json', buffer: Buffer.from(JSON.stringify({ schema: 'trails.publishing-package/v1', outcome: 'complete', outputs: [
    { relativePath: 'website/grid-960.v1.jpg', filename: 'grid-960.v1.jpg', presetId: 'website-grid-960', status: 'saved' },
    { relativePath: 'website/cover-2048.v1.jpg', filename: 'cover-2048.v1.jpg', presetId: 'website-cover-2048', status: 'saved' },
    { relativePath: 'website/preview-4096.v1.jpg', filename: 'preview-4096.v1.jpg', presetId: 'website-preview-4096', status: 'saved' },
  ] })) },
  { name: 'website/grid-960.v1.jpg', buffer: await image(960, 400) },
  { name: 'website/cover-2048.v1.jpg', buffer: await image(2048, 960) },
  { name: 'website/preview-4096.v1.jpg', buffer: await image(4096, 1024) },
];
const asset = (id = 'asset_a', version = '1'): DurableMediaAsset => ({ id, tenantId: actor.tenantId, ownerUserId: actor.userId, mimeType: 'image/jpeg', status: 'draft', resourceVersion: version, createdAt: '2026-08-03T00:00:00.000Z', updatedAt: '2026-08-03T00:00:00.000Z' });
type FenceFlowCall = { kind: 'acquire' | 'storage' | 'record'; slot: TrustedPhotoshopStorageWriteFenceSlot; grant: Pick<TrustedPhotoshopStorageWriteFenceGrant, 'objectIdentity' | 'fenceToken'> };

class MemoryOperations implements TrustedPhotoshopIngestionOperationStore {
  current?: TrustedPhotoshopIngestionOperation;
  readonly calls: string[] = [];
  readonly issuedGrants = new Map<TrustedPhotoshopStorageWriteFenceSlot, TrustedPhotoshopStorageWriteFenceGrant>();
  failTransition?: TrustedPhotoshopIngestionPhase;
  constructor(private readonly fenceFlow: FenceFlowCall[] = []) {}
  async listRecent(): Promise<TrustedPhotoshopIngestionOperation[]> { return this.current ? [this.current] : []; }
  async create(input: Parameters<TrustedPhotoshopIngestionOperationStore['create']>[0]): Promise<TrustedPhotoshopIngestionOperation> {
    this.calls.push('create');
    if (this.current) return this.current;
    this.current = { tenantId: input.tenantId, operationId: input.operationId, ownerUserId: input.ownerUserId, assetId: input.assetId, assetFingerprint: input.assetFingerprint, intentDigest: hash(Buffer.from(JSON.stringify(input))), registerMutationId: input.registerMutationId, artifactMutationId: input.artifactMutationId, phase: 'prepared', resourceVersion: '1', master: { ...input.master, byteLength: String(input.master.byteLength) }, artifacts: input.artifacts.map(item => ({ ...item, byteLength: String(item.byteLength), writeState: 'pending' })), createdAt: '2026-08-03T00:00:00.000Z', updatedAt: '2026-08-03T00:00:00.000Z' };
    return this.current;
  }
  async claim(input: Parameters<TrustedPhotoshopIngestionOperationStore['claim']>[0]): Promise<TrustedPhotoshopIngestionOperation> { this.calls.push('claim'); if (!this.current || this.current.phase === 'completed') throw new Error('unavailable'); this.current = { ...this.current, resourceVersion: String(Number(this.current.resourceVersion) + 1), lease: { owner: input.owner, expiresAt: '2026-08-04T00:00:00.000Z' } }; return this.current; }
  async acquireStorageWriteFence(input: Parameters<TrustedPhotoshopIngestionOperationStore['acquireStorageWriteFence']>[0]) {
    this.calls.push(`acquire:${input.slot}`); if (!this.current || this.current.phase !== 'storage_pending' || this.current.resourceVersion !== input.expectedVersion || this.issuedGrants.has(input.slot)) throw new Error('grant failure');
    const fenceToken = hash(Buffer.from(`${input.operationId}:${input.slot}:${input.expectedVersion}`)); this.current = { ...this.current, resourceVersion: String(Number(this.current.resourceVersion) + 1) };
    const grant = { slot: input.slot, objectIdentity: hash(Buffer.from(`${input.tenantId}:${input.operationId}:${input.slot}`)), fenceToken, intentDigest: this.current.intentDigest, mimeType: input.slot === 'master' ? this.current.master.mimeType : this.current.artifacts.find(item => `${item.logicalRendition}:${item.codec}` === input.slot)!.mimeType, byteLength: input.slot === 'master' ? this.current.master.byteLength : this.current.artifacts.find(item => `${item.logicalRendition}:${item.codec}` === input.slot)!.byteLength, sha256: input.slot === 'master' ? this.current.master.sha256 : this.current.artifacts.find(item => `${item.logicalRendition}:${item.codec}` === input.slot)!.sha256, resourceVersion: this.current.resourceVersion };
    this.issuedGrants.set(input.slot, grant); this.fenceFlow.push({ kind: 'acquire', slot: input.slot, grant }); return grant;
  }
  async transition(input: Parameters<TrustedPhotoshopIngestionOperationStore['transition']>[0]): Promise<TrustedPhotoshopIngestionOperation> {
    this.calls.push(`transition:${input.phase}`); if (!this.current || this.current.resourceVersion !== input.expectedVersion) throw new Error('transition failure'); if (this.failTransition === input.phase) { this.failTransition = undefined; throw new Error('transition failure'); }
    this.current = { ...this.current, phase: input.phase, failureClass: input.failureClass, registryMasterVersion: input.registryMasterVersion ?? this.current.registryMasterVersion, registryArtifactsVersion: input.registryArtifactsVersion ?? this.current.registryArtifactsVersion, resourceVersion: String(Number(this.current.resourceVersion) + 1) }; return this.current;
  }
  async recordMaster(input: Parameters<TrustedPhotoshopIngestionOperationStore['recordMaster']>[0]): Promise<TrustedPhotoshopIngestionOperation> { const grant = this.issuedGrants.get('master'); this.calls.push('recordMaster'); if (!this.current || !grant || this.current.resourceVersion !== input.expectedVersion || grant.fenceToken !== input.fenceToken) throw new Error('record failure'); this.fenceFlow.push({ kind: 'record', slot: 'master', grant }); this.current = { ...this.current, master: { locator: input.locator, mimeType: input.mimeType, byteLength: String(input.byteLength), sha256: input.sha256 }, resourceVersion: String(Number(this.current.resourceVersion) + 1) }; return this.current; }
  async recordArtifact(input: Parameters<TrustedPhotoshopIngestionOperationStore['recordArtifact']>[0]): Promise<TrustedPhotoshopIngestionOperation> { this.calls.push(`record:${input.logicalRendition}:${input.codec}`); const slot = `${input.logicalRendition}:${input.codec}` as TrustedPhotoshopStorageWriteFenceSlot; const grant = this.issuedGrants.get(slot); if (!this.current || !grant || this.current.resourceVersion !== input.expectedVersion || grant.fenceToken !== input.fenceToken) throw new Error('record failure'); this.fenceFlow.push({ kind: 'record', slot, grant }); this.current = { ...this.current, artifacts: this.current.artifacts.map(item => item.logicalRendition === input.logicalRendition && item.codec === input.codec ? { ...item, locator: input.locator, writeState: 'recorded' } : item), resourceVersion: String(Number(this.current.resourceVersion) + 1) }; return this.current; }
}
class LoggedStorage implements TrustedPhotoshopIngestionPrivateStorage {
  constructor(private readonly storage: InMemoryTrustedPhotoshopIngestionPrivateStorage, private readonly fenceFlow: FenceFlowCall[]) {}
  async storeMaster(input: Parameters<TrustedPhotoshopIngestionPrivateStorage['storeMaster']>[0]) { this.fenceFlow.push({ kind: 'storage', slot: 'master', grant: input.grant }); return this.storage.storeMaster(input); }
  async storeArtifact(input: Parameters<TrustedPhotoshopIngestionPrivateStorage['storeArtifact']>[0]) { this.fenceFlow.push({ kind: 'storage', slot: input.slot, grant: input.grant }); return this.storage.storeArtifact(input); }
}
const registry = (register = jest.fn().mockResolvedValue(asset('asset_a', '2')), persistArtifacts = jest.fn().mockResolvedValue(asset('asset_a', '3'))): DurableMediaAssetRegistryStore => ({ register, persistArtifacts, publish: jest.fn(), listWorkspacePicker: jest.fn().mockResolvedValue([]), listPublic: jest.fn().mockResolvedValue([]), approvePublicDerivatives: jest.fn().mockResolvedValue(asset()) });
const input = async () => ({ actor, operationId: 'operation_a', ownerUserId: actor.userId, assetId: 'asset_a', workerId: 'worker_a', leaseMs: 60_000, entries: await packageEntries() });
const expectRedacted = (error: unknown) => { expect(error).toBeInstanceOf(TrustedPhotoshopPublicationIngestionCoordinatorError); expect(error).toMatchObject({ message: 'Trusted Photoshop publication ingestion failed', name: 'TrustedPhotoshopPublicationIngestionCoordinatorError' }); expect(error).not.toHaveProperty('cause'); };

describe('trusted Photoshop publication ingestion coordinator', () => {
  it('imports once, records the master and nine artifacts, registers a draft asset, and returns only the safe summary', async () => {
    const fenceFlow: FenceFlowCall[] = []; const operations = new MemoryOperations(fenceFlow); const stored = new InMemoryTrustedPhotoshopIngestionPrivateStorage(); const storage = new LoggedStorage(stored, fenceFlow); const register = jest.fn().mockResolvedValue(asset('asset_a', '2')); const persist = jest.fn().mockResolvedValue(asset('asset_a', '3'));
    const result = await ingestTrustedPhotoshopPublication(await input(), operations, storage, registry(register, persist));
    expect(result).toEqual({ operationId: 'operation_a', assetId: 'asset_a', phase: 'completed', assetStatus: 'draft' });
    expect(stored.countForTest()).toBe(10); expect(operations.calls).toEqual(['create', 'claim', 'transition:storage_pending', 'acquire:master', 'recordMaster', 'acquire:grid-960:avif', 'record:grid-960:avif', 'acquire:grid-960:webp', 'record:grid-960:webp', 'acquire:grid-960:jpeg', 'record:grid-960:jpeg', 'acquire:cover-2048:avif', 'record:cover-2048:avif', 'acquire:cover-2048:webp', 'record:cover-2048:webp', 'acquire:cover-2048:jpeg', 'record:cover-2048:jpeg', 'acquire:preview-4096:avif', 'record:preview-4096:avif', 'acquire:preview-4096:webp', 'record:preview-4096:webp', 'acquire:preview-4096:jpeg', 'record:preview-4096:jpeg', 'transition:storage_recorded', 'transition:registry_master_pending', 'transition:registry_master_recorded', 'transition:registry_artifacts_pending', 'transition:completed']);
    expect(fenceFlow).toHaveLength(30); for (let index = 0; index < fenceFlow.length; index += 3) { const [acquire, storageCall, record] = fenceFlow.slice(index, index + 3); expect([acquire.kind, storageCall.kind, record.kind]).toEqual(['acquire', 'storage', 'record']); expect(storageCall.slot).toBe(acquire.slot); expect(record.slot).toBe(acquire.slot); expect(storageCall.grant).toBe(acquire.grant); expect(record.grant).toBe(acquire.grant); }
    expect(register).toHaveBeenCalledWith(actor, expect.objectContaining({ mutationId: 'operation_a:register', expectedResourceVersion: null, id: 'asset_a' }));
    expect(persist).toHaveBeenCalledWith(actor, expect.objectContaining({ mutationId: 'operation_a:artifacts', expectedResourceVersion: '2', assetId: 'asset_a', artifacts: expect.any(Array) })); expect(persist.mock.calls[0][1].artifacts).toHaveLength(9);
    const issuedValues = [...operations.issuedGrants.values()].flatMap(grant => [grant.objectIdentity, grant.fenceToken]); const publicValues = [JSON.stringify(result), JSON.stringify(register.mock.calls[0][1]), JSON.stringify(persist.mock.calls[0][1])]; for (const value of publicValues) { expect(value).not.toContain('objectIdentity'); expect(value).not.toContain('fenceToken'); for (const issuedValue of issuedValues) expect(value).not.toContain(issuedValue); }
  });

  it('returns completed replay without claiming, storing, or calling the registry', async () => {
    const operations = new MemoryOperations(); const storage = new InMemoryTrustedPhotoshopIngestionPrivateStorage(); const services = registry(); await ingestTrustedPhotoshopPublication(await input(), operations, storage, services);
    const count = storage.countForTest(); await expect(ingestTrustedPhotoshopPublication(await input(), operations, storage, services)).resolves.toEqual({ operationId: 'operation_a', assetId: 'asset_a', phase: 'completed', assetStatus: 'draft' });
    expect(storage.countForTest()).toBe(count); expect(services.register).toHaveBeenCalledTimes(1); expect(services.persistArtifacts).toHaveBeenCalledTimes(1); expect(operations.calls.filter(call => call === 'claim')).toHaveLength(1);
  });

  it('replays stable private identities, rejects changed content before mutation, and keeps defensive copies', async () => {
    const storage = new InMemoryTrustedPhotoshopIngestionPrivateStorage(); const content = Buffer.from('verified'); const sha256 = hash(content); const grant = { objectIdentity: 'a'.repeat(64), fenceToken: 'b'.repeat(64), intentDigest: 'c'.repeat(64) };
 const first = await storage.storeMaster({ tenantId: 'tenant', operationId: 'op', grant, content, mimeType: 'image/jpeg', byteLength: content.length, sha256 }); const second = await storage.storeMaster({ tenantId: 'tenant', operationId: 'op', grant, content: Buffer.from(content), mimeType: 'image/jpeg', byteLength: content.length, sha256 });
 expect(second).toEqual(first); content[0] ^= 0xff; expect(storage.bufferCopyForTest(grant.objectIdentity)).toEqual(Buffer.from('verified')); await expect(storage.storeMaster({ tenantId: 'tenant', operationId: 'op', grant, content: Buffer.from('changed'), mimeType: 'image/jpeg', byteLength: 7, sha256: hash(Buffer.from('changed')) })).rejects.toThrow('collision'); expect(storage.countForTest()).toBe(1);
  });

  it('fails malformed packages before storage or registry calls', async () => {
    const operations = new MemoryOperations(); const storage = new InMemoryTrustedPhotoshopIngestionPrivateStorage(); const services = registry(); const invalid = await input(); invalid.entries = [{ name: 'manifest.json', buffer: Buffer.from('{}') }];
    expectRedacted(await ingestTrustedPhotoshopPublication(invalid, operations, storage, services).catch(error => error)); expect(storage.countForTest()).toBe(0); expect(services.register).not.toHaveBeenCalled(); expect(services.persistArtifacts).not.toHaveBeenCalled();
  });

  it('records successful partial storage durably and blocks the ambiguous run', async () => {
    const operations = new MemoryOperations(); const stored = new InMemoryTrustedPhotoshopIngestionPrivateStorage(); let artifactCalls = 0;
    const flaky: TrustedPhotoshopIngestionPrivateStorage = { storeMaster: input => stored.storeMaster(input), storeArtifact: async input => { artifactCalls += 1; if (artifactCalls === 2) throw new Error('timeout'); return stored.storeArtifact(input); } };
    const services = registry(); expectRedacted(await ingestTrustedPhotoshopPublication(await input(), operations, flaky, services).catch(error => error)); expect(operations.current?.phase).toBe('blocked_ambiguous'); expect(operations.current?.failureClass).toBe('storage'); expect(operations.calls).toContain('record:grid-960:avif'); expect(services.register).not.toHaveBeenCalled(); expect(stored.countForTest()).toBe(2);
  });

  it('blocks an ambiguous storage result without registry calls or cleanup', async () => {
    const operations = new MemoryOperations(); const services = registry(); const storage: TrustedPhotoshopIngestionPrivateStorage = { storeMaster: jest.fn().mockResolvedValue({ privateLocator: 'bad/locator' }), storeArtifact: jest.fn() };
    expectRedacted(await ingestTrustedPhotoshopPublication(await input(), operations, storage, services).catch(error => error)); expect(operations.current?.phase).toBe('blocked_ambiguous'); expect(operations.current?.failureClass).toBe('storage'); expect(services.register).not.toHaveBeenCalled(); expect(services.persistArtifacts).not.toHaveBeenCalled();
  });

  it.each(['master', 'artifacts'] as const)('blocks ambiguous %s registry outcomes without cleanup, variants, or publishing', async (stage) => {
    const operations = new MemoryOperations(); const storage = new InMemoryTrustedPhotoshopIngestionPrivateStorage(); const register = stage === 'master' ? jest.fn().mockRejectedValue(new Error('timeout')) : jest.fn().mockResolvedValue(asset('asset_a', '2')); const persist = stage === 'artifacts' ? jest.fn().mockRejectedValue(new Error('timeout')) : jest.fn().mockResolvedValue(asset('asset_a', '3')); const services = registry(register, persist);
    expectRedacted(await ingestTrustedPhotoshopPublication(await input(), operations, storage, services).catch(error => error)); expect(operations.current?.phase).toBe('blocked_ambiguous'); expect(services.publish).not.toHaveBeenCalled(); expect(storage.countForTest()).toBe(10);
  });

  it('resumes storage_pending after storage_recorded transition failure without repeating storage', async () => {
    const operations = new MemoryOperations(); operations.failTransition = 'storage_recorded'; const storage = new InMemoryTrustedPhotoshopIngestionPrivateStorage(); const register = jest.fn().mockResolvedValue(asset('asset_a', '2')); const persist = jest.fn().mockResolvedValue(asset('asset_a', '3')); const services = registry(register, persist);
    expectRedacted(await ingestTrustedPhotoshopPublication(await input(), operations, storage, services).catch(error => error)); expect(operations.current?.phase).toBe('storage_pending'); expect(storage.countForTest()).toBe(10); expect(register).not.toHaveBeenCalled(); expect(persist).not.toHaveBeenCalled();
    await expect(ingestTrustedPhotoshopPublication(await input(), operations, storage, services)).resolves.toEqual({ operationId: 'operation_a', assetId: 'asset_a', phase: 'completed', assetStatus: 'draft' }); expect(storage.countForTest()).toBe(10); expect(register).toHaveBeenCalledTimes(1); expect(persist).toHaveBeenCalledTimes(1);
  });

  it('resumes storage_recorded after registry_master_pending transition failure without repeating storage or master registration', async () => {
    const operations = new MemoryOperations(); operations.failTransition = 'registry_master_pending'; const storage = new InMemoryTrustedPhotoshopIngestionPrivateStorage(); const register = jest.fn().mockResolvedValue(asset('asset_a', '2')); const persist = jest.fn().mockResolvedValue(asset('asset_a', '3')); const services = registry(register, persist);
    expectRedacted(await ingestTrustedPhotoshopPublication(await input(), operations, storage, services).catch(error => error)); expect(operations.current?.phase).toBe('storage_recorded'); expect(storage.countForTest()).toBe(10); expect(register).not.toHaveBeenCalled();
    await expect(ingestTrustedPhotoshopPublication(await input(), operations, storage, services)).resolves.toEqual({ operationId: 'operation_a', assetId: 'asset_a', phase: 'completed', assetStatus: 'draft' }); expect(storage.countForTest()).toBe(10); expect(register).toHaveBeenCalledTimes(1); expect(persist).toHaveBeenCalledTimes(1);
  });

  it('resumes registry_master_recorded after registry_artifacts_pending transition failure without repeating storage or master registration', async () => {
    const operations = new MemoryOperations(); operations.failTransition = 'registry_artifacts_pending'; const storage = new InMemoryTrustedPhotoshopIngestionPrivateStorage(); const register = jest.fn().mockResolvedValue(asset('asset_a', '2')); const persist = jest.fn().mockResolvedValue(asset('asset_a', '3')); const services = registry(register, persist);
    expectRedacted(await ingestTrustedPhotoshopPublication(await input(), operations, storage, services).catch(error => error)); expect(operations.current?.phase).toBe('registry_master_recorded'); expect(storage.countForTest()).toBe(10); expect(register).toHaveBeenCalledTimes(1); expect(persist).not.toHaveBeenCalled();
    await expect(ingestTrustedPhotoshopPublication(await input(), operations, storage, services)).resolves.toEqual({ operationId: 'operation_a', assetId: 'asset_a', phase: 'completed', assetStatus: 'draft' }); expect(storage.countForTest()).toBe(10); expect(register).toHaveBeenCalledTimes(1); expect(persist).toHaveBeenCalledTimes(1);
  });

  it.each(['registry_master_recorded', 'completed'] as TrustedPhotoshopIngestionPhase[])('blocks after a registry return when %s persistence fails and never repeats the completed call', async (phase) => {
    const operations = new MemoryOperations(); operations.failTransition = phase; const register = jest.fn().mockResolvedValue(asset('asset_a', '2')); const persist = jest.fn().mockResolvedValue(asset('asset_a', '3')); const services = registry(register, persist);
    expectRedacted(await ingestTrustedPhotoshopPublication(await input(), operations, new InMemoryTrustedPhotoshopIngestionPrivateStorage(), services).catch(error => error)); expect(register).toHaveBeenCalledTimes(1); expect(persist).toHaveBeenCalledTimes(phase === 'completed' ? 1 : 0); expect(operations.current?.phase).toBe('blocked_ambiguous');
  });

  it('has no action, public storage, provider, COS, Tencent, or legacy persistence dependency', () => {
    const source = readFileSync(require.resolve('../../src/apps/trails/utils/trusted-photoshop-publication-ingestion-coordinator'), 'utf8');
    expect(source).not.toMatch(/from ['"].*(actions|delivery|cos|tencent|trusted-private-derivative-storage|trusted-photoshop-derivative-persistence-orchestrator)|registerVariant|\.publish\(/i);
  });
});
