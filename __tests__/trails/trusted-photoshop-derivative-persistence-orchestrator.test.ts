import { readFileSync } from 'fs';
import sharp from 'sharp';
import { Actor, DurableMediaAsset, DurableMediaAssetArtifactDescriptor, DurableMediaAssetRegistryStore } from '../../src/apps/trails/types';
import { stageTrustedPhotoshopPackageDerivatives, TrustedPhotoshopDerivativeStagingPlan } from '../../src/apps/trails/utils/trusted-photoshop-derivative-staging-plan';
import { processTrustedPhotoshopPackageDerivatives } from '../../src/apps/trails/utils/trusted-photoshop-package-derivative-orchestrator';
import { persistTrustedPhotoshopDerivativeStagingPlan, TrustedPhotoshopDerivativePersistenceError } from '../../src/apps/trails/utils/trusted-photoshop-derivative-persistence-orchestrator';
import { InMemoryTrustedPrivateDerivativeStorage, TrustedPrivateDerivativeStorage, TrustedPrivateDerivativeStorageResult } from '../../src/apps/trails/utils/trusted-private-derivative-storage';

const actor: Actor = { tenantId: 'tenant-a', userId: 'owner-a', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const asset: DurableMediaAsset = { id: 'asset_1', tenantId: actor.tenantId, ownerUserId: actor.userId, mimeType: 'image/jpeg', status: 'draft', resourceVersion: '2', createdAt: '2026-08-03T00:00:00.000Z', updatedAt: '2026-08-03T00:00:00.000Z' };
const jpeg = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: 'navy' } }).jpeg().toBuffer();
const plan = async (): Promise<TrustedPhotoshopDerivativeStagingPlan> => stageTrustedPhotoshopPackageDerivatives(await processTrustedPhotoshopPackageDerivatives([
  { name: 'manifest.json', buffer: Buffer.from(JSON.stringify({ schema: 'trails.publishing-package/v1', outcome: 'complete', outputs: [
    { relativePath: 'website/grid-960.v1.jpg', filename: 'grid-960.v1.jpg', presetId: 'website-grid-960', status: 'saved' },
    { relativePath: 'website/cover-2048.v1.jpg', filename: 'cover-2048.v1.jpg', presetId: 'website-cover-2048', status: 'saved' },
    { relativePath: 'website/preview-4096.v1.jpg', filename: 'preview-4096.v1.jpg', presetId: 'website-preview-4096', status: 'saved' },
  ] })) },
  { name: 'website/grid-960.v1.jpg', buffer: await jpeg(960, 400) },
  { name: 'website/cover-2048.v1.jpg', buffer: await jpeg(2048, 960) },
  { name: 'website/preview-4096.v1.jpg', buffer: await jpeg(4096, 1024) },
]));

const registry = (persistArtifacts: jest.Mock): DurableMediaAssetRegistryStore => ({
  listWorkspacePicker: jest.fn(), listPublic: jest.fn(), register: jest.fn(), approvePublicDerivatives: jest.fn(), persistArtifacts, publish: jest.fn(),
});
const input = (stagingPlan: TrustedPhotoshopDerivativeStagingPlan) => ({ actor, mutation: { mutationId: 'persist-1', expectedResourceVersion: '1', assetId: asset.id }, plan: stagingPlan });
const opaqueResults = (): TrustedPrivateDerivativeStorageResult[] => Array.from({ length: 9 }, (_, index) => ({ privateLocator: `opaque_${index}` }));
const expectRedactedError = (error: unknown): void => {
  expect(error).toBeInstanceOf(TrustedPhotoshopDerivativePersistenceError);
  expect(error).toMatchObject({ name: 'TrustedPhotoshopDerivativePersistenceError', message: 'Trusted Photoshop derivative persistence failed' });
  expect(error).not.toHaveProperty('cause');
  expect(Object.getOwnPropertyNames(error as Error).sort()).toEqual(['message', 'name', 'stack']);
  expect(JSON.stringify(error)).toBe('{"name":"TrustedPhotoshopDerivativePersistenceError"}');
};

describe('trusted Photoshop derivative persistence orchestrator', () => {
  it('stores the canonical matrix through the private adapter and persists exactly metadata-only descriptors', async () => {
    const stagingPlan = await plan();
    const before = stagingPlan.artifacts.map(artifact => ({ ...artifact, buffer: Buffer.from(artifact.buffer) }));
    const storage = new InMemoryTrustedPrivateDerivativeStorage();
    const remove = jest.spyOn(storage, 'remove');
    const persistArtifacts = jest.fn().mockResolvedValue(asset);
    const result = await persistTrustedPhotoshopDerivativeStagingPlan(input(stagingPlan), storage, registry(persistArtifacts));

    expect(result).toEqual(asset);
    expect(remove).not.toHaveBeenCalled();
    expect(persistArtifacts).toHaveBeenCalledTimes(1);
    expect(storage.countForTest()).toBe(9);
    const [, mutation] = persistArtifacts.mock.calls[0];
    expect(mutation.artifacts.map((descriptor: DurableMediaAssetArtifactDescriptor) => `${descriptor.logicalRendition}:${descriptor.codec}`)).toEqual([
      'grid-960:avif', 'grid-960:webp', 'grid-960:jpeg', 'cover-2048:avif', 'cover-2048:webp', 'cover-2048:jpeg', 'preview-4096:avif', 'preview-4096:webp', 'preview-4096:jpeg',
    ]);
    expect(mutation.artifacts).toEqual(stagingPlan.artifacts.map((artifact, index) => ({
      logicalRendition: artifact.logicalRendition, codec: artifact.codec, privateLocator: `trusted_private_derivative_${(index + 1).toString().padStart(8, '0')}`,
      mimeType: artifact.mime, width: artifact.width, height: artifact.height, byteLength: artifact.byteLength, sha256: artifact.sha256,
    })));
    expect(JSON.stringify(mutation)).not.toContain('buffer');
    expect(Object.values(mutation.artifacts).flat()).not.toContainEqual(expect.any(Buffer));
    expect(stagingPlan.artifacts).toEqual(before);
  });

  it('gives buffers only to the dedicated adapter and the fake retains defensive copies', async () => {
    const stagingPlan = await plan();
    const storage = new InMemoryTrustedPrivateDerivativeStorage();
    const store = jest.spyOn(storage, 'store');
    const persistArtifacts = jest.fn().mockResolvedValue(asset);
    await persistTrustedPhotoshopDerivativeStagingPlan(input(stagingPlan), storage, registry(persistArtifacts));
    const locator = `trusted_private_derivative_${String(1).padStart(8, '0')}`;
    const stored = storage.bufferCopyForTest(locator);
    expect(store).toHaveBeenCalledWith(stagingPlan.artifacts);
    expect(stored).toEqual(stagingPlan.artifacts[0].buffer);
    stagingPlan.artifacts[0].buffer[0] ^= 0xff;
    expect(storage.bufferCopyForTest(locator)).toEqual(stored);
    const returned = storage.bufferCopyForTest(locator);
    returned![0] ^= 0xff;
    expect(storage.bufferCopyForTest(locator)).toEqual(stored);
    expect(JSON.stringify(persistArtifacts.mock.calls)).not.toContain('buffer');
  });

  it('rejects a mutated plan before storage or registry calls without mutating its input', async () => {
    const stagingPlan = await plan();
    const snapshot = { ...stagingPlan, artifacts: stagingPlan.artifacts.map(artifact => ({ ...artifact, buffer: Buffer.from(artifact.buffer) })) };
    const storage = new InMemoryTrustedPrivateDerivativeStorage();
    const persistArtifacts = jest.fn();
    (stagingPlan.artifacts as Array<typeof stagingPlan.artifacts[number]>)[0] = { ...stagingPlan.artifacts[0], width: 1 };
    const error = await persistTrustedPhotoshopDerivativeStagingPlan(input(stagingPlan), storage, registry(persistArtifacts)).catch(reason => reason);
    expectRedactedError(error);
    expect(String(error)).not.toContain('private derivative storage failed');
    expect(storage.countForTest()).toBe(0);
    expect(persistArtifacts).not.toHaveBeenCalled();
    expect(snapshot.artifacts[1]).toEqual(stagingPlan.artifacts[1]);
  });

  it('relies on adapter rollback for partial storage failure, does not retry, and never calls the registry', async () => {
    const storage = new InMemoryTrustedPrivateDerivativeStorage(3);
    const store = jest.spyOn(storage, 'store');
    const remove = jest.spyOn(storage, 'remove');
    const persistArtifacts = jest.fn();
    const error = await persistTrustedPhotoshopDerivativeStagingPlan(input(await plan()), storage, registry(persistArtifacts)).catch(reason => reason);
    expectRedactedError(error);
    expect(storage.countForTest()).toBe(0);
    expect(store).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
    expect(persistArtifacts).not.toHaveBeenCalled();
  });

  it.each([
    ['a non-array result', { privateLocator: 'opaque_0' }, []],
    ['a wrong result count', opaqueResults().slice(0, 8), opaqueResults().slice(0, 8).map(result => result.privateLocator)],
    ['duplicate locators', opaqueResults().map((result, index) => index === 8 ? { privateLocator: 'opaque_0' } : result), opaqueResults().map((result, index) => index === 8 ? 'opaque_0' : result.privateLocator)],
    ['invalid locator syntax', opaqueResults().map((result, index) => index === 4 ? { privateLocator: 'bad/locator' } : result), opaqueResults().map((result, index) => index === 4 ? 'bad/locator' : result.privateLocator)],
    ['forbidden result fields', opaqueResults().map((result, index) => index === 0 ? { ...result, buffer: Buffer.from('must not escape') } : result), opaqueResults().map(result => result.privateLocator)],
  ])('redacts %s, cleans returned string locators, and skips the registry', async (_label, results, expectedCleanup) => {
    const remove = jest.fn().mockResolvedValue(undefined);
    const store = jest.fn().mockResolvedValue(results);
    const storage: TrustedPrivateDerivativeStorage = { store, remove };
    const persistArtifacts = jest.fn();
    const error = await persistTrustedPhotoshopDerivativeStagingPlan(input(await plan()), storage, registry(persistArtifacts)).catch(reason => reason);
    expectRedactedError(error);
    expect(store).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(expectedCleanup.length === 0 ? 0 : 1);
    if (expectedCleanup.length > 0) expect(remove).toHaveBeenCalledWith(expectedCleanup);
    expect(persistArtifacts).not.toHaveBeenCalled();
  });

  it('cleans private artifacts after registry failure, redacts the cause, and keeps cleanup failures private', async () => {
    const stagingPlan = await plan();
    const remove = jest.fn().mockRejectedValue(new Error('private cleanup detail'));
    const results = opaqueResults();
    const store = jest.fn().mockResolvedValue(results);
    const storage: TrustedPrivateDerivativeStorage = { store, remove };
    const persistArtifacts = jest.fn().mockRejectedValue(new Error('private registry detail'));
    const error = await persistTrustedPhotoshopDerivativeStagingPlan(input(stagingPlan), storage, registry(persistArtifacts)).catch(reason => reason);
    expectRedactedError(error);
    expect(store).toHaveBeenCalledTimes(1);
    expect(persistArtifacts).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(results.map(result => result.privateLocator));
    expect(remove).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(error)).not.toContain('private cleanup detail');
    expect(JSON.stringify(error)).not.toContain('private registry detail');
    expect(JSON.stringify(error)).not.toContain('opaque_');
  });

  it('has no generic storage, COS, action, delivery, URL, or filesystem dependency leaks', () => {
    const storageSource = readFileSync(require.resolve('../../src/apps/trails/utils/trusted-private-derivative-storage'), 'utf8');
    const orchestratorSource = readFileSync(require.resolve('../../src/apps/trails/utils/trusted-photoshop-derivative-persistence-orchestrator'), 'utf8');
    expect(storageSource).not.toMatch(/TrailsStorage|from ['"](?:fs|path|stream|.*cos|.*delivery|.*actions)['"]/i);
    expect(orchestratorSource).not.toMatch(/TrailsStorage|from ['"](?:fs|path|stream|.*cos|.*delivery|.*actions)['"]/i);
    expect(`${storageSource}\n${orchestratorSource}`).not.toMatch(/https?:\/\/|objectKey|provider|credential|readFile\(|writeFile\(|\.upload\(/i);
  });
});
