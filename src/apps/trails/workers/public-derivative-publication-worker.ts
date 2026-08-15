import { createHash } from 'crypto';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import sharp from 'sharp';
import { Actor, DurableMediaAssetArtifactDescriptor, DurableMediaAssetVariantName } from '../types';

const renditions: readonly DurableMediaAssetVariantName[] = ['grid-800', 'cover-1600', 'preview-2048'];
const codecs = ['avif', 'webp', 'jpeg'] as const;
const opaqueLocator = /^[A-Za-z0-9_-]{1,512}$/;
const opaqueReference = /^[A-Za-z0-9_-]{1,160}$/;
const sha256 = /^[a-f0-9]{64}$/;
const immutableCacheControl = 'public, max-age=31536000, immutable';

export interface TrailsPublicDerivativePublicationJob {
  jobId: string;
  actor: Actor;
  assetId: string;
  expectedResourceVersion: string;
  approvalId: string;
  artifacts: readonly DurableMediaAssetArtifactDescriptor[];
  /** Registry-derived opaque references, never URLs or COS keys. */
  publicReferences: Readonly<Record<DurableMediaAssetVariantName, string>>;
}

export interface TrailsPublicDerivativePublicationJobSource {
  takeOne(): Promise<TrailsPublicDerivativePublicationJob | undefined>;
}

/** This resolver is the only private-storage read seam. Its implementation may map a locator to COS internally. */
export interface TrailsPrivateJpegLocatorResolver {
  openPrivateJpeg(locator: string): Promise<{ body: Readable; contentType: string; byteLength: number }>;
}

export interface TrailsWorkloadIdentityCredentials {
  mode: 'workload-identity';
}

/**
 * Production composition supplies this from the platform workload identity provider.
 * It deliberately has no environment/static-secret implementation in this foundation.
 */
export interface TrailsWorkloadIdentityCredentialProvider {
  getCredentials(): Promise<TrailsWorkloadIdentityCredentials>;
}

/** Provider-neutral COS writer boundary. Implementations must obtain credentials from workload identity, never environment secrets. */
export interface TrailsPublicDerivativeObjectStore {
  putImmutable(input: { credentials: TrailsWorkloadIdentityCredentials; key: string; body: Readable; contentType: 'image/jpeg'; cacheControl: string; contentLength: number; signal: AbortSignal }): Promise<void>;
  head(input: { credentials: TrailsWorkloadIdentityCredentials; key: string; signal: AbortSignal }): Promise<{ contentType: string; cacheControl: string; contentLength: number; sha256: string }>;
}

export interface TrailsPublicDerivativeRegistryApprover {
  approvePublicDerivatives(actor: Actor, input: { mutationId: string; expectedResourceVersion: string; assetId: string; publication: { approvalId: string; identityMode: 'workload-identity' } }): Promise<unknown>;
}

export interface TrailsPublicationWorkerLogger {
  info(event: 'idle' | 'published', details: { jobId?: string; assetId?: string }): void;
  error(event: 'failed', details: { jobId?: string; assetId?: string }): void;
}

export interface TrailsPublicDerivativePublicationWorkerDependencies {
  jobs: TrailsPublicDerivativePublicationJobSource;
  privateLocatorResolver: TrailsPrivateJpegLocatorResolver;
  credentialProvider: TrailsWorkloadIdentityCredentialProvider;
  objectStore: TrailsPublicDerivativeObjectStore;
  registry: TrailsPublicDerivativeRegistryApprover;
  logger?: TrailsPublicationWorkerLogger;
  cosOperationTimeoutMs?: number;
}

export type TrailsPublicDerivativeWorkerRunResult = { outcome: 'idle' } | { outcome: 'published'; jobId: string; assetId: string } | { outcome: 'failed'; jobId: string; assetId: string };

const timeout = async <T>(milliseconds: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> => {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work(controller.signal),
      new Promise<T>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('COS operation timed out')); }, milliseconds); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const exactMatrix = (artifacts: readonly DurableMediaAssetArtifactDescriptor[]): void => {
  if (artifacts.length !== renditions.length * codecs.length) throw new Error('private derivative matrix is incomplete');
  const seen = new Set<string>();
  for (const artifact of artifacts) {
    if (!renditions.includes(artifact.logicalRendition) || !codecs.includes(artifact.codec) || artifact.mimeType !== `image/${artifact.codec}` || !opaqueLocator.test(artifact.privateLocator) || !Number.isSafeInteger(artifact.width) || artifact.width < 1 || !Number.isSafeInteger(artifact.height) || artifact.height < 1 || !Number.isSafeInteger(artifact.byteLength) || artifact.byteLength < 1 || !sha256.test(artifact.sha256)) throw new Error('private derivative matrix is invalid');
    const identity = `${artifact.logicalRendition}:${artifact.codec}`;
    if (seen.has(identity)) throw new Error('private derivative matrix is invalid');
    seen.add(identity);
  }
  for (const rendition of renditions) for (const codec of codecs) if (!seen.has(`${rendition}:${codec}`)) throw new Error('private derivative matrix is incomplete');
};

const publicObjectKey = (reference: string): string => {
  if (!opaqueReference.test(reference)) throw new Error('registry public reference is invalid');
  return `public-derivatives/${reference}.jpg`;
};

const validatePrivateJpeg = async (resolver: TrailsPrivateJpegLocatorResolver, artifact: DurableMediaAssetArtifactDescriptor): Promise<void> => {
  const source = await resolver.openPrivateJpeg(artifact.privateLocator);
  if (source.contentType !== 'image/jpeg' || source.byteLength !== artifact.byteLength) throw new Error('private JPEG source metadata mismatch');
  let receivedByteLength = 0;
  const hash = createHash('sha256');
  const validator = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedByteLength += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  const image = sharp();
  await pipeline(source.body, validator, image);
  const metadata = await image.metadata();
  if (metadata.format !== 'jpeg' || metadata.width !== artifact.width || metadata.height !== artifact.height) throw new Error('private JPEG image metadata mismatch');
  if (receivedByteLength !== artifact.byteLength || hash.digest('hex') !== artifact.sha256) throw new Error('private JPEG content mismatch');
};

const publishJpeg = async (job: TrailsPublicDerivativePublicationJob, artifact: DurableMediaAssetArtifactDescriptor, dependencies: TrailsPublicDerivativePublicationWorkerDependencies, timeoutMs: number): Promise<void> => {
  await validatePrivateJpeg(dependencies.privateLocatorResolver, artifact);
  const source = await dependencies.privateLocatorResolver.openPrivateJpeg(artifact.privateLocator);
  if (source.contentType !== 'image/jpeg' || source.byteLength !== artifact.byteLength) throw new Error('private JPEG source metadata mismatch');
  let uploadedByteLength = 0;
  const body = source.body.pipe(new Transform({ transform(chunk: Buffer, _encoding, callback) { uploadedByteLength += chunk.length; callback(null, chunk); } }));
  const key = publicObjectKey(job.publicReferences[artifact.logicalRendition]);
  const credentials = await dependencies.credentialProvider.getCredentials();
  if (credentials.mode !== 'workload-identity') throw new Error('publication worker credentials are invalid');
  await timeout(timeoutMs, signal => dependencies.objectStore.putImmutable({ credentials, key, body, contentType: 'image/jpeg', cacheControl: immutableCacheControl, contentLength: artifact.byteLength, signal }));
  if (uploadedByteLength !== artifact.byteLength) throw new Error('public JPEG upload length mismatch');
  const stored = await timeout(timeoutMs, signal => dependencies.objectStore.head({ credentials, key, signal }));
  if (stored.contentType !== 'image/jpeg' || stored.cacheControl !== immutableCacheControl || stored.contentLength !== artifact.byteLength || stored.sha256 !== artifact.sha256) throw new Error('public JPEG verification failed');
};

/** Runs at most one job. No HTTP action, service registration, polling loop, or deployment composition is provided. */
export const runOneTrailsPublicDerivativePublicationJob = async (dependencies: TrailsPublicDerivativePublicationWorkerDependencies): Promise<TrailsPublicDerivativeWorkerRunResult> => {
  const timeoutMs = dependencies.cosOperationTimeoutMs ?? 15_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('publication worker configuration is invalid');
  const job = await dependencies.jobs.takeOne();
  if (!job) { dependencies.logger?.info('idle', {}); return { outcome: 'idle' }; }
  try {
    if (!opaqueReference.test(job.jobId) || !opaqueReference.test(job.assetId) || !opaqueReference.test(job.approvalId) || !/^(0|[1-9][0-9]*)$/.test(job.expectedResourceVersion)) throw new Error('publication job is invalid');
    exactMatrix(job.artifacts);
    for (const rendition of renditions) {
      const jpeg = job.artifacts.find(artifact => artifact.logicalRendition === rendition && artifact.codec === 'jpeg');
      if (!jpeg) throw new Error('private JPEG derivative is missing');
      await publishJpeg(job, jpeg, dependencies, timeoutMs);
    }
    await dependencies.registry.approvePublicDerivatives(job.actor, { mutationId: `${job.jobId}:approve`, expectedResourceVersion: job.expectedResourceVersion, assetId: job.assetId, publication: { approvalId: job.approvalId, identityMode: 'workload-identity' } });
    dependencies.logger?.info('published', { jobId: job.jobId, assetId: job.assetId });
    return { outcome: 'published', jobId: job.jobId, assetId: job.assetId };
  } catch (_error: unknown) {
    dependencies.logger?.error('failed', { jobId: job.jobId, assetId: job.assetId });
    return { outcome: 'failed', jobId: job.jobId, assetId: job.assetId };
  }
};

export const trailsPublicDerivativeCacheControl = immutableCacheControl;
