import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { Readable } from 'stream';
import COS from 'cos-nodejs-sdk-v5';
import { Actor } from '../types';
import { creatorSpaceOwnerId } from './actor';
import { TrustedPhotoshopPublicationPackageEntry } from './trusted-photoshop-publication-package-importer';

const BUCKET = 'starlight-media-prod-1313219189';
const REGION = 'ap-guangzhou';
const PREFIX = 'photoshop-staging-private/';
const SESSION_TTL_MS = 15 * 60 * 1000;
const MAX_PACKAGE_BYTES = 64 * 1024 * 1024;
const OPAQUE = /^[A-Za-z0-9_-]{1,160}$/;
const ENTRY_SPECS = [
  { name: 'manifest.json', contentType: 'application/json', maximumBytes: 64 * 1024 },
  { name: 'website/grid-960.v1.jpg', contentType: 'image/jpeg', maximumBytes: 8 * 1024 * 1024 },
  { name: 'website/cover-2048.v1.jpg', contentType: 'image/jpeg', maximumBytes: 24 * 1024 * 1024 },
  { name: 'website/preview-4096.v1.jpg', contentType: 'image/jpeg', maximumBytes: 48 * 1024 * 1024 },
] as const;

type EntryName = (typeof ENTRY_SPECS)[number]['name'];
type Credentials = { secretId: string; secretKey: string; mappingSecret: string };
type UploadSessionClaims = {
  contract: 'trails-photoshop-upload-v1';
  expiresAt: number;
  uploadId: string;
  tenantId: string;
  actorUserId: string;
  ownerUserId: string;
  operationId: string;
  assetId: string;
};

export type TrustedPhotoshopUploadSession = {
  uploadSession: string;
  expiresAt: string;
  entries: Array<{ name: EntryName; contentType: 'application/json' | 'image/jpeg'; uploadUrl: string }>;
};

export type TrustedPhotoshopCompletedUpload = {
  operationId: string;
  assetId: string;
  ownerUserId: string;
  entries: TrustedPhotoshopPublicationPackageEntry[];
};

export class TencentCosTrustedPhotoshopPackageTransferError extends Error {
  constructor() { super('Trusted Photoshop package transfer failed'); this.name = 'TencentCosTrustedPhotoshopPackageTransferError'; }
}

const required = (value: string | undefined): string | undefined => value?.trim() || undefined;
const configurationFrom = (environment: NodeJS.ProcessEnv): Credentials | undefined => {
  const productionEnabled = environment.NODE_ENV === 'production'
    && environment.TRAILS_MEDIA_PUBLICATION_ENABLED === 'true'
    && environment.TRAILS_MEDIA_SERVER_IDENTITY_MODE === 'static-scoped-key'
    && environment.TRAILS_COS_ENABLED === 'true'
    && environment.TRAILS_COS_INGESTION_ENABLED === 'true'
    && environment.TRAILS_COS_CREDENTIAL_PROVIDER === 'static-env';
  const localEnabled = ['development', 'test'].includes(environment.NODE_ENV || '')
    && environment.TRAILS_COS_INGESTION_ENABLED === 'true'
    && (environment.TRAILS_COS_CREDENTIAL_PROVIDER === 'static-env' || environment.TRAILS_COS_CREDENTIAL_PROVIDER === 'sts-env');
  if (!productionEnabled && !localEnabled) return undefined;
  const secretId = required(environment.TRAILS_COS_SECRET_ID);
  const secretKey = required(environment.TRAILS_COS_SECRET_KEY);
  const mappingSecret = required(environment.TRAILS_COS_INGESTION_MAPPING_SECRET);
  if (!secretId || !secretKey || !mappingSecret || environment.TRAILS_COS_SECURITY_TOKEN) return undefined;
  return { secretId, secretKey, mappingSecret };
};

const sign = (secret: string, value: string): string => createHmac('sha256', secret).update(`trails-photoshop-upload-v1\u0000${value}`).digest('base64url');
const entrySpec = (name: string) => ENTRY_SPECS.find(item => item.name === name);
const keyFor = (secret: string, uploadId: string, name: EntryName): string => `${PREFIX}${createHmac('sha256', secret).update(`trails-photoshop-upload-object\u0000${uploadId}\u0000${name}`).digest('base64url')}`;
const encodeSession = (claims: UploadSessionClaims, secret: string): string => {
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${body}.${sign(secret, body)}`;
};
const equal = (left: string, right: string): boolean => left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right));
const decodeSession = (value: string, secret: string): UploadSessionClaims | undefined => {
  const [body, signature, extra] = value.split('.');
  if (!body || !signature || extra || !equal(signature, sign(secret, body))) return undefined;
  try {
    const claims: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return undefined;
    const item = claims as Partial<UploadSessionClaims>;
    if (item.contract !== 'trails-photoshop-upload-v1' || typeof item.expiresAt !== 'number' || !Number.isSafeInteger(item.expiresAt) || item.expiresAt < Date.now()
      || ![item.uploadId, item.tenantId, item.actorUserId, item.ownerUserId, item.operationId, item.assetId].every(value => typeof value === 'string' && OPAQUE.test(value))) return undefined;
    return item as UploadSessionClaims;
  } catch { return undefined; }
};
const asBuffer = async (value: unknown): Promise<Buffer> => {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value);
  if (value instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of value) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
  throw new Error('COS object body is invalid');
};

/**
 * Issues exact-object, short-lived browser PUT authorizations and reopens only those opaque
 * objects server-side. It never exposes a bucket name, object key, cloud credential, or master
 * locator to the workspace.
 */
export class TencentCosTrustedPhotoshopPackageTransfer {
  private readonly client: COS;
  private readonly mappingSecret: string;

  constructor(environment: NodeJS.ProcessEnv = process.env) {
    const configuration = configurationFrom(environment);
    if (!configuration) throw new TencentCosTrustedPhotoshopPackageTransferError();
    this.mappingSecret = configuration.mappingSecret;
    this.client = new COS({ SecretId: configuration.secretId, SecretKey: configuration.secretKey, Protocol: 'https:', Timeout: 30_000 });
  }

  createUploadSession(actor: Actor): TrustedPhotoshopUploadSession {
    try {
      const ownerUserId = creatorSpaceOwnerId(actor);
      if (!ownerUserId || !OPAQUE.test(actor.tenantId) || !OPAQUE.test(actor.userId) || !OPAQUE.test(ownerUserId)) throw new Error('invalid actor');
      const claims: UploadSessionClaims = {
        contract: 'trails-photoshop-upload-v1', expiresAt: Date.now() + SESSION_TTL_MS,
        uploadId: `up_${randomBytes(24).toString('base64url')}`,
        tenantId: actor.tenantId, actorUserId: actor.userId, ownerUserId,
        operationId: `psop_${randomBytes(24).toString('base64url')}`,
        assetId: `asset_${randomBytes(24).toString('base64url')}`,
      };
      const uploadSession = encodeSession(claims, this.mappingSecret);
      return {
        uploadSession,
        expiresAt: new Date(claims.expiresAt).toISOString(),
        entries: ENTRY_SPECS.map(entry => ({
          name: entry.name,
          contentType: entry.contentType,
          uploadUrl: this.client.getObjectUrl({ Bucket: BUCKET, Region: REGION, Key: keyFor(this.mappingSecret, claims.uploadId, entry.name), Method: 'PUT', Sign: true, Expires: Math.ceil(SESSION_TTL_MS / 1000) }),
        })),
      };
    } catch (_error: unknown) { throw new TencentCosTrustedPhotoshopPackageTransferError(); }
  }

  async completeUpload(actor: Actor, uploadSession: string): Promise<TrustedPhotoshopCompletedUpload> {
    try {
      const claims = decodeSession(uploadSession, this.mappingSecret);
      const ownerUserId = creatorSpaceOwnerId(actor);
      if (!claims || actor.tenantId !== claims.tenantId || actor.userId !== claims.actorUserId || ownerUserId !== claims.ownerUserId) throw new Error('invalid session actor');
      const entries = await Promise.all(ENTRY_SPECS.map(async entry => {
        const response = await this.client.getObject({ Bucket: BUCKET, Region: REGION, Key: keyFor(this.mappingSecret, claims.uploadId, entry.name) }) as unknown as { Body?: unknown; headers?: Record<string, unknown> };
        const contentType = response.headers?.['content-type'];
        if (typeof contentType !== 'string' || contentType.split(';', 1)[0].trim().toLowerCase() !== entry.contentType) throw new Error('invalid staged content type');
        const buffer = await asBuffer(response.Body);
        if (buffer.length < 1 || buffer.length > entry.maximumBytes) throw new Error('invalid staged entry size');
        return { name: entry.name, buffer };
      }));
      if (entries.reduce((total, entry) => total + entry.buffer.length, 0) > MAX_PACKAGE_BYTES) throw new Error('package too large');
      return { operationId: claims.operationId, assetId: claims.assetId, ownerUserId: claims.ownerUserId, entries };
    } catch (_error: unknown) { throw new TencentCosTrustedPhotoshopPackageTransferError(); }
  }

  async removeCompletedUpload(uploadSession: string): Promise<void> {
    try {
      const claims = decodeSession(uploadSession, this.mappingSecret);
      if (!claims) return;
      await Promise.all(ENTRY_SPECS.map(entry => this.client.deleteObject({ Bucket: BUCKET, Region: REGION, Key: keyFor(this.mappingSecret, claims.uploadId, entry.name) })));
    } catch { /* COS lifecycle remains the fallback cleanup boundary. */ }
  }
}
