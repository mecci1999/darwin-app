import COS from 'cos-nodejs-sdk-v5';

const STATIC_ENV_PROVIDER = 'static-env';
const STS_ENV_PROVIDER = 'sts-env';
const INGESTION_BUCKET = 'starlight-media-prod-1313219189';
const INGESTION_REGION = 'ap-guangzhou';

export type TrailsCosIngestionVersioningPreflightReason =
  | 'ready'
  | 'disabled'
  | 'misconfigured'
  | 'unavailable'
  | 'versioning-not-disabled';

export interface TrailsCosIngestionVersioningPreflightStatus {
  eligible: boolean;
  reason: TrailsCosIngestionVersioningPreflightReason;
}

interface TrailsCosVersioningClient {
  getBucketVersioning(params: { Bucket: string; Region: string }): Promise<unknown>;
}

interface TrailsCosStaticCredentials {
  secretId: string;
  secretKey: string;
}

interface TrailsCosStsCredentials extends TrailsCosStaticCredentials {
  securityToken: string;
}

interface TrailsCosIngestionVersioningPreflightConfiguration {
  credentials: TrailsCosStaticCredentials | TrailsCosStsCredentials;
}

type TrailsCosVersioningClientFactory = (
  credentials: TrailsCosStaticCredentials | TrailsCosStsCredentials,
) => TrailsCosVersioningClient;

const isStsCredentials = (
  credentials: TrailsCosStaticCredentials | TrailsCosStsCredentials,
): credentials is TrailsCosStsCredentials => 'securityToken' in credentials;

const nonEmpty = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const isLocalDevelopmentEnvironment = (environment: NodeJS.ProcessEnv): boolean =>
  environment.NODE_ENV === 'development' || environment.NODE_ENV === 'test';

const configurationFrom = (
  environment: NodeJS.ProcessEnv,
): TrailsCosIngestionVersioningPreflightConfiguration | undefined => {
  const provider = environment.TRAILS_COS_CREDENTIAL_PROVIDER;
  if (!isLocalDevelopmentEnvironment(environment) || (provider !== STATIC_ENV_PROVIDER && provider !== STS_ENV_PROVIDER)) return undefined;

  const secretId = nonEmpty(environment.TRAILS_COS_SECRET_ID);
  const secretKey = nonEmpty(environment.TRAILS_COS_SECRET_KEY);
  if (!secretId || !secretKey) return undefined;

  if (provider === STATIC_ENV_PROVIDER) {
    if (environment.TRAILS_COS_SECURITY_TOKEN !== undefined) return undefined;
    return { credentials: { secretId, secretKey } };
  }

  const securityToken = nonEmpty(environment.TRAILS_COS_SECURITY_TOKEN);
  if (!securityToken) return undefined;

  return { credentials: { secretId, secretKey, securityToken } };
};

const defaultClientFactory: TrailsCosVersioningClientFactory = (credentials) => new COS({
  SecretId: credentials.secretId,
  SecretKey: credentials.secretKey,
  ...(isStsCredentials(credentials) ? { SecurityToken: credentials.securityToken } : {}),
  Protocol: 'https:',
  Timeout: 5000,
});

const hasErrorCode = (error: unknown, code: string): boolean => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { Code?: unknown; code?: unknown; error?: { Code?: unknown; code?: unknown } };
  return candidate.Code === code
    || candidate.code === code
    || candidate.error?.Code === code
    || candidate.error?.code === code;
};

/**
 * A server-only, fixed-scope readiness preflight. It is deliberately unregistered,
 * calls only GetBucketVersioning, and never constructs an ingestion write adapter.
 */
export class TrailsCosIngestionVersioningPreflight {
  constructor(
    private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly createClient: TrailsCosVersioningClientFactory = defaultClientFactory,
  ) {}

  async check(): Promise<TrailsCosIngestionVersioningPreflightStatus> {
    if (this.environment.TRAILS_COS_INGESTION_VERSIONING_PREFLIGHT_ENABLED !== 'true') {
      return { eligible: false, reason: 'disabled' };
    }

    const configuration = configurationFrom(this.environment);
    if (!configuration) return { eligible: false, reason: 'misconfigured' };

    try {
      const client = this.createClient(configuration.credentials);
      const response = await client.getBucketVersioning({ Bucket: INGESTION_BUCKET, Region: INGESTION_REGION });
      if (response && typeof response === 'object' && (((response as { Status?: unknown }).Status === 'Enabled') || ((response as { Status?: unknown }).Status === 'Suspended'))) {
        return { eligible: false, reason: 'versioning-not-disabled' };
      }
      return { eligible: false, reason: 'versioning-not-disabled' };
    } catch (error: unknown) {
      if (hasErrorCode(error, 'NoSuchVersioningConfiguration')) return { eligible: true, reason: 'ready' };
      return { eligible: false, reason: 'unavailable' };
    }
  }
}

export const createTrailsCosIngestionVersioningPreflight = (
  environment: NodeJS.ProcessEnv = process.env,
  createClient: TrailsCosVersioningClientFactory = defaultClientFactory,
): TrailsCosIngestionVersioningPreflight => new TrailsCosIngestionVersioningPreflight(environment, createClient);
