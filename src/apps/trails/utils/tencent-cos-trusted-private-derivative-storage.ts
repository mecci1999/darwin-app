import { createHmac, randomBytes } from 'crypto';
import COS from 'cos-nodejs-sdk-v5';
import type { TrustedPhotoshopDerivativeStagedArtifact } from './trusted-photoshop-derivative-staging-plan';
import type { TrustedPrivateDerivativeStorage, TrustedPrivateDerivativeStorageResult } from './trusted-private-derivative-storage';

const STATIC_ENV_PROVIDER = 'static-env';
const STS_ENV_PROVIDER = 'sts-env';
const PRIVATE_DERIVATIVE_BUCKET = 'starlight-media-prod-1313219189';
const PRIVATE_DERIVATIVE_REGION = 'ap-guangzhou';
const PRIVATE_DERIVATIVE_PREFIX = 'derivatives-private/v1/';
const PRIVATE_DERIVATIVE_ENABLED = 'TRAILS_COS_ENABLED';
const MAPPING_SECRET = 'TRAILS_COS_PRIVATE_DERIVATIVE_MAPPING_SECRET';
const OPAQUE_LOCATOR = /^[A-Za-z0-9_-]{1,512}$/;

interface TencentCosStaticCredentials {
  secretId: string;
  secretKey: string;
}

interface TencentCosStsCredentials extends TencentCosStaticCredentials {
  securityToken: string;
}

interface TencentCosConfiguration {
  credentials: TencentCosStaticCredentials | TencentCosStsCredentials;
  mappingSecret: string;
}

export interface TencentCosPrivateDerivativePutRequest {
  Bucket: string;
  Region: string;
  Key: string;
  Body: Buffer;
  ContentLength: number;
  ContentType: string;
}

export interface TencentCosPrivateDerivativeDeleteRequest {
  Bucket: string;
  Region: string;
  Key: string;
}

/** Minimal server-side COS surface; tests inject a fake and never contact COS. */
export interface TencentCosPrivateDerivativeClient {
  putObject(params: TencentCosPrivateDerivativePutRequest): Promise<unknown>;
  deleteObject(params: TencentCosPrivateDerivativeDeleteRequest): Promise<unknown>;
}

export type TencentCosPrivateDerivativeClientFactory = (
  credentials: TencentCosStaticCredentials | TencentCosStsCredentials,
) => TencentCosPrivateDerivativeClient;

/** Fixed redacted failure for credentials, validation, and COS operations. */
export class TencentCosTrustedPrivateDerivativeStorageError extends Error {
  constructor() {
    super('Private derivative storage failed');
    this.name = 'TencentCosTrustedPrivateDerivativeStorageError';
  }
}

const isStsCredentials = (credentials: TencentCosStaticCredentials | TencentCosStsCredentials): credentials is TencentCosStsCredentials =>
  'securityToken' in credentials;

const nonEmpty = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const configurationFrom = (environment: NodeJS.ProcessEnv): TencentCosConfiguration | undefined => {
  if (
    environment[PRIVATE_DERIVATIVE_ENABLED] !== 'true'
    || (environment.NODE_ENV !== 'development' && environment.NODE_ENV !== 'test')
  ) return undefined;

  const secretId = nonEmpty(environment.TRAILS_COS_SECRET_ID);
  const secretKey = nonEmpty(environment.TRAILS_COS_SECRET_KEY);
  const mappingSecret = nonEmpty(environment[MAPPING_SECRET]);
  const provider = environment.TRAILS_COS_CREDENTIAL_PROVIDER;
  if (!secretId || !secretKey || !mappingSecret || (provider !== STATIC_ENV_PROVIDER && provider !== STS_ENV_PROVIDER)) return undefined;

  if (provider === STATIC_ENV_PROVIDER) {
    if (environment.TRAILS_COS_SECURITY_TOKEN !== undefined) return undefined;
    return { credentials: { secretId, secretKey }, mappingSecret };
  }

  const securityToken = nonEmpty(environment.TRAILS_COS_SECURITY_TOKEN);
  return securityToken === undefined ? undefined : { credentials: { secretId, secretKey, securityToken }, mappingSecret };
};

const defaultClientFactory: TencentCosPrivateDerivativeClientFactory = credentials => {
  const client = new COS({
    SecretId: credentials.secretId,
    SecretKey: credentials.secretKey,
    ...(isStsCredentials(credentials) ? { SecurityToken: credentials.securityToken } : {}),
    Protocol: 'https:',
    Timeout: 5000,
  });
  return {
    putObject: params => {
      const request: COS.PutObjectParams = { ...params };
      return client.putObject(request);
    },
    deleteObject: params => {
      const request: COS.DeleteObjectParams = { ...params };
      return client.deleteObject(request);
    },
  };
};

const privateKeyFor = (mappingSecret: string, privateLocator: string): string =>
  `${PRIVATE_DERIVATIVE_PREFIX}${createHmac('sha256', mappingSecret).update(privateLocator).digest('base64url')}`;

const nextLocator = (): string => randomBytes(32).toString('base64url');

const putRequestFor = (key: string, artifact: TrustedPhotoshopDerivativeStagedArtifact): TencentCosPrivateDerivativePutRequest => ({
  Bucket: PRIVATE_DERIVATIVE_BUCKET,
  Region: PRIVATE_DERIVATIVE_REGION,
  Key: key,
  Body: artifact.buffer,
  ContentLength: artifact.buffer.length,
  ContentType: artifact.mime,
});

const deleteRequestFor = (key: string): TencentCosPrivateDerivativeDeleteRequest => ({
  Bucket: PRIVATE_DERIVATIVE_BUCKET,
  Region: PRIVATE_DERIVATIVE_REGION,
  Key: key,
});

/**
 * Unregistered server-only storage for already validated staged derivative buffers.
 * It accepts no storage scope from callers and returns only opaque locators.
 */
export class TencentCosTrustedPrivateDerivativeStorage implements TrustedPrivateDerivativeStorage {
  private readonly client: TencentCosPrivateDerivativeClient;
  private readonly mappingSecret: string;

  constructor(
    environment: NodeJS.ProcessEnv = process.env,
    createClient: TencentCosPrivateDerivativeClientFactory = defaultClientFactory,
  ) {
    const configuration = configurationFrom(environment);
    if (!configuration) throw new TencentCosTrustedPrivateDerivativeStorageError();
    try {
      this.client = createClient(configuration.credentials);
      this.mappingSecret = configuration.mappingSecret;
    } catch (_error: unknown) {
      throw new TencentCosTrustedPrivateDerivativeStorageError();
    }
  }

  async store(artifacts: readonly TrustedPhotoshopDerivativeStagedArtifact[]): Promise<readonly TrustedPrivateDerivativeStorageResult[]> {
    const createdKeys: string[] = [];
    try {
      const results: TrustedPrivateDerivativeStorageResult[] = [];
      for (const artifact of artifacts) {
        if (!Buffer.isBuffer(artifact.buffer) || artifact.buffer.length === 0 || artifact.byteLength !== artifact.buffer.length) {
          throw new Error('invalid staged artifact');
        }
        const privateLocator = nextLocator();
        const key = privateKeyFor(this.mappingSecret, privateLocator);
        createdKeys.push(key);
        await this.client.putObject(putRequestFor(key, artifact));
        results.push({ privateLocator });
      }
      return results;
    } catch (_error: unknown) {
      await Promise.allSettled(createdKeys.map(key => Promise.resolve().then(() => this.client.deleteObject(deleteRequestFor(key)))));
      throw new TencentCosTrustedPrivateDerivativeStorageError();
    }
  }

  async remove(locators: readonly string[]): Promise<void> {
    try {
      if (!locators.every(locator => typeof locator === 'string' && OPAQUE_LOCATOR.test(locator))) throw new Error('invalid locator');
      const deletes = locators.map(locator => Promise.resolve().then(() => this.client.deleteObject(deleteRequestFor(privateKeyFor(this.mappingSecret, locator)))));
      const outcomes = await Promise.allSettled(deletes);
      if (outcomes.some(outcome => outcome.status === 'rejected')) throw new Error('delete failed');
    } catch (_error: unknown) {
      throw new TencentCosTrustedPrivateDerivativeStorageError();
    }
  }
}

export const createTencentCosTrustedPrivateDerivativeStorage = (
  environment: NodeJS.ProcessEnv = process.env,
  createClient: TencentCosPrivateDerivativeClientFactory = defaultClientFactory,
): TencentCosTrustedPrivateDerivativeStorage => new TencentCosTrustedPrivateDerivativeStorage(environment, createClient);
