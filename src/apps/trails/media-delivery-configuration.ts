const legacyProductionForbidden = [
  'TRAILS_COS_SECURITY_TOKEN',
] as const;

const requiredPublicationIdentifiers = [
  'TRAILS_MEDIA_CDN_DISTRIBUTION_ID',
  'TRAILS_MEDIA_COS_BUCKET_ID',
  'TRAILS_MEDIA_COS_REGION',
  'TRAILS_MEDIA_PUBLIC_DERIVATIVE_NAMESPACE',
] as const;

const configured = (environment: NodeJS.ProcessEnv, key: string) => Object.prototype.hasOwnProperty.call(environment, key);
const nonSecretIdentifier = (value: string | undefined) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(value);
const nonEmpty = (value: string | undefined) => typeof value === 'string' && value.trim().length > 0;
const staticScopedLighthouseIdentity = (environment: NodeJS.ProcessEnv) => (
  environment.TRAILS_MEDIA_SERVER_IDENTITY_MODE === 'static-scoped-key'
  && environment.TRAILS_COS_CREDENTIAL_PROVIDER === 'static-env'
  && environment.TRAILS_COS_ENABLED === 'true'
  && environment.TRAILS_COS_INGESTION_ENABLED === 'true'
  && nonEmpty(environment.TRAILS_COS_SECRET_ID)
  && nonEmpty(environment.TRAILS_COS_SECRET_KEY)
  && nonEmpty(environment.TRAILS_COS_INGESTION_MAPPING_SECRET)
  && environment.TRAILS_MEDIA_COS_BUCKET_ID === 'starlight-media-prod-1313219189'
  && environment.TRAILS_MEDIA_COS_REGION === 'ap-guangzhou'
  && environment.TRAILS_MEDIA_PUBLIC_DERIVATIVE_NAMESPACE === 'public-derivatives'
);

/**
 * Validates deployment intent only. It never builds a COS client, exposes a delivery URL,
 * accepts browser credentials or delivery URLs supplied by callers. Production supports a
 * workload identity, or a narrowly scoped static key for Lighthouse where instance roles are
 * unavailable. The latter still requires server-only secrets and fixed COS namespaces.
 */
export const validateTrailsMediaDeliveryConfiguration = (environment: NodeJS.ProcessEnv = process.env): void => {
  if (environment.NODE_ENV !== 'production') return;

  const publicationEnabled = environment.TRAILS_MEDIA_PUBLICATION_ENABLED === 'true';
  if (environment.TRAILS_MEDIA_PUBLICATION_ENABLED !== undefined && !['true', 'false'].includes(environment.TRAILS_MEDIA_PUBLICATION_ENABLED)) {
    throw new Error('Unsafe Trails media delivery configuration in production');
  }

  if (legacyProductionForbidden.some(key => configured(environment, key) && environment[key] !== 'false')) {
    throw new Error('Unsafe Trails media delivery configuration in production');
  }

  if (!publicationEnabled) {
    if (requiredPublicationIdentifiers.some(key => configured(environment, key)) || configured(environment, 'TRAILS_MEDIA_SERVER_IDENTITY_MODE')) {
      throw new Error('Unsafe Trails media delivery configuration in production');
    }
    return;
  }

  const workloadIdentity = environment.TRAILS_MEDIA_SERVER_IDENTITY_MODE === 'workload-identity';
  if ((!workloadIdentity && !staticScopedLighthouseIdentity(environment)) || requiredPublicationIdentifiers.some(key => !nonSecretIdentifier(environment[key]))) {
    throw new Error('Unsafe Trails media delivery configuration in production');
  }
};
