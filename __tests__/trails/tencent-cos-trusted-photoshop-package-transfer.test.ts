import { Readable } from 'stream';
import { Actor } from '../../src/apps/trails/types';

jest.mock('cos-nodejs-sdk-v5', () => jest.fn());

import { TencentCosTrustedPhotoshopPackageTransfer, TencentCosTrustedPhotoshopPackageTransferError } from '../../src/apps/trails/utils/tencent-cos-trusted-photoshop-package-transfer';

const mockedCos = jest.requireMock('cos-nodejs-sdk-v5') as jest.Mock;
const actor: Actor = { tenantId: 'tenant_a', userId: 'owner_a', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const environment = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: 'test',
  TRAILS_COS_INGESTION_ENABLED: 'true',
  TRAILS_COS_CREDENTIAL_PROVIDER: 'static-env',
  TRAILS_COS_SECRET_ID: 'test-secret-id',
  TRAILS_COS_SECRET_KEY: 'test-secret-key',
  TRAILS_COS_INGESTION_MAPPING_SECRET: 'test-transfer-mapping-secret',
  ...overrides,
});
const client = () => ({ getObjectUrl: jest.fn((request: { Key: string }) => `https://upload.invalid/${request.Key}`), getObject: jest.fn(), deleteObject: jest.fn().mockResolvedValue({}) });
const useClient = (fake = client()) => { mockedCos.mockImplementation(() => fake); return fake; };
const completeBodies = () => [
  { Body: Buffer.from('{"schema":"trails.publishing-package/v1"}'), headers: { 'content-type': 'application/json; charset=utf-8' } },
  { Body: Readable.from([Buffer.from('grid')]), headers: { 'content-type': 'image/jpeg' } },
  { Body: Buffer.from('cover'), headers: { 'content-type': 'image/jpeg' } },
  { Body: Buffer.from('preview'), headers: { 'content-type': 'image/jpeg' } },
];
const expectRedacted = (error: unknown): void => {
  expect(error).toBeInstanceOf(TencentCosTrustedPhotoshopPackageTransferError);
  expect(error).toMatchObject({ name: 'TencentCosTrustedPhotoshopPackageTransferError', message: 'Trusted Photoshop package transfer failed' });
  expect(error).not.toHaveProperty('cause');
};

describe('Tencent COS trusted Photoshop package transfer', () => {
  afterEach(() => mockedCos.mockReset());

  it('issues a 15-minute authorization for exactly the fixed publish-package entries', () => {
    const fake = useClient();
    const before = Date.now();
    const session = new TencentCosTrustedPhotoshopPackageTransfer(environment()).createUploadSession(actor);
    const expiresAt = Date.parse(session.expiresAt);
    expect(expiresAt).toBeGreaterThan(before + (14 * 60 * 1000));
    expect(expiresAt).toBeLessThanOrEqual(before + (15 * 60 * 1000) + 1000);
    expect(session.entries.map(entry => [entry.name, entry.contentType])).toEqual([
      ['manifest.json', 'application/json'],
      ['website/grid-960.v1.jpg', 'image/jpeg'],
      ['website/cover-2048.v1.jpg', 'image/jpeg'],
      ['website/preview-4096.v1.jpg', 'image/jpeg'],
    ]);
    expect(fake.getObjectUrl).toHaveBeenCalledTimes(4);
    for (const [request] of fake.getObjectUrl.mock.calls) {
      expect(request).toMatchObject({ Bucket: 'starlight-media-prod-1313219189', Region: 'ap-guangzhou', Method: 'PUT', Sign: true, Expires: 900 });
      expect(request.Key).toMatch(/^photoshop-staging-private\/[A-Za-z0-9_-]{43}$/);
    }
    expect(JSON.stringify(session)).not.toContain('test-secret-key');
    expect(JSON.stringify(session)).not.toContain('test-transfer-mapping-secret');
  });

  it('reopens only the authorized actor session and returns no cloud addressing or credentials', async () => {
    const fake = useClient();
    const transfer = new TencentCosTrustedPhotoshopPackageTransfer(environment());
    const session = transfer.createUploadSession(actor);
    for (const body of completeBodies()) fake.getObject.mockResolvedValueOnce(body);
    const completed = await transfer.completeUpload(actor, session.uploadSession);
    expect(completed).toMatchObject({ ownerUserId: actor.userId });
    expect(completed.entries.map(entry => entry.name)).toEqual(session.entries.map(entry => entry.name));
    const projected = JSON.stringify(completed);
    for (const value of ['starlight-media-prod', 'photoshop-staging-private', 'test-secret-id', 'test-secret-key', 'test-transfer-mapping-secret', 'https://']) expect(projected).not.toContain(value);
    expect(fake.getObject).toHaveBeenCalledTimes(4);

    const anotherActor = { ...actor, userId: 'owner_b' };
    expectRedacted(await transfer.completeUpload(anotherActor, session.uploadSession).catch(error => error));
    expect(fake.getObject).toHaveBeenCalledTimes(4);
  });

  it.each([
    ['wrong MIME type', { Body: Buffer.from('{}'), headers: { 'content-type': 'text/plain' } }],
    ['empty object', { Body: Buffer.alloc(0), headers: { 'content-type': 'application/json' } }],
    ['object over entry limit', { Body: Buffer.alloc((64 * 1024) + 1), headers: { 'content-type': 'application/json' } }],
  ])('rejects a staged %s before exposing it to the ingestion coordinator', async (_label, firstResponse) => {
    const fake = useClient();
    const transfer = new TencentCosTrustedPhotoshopPackageTransfer(environment());
    const session = transfer.createUploadSession(actor);
    fake.getObject.mockResolvedValueOnce(firstResponse);
    expectRedacted(await transfer.completeUpload(actor, session.uploadSession).catch(error => error));
  });

  it.each([
    ['disabled', environment({ TRAILS_COS_INGESTION_ENABLED: 'false' })],
    ['security token present', environment({ TRAILS_COS_SECURITY_TOKEN: 'not-permitted' })],
    ['production without full publication gates', environment({ NODE_ENV: 'production' })],
    ['missing mapping secret', environment({ TRAILS_COS_INGESTION_MAPPING_SECRET: ' ' })],
  ])('fails closed before COS initialization when %s', (_label, env) => {
    useClient();
    const error = (() => { try { new TencentCosTrustedPhotoshopPackageTransfer(env); } catch (reason: unknown) { return reason; } throw new Error('expected failure'); })();
    expectRedacted(error);
    expect(mockedCos).not.toHaveBeenCalled();
  });
});
