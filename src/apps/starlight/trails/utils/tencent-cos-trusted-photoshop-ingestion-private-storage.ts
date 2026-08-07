import { createHash, createHmac } from 'crypto';
import COS from 'cos-nodejs-sdk-v5';
import type { TrustedPhotoshopDerivativeStagedArtifact } from './trusted-photoshop-derivative-staging-plan';
import type { TrustedPhotoshopIngestionPrivateStorage } from './trusted-photoshop-ingestion-private-storage';

const BUCKET = 'starlight-media-prod-1313219189';
const REGION = 'ap-guangzhou';
const PREFIX = 'ingestion-private/v1/';
const ENABLED = 'TRAILS_COS_INGESTION_ENABLED';
const MAPPING_SECRET = 'TRAILS_COS_INGESTION_MAPPING_SECRET';
const CONTRACT = 'trusted-photoshop-ingestion-private-v1';
const STATIC_ENV_PROVIDER = 'static-env';
const STS_ENV_PROVIDER = 'sts-env';
const SHA256 = /^[a-f0-9]{64}$/;
const SLOT = /^(?:master|(?:grid-800|cover-1600|preview-2048):(?:avif|webp|jpeg))$/;
const MIME_FOR_SLOT: Readonly<Record<string, string>> = { master: 'image/jpeg', 'grid-800:avif': 'image/avif', 'grid-800:webp': 'image/webp', 'grid-800:jpeg': 'image/jpeg', 'cover-1600:avif': 'image/avif', 'cover-1600:webp': 'image/webp', 'cover-1600:jpeg': 'image/jpeg', 'preview-2048:avif': 'image/avif', 'preview-2048:webp': 'image/webp', 'preview-2048:jpeg': 'image/jpeg' };

interface StaticCredentials { secretId: string; secretKey: string; }
interface StsCredentials extends StaticCredentials { securityToken: string; }
interface Configuration { credentials: StaticCredentials | StsCredentials; mappingSecret: string; }

export interface TencentCosTrustedPhotoshopIngestionHeadRequest { Bucket: string; Region: string; Key: string; }
export interface TencentCosTrustedPhotoshopIngestionPutRequest {
  Bucket: string; Region: string; Key: string; Body: Buffer; ContentLength: number; ContentType: string;
  Headers: Readonly<{ 'x-cos-forbid-overwrite': 'true' }>;
  [metadata: `x-cos-meta-${string}`]: string;
  'x-cos-meta-contract': string; 'x-cos-meta-identity': string; 'x-cos-meta-sha256': string;
  'x-cos-meta-length': string; 'x-cos-meta-mime': string; 'x-cos-meta-fence-token-digest': string;
}
export interface TencentCosTrustedPhotoshopIngestionHeadResult { contentLength: number; metadata: Readonly<Record<string, string | undefined>>; }
export interface TencentCosTrustedPhotoshopIngestionClient {
  headObject(params: TencentCosTrustedPhotoshopIngestionHeadRequest): Promise<TencentCosTrustedPhotoshopIngestionHeadResult>;
  putObject(params: TencentCosTrustedPhotoshopIngestionPutRequest): Promise<unknown>;
}
export type TencentCosTrustedPhotoshopIngestionClientFactory = (credentials: StaticCredentials | StsCredentials) => TencentCosTrustedPhotoshopIngestionClient;

export class TencentCosTrustedPhotoshopIngestionPrivateStorageError extends Error {
  constructor() { super('Private ingestion storage failed'); this.name = 'TencentCosTrustedPhotoshopIngestionPrivateStorageError'; }
}

const nonEmpty = (value: string | undefined): string | undefined => value?.trim() || undefined;
const isSts = (credentials: StaticCredentials | StsCredentials): credentials is StsCredentials => 'securityToken' in credentials;
const configurationFrom = (environment: NodeJS.ProcessEnv): Configuration | undefined => {
  if (environment[ENABLED] !== 'true' || !['development', 'test'].includes(environment.NODE_ENV || '')) return undefined;
  const secretId = nonEmpty(environment.TRAILS_COS_SECRET_ID);
  const secretKey = nonEmpty(environment.TRAILS_COS_SECRET_KEY);
  const mappingSecret = nonEmpty(environment[MAPPING_SECRET]);
  const provider = environment.TRAILS_COS_CREDENTIAL_PROVIDER;
  if (!secretId || !secretKey || !mappingSecret || (provider !== STATIC_ENV_PROVIDER && provider !== STS_ENV_PROVIDER)) return undefined;
  if (provider === STATIC_ENV_PROVIDER) return environment.TRAILS_COS_SECURITY_TOKEN === undefined ? { credentials: { secretId, secretKey }, mappingSecret } : undefined;
  const securityToken = nonEmpty(environment.TRAILS_COS_SECURITY_TOKEN);
  return securityToken ? { credentials: { secretId, secretKey, securityToken }, mappingSecret } : undefined;
};

const defaultClientFactory: TencentCosTrustedPhotoshopIngestionClientFactory = credentials => {
  const client = new COS({ SecretId: credentials.secretId, SecretKey: credentials.secretKey, ...(isSts(credentials) ? { SecurityToken: credentials.securityToken } : {}), Protocol: 'https:', Timeout: 5000 });
  return {
    headObject: async params => {
      const response = await client.headObject(params as COS.HeadObjectParams) as unknown as { headers?: Record<string, string | number | undefined> };
      const headers = response.headers || {};
      return { contentLength: Number(headers['content-length']), metadata: {
        contract: typeof headers['x-cos-meta-contract'] === 'string' ? headers['x-cos-meta-contract'] : undefined,
        identity: typeof headers['x-cos-meta-identity'] === 'string' ? headers['x-cos-meta-identity'] : undefined,
        sha256: typeof headers['x-cos-meta-sha256'] === 'string' ? headers['x-cos-meta-sha256'] : undefined,
        length: typeof headers['x-cos-meta-length'] === 'string' ? headers['x-cos-meta-length'] : undefined,
        mime: typeof headers['x-cos-meta-mime'] === 'string' ? headers['x-cos-meta-mime'] : undefined,
        fenceTokenDigest: typeof headers['x-cos-meta-fence-token-digest'] === 'string' ? headers['x-cos-meta-fence-token-digest'] : undefined,
      } };
    },
    putObject: params => client.putObject(params as COS.PutObjectParams),
  };
};

const hmac = (secret: string, domain: string, value: string): string => createHmac('sha256', secret).update(`${domain}\u0000${value}`).digest('base64url');
const canonical = (tenantId: string, operationId: string, slot: string): string => JSON.stringify([tenantId, operationId, slot]);
const notFound = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; statusCode?: unknown; status?: unknown };
  return candidate.code === 'NoSuchKey' || candidate.code === 'NotFound' || candidate.statusCode === 404 || candidate.status === 404;
};
const createOnlyCollision = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; statusCode?: unknown; status?: unknown; error?: unknown };
  const nestedCode = candidate.error && typeof candidate.error === 'object' ? (candidate.error as { Code?: unknown }).Code : undefined;
  return (candidate.statusCode === 409 || candidate.status === 409) && (candidate.code === 'FileAlreadyExists' || nestedCode === 'FileAlreadyExists');
};

/**
 * Unregistered server-only adapter. A durable grant authorizes no more than one PUT attempt.
 * COS create-only protection uses x-cos-forbid-overwrite and is effective only for a bucket with versioning disabled.
 */
export class TencentCosTrustedPhotoshopIngestionPrivateStorage implements TrustedPhotoshopIngestionPrivateStorage {
  private readonly client: TencentCosTrustedPhotoshopIngestionClient;
  private readonly mappingSecret: string;

  constructor(environment: NodeJS.ProcessEnv = process.env, createClient: TencentCosTrustedPhotoshopIngestionClientFactory = defaultClientFactory) {
    const configuration = configurationFrom(environment);
    if (!configuration) throw new TencentCosTrustedPhotoshopIngestionPrivateStorageError();
    try { this.client = createClient(configuration.credentials); this.mappingSecret = configuration.mappingSecret; } catch (_error: unknown) { throw new TencentCosTrustedPhotoshopIngestionPrivateStorageError(); }
  }

  async storeMaster(input: { tenantId: string; operationId: string; grant: { objectIdentity: string; fenceToken: string }; content: Buffer; mimeType: 'image/jpeg'; byteLength: number; sha256: string }): Promise<{ privateLocator: string }> {
    return this.store({ tenantId: input.tenantId, operationId: input.operationId, slot: 'master', grant: input.grant, content: input.content, mimeType: input.mimeType, byteLength: input.byteLength, sha256: input.sha256 });
  }

  async storeArtifact(input: { tenantId: string; operationId: string; slot: TrustedPhotoshopDerivativeStagedArtifact['slot']; grant: { objectIdentity: string; fenceToken: string }; artifact: TrustedPhotoshopDerivativeStagedArtifact }): Promise<{ privateLocator: string }> {
    const { artifact } = input;
    return this.store({ tenantId: input.tenantId, operationId: input.operationId, slot: input.slot, grant: input.grant, content: artifact.buffer, mimeType: artifact.mime, byteLength: artifact.byteLength, sha256: artifact.sha256, artifactSlot: artifact.slot });
  }

  private async store(input: { tenantId: string; operationId: string; slot: string; grant: { objectIdentity: string; fenceToken: string }; content: Buffer; mimeType: string; byteLength: number; sha256: string; artifactSlot?: string }): Promise<{ privateLocator: string }> {
    try {
      if (!nonEmpty(input.tenantId) || !nonEmpty(input.operationId) || !SLOT.test(input.slot) || MIME_FOR_SLOT[input.slot] !== input.mimeType || (input.artifactSlot !== undefined && input.artifactSlot !== input.slot) || !Buffer.isBuffer(input.content) || input.content.length === 0 || input.content.length !== input.byteLength || !SHA256.test(input.sha256) || createHash('sha256').update(input.content).digest('hex') !== input.sha256 || !nonEmpty(input.grant.objectIdentity) || !nonEmpty(input.grant.fenceToken)) throw new Error('invalid input');
      const identity = hmac(this.mappingSecret, 'ingestion-object-identity', canonical(input.tenantId, input.operationId, input.slot));
      if (input.grant.objectIdentity !== identity) throw new Error('invalid grant');
      const key = `${PREFIX}${hmac(this.mappingSecret, 'ingestion-cos-key', identity)}`;
      const privateLocator = `ingestion_${hmac(this.mappingSecret, 'ingestion-locator', identity)}`;
      const metadata = { contract: CONTRACT, identity, sha256: input.sha256, length: String(input.byteLength), mime: input.mimeType, fenceTokenDigest: hmac(this.mappingSecret, 'ingestion-fence-token', input.grant.fenceToken) };
      const matches = (result: TencentCosTrustedPhotoshopIngestionHeadResult): boolean => result.contentLength === input.byteLength && result.metadata.contract === metadata.contract && result.metadata.identity === metadata.identity && result.metadata.sha256 === metadata.sha256 && result.metadata.length === metadata.length && result.metadata.mime === metadata.mime && result.metadata.fenceTokenDigest === metadata.fenceTokenDigest;
      let exists = false;
      try { if (matches(await this.client.headObject({ Bucket: BUCKET, Region: REGION, Key: key }))) return { privateLocator }; exists = true; } catch (error: unknown) { if (!notFound(error)) throw error; }
      if (exists) throw new Error('existing object mismatch');
      const request: TencentCosTrustedPhotoshopIngestionPutRequest = { Bucket: BUCKET, Region: REGION, Key: key, Body: input.content, ContentLength: input.byteLength, ContentType: input.mimeType, Headers: { 'x-cos-forbid-overwrite': 'true' }, 'x-cos-meta-contract': metadata.contract, 'x-cos-meta-identity': metadata.identity, 'x-cos-meta-sha256': metadata.sha256, 'x-cos-meta-length': metadata.length, 'x-cos-meta-mime': metadata.mime, 'x-cos-meta-fence-token-digest': metadata.fenceTokenDigest };
      try { await this.client.putObject(request); } catch (error: unknown) { if (createOnlyCollision(error)) throw error; /* one verification HEAD is required after an ambiguous PUT outcome */ }
      if (matches(await this.client.headObject({ Bucket: BUCKET, Region: REGION, Key: key }))) return { privateLocator };
      throw new Error('post-put verification failed');
    } catch (_error: unknown) { throw new TencentCosTrustedPhotoshopIngestionPrivateStorageError(); }
  }
}

export const createTencentCosTrustedPhotoshopIngestionPrivateStorage = (environment: NodeJS.ProcessEnv = process.env, createClient: TencentCosTrustedPhotoshopIngestionClientFactory = defaultClientFactory): TencentCosTrustedPhotoshopIngestionPrivateStorage => new TencentCosTrustedPhotoshopIngestionPrivateStorage(environment, createClient);
