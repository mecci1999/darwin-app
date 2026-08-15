import { createHash, createHmac } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  TencentCosTrustedPhotoshopIngestionClient,
  TencentCosTrustedPhotoshopIngestionClientFactory,
  TencentCosTrustedPhotoshopIngestionHeadResult,
  TencentCosTrustedPhotoshopIngestionPrivateStorage,
  TencentCosTrustedPhotoshopIngestionPrivateStorageError,
} from '../../src/apps/trails/utils/tencent-cos-trusted-photoshop-ingestion-private-storage';

jest.mock('cos-nodejs-sdk-v5', () => jest.fn());

const mockedCos = jest.requireMock('cos-nodejs-sdk-v5') as jest.Mock;
const secret = 'test-ingestion-mapping-secret';
const environment = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({ NODE_ENV: 'test', TRAILS_COS_INGESTION_ENABLED: 'true', TRAILS_COS_CREDENTIAL_PROVIDER: 'static-env', TRAILS_COS_SECRET_ID: 'test-secret-id', TRAILS_COS_SECRET_KEY: 'test-secret-key', TRAILS_COS_INGESTION_MAPPING_SECRET: secret, ...overrides });
const hmac = (domain: string, value: string): string => createHmac('sha256', secret).update(`${domain}\u0000${value}`).digest('base64url');
const identityFor = (tenantId = 'tenant_a', operationId = 'operation_a', slot = 'master'): string => hmac('ingestion-object-identity', JSON.stringify([tenantId, operationId, slot]));
const digest = (content: Buffer): string => createHash('sha256').update(content).digest('hex');
const notFound = (): Error & { statusCode: number } => Object.assign(new Error('not found'), { statusCode: 404 });
const client = (): jest.Mocked<TencentCosTrustedPhotoshopIngestionClient> => ({ headObject: jest.fn().mockRejectedValue(notFound()), putObject: jest.fn().mockResolvedValue({ provider: 'hidden' }) });
const storage = (fakeClient = client(), env: NodeJS.ProcessEnv = environment()) => {
  const factory = jest.fn<TencentCosTrustedPhotoshopIngestionClient, Parameters<TencentCosTrustedPhotoshopIngestionClientFactory>>().mockReturnValue(fakeClient);
  return { adapter: new TencentCosTrustedPhotoshopIngestionPrivateStorage(env, factory), fakeClient, factory };
};
const input = (overrides: Partial<{ tenantId: string; operationId: string; slot: string; content: Buffer; mimeType: string; byteLength: number; sha256: string; objectIdentity: string; fenceToken: string }> = {}) => {
  const tenantId = overrides.tenantId || 'tenant_a'; const operationId = overrides.operationId || 'operation_a'; const slot = overrides.slot || 'master'; const content = overrides.content || Buffer.from('verified master');
  return { tenantId, operationId, slot, grant: { objectIdentity: overrides.objectIdentity || identityFor(tenantId, operationId, slot), fenceToken: overrides.fenceToken || 'fence-token-private' }, content, mimeType: (overrides.mimeType || 'image/jpeg') as 'image/jpeg', byteLength: overrides.byteLength === undefined ? content.length : overrides.byteLength, sha256: overrides.sha256 || digest(content) };
};
const matchingHead = (value = input()): TencentCosTrustedPhotoshopIngestionHeadResult => ({ contentLength: value.byteLength, metadata: { contract: 'trusted-photoshop-ingestion-private-v1', identity: value.grant.objectIdentity, sha256: value.sha256, length: String(value.byteLength), mime: value.mimeType, fenceTokenDigest: hmac('ingestion-fence-token', value.grant.fenceToken) } });
const expectRedacted = (error: unknown): void => { expect(error).toBeInstanceOf(TencentCosTrustedPhotoshopIngestionPrivateStorageError); expect(error).toMatchObject({ name: 'TencentCosTrustedPhotoshopIngestionPrivateStorageError', message: 'Private ingestion storage failed' }); expect(error).not.toHaveProperty('cause'); expect(JSON.stringify(error)).toBe('{"name":"TencentCosTrustedPhotoshopIngestionPrivateStorageError"}'); };
const filesBelow = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => { const file = join(directory, entry.name); return entry.isDirectory() ? filesBelow(file) : [file]; });

describe('Tencent COS trusted Photoshop ingestion private storage', () => {
  it('uses fixed scope, deterministic opaque locator, and exact private metadata without ACL', async () => {
    const value = input(); const { adapter, fakeClient, factory } = storage();
    fakeClient.headObject.mockRejectedValueOnce(notFound()).mockResolvedValueOnce(matchingHead(value));
    const result = await adapter.storeMaster(value);
    expect(factory).toHaveBeenCalledWith({ secretId: 'test-secret-id', secretKey: 'test-secret-key' });
    expect(result).toEqual({ privateLocator: `ingestion_${hmac('ingestion-locator', value.grant.objectIdentity)}` });
    expect(fakeClient.headObject).toHaveBeenCalledTimes(2); expect(fakeClient.putObject).toHaveBeenCalledTimes(1);
    const [request] = fakeClient.putObject.mock.calls[0];
    const fenceTokenDigest = hmac('ingestion-fence-token', value.grant.fenceToken);
    expect(request).toEqual({ Bucket: 'starlight-media-prod-1313219189', Region: 'ap-guangzhou', Key: `masters-private/${hmac('ingestion-cos-key', `${value.grant.objectIdentity}\u0000${fenceTokenDigest}`)}`, Body: value.content, ContentLength: value.byteLength, ContentType: 'image/jpeg', 'x-cos-meta-contract': 'trusted-photoshop-ingestion-private-v1', 'x-cos-meta-identity': value.grant.objectIdentity, 'x-cos-meta-sha256': value.sha256, 'x-cos-meta-length': String(value.byteLength), 'x-cos-meta-mime': 'image/jpeg', 'x-cos-meta-fence-token-digest': fenceTokenDigest });
    expect(Object.keys(request)).not.toContain('ACL'); expect(Object.keys(request)).not.toContain('Headers'); expect(JSON.stringify(result)).not.toMatch(/masters-private|starlight-media|tenant_a|operation_a|fence-token/);
  });

  it('returns an existing exact object after its initial HEAD without a PUT', async () => {
    const value = input(); const { adapter, fakeClient } = storage(); fakeClient.headObject.mockResolvedValueOnce(matchingHead(value));
    await expect(adapter.storeMaster(value)).resolves.toEqual({ privateLocator: `ingestion_${hmac('ingestion-locator', value.grant.objectIdentity)}` });
    expect(fakeClient.putObject).not.toHaveBeenCalled(); expect(fakeClient.headObject).toHaveBeenCalledTimes(1);
  });

  it('rejects a mismatched existing object without overwrite', async () => {
    const { adapter, fakeClient } = storage(); fakeClient.headObject.mockResolvedValueOnce({ contentLength: 1, metadata: {} });
    expectRedacted(await adapter.storeMaster(input()).catch(error => error)); expect(fakeClient.putObject).not.toHaveBeenCalled();
  });

  it('accepts a timed-out PUT only after one matching verification HEAD, and otherwise never retries or deletes', async () => {
    const value = input(); const { adapter, fakeClient } = storage(); fakeClient.headObject.mockRejectedValueOnce(notFound()).mockResolvedValueOnce(matchingHead(value)); fakeClient.putObject.mockRejectedValueOnce(new Error('provider timeout'));
    await expect(adapter.storeMaster(value)).resolves.toEqual({ privateLocator: `ingestion_${hmac('ingestion-locator', value.grant.objectIdentity)}` }); expect(fakeClient.putObject).toHaveBeenCalledTimes(1);
    const absent = storage(); absent.fakeClient.headObject.mockRejectedValueOnce(notFound()).mockRejectedValueOnce(notFound()); absent.fakeClient.putObject.mockRejectedValueOnce(new Error('timeout'));
    expectRedacted(await absent.adapter.storeMaster(input()).catch(error => error)); expect(absent.fakeClient.putObject).toHaveBeenCalledTimes(1); expect(Object.keys(absent.fakeClient)).not.toContain('deleteObject');
    const mismatch = storage(); mismatch.fakeClient.headObject.mockRejectedValueOnce(notFound()).mockResolvedValueOnce({ contentLength: 1, metadata: {} }); mismatch.fakeClient.putObject.mockRejectedValueOnce(new Error('timeout'));
    expectRedacted(await mismatch.adapter.storeMaster(input()).catch(error => error)); expect(mismatch.fakeClient.putObject).toHaveBeenCalledTimes(1);
  });

  it('verifies a matching existing object after a collision response without retry or delete', async () => {
    const value = input(); const { adapter, fakeClient } = storage();
    fakeClient.headObject.mockRejectedValueOnce(notFound()).mockResolvedValueOnce(matchingHead(value));
    fakeClient.putObject.mockRejectedValueOnce({ statusCode: 409, error: { Code: 'FileAlreadyExists', Message: 'hidden provider detail' } });
    await expect(adapter.storeMaster(value)).resolves.toEqual({ privateLocator: `ingestion_${hmac('ingestion-locator', value.grant.objectIdentity)}` });
    expect(fakeClient.putObject).toHaveBeenCalledTimes(1); expect(fakeClient.headObject).toHaveBeenCalledTimes(2);
    expect(Object.keys(fakeClient)).not.toContain('deleteObject');
  });

  it('normalizes lowercase SDK HEAD headers into the exact metadata needed for an existing-object success', async () => {
    const value = input();
    const sdkClient = {
      headObject: jest.fn().mockResolvedValue({ headers: {
        'content-length': String(value.byteLength), 'x-cos-meta-contract': 'trusted-photoshop-ingestion-private-v1', 'x-cos-meta-identity': value.grant.objectIdentity,
        'x-cos-meta-sha256': value.sha256, 'x-cos-meta-length': String(value.byteLength), 'x-cos-meta-mime': value.mimeType,
        'x-cos-meta-fence-token-digest': hmac('ingestion-fence-token', value.grant.fenceToken),
      } }),
      putObject: jest.fn(),
    };
    mockedCos.mockImplementation(() => sdkClient);
    const adapter = new TencentCosTrustedPhotoshopIngestionPrivateStorage(environment());
    await expect(adapter.storeMaster(value)).resolves.toEqual({ privateLocator: `ingestion_${hmac('ingestion-locator', value.grant.objectIdentity)}` });
    expect(sdkClient.headObject).toHaveBeenCalledTimes(1); expect(sdkClient.putObject).not.toHaveBeenCalled(); mockedCos.mockReset();
  });

  it.each([
    ['content length', (head: TencentCosTrustedPhotoshopIngestionHeadResult) => ({ ...head, contentLength: head.contentLength + 1 })],
    ['contract', (head: TencentCosTrustedPhotoshopIngestionHeadResult) => ({ ...head, metadata: { ...head.metadata, contract: 'wrong' } })],
    ['identity', (head: TencentCosTrustedPhotoshopIngestionHeadResult) => ({ ...head, metadata: { ...head.metadata, identity: 'wrong' } })],
    ['sha256', (head: TencentCosTrustedPhotoshopIngestionHeadResult) => ({ ...head, metadata: { ...head.metadata, sha256: '0'.repeat(64) } })],
    ['length', (head: TencentCosTrustedPhotoshopIngestionHeadResult) => ({ ...head, metadata: { ...head.metadata, length: '0' } })],
    ['MIME', (head: TencentCosTrustedPhotoshopIngestionHeadResult) => ({ ...head, metadata: { ...head.metadata, mime: 'image/webp' } })],
    ['fence-token digest', (head: TencentCosTrustedPhotoshopIngestionHeadResult) => ({ ...head, metadata: { ...head.metadata, fenceTokenDigest: 'wrong' } })],
  ])('rejects an initial HEAD with mismatched %s without PUT', async (_field, mutate: (head: TencentCosTrustedPhotoshopIngestionHeadResult) => TencentCosTrustedPhotoshopIngestionHeadResult) => {
    const value = input(); const { adapter, fakeClient } = storage(); fakeClient.headObject.mockResolvedValueOnce(mutate(matchingHead(value)));
    expectRedacted(await adapter.storeMaster(value).catch(error => error)); expect(fakeClient.headObject).toHaveBeenCalledTimes(1); expect(fakeClient.putObject).not.toHaveBeenCalled();
  });

  it.each([
    ['disabled', environment({ TRAILS_COS_INGESTION_ENABLED: 'false' })], ['production', environment({ NODE_ENV: 'production' })], ['missing secret', environment({ TRAILS_COS_INGESTION_MAPPING_SECRET: ' ' })], ['static token', environment({ TRAILS_COS_SECURITY_TOKEN: 'token' })], ['invalid provider', environment({ TRAILS_COS_CREDENTIAL_PROVIDER: 'other' })], ['missing sts token', environment({ TRAILS_COS_CREDENTIAL_PROVIDER: 'sts-env', TRAILS_COS_SECURITY_TOKEN: undefined })],
  ])('fails closed before client creation for %s', (_label, env) => { const factory = jest.fn<TencentCosTrustedPhotoshopIngestionClient, Parameters<TencentCosTrustedPhotoshopIngestionClientFactory>>(); const error = (() => { try { new TencentCosTrustedPhotoshopIngestionPrivateStorage(env, factory); } catch (reason: unknown) { return reason; } throw new Error('expected failure'); })(); expectRedacted(error); expect(factory).not.toHaveBeenCalled(); });

  it('supports STS only when explicitly selected and configures the default client with HTTPS and a five-second timeout', () => {
    const fake = client(); mockedCos.mockImplementation(() => fake); new TencentCosTrustedPhotoshopIngestionPrivateStorage(environment()); new TencentCosTrustedPhotoshopIngestionPrivateStorage(environment({ TRAILS_COS_CREDENTIAL_PROVIDER: 'sts-env', TRAILS_COS_SECURITY_TOKEN: 'sts-token' }));
    expect(mockedCos.mock.calls).toEqual([[{ SecretId: 'test-secret-id', SecretKey: 'test-secret-key', Protocol: 'https:', Timeout: 5000 }], [{ SecretId: 'test-secret-id', SecretKey: 'test-secret-key', SecurityToken: 'sts-token', Protocol: 'https:', Timeout: 5000 }]]); mockedCos.mockReset();
  });

  it('rejects invalid scope, metadata, or grant before I/O and reserves derivative storage for a future worker', async () => {
    const invalid = storage(); const bad = input({ objectIdentity: 'wrong' }); expectRedacted(await invalid.adapter.storeMaster(bad).catch(error => error)); expect(invalid.fakeClient.headObject).not.toHaveBeenCalled();
    const malformed = storage(); expectRedacted(await malformed.adapter.storeMaster(input({ sha256: 'bad' })).catch(error => error)); expect(malformed.fakeClient.headObject).not.toHaveBeenCalled();
    const artifactClient = client(); const artifactAdapter = storage(artifactClient).adapter; const artifactContent = Buffer.from('webp'); const artifactInput = input({ tenantId: 'tenant_b', operationId: 'operation_b', slot: 'grid-800:webp', content: artifactContent, mimeType: 'image/webp' }); artifactClient.headObject.mockRejectedValueOnce(notFound()).mockResolvedValueOnce(matchingHead(artifactInput));
    expectRedacted(await artifactAdapter.storeArtifact({ ...artifactInput, slot: 'grid-800:webp', artifact: { slot: 'grid-800:webp', logicalRendition: 'grid-800', codec: 'webp', mime: 'image/webp', width: 800, height: 400, byteLength: artifactContent.length, sha256: digest(artifactContent), buffer: artifactContent } }).catch(error => error));
    expect(artifactClient.headObject).not.toHaveBeenCalled(); expect(artifactClient.putObject).not.toHaveBeenCalled();
  });

  it('uses a deterministic key for a retried grant and a distinct immutable key for a new fence token', async () => {
    const first = input({ fenceToken: 'fence-token-one' }); const retry = storage();
    retry.fakeClient.headObject.mockRejectedValueOnce(notFound()).mockResolvedValueOnce(matchingHead(first)).mockResolvedValueOnce(matchingHead(first));
    await retry.adapter.storeMaster(first);
    const sameGrantRequest = retry.fakeClient.putObject.mock.calls[0][0];
    await retry.adapter.storeMaster(first);
    const firstAttemptKey = retry.fakeClient.headObject.mock.calls[0][0].Key;
    const retryKey = retry.fakeClient.headObject.mock.calls[2][0].Key;

    const second = input({ fenceToken: 'fence-token-two' }); const differentFence = storage();
    differentFence.fakeClient.headObject.mockRejectedValueOnce(notFound()).mockResolvedValueOnce(matchingHead(second));
    await differentFence.adapter.storeMaster(second);
    const differentFenceRequest = differentFence.fakeClient.putObject.mock.calls[0][0];

    expect(sameGrantRequest.Key).toMatch(/^masters-private\/[A-Za-z0-9_-]{43}$/);
    expect(sameGrantRequest.Key).not.toBe(differentFenceRequest.Key);
    expect(retryKey).toBe(firstAttemptKey);
    expect(sameGrantRequest.Key).toBe(`masters-private/${hmac('ingestion-cos-key', `${first.grant.objectIdentity}\u0000${hmac('ingestion-fence-token', first.grant.fenceToken)}`)}`);
  });

  it('keeps the COS dependency adapter unregistered and isolated from action, lifecycle, state, and coordinator runtime imports', () => {
    const adapterPath = require.resolve('../../src/apps/trails/utils/tencent-cos-trusted-photoshop-ingestion-private-storage'); const adapterSource = readFileSync(adapterPath, 'utf8'); const trailsRoot = join(__dirname, '../../src/apps/trails'); const otherSources = filesBelow(trailsRoot).filter(file => file.endsWith('.ts') && file !== adapterPath).map(file => readFileSync(file, 'utf8')).join('\n');
    expect(adapterSource).toMatch(/from 'cos-nodejs-sdk-v5'/); expect(adapterSource).not.toMatch(/https?:\/\/|\b(?:ACL|Signed|CDN|URL|deleteObject|getObject|listObject)\b|console\.|logger/i); expect(otherSources).not.toMatch(/tencent-cos-trusted-photoshop-ingestion-private-storage/);
  });
});
