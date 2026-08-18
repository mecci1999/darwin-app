import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  TencentCosPrivateDerivativeClient,
  TencentCosPrivateDerivativeClientFactory,
  TencentCosTrustedPrivateDerivativeStorage,
  TencentCosTrustedPrivateDerivativeStorageError,
} from '../../src/apps/trails/utils/tencent-cos-trusted-private-derivative-storage';
import { TrustedPhotoshopDerivativeStagedArtifact } from '../../src/apps/trails/utils/trusted-photoshop-derivative-staging-plan';

jest.mock('cos-nodejs-sdk-v5', () => jest.fn());

const mockedCos = jest.requireMock('cos-nodejs-sdk-v5') as jest.Mock;

const environment = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: 'test',
  TRAILS_COS_ENABLED: 'true',
  TRAILS_COS_CREDENTIAL_PROVIDER: 'static-env',
  TRAILS_COS_SECRET_ID: 'test-secret-id',
  TRAILS_COS_SECRET_KEY: 'test-secret-key',
  TRAILS_COS_PRIVATE_DERIVATIVE_MAPPING_SECRET: 'test-mapping-secret',
  ...overrides,
});

const artifact = (content: string, mime: 'image/avif' | 'image/webp' | 'image/jpeg' = 'image/jpeg'): TrustedPhotoshopDerivativeStagedArtifact => ({
  slot: 'grid-960:jpeg', logicalRendition: 'grid-960', codec: 'jpeg', mime,
  width: 960, height: 400, byteLength: Buffer.byteLength(content), sha256: 'a'.repeat(64), buffer: Buffer.from(content),
});

const client = (): jest.Mocked<TencentCosPrivateDerivativeClient> => ({
  putObject: jest.fn().mockResolvedValue({ privateProviderDetail: 'never exposed' }),
  deleteObject: jest.fn().mockResolvedValue({ privateProviderDetail: 'never exposed' }),
});

const storage = (
  fakeClient = client(),
  env: NodeJS.ProcessEnv = environment(),
): { storage: TencentCosTrustedPrivateDerivativeStorage; fakeClient: jest.Mocked<TencentCosPrivateDerivativeClient>; factory: jest.MockedFunction<TencentCosPrivateDerivativeClientFactory> } => {
  const factory = jest.fn<TencentCosPrivateDerivativeClient, Parameters<TencentCosPrivateDerivativeClientFactory>>().mockReturnValue(fakeClient);
  return { storage: new TencentCosTrustedPrivateDerivativeStorage(env, factory), fakeClient, factory };
};

const expectRedacted = (error: unknown): void => {
  expect(error).toBeInstanceOf(TencentCosTrustedPrivateDerivativeStorageError);
  expect(error).toMatchObject({ name: 'TencentCosTrustedPrivateDerivativeStorageError', message: 'Private derivative storage failed' });
  expect(error).not.toHaveProperty('cause');
  expect(JSON.stringify(error)).toBe('{"name":"TencentCosTrustedPrivateDerivativeStorageError"}');
};

const filesBelow = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const file = join(directory, entry.name);
  return entry.isDirectory() ? filesBelow(file) : [file];
});

describe('Tencent COS trusted private derivative storage', () => {
  it('stores in order with opaque random locators and fixed private-only COS requests', async () => {
    const { storage: adapter, fakeClient, factory } = storage();
    const artifacts = [artifact('first', 'image/avif'), artifact('second', 'image/webp')];
    const results = await adapter.store(artifacts);

    expect(factory).toHaveBeenCalledWith({ secretId: 'test-secret-id', secretKey: 'test-secret-key' });
    expect(results).toHaveLength(2);
    expect(results.map(result => Object.keys(result))).toEqual([['privateLocator'], ['privateLocator']]);
    expect(results.every(result => /^[A-Za-z0-9_-]{1,512}$/.test(result.privateLocator))).toBe(true);
    expect(new Set(results.map(result => result.privateLocator)).size).toBe(2);
    expect(fakeClient.putObject).toHaveBeenCalledTimes(2);
    for (const [index, [request]] of fakeClient.putObject.mock.calls.entries()) {
      expect(request).toEqual({
        Bucket: 'starlight-media-prod-1313219189', Region: 'ap-guangzhou',
        Key: expect.stringMatching(/^derivatives-private\/v1\/[A-Za-z0-9_-]{43}$/),
        Body: artifacts[index].buffer, ContentLength: artifacts[index].buffer.length, ContentType: artifacts[index].mime,
      });
      expect(Object.keys(request)).toEqual(['Bucket', 'Region', 'Key', 'Body', 'ContentLength', 'ContentType']);
      expect(request.Key).not.toContain(results[index].privateLocator);
    }
    expect(JSON.stringify(results)).not.toContain('derivatives-private');
    expect(JSON.stringify(results)).not.toContain('starlight-media-prod');
  });

  it('passes SecurityToken only for the explicit STS credential provider', () => {
    const { factory } = storage(client(), environment({ TRAILS_COS_CREDENTIAL_PROVIDER: 'sts-env', TRAILS_COS_SECURITY_TOKEN: 'test-token' }));
    expect(factory).toHaveBeenCalledWith({ secretId: 'test-secret-id', secretKey: 'test-secret-key', securityToken: 'test-token' });
  });

  it('configures the default SDK only with fixed HTTPS timeout and the credential-provider boundary', () => {
    const fakeClient = client();
    mockedCos.mockImplementation(() => fakeClient);
    new TencentCosTrustedPrivateDerivativeStorage(environment());
    new TencentCosTrustedPrivateDerivativeStorage(environment({ TRAILS_COS_CREDENTIAL_PROVIDER: 'sts-env', TRAILS_COS_SECURITY_TOKEN: 'test-token' }));

    expect(mockedCos.mock.calls).toEqual([
      [{ SecretId: 'test-secret-id', SecretKey: 'test-secret-key', Protocol: 'https:', Timeout: 5000 }],
      [{ SecretId: 'test-secret-id', SecretKey: 'test-secret-key', SecurityToken: 'test-token', Protocol: 'https:', Timeout: 5000 }],
    ]);
    mockedCos.mockReset();
  });

  it.each([
    ['feature disabled', environment({ TRAILS_COS_ENABLED: 'false' })],
    ['production', environment({ NODE_ENV: 'production' })],
    ['unknown provider', environment({ TRAILS_COS_CREDENTIAL_PROVIDER: 'other' })],
    ['blank credentials', environment({ TRAILS_COS_SECRET_ID: '  ' })],
    ['missing mapping secret', environment({ TRAILS_COS_PRIVATE_DERIVATIVE_MAPPING_SECRET: ' ' })],
    ['static token boundary', environment({ TRAILS_COS_SECURITY_TOKEN: 'not-permitted' })],
    ['missing STS token', environment({ TRAILS_COS_CREDENTIAL_PROVIDER: 'sts-env', TRAILS_COS_SECURITY_TOKEN: undefined })],
  ])('fails closed without production or invalid credential construction for %s', (_label, env) => {
    const factory = jest.fn<TencentCosPrivateDerivativeClient, Parameters<TencentCosPrivateDerivativeClientFactory>>();
    const error = (() => {
      try {
        new TencentCosTrustedPrivateDerivativeStorage(env, factory);
      } catch (reason: unknown) {
        return reason;
      }
      throw new Error('expected construction to fail');
    })();
    expectRedacted(error);
    expect(factory).not.toHaveBeenCalled();
    expect(JSON.stringify(error)).not.toContain('test-secret');
  });

  it('deletes every attempted key after a failed put and redacts all provider details', async () => {
    const { storage: adapter, fakeClient } = storage();
    fakeClient.putObject.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('provider / hidden-key failure'));
    fakeClient.deleteObject.mockRejectedValueOnce(new Error('cleanup failure'));
    const error = await adapter.store([artifact('one'), artifact('two')]).catch(reason => reason);

    expectRedacted(error);
    expect(fakeClient.putObject).toHaveBeenCalledTimes(2);
    expect(fakeClient.deleteObject).toHaveBeenCalledTimes(2);
    expect(fakeClient.deleteObject.mock.calls.map(([request]) => request)).toEqual(fakeClient.putObject.mock.calls.map(([request]) => ({
      Bucket: 'starlight-media-prod-1313219189', Region: 'ap-guangzhou', Key: request.Key,
    })));
    expect(JSON.stringify(error)).not.toContain('provider');
    expect(JSON.stringify(error)).not.toContain('hidden-key');
  });

  it('removes all valid locators even after delete failures, with deterministic internal keys and redacted error', async () => {
    const { storage: adapter, fakeClient } = storage();
    fakeClient.deleteObject.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('provider failure'));
    const error = await adapter.remove(['first_locator', 'first_locator']).catch(reason => reason);

    expectRedacted(error);
    expect(fakeClient.deleteObject).toHaveBeenCalledTimes(2);
    const keys = fakeClient.deleteObject.mock.calls.map(([request]) => request.Key);
    expect(keys[0]).toMatch(/^derivatives-private\/v1\/[A-Za-z0-9_-]{43}$/);
    expect(keys[1]).toBe(keys[0]);
  });

  it.each(['bad/locator', '', 'x'.repeat(513)])('rejects invalid locators before any delete: %s', async locator => {
    const { storage: adapter, fakeClient } = storage();
    const error = await adapter.remove(['valid_locator', locator]).catch(reason => reason);
    expectRedacted(error);
    expect(fakeClient.deleteObject).not.toHaveBeenCalled();
    if (locator) expect(JSON.stringify(error)).not.toContain(locator);
  });

  it.each([Buffer.from('valid_locator'), 123])('rejects runtime non-string locators before any delete', async locator => {
    const { storage: adapter, fakeClient } = storage();
    const error = await adapter.remove(['valid_locator', locator] as unknown as readonly string[]).catch(reason => reason);
    expectRedacted(error);
    expect(fakeClient.deleteObject).not.toHaveBeenCalled();
  });

  it('keeps the COS dependency and server-only adapter isolated from actions, lifecycle, and state', () => {
    const adapterPath = require.resolve('../../src/apps/trails/utils/tencent-cos-trusted-private-derivative-storage');
    const adapterSource = readFileSync(adapterPath, 'utf8');
const trailsRoot = join(__dirname, '../../src/apps/trails');
    const otherSources = filesBelow(trailsRoot)
      .filter(file => file.endsWith('.ts') && file !== adapterPath)
      .map(file => readFileSync(file, 'utf8')).join('\n');
    expect(adapterSource).toMatch(/from 'cos-nodejs-sdk-v5'/);
    expect(adapterSource).not.toMatch(/https?:\/\/|\b(?:ACL|Grant|Signed|CDN|URL)\b|console\.|logger/i);
    expect(otherSources).not.toMatch(/tencent-cos-trusted-private-derivative-storage/);
  });
});
