const productionOnlyForbidden = [
  'TRAILS_COS_ENABLED',
  'TRAILS_COS_INGESTION_ENABLED',
  'TRAILS_COS_INGESTION_VERSIONING_PREFLIGHT_ENABLED',
  'TRAILS_COS_CREDENTIAL_PROVIDER',
  'TRAILS_COS_SECRET_ID',
  'TRAILS_COS_SECRET_KEY',
  'TRAILS_COS_SECURITY_TOKEN',
  'TRAILS_COS_INGESTION_MAPPING_SECRET',
  'TRAILS_COS_PRIVATE_DERIVATIVE_MAPPING_SECRET',
  'TRAILS_MEDIA_PUBLIC_DELIVERY_BASE',
] as const;

const requiredPublicationIdentifiers = [
  'TRAILS_MEDIA_CDN_DISTRIBUTION_ID',
  'TRAILS_MEDIA_COS_BUCKET_ID',
  'TRAILS_MEDIA_COS_REGION',
  'TRAILS_MEDIA_PUBLIC_DERIVATIVE_NAMESPACE',
] as const;

const configured = (environment: NodeJS.ProcessEnv, key: string) => Object.prototype.hasOwnProperty.call(environment, key);
const nonSecretIdentifier = (value: string | undefined) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(value);

/**
 * Validates deployment intent only. It never builds a COS client, exposes a delivery URL,
 * accepts static credentials, or enables a delivery worker. Production publication remains
 * unavailable until a separately composed workload-identity worker uses this contract.
 */
export const validateTrailsMediaDeliveryConfiguration = (environment: NodeJS.ProcessEnv = process.env): void => {
  if (environment.NODE_ENV !== 'production') return;

  const publicationEnabled = environment.TRAILS_MEDIA_PUBLICATION_ENABLED === 'true';
  if (environment.TRAILS_MEDIA_PUBLICATION_ENABLED !== undefined && !['true', 'false'].includes(environment.TRAILS_MEDIA_PUBLICATION_ENABLED)) {
    throw new Error('Unsafe Trails media delivery configuration in production');
  }

  if (productionOnlyForbidden.some(key => configured(environment, key) && environment[key] !== 'false')) {
    throw new Error('Unsafe Trails media delivery configuration in production');
  }

  if (!publicationEnabled) {
    if (requiredPublicationIdentifiers.some(key => configured(environment, key)) || configured(environment, 'TRAILS_MEDIA_SERVER_IDENTITY_MODE')) {
      throw new Error('Unsafe Trails media delivery configuration in production');
    }
    return;
  }

  if (environment.TRAILS_MEDIA_SERVER_IDENTITY_MODE !== 'workload-identity' || requiredPublicationIdentifiers.some(key => !nonSecretIdentifier(environment[key]))) {
    throw new Error('Unsafe Trails media delivery configuration in production');
  }
};
