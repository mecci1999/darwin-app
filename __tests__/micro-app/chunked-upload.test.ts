import { strToU8, zipSync } from 'fflate';
import microAppActions from '../../src/apps/starlight/micro-app/actions';

const packageBase64 = Buffer.from(zipSync({
  'manifest.json': strToU8(JSON.stringify({
    appId: 'starlight-trails-workspace',
    name: '星迹创作后台',
    version: '1.0.3',
    entry: 'index.html',
  })),
  'index.html': strToU8('<!doctype html><title>StarLight Trails</title>'),
})).toString('base64');

const uploadedManifest = {
  appId: 'starlight-trails-workspace',
  name: '星迹创作后台',
  version: '1.0.3',
  entry: 'index.html',
  icon: 'https://cdn.starlight.host/micro-app-icons/trails.webp',
  iconFileId: 'file-123',
};

const createFixture = () => {
  const chunks = new Map<string, unknown>();
  const upsertMicroApp = jest.fn(async (app) => app);
  const upsertMicroAppVersion = jest.fn(async (version) => version);
  const createMicroAppAuditLog = jest.fn(async () => undefined);
  const star = {
    cacher: {
      get: jest.fn(async (key: string) => chunks.get(key)),
      set: jest.fn(async (key: string, value: unknown) => chunks.set(key, value)),
      delete: jest.fn(async (key: string) => chunks.delete(key)),
    },
    db: {
      microApp: { upsertMicroApp, upsertMicroAppVersion, createMicroAppAuditLog },
    },
  };
  return { actions: microAppActions(star as never), chunks, upsertMicroApp, upsertMicroAppVersion, createMicroAppAuditLog };
};

const context = (params: Record<string, unknown>) => ({
  params,
  meta: { tenantId: 'tenant-1', user: { userId: 'admin-1', isAdmin: true } },
});

describe('micro-app chunked upload', () => {
  it('persists a complete upload without relying on an action handler this binding', async () => {
    const fixture = createFixture();
    const splitAt = Math.floor(packageBase64.length / 2);
    const uploadId = 'trails-1.0.3-upload';

    await fixture.actions['v1.uploadChunk'].handler(context({ uploadId, index: 0, total: 2, manifest: uploadedManifest, chunkBase64: packageBase64.slice(0, splitAt) }) as never);
    await fixture.actions['v1.uploadChunk'].handler(context({ uploadId, index: 1, total: 2, chunkBase64: packageBase64.slice(splitAt) }) as never);
    const response = await fixture.actions['v1.completeUpload'].handler(context({ uploadId, visibility: 'tenant', rolloutPercent: 100 }) as never);

    expect(response.status).toBe(200);
    expect(response.data.success).toBe(true);
    expect(fixture.upsertMicroApp).toHaveBeenCalledWith(expect.objectContaining({ appId: 'starlight-trails-workspace', tenantId: 'tenant-1' }));
    expect(fixture.upsertMicroAppVersion).toHaveBeenCalledWith(expect.objectContaining({
      version: '1.0.3',
      packageBase64,
      manifestJson: expect.stringContaining('https://cdn.starlight.host/micro-app-icons/trails.webp'),
    }));
    expect(fixture.createMicroAppAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'upload', version: '1.0.3' }));
    expect(fixture.chunks.size).toBe(0);
  });

  it('retains chunks when persistence fails so the client can retry completion', async () => {
    const fixture = createFixture();
    const uploadId = 'trails-retry-upload';

    await fixture.actions['v1.uploadChunk'].handler(context({ uploadId, index: 0, total: 1, chunkBase64: 'not-a-zip' }) as never);
    const response = await fixture.actions['v1.completeUpload'].handler(context({ uploadId, visibility: 'tenant' }) as never);

    expect(response.data.success).toBe(false);
    expect(fixture.chunks.size).toBe(1);
  });
});
