import { createHmac } from 'crypto';
import { Readable } from 'stream';
import COS from 'cos-nodejs-sdk-v5';
import {
  TrailsPrivateJpegLocatorResolver,
  TrailsPublicationCredentials,
  TrailsPublicDerivativeObjectStore,
  TrailsWorkloadIdentityCredentialProvider,
} from './public-derivative-publication-worker';

const BUCKET = 'starlight-media-prod-1313219189';
const REGION = 'ap-guangzhou';
const PRIVATE_PREFIX = 'masters-private/';
const PUBLIC_PREFIX = 'public-derivatives/';
const OPAQUE_LOCATOR = /^[A-Za-z0-9_-]{1,512}$/;
const PUBLIC_KEY = /^public-derivatives\/[A-Za-z0-9_-]{1,160}\.jpg$/;

type StaticCredentials = { secretId: string; secretKey: string; mappingSecret: string };

const required = (value: string | undefined): string | undefined => value?.trim() || undefined;

const configuration = (environment: NodeJS.ProcessEnv): StaticCredentials | undefined => {
  if (
    environment.NODE_ENV !== 'production'
    || environment.TRAILS_MEDIA_PUBLICATION_ENABLED !== 'true'
    || environment.TRAILS_MEDIA_SERVER_IDENTITY_MODE !== 'static-scoped-key'
    || environment.TRAILS_COS_ENABLED !== 'true'
    || environment.TRAILS_COS_CREDENTIAL_PROVIDER !== 'static-env'
  ) return undefined;
  const secretId = required(environment.TRAILS_COS_SECRET_ID);
  const secretKey = required(environment.TRAILS_COS_SECRET_KEY);
  const mappingSecret = required(environment.TRAILS_COS_INGESTION_MAPPING_SECRET);
  return secretId && secretKey && mappingSecret ? { secretId, secretKey, mappingSecret } : undefined;
};

const privateKey = (mappingSecret: string, locator: string): string =>
  `${PRIVATE_PREFIX}${createHmac('sha256', mappingSecret).update(`ingestion-cos-key\u0000${locator}`).digest('base64url')}`;

const header = (headers: Record<string, unknown> | undefined, name: string): string | undefined => {
  const value = headers?.[name];
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined;
};

/** Fixed-scope production adapter for Lighthouse. No caller can select credentials, bucket, or prefixes. */
export class TencentCosStaticPublicDerivativeStore implements TrailsPrivateJpegLocatorResolver, TrailsPublicDerivativeObjectStore, TrailsWorkloadIdentityCredentialProvider {
  private readonly client: COS;
  private readonly mappingSecret: string;

  constructor(environment: NodeJS.ProcessEnv = process.env) {
    const value = configuration(environment);
    if (!value) throw new Error('Trails media runtime is unavailable');
    this.mappingSecret = value.mappingSecret;
    this.client = new COS({ SecretId: value.secretId, SecretKey: value.secretKey, Protocol: 'https:', Timeout: 15_000 });
  }

  async getCredentials(): Promise<TrailsPublicationCredentials> { return { mode: 'static-scoped-key' }; }

  async openPrivateJpeg(locator: string): Promise<{ body: Readable; contentType: string; byteLength: number }> {
    if (!OPAQUE_LOCATOR.test(locator) || !/^ingestion_[A-Za-z0-9_-]{32,128}$/.test(locator)) throw new Error('private locator is invalid');
    const response = await this.client.getObject({ Bucket: BUCKET, Region: REGION, Key: privateKey(this.mappingSecret, locator) }) as unknown as { Body?: unknown; headers?: Record<string, unknown> };
    const body = response.Body instanceof Readable
      ? response.Body
      : Buffer.isBuffer(response.Body)
        ? Readable.from(response.Body)
        : undefined;
    if (!body) throw new Error('private object body is invalid');
    const contentType = header(response.headers, 'content-type');
    const length = Number(header(response.headers, 'content-length'));
    if (!contentType || !Number.isSafeInteger(length) || length < 1) throw new Error('private object metadata is invalid');
    return { body, contentType, byteLength: length };
  }

  async putImmutable(input: { credentials: TrailsPublicationCredentials; key: string; body: Readable; contentType: 'image/jpeg'; cacheControl: string; contentLength: number; sha256: string; signal: AbortSignal }): Promise<void> {
    if (input.credentials.mode !== 'static-scoped-key' || !PUBLIC_KEY.test(input.key) || input.contentType !== 'image/jpeg' || input.cacheControl !== 'public, max-age=31536000, immutable' || !Number.isSafeInteger(input.contentLength) || input.contentLength < 1 || !/^[a-f0-9]{64}$/.test(input.sha256) || input.signal.aborted) throw new Error('public derivative write is invalid');
    await this.client.putObject({ Bucket: BUCKET, Region: REGION, Key: input.key, Body: input.body, ContentLength: input.contentLength, ContentType: 'image/jpeg', CacheControl: input.cacheControl, 'x-cos-meta-sha256': input.sha256 } as COS.PutObjectParams);
    if (input.signal.aborted) throw new Error('public derivative write timed out');
  }

  async head(input: { credentials: TrailsPublicationCredentials; key: string; signal: AbortSignal }): Promise<{ contentType: string; cacheControl: string; contentLength: number; sha256: string }> {
    if (input.credentials.mode !== 'static-scoped-key' || !PUBLIC_KEY.test(input.key) || input.signal.aborted) throw new Error('public derivative head is invalid');
    const response = await this.client.headObject({ Bucket: BUCKET, Region: REGION, Key: input.key }) as unknown as { headers?: Record<string, unknown> };
    const contentType = header(response.headers, 'content-type');
    const cacheControl = header(response.headers, 'cache-control');
    const contentLength = Number(header(response.headers, 'content-length'));
    const sha256 = header(response.headers, 'x-cos-meta-sha256');
    if (!contentType || !cacheControl || !Number.isSafeInteger(contentLength) || contentLength < 1 || !sha256 || !/^[a-f0-9]{64}$/.test(sha256) || input.signal.aborted) throw new Error('public derivative metadata is invalid');
    return { contentType, cacheControl, contentLength, sha256 };
  }
}
