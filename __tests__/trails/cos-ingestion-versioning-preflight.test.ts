import fs from 'fs';
import path from 'path';
import COS from 'cos-nodejs-sdk-v5';
import { createTrailsCosIngestionVersioningPreflight } from '../../src/apps/starlight/trails/cos-ingestion-versioning-preflight';

jest.mock('cos-nodejs-sdk-v5', () => jest.fn());

const mockedCos = jest.mocked(COS);
const projectRoot = path.resolve(__dirname, '../..');
const preflightSource = path.join(projectRoot, 'src/apps/starlight/trails/cos-ingestion-versioning-preflight.ts');
const validEnvironment = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'development',
  TRAILS_COS_INGESTION_VERSIONING_PREFLIGHT_ENABLED: 'true',
  TRAILS_COS_CREDENTIAL_PROVIDER: 'static-env',
  TRAILS_COS_SECRET_ID: 'development-only-id',
  TRAILS_COS_SECRET_KEY: 'development-only-key',
});
const validStsEnvironment = (): NodeJS.ProcessEnv => ({
  ...validEnvironment(),
  TRAILS_COS_CREDENTIAL_PROVIDER: 'sts-env',
  TRAILS_COS_SECURITY_TOKEN: 'short-lived-security-token',
});

describe('Trails COS ingestion versioning preflight boundary', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is disabled by default without constructing a client', async () => {
    const createClient = jest.fn();

    await expect(createTrailsCosIngestionVersioningPreflight({ NODE_ENV: 'development' }, createClient).check())
      .resolves.toEqual({ eligible: false, reason: 'disabled' });
    expect(createClient).not.toHaveBeenCalled();
    expect(mockedCos).not.toHaveBeenCalled();
  });

  it('fails closed before client construction outside development/test or with invalid credentials', async () => {
    const missingKey = validEnvironment();
    delete missingKey.TRAILS_COS_SECRET_KEY;
    const staticWithToken = { ...validEnvironment(), TRAILS_COS_SECURITY_TOKEN: 'unexpected-token' };
    const missingStsToken = { ...validEnvironment(), TRAILS_COS_CREDENTIAL_PROVIDER: 'sts-env' };
    const createClient = jest.fn();

    await expect(createTrailsCosIngestionVersioningPreflight({ ...validEnvironment(), NODE_ENV: 'production' }, createClient).check()).resolves.toEqual({ eligible: false, reason: 'misconfigured' });
    await expect(createTrailsCosIngestionVersioningPreflight(missingKey, createClient).check()).resolves.toEqual({ eligible: false, reason: 'misconfigured' });
    await expect(createTrailsCosIngestionVersioningPreflight(staticWithToken, createClient).check()).resolves.toEqual({ eligible: false, reason: 'misconfigured' });
    await expect(createTrailsCosIngestionVersioningPreflight(missingStsToken, createClient).check()).resolves.toEqual({ eligible: false, reason: 'misconfigured' });
    expect(createClient).not.toHaveBeenCalled();
    expect(mockedCos).not.toHaveBeenCalled();
  });

  it('uses only the fixed request and approves only explicit NoSuchVersioningConfiguration', async () => {
    const getBucketVersioning = jest.fn().mockRejectedValue({ Code: 'NoSuchVersioningConfiguration', provider: 'private-value' });
    const createClient = jest.fn().mockReturnValue({ getBucketVersioning });

    await expect(createTrailsCosIngestionVersioningPreflight({ ...validEnvironment(), TRAILS_COS_BUCKET: 'other-bucket', TRAILS_COS_REGION: 'ap-other' }, createClient).check())
      .resolves.toEqual({ eligible: true, reason: 'ready' });
    expect(getBucketVersioning).toHaveBeenCalledWith({ Bucket: 'starlight-media-prod-1313219189', Region: 'ap-guangzhou' });
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(mockedCos).not.toHaveBeenCalled();
  });

  it.each([
    [{ Status: 'Enabled' }],
    [{ Status: 'Suspended' }],
    [{}],
    [undefined],
  ])('rejects versioning responses that are enabled, suspended, malformed, or unknown', async (response) => {
    const getBucketVersioning = jest.fn().mockResolvedValue(response);
    mockedCos.mockImplementation(() => ({ getBucketVersioning }) as unknown as COS);

    await expect(createTrailsCosIngestionVersioningPreflight(validEnvironment()).check())
      .resolves.toEqual({ eligible: false, reason: 'versioning-not-disabled' });
  });

  it('fails closed and redacts non-versioning errors', async () => {
    const token = 'short-lived-security-token';
    const getBucketVersioning = jest.fn().mockRejectedValue(new Error(`provider response ${token}`));
    mockedCos.mockImplementation(() => ({ getBucketVersioning }) as unknown as COS);

    const result = await createTrailsCosIngestionVersioningPreflight(validStsEnvironment()).check();

    expect(result).toEqual({ eligible: false, reason: 'unavailable' });
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain('provider response');
    expect(JSON.stringify(result)).not.toContain('starlight-media');
    expect(JSON.stringify(result)).not.toContain('ap-guangzhou');
  });

  it('constructs the default client with static or STS credentials only after the gate passes', async () => {
    const getBucketVersioning = jest.fn().mockRejectedValue({ Code: 'NoSuchVersioningConfiguration' });
    mockedCos.mockImplementation(() => ({ getBucketVersioning }) as unknown as COS);

    await createTrailsCosIngestionVersioningPreflight(validEnvironment()).check();
    expect(mockedCos).toHaveBeenLastCalledWith({ SecretId: 'development-only-id', SecretKey: 'development-only-key', Protocol: 'https:', Timeout: 5000 });

    await createTrailsCosIngestionVersioningPreflight(validStsEnvironment()).check();
    expect(mockedCos).toHaveBeenLastCalledWith({ SecretId: 'development-only-id', SecretKey: 'development-only-key', SecurityToken: 'short-lived-security-token', Protocol: 'https:', Timeout: 5000 });
  });

  it('is source-isolated from writers, actions, lifecycle, coordinators, and mutation APIs', () => {
    const source = fs.readFileSync(preflightSource, 'utf8');

    expect(source).toContain('getBucketVersioning');
    expect(source).not.toMatch(/(?:put|delete|upload|set)Bucket|putObject|deleteObject|headObject/i);
    expect(source).not.toMatch(/from ['"].*(?:trusted-photoshop|derivative-storage|actions|coordinator|writer)/i);
  });
});
