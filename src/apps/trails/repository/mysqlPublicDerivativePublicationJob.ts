import { createHash, randomBytes } from 'crypto';
import { ModelStatic, Op, Transaction } from 'sequelize';
import { ITrailsMediaAssetArtifactTableAttributes, TrailsMediaAssetArtifactTable } from 'db/mysql/models/trailsMediaAssetArtifact';
import { ITrailsPublicDerivativePublicationJobTableAttributes, TrailsPublicDerivativePublicationJobTable } from 'db/mysql/models/trailsPublicDerivativePublicationJob';
import { Actor, DurableMediaAssetArtifactDescriptor, DurableMediaAssetVariantName } from '../types';
import { TrailsSyncInputError, TrailsSyncPersistenceError, TrailsSyncTransaction } from './mysqlPortfolioCategorySync';
import { TrailsPublicDerivativePublicationJob, TrailsPublicDerivativePublicationJobSource } from '../workers/public-derivative-publication-worker';

type JobRow = Omit<ITrailsPublicDerivativePublicationJobTableAttributes, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date };
type ArtifactRow = Omit<ITrailsMediaAssetArtifactTableAttributes, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date };
const opaque = /^[A-Za-z0-9_-]{1,160}$/;
const locator = /^[A-Za-z0-9_-]{1,512}$/;
const decimal = /^(0|[1-9][0-9]*)$/;
const renditions: readonly DurableMediaAssetVariantName[] = ['grid-960', 'cover-2048', 'preview-4096'];
const codecs = ['avif', 'webp', 'jpeg'] as const;

const text = (value: unknown, label: string, maximum = 160): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new TrailsSyncInputError(`${label}无效`);
  return value.trim();
};
const dbDecimal = (value: unknown): string => typeof value === 'string' && decimal.test(value) ? value : typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : typeof value === 'bigint' && value >= BigInt(0) ? value.toString() : (() => { throw new TrailsSyncPersistenceError('publication job numeric value invalid'); })();
const jobRow = (value: ITrailsPublicDerivativePublicationJobTableAttributes): JobRow => {
  if (!value.createdAt || !value.updatedAt) throw new TrailsSyncPersistenceError('publication job row invalid');
  return { ...value, expectedResourceVersion: dbDecimal(value.expectedResourceVersion), createdAt: value.createdAt, updatedAt: value.updatedAt };
};
const artifactRow = (value: ITrailsMediaAssetArtifactTableAttributes): ArtifactRow => {
  if (!value.createdAt || !value.updatedAt) throw new TrailsSyncPersistenceError('publication artifact row invalid');
  return { ...value, byteLength: dbDecimal(value.byteLength), createdAt: value.createdAt, updatedAt: value.updatedAt };
};
const publicReference = (assetId: string, name: DurableMediaAssetVariantName, artifact: ArtifactRow): string =>
  `trails_v1_${createHash('sha256').update(JSON.stringify({ assetId, name, codec: artifact.codec, sha256: artifact.sha256 })).digest('base64url')}`;
const descriptor = (artifact: ArtifactRow): DurableMediaAssetArtifactDescriptor => {
  if (!renditions.includes(artifact.logicalRendition as DurableMediaAssetVariantName) || !codecs.includes(artifact.codec as typeof codecs[number]) || !locator.test(artifact.privateLocator) || !Number.isSafeInteger(artifact.width) || artifact.width < 1 || !Number.isSafeInteger(artifact.height) || artifact.height < 1 || !decimal.test(artifact.byteLength) || !Number.isSafeInteger(Number(artifact.byteLength)) || Number(artifact.byteLength) < 1 || !/^[a-f0-9]{64}$/.test(artifact.sha256)) throw new TrailsSyncPersistenceError('publication artifact invalid');
  return { logicalRendition: artifact.logicalRendition as DurableMediaAssetVariantName, codec: artifact.codec as DurableMediaAssetArtifactDescriptor['codec'], privateLocator: artifact.privateLocator, mimeType: artifact.mimeType as DurableMediaAssetArtifactDescriptor['mimeType'], width: artifact.width, height: artifact.height, byteLength: Number(artifact.byteLength), sha256: artifact.sha256 };
};
const actor = (row: JobRow): Actor => ({ tenantId: row.tenantId, userId: row.actorUserId, creatorSpaceRole: row.actorUserId === row.ownerUserId ? 'creator-space-owner' : 'creator-space-editor', ...(row.actorUserId === row.ownerUserId ? {} : { creatorSpaceOwnerUserId: row.ownerUserId }), isAdmin: false });

export interface TrailsPublicDerivativePublicationJobStore extends TrailsPublicDerivativePublicationJobSource {
  enqueue(input: { tenantId: string; operationId: string; actor: Actor; assetId: string; expectedResourceVersion: string; approvalId: string }): Promise<string>;
  retryFailed(jobId: string): Promise<boolean>;
}

/** Durable, lease-based source. It stores no object keys, URLs, binary payloads, or credentials. */
export class MySqlPublicDerivativePublicationJobRepository implements TrailsPublicDerivativePublicationJobStore {
  constructor(
    private readonly connection: { transaction<T>(work: (transaction: TrailsSyncTransaction) => Promise<T>): Promise<T> },
    private readonly jobs: ModelStatic<TrailsPublicDerivativePublicationJobTable>,
    private readonly artifacts: ModelStatic<TrailsMediaAssetArtifactTable>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async enqueue(input: { tenantId: string; operationId: string; actor: Actor; assetId: string; expectedResourceVersion: string; approvalId: string }): Promise<string> {
    const tenantId = text(input.tenantId, 'tenantId', 64);
    const operationId = text(input.operationId, 'operationId');
    const assetId = text(input.assetId, 'assetId');
    const approvalId = text(input.approvalId, 'approvalId');
    const expectedResourceVersion = text(input.expectedResourceVersion, 'expectedResourceVersion');
    if (!decimal.test(expectedResourceVersion) || input.actor.tenantId !== tenantId || !opaque.test(input.actor.userId) || !opaque.test(input.actor.creatorSpaceOwnerUserId || input.actor.userId)) throw new TrailsSyncInputError('publication job input invalid');
    const jobId = `pub_${createHash('sha256').update(`${tenantId}\u0000${operationId}`).digest('base64url')}`;
    return this.connection.transaction(async transaction => {
      const tx = transaction as Transaction;
      const existing = await this.jobs.findOne({ where: { tenantId, jobId }, transaction: tx, lock: tx.LOCK.UPDATE });
      if (existing) {
        const row = jobRow(existing.get());
        if (row.assetId !== assetId || row.expectedResourceVersion !== expectedResourceVersion || row.approvalId !== approvalId || row.actorUserId !== input.actor.userId) throw new TrailsSyncInputError('operation已绑定不同的公开发布任务');
        return jobId;
      }
      const ownerUserId = input.actor.creatorSpaceRole === 'creator-space-owner' ? input.actor.userId : input.actor.creatorSpaceOwnerUserId;
      if (!ownerUserId || !opaque.test(ownerUserId)) throw new TrailsSyncInputError('publication owner invalid');
      const time = this.now();
      await this.jobs.create({ tenantId, jobId, assetId, ownerUserId, actorUserId: input.actor.userId, expectedResourceVersion, approvalId, status: 'pending', attempts: 0, createdAt: time, updatedAt: time }, { transaction: tx });
      return jobId;
    });
  }

  async takeOne(): Promise<TrailsPublicDerivativePublicationJob | undefined> {
    return this.connection.transaction(async transaction => {
      const tx = transaction as Transaction;
      const now = this.now();
      const candidate = await this.jobs.findOne({
        where: { [Op.or]: [{ status: 'pending' }, { status: 'processing', leaseExpiresAt: { [Op.lte]: now } }] },
        order: [['createdAt', 'ASC'], ['jobId', 'ASC']], transaction: tx, lock: tx.LOCK.UPDATE,
      });
      if (!candidate) return undefined;
      const current = jobRow(candidate.get());
      const leaseToken = randomBytes(32).toString('hex');
      const expiresAt = new Date(now.getTime() + 60_000);
      const [updated] = await this.jobs.update({ status: 'processing', attempts: current.attempts + 1, leaseToken, leaseExpiresAt: expiresAt, updatedAt: now }, { where: { tenantId: current.tenantId, jobId: current.jobId, status: current.status, ...(current.status === 'processing' ? { leaseToken: current.leaseToken, leaseExpiresAt: current.leaseExpiresAt } : {}) }, transaction: tx });
      if (updated !== 1) return undefined;
      const stored = (await this.artifacts.findAll({ where: { tenantId: current.tenantId, assetId: current.assetId }, transaction: tx })).map(found => artifactRow(found.get()));
      const items = stored.map(descriptor);
      if (items.length !== renditions.length * codecs.length) throw new TrailsSyncPersistenceError('publication job artifact matrix incomplete');
      const publicReferences = Object.fromEntries(renditions.map(name => {
        const jpeg = stored.find(item => item.logicalRendition === name && item.codec === 'jpeg');
        if (!jpeg) throw new TrailsSyncPersistenceError('publication job JPEG missing');
        return [name, publicReference(current.assetId, name, jpeg)];
      })) as Record<DurableMediaAssetVariantName, string>;
      return { jobId: current.jobId, actor: actor(current), assetId: current.assetId, expectedResourceVersion: current.expectedResourceVersion, approvalId: current.approvalId, artifacts: items, publicReferences };
    });
  }

  async complete(input: { jobId: string; outcome: 'published' | 'failed' }): Promise<void> {
    if (!opaque.test(input.jobId) || (input.outcome !== 'published' && input.outcome !== 'failed')) throw new TrailsSyncInputError('publication completion invalid');
    await this.connection.transaction(async transaction => {
      const tx = transaction as Transaction;
      const job = await this.jobs.findOne({ where: { jobId: input.jobId, status: 'processing' }, transaction: tx, lock: tx.LOCK.UPDATE });
      if (!job) return;
      const current = jobRow(job.get());
      const now = this.now();
      await this.jobs.update({ status: input.outcome, leaseToken: undefined, leaseExpiresAt: undefined, ...(input.outcome === 'published' ? { publishedAt: now } : { failedAt: now }), updatedAt: now }, { where: { tenantId: current.tenantId, jobId: current.jobId, status: 'processing' }, transaction: tx });
    });
  }

  async retryFailed(jobId: string): Promise<boolean> {
    if (!opaque.test(jobId)) throw new TrailsSyncInputError('publication job invalid');
    return this.connection.transaction(async transaction => {
      const tx = transaction as Transaction;
      const now = this.now();
      const [updated] = await this.jobs.update({ status: 'pending', leaseToken: undefined, leaseExpiresAt: undefined, failedAt: undefined, updatedAt: now }, { where: { jobId, status: 'failed' }, transaction: tx });
      return updated === 1;
    });
  }
}
