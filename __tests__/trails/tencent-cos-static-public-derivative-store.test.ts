import { Readable } from 'stream';
import { TencentCosStaticPublicDerivativeStore } from '../../src/apps/trails/workers/tencent-cos-static-public-derivative-store';

jest.mock('cos-nodejs-sdk-v5', () => jest.fn());

const mockedCos = jest.requireMock('cos-nodejs-sdk-v5') as jest.Mock;

describe('Tencent COS static public derivative store', () => {
  it('writes only validated public derivatives without widening the private bucket ACL', async () => {
    const client = { putObject: jest.fn().mockResolvedValue({}) };
    mockedCos.mockImplementation(() => client);
    const store = new TencentCosStaticPublicDerivativeStore({
      NODE_ENV: 'production', TRAILS_MEDIA_PUBLICATION_ENABLED: 'true', TRAILS_MEDIA_SERVER_IDENTITY_MODE: 'static-scoped-key',
      TRAILS_COS_ENABLED: 'true', TRAILS_COS_CREDENTIAL_PROVIDER: 'static-env', TRAILS_COS_SECRET_ID: 'test-id',
      TRAILS_COS_SECRET_KEY: 'test-key', TRAILS_COS_INGESTION_MAPPING_SECRET: 'test-mapping-secret',
    });

    await store.putImmutable({
      credentials: { mode: 'static-scoped-key' }, key: 'public-derivatives/reference_grid.jpg', body: Readable.from(Buffer.from('jpeg')),
      contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable', contentLength: 4, sha256: 'a'.repeat(64), signal: new AbortController().signal,
    });

    const [request] = client.putObject.mock.calls[0];
    expect(request).toEqual(expect.objectContaining({
      Bucket: 'starlight-media-prod-1313219189', Region: 'ap-guangzhou', Key: 'public-derivatives/reference_grid.jpg',
    }));
    expect(request).not.toHaveProperty('ACL');
    mockedCos.mockReset();
  });
});
