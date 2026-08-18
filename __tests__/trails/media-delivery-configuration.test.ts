import { validateTrailsMediaDeliveryConfiguration } from '../../src/apps/trails/media-delivery-configuration';

const production = (): NodeJS.ProcessEnv => ({ NODE_ENV: 'production', TRAILS_COS_ENABLED: 'false', TRAILS_COS_INGESTION_ENABLED: 'false', TRAILS_COS_INGESTION_VERSIONING_PREFLIGHT_ENABLED: 'false', TRAILS_MEDIA_PUBLICATION_ENABLED: 'false' });

describe('Trails media delivery production configuration', () => {
  it('accepts the explicit disabled production baseline', () => {
    expect(() => validateTrailsMediaDeliveryConfiguration(production())).not.toThrow();
  });

  it.each(['TRAILS_COS_SECURITY_TOKEN'] as const)('rejects prohibited production configuration %s without reflecting its value', (key) => {
    const secret = 'secret-value';
    const environment = { ...production(), [key]: secret };
    expect(() => validateTrailsMediaDeliveryConfiguration(environment)).toThrow('Unsafe Trails media delivery configuration in production');
    try { validateTrailsMediaDeliveryConfiguration(environment); } catch (error: unknown) { expect(error).toBeInstanceOf(Error); expect((error as Error).message).not.toContain(secret); }
  });

  it('requires workload identity and all non-secret identifiers when publication is enabled', () => {
    expect(() => validateTrailsMediaDeliveryConfiguration({ ...production(), TRAILS_MEDIA_PUBLICATION_ENABLED: 'true' })).toThrow();
    expect(() => validateTrailsMediaDeliveryConfiguration({ ...production(), TRAILS_MEDIA_PUBLICATION_ENABLED: 'true', TRAILS_MEDIA_SERVER_IDENTITY_MODE: 'workload-identity', TRAILS_MEDIA_CDN_DISTRIBUTION_ID: 'cdn_1', TRAILS_MEDIA_COS_BUCKET_ID: 'bucket_1', TRAILS_MEDIA_COS_REGION: 'ap-guangzhou', TRAILS_MEDIA_PUBLIC_DERIVATIVE_NAMESPACE: 'approved-v1' })).not.toThrow();
  });

  it('accepts a fully configured Lighthouse static key without reflecting credential values', () => {
    const environment = {
      ...production(),
      TRAILS_MEDIA_PUBLICATION_ENABLED: 'true',
      TRAILS_MEDIA_SERVER_IDENTITY_MODE: 'static-scoped-key',
      TRAILS_COS_ENABLED: 'true',
      TRAILS_COS_INGESTION_ENABLED: 'true',
      TRAILS_COS_CREDENTIAL_PROVIDER: 'static-env',
      TRAILS_COS_SECRET_ID: 'secret-id',
      TRAILS_COS_SECRET_KEY: 'secret-key',
      TRAILS_COS_INGESTION_MAPPING_SECRET: 'ingestion-mapping-secret',
      TRAILS_COS_PRIVATE_DERIVATIVE_MAPPING_SECRET: 'derivative-mapping-secret',
      TRAILS_MEDIA_CDN_DISTRIBUTION_ID: 'media-starlight-host',
      TRAILS_MEDIA_COS_BUCKET_ID: 'starlight-media-prod-1313219189',
      TRAILS_MEDIA_COS_REGION: 'ap-guangzhou',
      TRAILS_MEDIA_PUBLIC_DERIVATIVE_NAMESPACE: 'public-derivatives',
    };
    expect(() => validateTrailsMediaDeliveryConfiguration(environment)).not.toThrow();
  });

  it('rejects a static-key deployment that names a COS scope different from the fixed worker scope', () => {
    const environment = {
      ...production(), TRAILS_MEDIA_PUBLICATION_ENABLED: 'true', TRAILS_MEDIA_SERVER_IDENTITY_MODE: 'static-scoped-key', TRAILS_COS_ENABLED: 'true', TRAILS_COS_INGESTION_ENABLED: 'true', TRAILS_COS_CREDENTIAL_PROVIDER: 'static-env', TRAILS_COS_SECRET_ID: 'secret-id', TRAILS_COS_SECRET_KEY: 'secret-key', TRAILS_COS_INGESTION_MAPPING_SECRET: 'ingestion-mapping-secret', TRAILS_MEDIA_CDN_DISTRIBUTION_ID: 'media-starlight-host', TRAILS_MEDIA_COS_BUCKET_ID: 'other-bucket', TRAILS_MEDIA_COS_REGION: 'ap-guangzhou', TRAILS_MEDIA_PUBLIC_DERIVATIVE_NAMESPACE: 'public-derivatives',
    };
    expect(() => validateTrailsMediaDeliveryConfiguration(environment)).toThrow('Unsafe Trails media delivery configuration in production');
  });

  it('does not restrict local/test-only adapter configuration outside production', () => {
    expect(() => validateTrailsMediaDeliveryConfiguration({ NODE_ENV: 'test', TRAILS_COS_ENABLED: 'true', TRAILS_COS_SECRET_ID: 'local-secret' })).not.toThrow();
  });
});
