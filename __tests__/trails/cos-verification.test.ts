import COS from 'cos-nodejs-sdk-v5';
import { createTrailsCosVerifier } from '../../src/apps/trails/cos-verification';

jest.mock('cos-nodejs-sdk-v5', () => jest.fn());

const mockedCos = jest.mocked(COS);
const validEnvironment = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'development',
  TRAILS_COS_ENABLED: 'true',
  TRAILS_COS_CREDENTIAL_PROVIDER: 'static-env',
  TRAILS_COS_SECRET_ID: 'development-only-id',
  TRAILS_COS_SECRET_KEY: 'development-only-key',
});
const validStsEnvironment = (): NodeJS.ProcessEnv => ({
  ...validEnvironment(),
  TRAILS_COS_CREDENTIAL_PROVIDER: 'sts-env',
  TRAILS_COS_SECURITY_TOKEN: 'short-lived-security-token',
});

describe('Trails COS verification boundary', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is disabled by default without constructing an SDK client', async () => {
    const result = await createTrailsCosVerifier({ NODE_ENV: 'development' }).verify();

    expect(result).toEqual({ available: false, reason: 'disabled' });
    expect(mockedCos).not.toHaveBeenCalled();
  });

  it('fails closed for incomplete credentials or production static configuration', async () => {
    const incomplete = validEnvironment();
    delete incomplete.TRAILS_COS_SECRET_KEY;
    const productionStatic = { ...validEnvironment(), NODE_ENV: 'production' };

    await expect(createTrailsCosVerifier(incomplete).verify()).resolves.toEqual({ available: false, reason: 'misconfigured' });
    await expect(createTrailsCosVerifier(productionStatic).verify()).resolves.toEqual({ available: false, reason: 'misconfigured' });
    expect(mockedCos).not.toHaveBeenCalled();
  });

  it('fails closed without constructing a client when the STS token is missing or blank', async () => {
    const missingToken = { ...validEnvironment(), TRAILS_COS_CREDENTIAL_PROVIDER: 'sts-env' };
    const blankToken = { ...validStsEnvironment(), TRAILS_COS_SECURITY_TOKEN: '   ' };

    await expect(createTrailsCosVerifier(missingToken).verify()).resolves.toEqual({ available: false, reason: 'misconfigured' });
    await expect(createTrailsCosVerifier(blankToken).verify()).resolves.toEqual({ available: false, reason: 'misconfigured' });
    expect(mockedCos).not.toHaveBeenCalled();
  });

  it('heads the reviewed fixed validation object regardless of operator-supplied scope variables', async () => {
    const headObject = jest.fn().mockResolvedValue({ ETag: 'private-provider-data' });
    mockedCos.mockImplementation(() => ({ headObject }) as unknown as COS);

    const result = await createTrailsCosVerifier({ ...validEnvironment(), TRAILS_COS_BUCKET: 'other-bucket-1234567890', TRAILS_COS_REGION: 'ap-other', TRAILS_COS_VERIFICATION_KEY: 'masters-private/cos-validation/other.jpg' }).verify();

    expect(result).toEqual({ available: true, reason: 'available' });
    expect(mockedCos).toHaveBeenCalledWith(expect.objectContaining({ Protocol: 'https:', Timeout: 5000 }));
    expect(headObject).toHaveBeenCalledTimes(1);
    expect(headObject).toHaveBeenCalledWith({
      Bucket: 'starlight-media-prod-1313219189',
      Region: 'ap-guangzhou',
      Key: 'masters-private/cos-validation/master-test.jpg',
    });
    expect(Object.keys(mockedCos.mock.results[0].value)).toEqual(['headObject']);
  });

  it('does not pass or accept a SecurityToken for static-env credentials', async () => {
    const headObject = jest.fn().mockResolvedValue({});
    mockedCos.mockImplementation(() => ({ headObject }) as unknown as COS);

    await expect(createTrailsCosVerifier(validEnvironment()).verify()).resolves.toEqual({ available: true, reason: 'available' });
    expect(mockedCos).toHaveBeenCalledWith({
      SecretId: 'development-only-id',
      SecretKey: 'development-only-key',
      Protocol: 'https:',
      Timeout: 5000,
    });
    expect(mockedCos.mock.calls[0][0]).not.toHaveProperty('SecurityToken');

    await expect(createTrailsCosVerifier({ ...validEnvironment(), TRAILS_COS_SECURITY_TOKEN: 'unexpected-token' }).verify()).resolves.toEqual({ available: false, reason: 'misconfigured' });
    expect(mockedCos).toHaveBeenCalledTimes(1);
  });

  it('passes the configured STS token only as SecurityToken', async () => {
    const headObject = jest.fn().mockResolvedValue({});
    mockedCos.mockImplementation(() => ({ headObject }) as unknown as COS);

    await expect(createTrailsCosVerifier(validStsEnvironment()).verify()).resolves.toEqual({ available: true, reason: 'available' });
    expect(mockedCos).toHaveBeenCalledWith({
      SecretId: 'development-only-id',
      SecretKey: 'development-only-key',
      SecurityToken: 'short-lived-security-token',
      Protocol: 'https:',
      Timeout: 5000,
    });
  });

  it('redacts SDK failures, provider response data, and the STS token', async () => {
    const token = 'short-lived-security-token';
    const headObject = jest.fn().mockRejectedValue(new Error(`secret provider response: ${token}`));
    mockedCos.mockImplementation(() => ({ headObject }) as unknown as COS);

    const result = await createTrailsCosVerifier(validStsEnvironment()).verify();

    expect(result).toEqual({ available: false, reason: 'unavailable' });
    expect(JSON.stringify(result)).not.toContain('secret provider response');
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain('masters-private');
    expect(JSON.stringify(result)).not.toContain('starlight-media');
  });
});
