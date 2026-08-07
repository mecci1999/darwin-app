import COS from 'cos-nodejs-sdk-v5';

const STATIC_ENV_PROVIDER = 'static-env';
const STS_ENV_PROVIDER = 'sts-env';
const VERIFICATION_BUCKET = 'starlight-media-prod-1313219189';
const VERIFICATION_REGION = 'ap-guangzhou';
const VERIFICATION_KEY = 'masters-private/cos-validation/master-test.jpg';

export type TrailsCosVerificationReason = 'available' | 'disabled' | 'misconfigured' | 'unavailable';

/** Deliberately redacted operational outcome: it never contains storage scope or provider details. */
export interface TrailsCosVerificationStatus {
  available: boolean;
  reason: TrailsCosVerificationReason;
}

interface TrailsCosHeadClient {
  headObject(params: { Bucket: string; Region: string; Key: string }): Promise<unknown>;
}

interface TrailsCosStaticCredentials {
  secretId: string;
  secretKey: string;
}

interface TrailsCosStsCredentials extends TrailsCosStaticCredentials {
  securityToken: string;
}

interface TrailsCosVerificationConfiguration {
  credentials: TrailsCosStaticCredentials | TrailsCosStsCredentials;
}

type TrailsCosClientFactory = (credentials: TrailsCosStaticCredentials | TrailsCosStsCredentials) => TrailsCosHeadClient;

const isStsCredentials = (credentials: TrailsCosStaticCredentials | TrailsCosStsCredentials): credentials is TrailsCosStsCredentials =>
  'securityToken' in credentials;

const nonEmpty = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const isLocalDevelopmentEnvironment = (environment: NodeJS.ProcessEnv): boolean =>
  environment.NODE_ENV === 'development' || environment.NODE_ENV === 'test';

const configurationFrom = (environment: NodeJS.ProcessEnv): TrailsCosVerificationConfiguration | undefined => {
  if (environment.TRAILS_COS_ENABLED !== 'true') return undefined;
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

const defaultClientFactory: TrailsCosClientFactory = (credentials) => new COS({
  SecretId: credentials.secretId,
  SecretKey: credentials.secretKey,
  ...(isStsCredentials(credentials) ? { SecurityToken: credentials.securityToken } : {}),
  Protocol: 'https:',
  Timeout: 5000,
});

/**
 * A server-only, fixed-scope COS readiness probe. This exposes no action and accepts
 * no caller input, so callers cannot select a bucket, region, object, or COS operation.
 */
export class TrailsCosVerifier {
  constructor(
    private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly createClient: TrailsCosClientFactory = defaultClientFactory,
  ) {}

  async verify(): Promise<TrailsCosVerificationStatus> {
    if (this.environment.TRAILS_COS_ENABLED !== 'true') return { available: false, reason: 'disabled' };

    const configuration = configurationFrom(this.environment);
    if (!configuration) return { available: false, reason: 'misconfigured' };

    try {
      const client = this.createClient(configuration.credentials);
      await client.headObject({ Bucket: VERIFICATION_BUCKET, Region: VERIFICATION_REGION, Key: VERIFICATION_KEY });
      return { available: true, reason: 'available' };
    } catch (error: unknown) {
      return { available: false, reason: 'unavailable' };
    }
  }
}

export const createTrailsCosVerifier = (
  environment: NodeJS.ProcessEnv = process.env,
  createClient: TrailsCosClientFactory = defaultClientFactory,
): TrailsCosVerifier => new TrailsCosVerifier(environment, createClient);
