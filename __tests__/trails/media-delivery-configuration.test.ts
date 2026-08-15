import { validateTrailsMediaDeliveryConfiguration } from '../../src/apps/trails/media-delivery-configuration';

const production = (): NodeJS.ProcessEnv => ({ NODE_ENV: 'production', TRAILS_COS_ENABLED: 'false', TRAILS_COS_INGESTION_ENABLED: 'false', TRAILS_COS_INGESTION_VERSIONING_PREFLIGHT_ENABLED: 'false', TRAILS_MEDIA_PUBLICATION_ENABLED: 'false' });

describe('Trails media delivery production configuration', () => {
  it('accepts the explicit disabled production baseline', () => {
    expect(() => validateTrailsMediaDeliveryConfiguration(production())).not.toThrow();
  });

  it.each(['TRAILS_COS_ENABLED', 'TRAILS_COS_INGESTION_ENABLED', 'TRAILS_COS_INGESTION_VERSIONING_PREFLIGHT_ENABLED', 'TRAILS_COS_CREDENTIAL_PROVIDER', 'TRAILS_COS_SECRET_ID', 'TRAILS_COS_SECRET_KEY', 'TRAILS_COS_SECURITY_TOKEN', 'TRAILS_COS_INGESTION_MAPPING_SECRET', 'TRAILS_COS_PRIVATE_DERIVATIVE_MAPPING_SECRET', 'TRAILS_MEDIA_PUBLIC_DELIVERY_BASE'] as const)('rejects prohibited production configuration %s without reflecting its value', (key) => {
    const secret = key === 'TRAILS_MEDIA_PUBLIC_DELIVERY_BASE' ? 'https://cdn.example.test' : 'secret-value';
    const environment = { ...production(), [key]: secret };
    expect(() => validateTrailsMediaDeliveryConfiguration(environment)).toThrow('Unsafe Trails media delivery configuration in production');
    try { validateTrailsMediaDeliveryConfiguration(environment); } catch (error: unknown) { expect(error).toBeInstanceOf(Error); expect((error as Error).message).not.toContain(secret); }
  });

  it('requires workload identity and all non-secret identifiers when publication is enabled', () => {
    expect(() => validateTrailsMediaDeliveryConfiguration({ ...production(), TRAILS_MEDIA_PUBLICATION_ENABLED: 'true' })).toThrow();
    expect(() => validateTrailsMediaDeliveryConfiguration({ ...production(), TRAILS_MEDIA_PUBLICATION_ENABLED: 'true', TRAILS_MEDIA_SERVER_IDENTITY_MODE: 'workload-identity', TRAILS_MEDIA_CDN_DISTRIBUTION_ID: 'cdn_1', TRAILS_MEDIA_COS_BUCKET_ID: 'bucket_1', TRAILS_MEDIA_COS_REGION: 'ap-guangzhou', TRAILS_MEDIA_PUBLIC_DERIVATIVE_NAMESPACE: 'approved-v1' })).not.toThrow();
  });

  it('does not restrict local/test-only adapter configuration outside production', () => {
    expect(() => validateTrailsMediaDeliveryConfiguration({ NODE_ENV: 'test', TRAILS_COS_ENABLED: 'true', TRAILS_COS_SECRET_ID: 'local-secret' })).not.toThrow();
  });
});
