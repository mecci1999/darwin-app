import { createHash } from 'crypto';
import { ModelStatic, Transaction } from 'sequelize';
import { ITrailsMediaAssetRegistryTableAttributes, TrailsMediaAssetRegistryTable } from '../../../../db/mysql/models/trailsMediaAssetRegistry';
import { ITrailsMediaAssetVariantTableAttributes, TrailsMediaAssetVariantTable } from '../../../../db/mysql/models/trailsMediaAssetVariant';
import { ITrailsMediaAssetArtifactTableAttributes, TrailsMediaAssetArtifactTable } from '../../../../db/mysql/models/trailsMediaAssetArtifact';
import { ITrailsMediaAssetRegistryMutationTableAttributes, TrailsMediaAssetRegistryMutationTable } from '../../../../db/mysql/models/trailsMediaAssetRegistryMutation';
import { Actor, DurableCommerceMutation, DurableMediaAsset, DurableMediaAssetArtifactCodec, DurableMediaAssetArtifactDescriptor, DurableMediaAssetRegistryStore, DurableMediaAssetVariantName, WorkspaceMediaAssetPickerItem } from '../types';
import { creatorSpaceOwnerId } from '../utils/actor';
import { TrailsSyncInputError, TrailsSyncPersistenceError, TrailsSyncTransaction } from './mysqlPortfolioCategorySync';

type AssetRow = Omit<ITrailsMediaAssetRegistryTableAttributes, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date };
type VariantRow = Omit<ITrailsMediaAssetVariantTableAttributes, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date };
type ArtifactRow = Omit<ITrailsMediaAssetArtifactTableAttributes, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date };
type MutationRow = ITrailsMediaAssetRegistryMutationTableAttributes;
type Options = { transaction: TrailsSyncTransaction };
const variants: DurableMediaAssetVariantName[] = ['grid-800', 'cover-1600', 'preview-2048'];
const codecs: DurableMediaAssetArtifactCodec[] = ['avif', 'webp', 'jpeg'];
const artifactMatrix: ReadonlyArray<Readonly<{ logicalRendition: DurableMediaAssetVariantName; codec: DurableMediaAssetArtifactCodec; mimeType: DurableMediaAssetArtifactDescriptor['mimeType'] }>> = variants.flatMap(logicalRendition => codecs.map(codec => ({ logicalRendition, codec, mimeType: `image/${codec}` as DurableMediaAssetArtifactDescriptor['mimeType'] })));
const opaqueReference = /^[A-Za-z0-9_-]{1,160}$/;
const opaquePrivateLocator = /^[A-Za-z0-9_-]{1,512}$/;
const fingerprint = (operation: string, input: unknown): string => createHash('sha256').update(JSON.stringify({ operation, input })).digest('hex');
const value = (input: unknown, label: string, max: number): string => { if (typeof input !== 'string' || !input.trim() || input.length > max) throw new TrailsSyncInputError(`${label}无效`); return input.trim(); };
const version = (input: unknown): string => { if (typeof input !== 'string' || !/^(0|[1-9][0-9]*)$/.test(input)) throw new TrailsSyncInputError('expectedResourceVersion必须是规范十进制字符串'); return input; };
const databaseVersion = (input: unknown): string => typeof input === 'string' && /^(0|[1-9][0-9]*)$/.test(input) ? input : typeof input === 'number' && Number.isSafeInteger(input) ? String(input) : typeof input === 'bigint' ? input.toString() : (() => { throw new TrailsSyncPersistenceError('media asset version invalid'); })();
const asset = (row: AssetRow): DurableMediaAsset => ({ id: row.id, tenantId: row.tenantId, ownerUserId: row.ownerUserId, mimeType: row.mimeType, status: row.status === 'published' ? 'published' : 'draft', resourceVersion: databaseVersion(row.resourceVersion), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
const isDurableMediaAsset = (input: unknown): input is DurableMediaAsset => typeof input === 'object' && input !== null && !Array.isArray(input)
  && typeof (input as Record<string, unknown>).id === 'string' && typeof (input as Record<string, unknown>).tenantId === 'string' && typeof (input as Record<string, unknown>).ownerUserId === 'string'
  && typeof (input as Record<string, unknown>).mimeType === 'string' && ((input as Record<string, unknown>).status === 'draft' || (input as Record<string, unknown>).status === 'published')
  && typeof (input as Record<string, unknown>).resourceVersion === 'string' && /^(0|[1-9][0-9]*)$/.test((input as Record<string, unknown>).resourceVersion as string)
  && typeof (input as Record<string, unknown>).createdAt === 'string' && typeof (input as Record<string, unknown>).updatedAt === 'string';
const replayResult = <T>(resultJson: string): T => { let parsed: unknown; try { parsed = JSON.parse(resultJson); } catch (error: unknown) { throw new TrailsSyncPersistenceError('media asset mutation result invalid JSON'); } if (!isDurableMediaAsset(parsed)) throw new TrailsSyncPersistenceError('media asset mutation result invalid'); return parsed as T; };
const ledgerTable = 'TrailsMediaAssetRegistryMutation';
const isLedgerDuplicateError = (error: Record<string, unknown>, cause: Record<string, unknown>): boolean => {
  if (error.name !== 'SequelizeUniqueConstraintError' || cause.code !== 'ER_DUP_ENTRY' || cause.errno !== 1062) return false;
  const message = typeof cause.sqlMessage === 'string' ? cause.sqlMessage : typeof cause.message === 'string' ? cause.message : '';
  const sql = typeof error.sql === 'string' ? error.sql : typeof cause.sql === 'string' ? cause.sql : '';
  const ledgerInsert = new RegExp('\\bINSERT\\s+INTO\\s+(?:`?[^\\s`.]+`?\\.)?`?' + ledgerTable + '`?\\b', 'i');
  return /for key '?PRIMARY'?$/i.test(message) && ledgerInsert.test(sql);
};
const isLedgerConflictError = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as Record<string, unknown>;
  const nested = candidate.cause ?? candidate.parent ?? candidate.original;
  const cause = typeof nested === 'object' && nested !== null ? nested as Record<string, unknown> : candidate;
  if (isLedgerDuplicateError(candidate, cause)) return true;
  return false;
};
const sequelizeTransaction = (transaction: TrailsSyncTransaction): Transaction => { if (transaction instanceof Transaction) return transaction; throw new TrailsSyncPersistenceError('Sequelize adapter requires a managed transaction'); };
const assetRow = (input: ITrailsMediaAssetRegistryTableAttributes): AssetRow => { if (!input.createdAt || !input.updatedAt) throw new TrailsSyncPersistenceError('media asset row invalid'); return { ...input, resourceVersion: databaseVersion(input.resourceVersion), createdAt: input.createdAt, updatedAt: input.updatedAt }; };
const variantRow = (input: ITrailsMediaAssetVariantTableAttributes): VariantRow => { if (!input.createdAt || !input.updatedAt) throw new TrailsSyncPersistenceError('media variant row invalid'); return { ...input, createdAt: input.createdAt, updatedAt: input.updatedAt }; };
const artifactByteLength = (input: unknown): string => databaseVersion(input);
const artifactRow = (input: ITrailsMediaAssetArtifactTableAttributes): ArtifactRow => { if (!input.createdAt || !input.updatedAt) throw new TrailsSyncPersistenceError('media artifact row invalid'); return { ...input, byteLength: artifactByteLength(input.byteLength), createdAt: input.createdAt, updatedAt: input.updatedAt }; };
const positiveSafeInteger = (input: unknown): input is number => typeof input === 'number' && Number.isSafeInteger(input) && input > 0;
const artifactDescriptor = (input: unknown): DurableMediaAssetArtifactDescriptor => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new TrailsSyncInputError('artifact描述无效');
  const candidate = input as Record<string, unknown>;
  const logicalRendition = candidate.logicalRendition;
  const codec = candidate.codec;
  const width = candidate.width;
  const height = candidate.height;
  const byteLength = candidate.byteLength;
  const expected = artifactMatrix.find(item => item.logicalRendition === logicalRendition && item.codec === codec);
  if (!expected || candidate.mimeType !== expected.mimeType) throw new TrailsSyncInputError('artifact编码或MIME无效');
  const privateLocator = value(candidate.privateLocator, 'artifact privateLocator', 512);
  if (!opaquePrivateLocator.test(privateLocator)) throw new TrailsSyncInputError('artifact privateLocator必须是不透明引用');
  if (!positiveSafeInteger(width) || !positiveSafeInteger(height) || !positiveSafeInteger(byteLength)) throw new TrailsSyncInputError('artifact元数据必须为正安全整数');
  if (typeof candidate.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(candidate.sha256)) throw new TrailsSyncInputError('artifact SHA-256无效');
  return { logicalRendition: expected.logicalRendition, codec: expected.codec, mimeType: expected.mimeType, privateLocator, width, height, byteLength, sha256: candidate.sha256 };
};
const workspacePickerItem = (row: AssetRow, readyVariants: VariantRow[]): WorkspaceMediaAssetPickerItem | undefined => {
  if (row.status !== 'published' || readyVariants.length !== variants.length || variants.some(name => !readyVariants.some(item => item.name === name && item.state === 'ready'))) return undefined;
  return {
    id: row.id,
    lifecycle: 'published',
    readiness: 'ready',
    mimeType: row.mimeType,
    renditions: variants.map((name): WorkspaceMediaAssetPickerItem['renditions'][number] => {
      const variant = readyVariants.find(item => item.name === name && item.state === 'ready');
      if (!variant) throw new TrailsSyncPersistenceError('published media asset has incomplete ready variants');
      if (!opaqueReference.test(variant.publicReference)) throw new TrailsSyncPersistenceError('published media asset has unsafe public reference');
      return { name, width: variant.width, height: variant.height, reference: variant.publicReference };
    }),
  };
};
const artifacts = (input: unknown): DurableMediaAssetArtifactDescriptor[] => {
  if (!Array.isArray(input) || input.length !== artifactMatrix.length) throw new TrailsSyncInputError('artifact必须是精确九项矩阵');
  const normalized = input.map(artifactDescriptor);
  const identities = new Set(normalized.map(item => `${item.logicalRendition}:${item.codec}`));
  if (identities.size !== artifactMatrix.length || artifactMatrix.some(expected => !identities.has(`${expected.logicalRendition}:${expected.codec}`))) throw new TrailsSyncInputError('artifact必须是精确九项矩阵');
  const byIdentity = new Map(normalized.map(item => [`${item.logicalRendition}:${item.codec}`, item]));
  const canonical: DurableMediaAssetArtifactDescriptor[] = [];
  for (const expected of artifactMatrix) {
    const descriptor = byIdentity.get(`${expected.logicalRendition}:${expected.codec}`);
    if (!descriptor) throw new TrailsSyncInputError('artifact必须是精确九项矩阵');
    canonical.push(descriptor);
  }
  return canonical;
};
export class TrailsMediaAssetRegistryStaleVersionError extends Error {}
export interface MediaAssetRegistryModels { assets: { create(input: AssetRow, options: Options): Promise<AssetRow>; find(input: { tenantId: string; id: string }, options: Options): Promise<AssetRow | undefined>; list(input: { tenantId: string; ownerUserId: string }, options: Options): Promise<AssetRow[]>; cas(input: { tenantId: string; id: string; expectedVersion: string; next: AssetRow }, options: Options): Promise<AssetRow | undefined>; }; variants: { upsert(input: VariantRow, options: Options): Promise<void>; list(input: { tenantId: string; assetId: string }, options: Options): Promise<VariantRow[]>; }; artifacts: { upsert(input: ArtifactRow, options: Options): Promise<void>; list(input: { tenantId: string; assetId: string }, options: Options): Promise<ArtifactRow[]>; }; mutations: { find(input: { tenantId: string; actorUserId: string; mutationId: string }, options: Options): Promise<MutationRow | undefined>; create(input: MutationRow, options: Options): Promise<void>; }; }

export class MySqlMediaAssetRegistryRepository implements DurableMediaAssetRegistryStore {
  constructor(private readonly connection: { transaction<T>(work: (transaction: TrailsSyncTransaction) => Promise<T>): Promise<T> }, private readonly models: MediaAssetRegistryModels, private readonly now: () => Date = () => new Date()) {}
  private owner(actor: Actor): string { const owner = creatorSpaceOwnerId(actor); if (!owner) throw new TrailsSyncInputError('当前账号没有创作空间管理权限'); return owner; }
  private async owned(actor: Actor, id: string, transaction: TrailsSyncTransaction): Promise<AssetRow> { const row = await this.models.assets.find({ tenantId: actor.tenantId, id: value(id, 'id', 160) }, { transaction }); if (!row || row.ownerUserId !== this.owner(actor)) throw new TrailsSyncInputError('资源不属于当前创作空间'); return row; }
  private async replayLedger<T>(actor: Actor, mutationId: string, expectedFingerprint: string): Promise<T> {
    return this.connection.transaction(async transaction => {
      const stored = await this.models.mutations.find({ tenantId: actor.tenantId, actorUserId: actor.userId, mutationId }, { transaction });
      if (!stored) throw new TrailsSyncPersistenceError('media asset mutation conflict has no committed ledger result');
      if (stored.fingerprint !== expectedFingerprint) throw new TrailsSyncInputError('mutationId不能用于不同的写入');
      return replayResult<T>(stored.resultJson);
    });
  }
  async listWorkspacePicker(actor: Actor): Promise<WorkspaceMediaAssetPickerItem[]> {
    const ownerUserId = this.owner(actor);
    return this.listReadyPicker({ tenantId: actor.tenantId, userId: ownerUserId });
  }
  async listPublic(owner: Pick<Actor, 'tenantId' | 'userId'>): Promise<WorkspaceMediaAssetPickerItem[]> {
    return this.listReadyPicker(owner);
  }
  private async listReadyPicker(owner: Pick<Actor, 'tenantId' | 'userId'>): Promise<WorkspaceMediaAssetPickerItem[]> {
    return this.connection.transaction(async transaction => {
      const rows = await this.models.assets.list({ tenantId: owner.tenantId, ownerUserId: owner.userId }, { transaction });
      const picker = await Promise.all(rows.map(async row => workspacePickerItem(row, await this.models.variants.list({ tenantId: row.tenantId, assetId: row.id }, { transaction }))));
      return picker.filter((item): item is WorkspaceMediaAssetPickerItem => item !== undefined);
    });
  }
  private async mutate<T>(actor: Actor, mutation: DurableCommerceMutation, operation: string, effectiveInput: unknown, work: (transaction: TrailsSyncTransaction) => Promise<T>): Promise<T> { value(mutation.mutationId, 'mutationId', 160); if (mutation.expectedResourceVersion !== null) version(mutation.expectedResourceVersion); const expected = fingerprint(operation, effectiveInput); try { return await this.connection.transaction(async transaction => { const prior = await this.models.mutations.find({ tenantId: actor.tenantId, actorUserId: actor.userId, mutationId: mutation.mutationId }, { transaction }); if (prior) { if (prior.fingerprint !== expected) throw new TrailsSyncInputError('mutationId不能用于不同的写入'); return replayResult<T>(prior.resultJson); } const result = await work(transaction); await this.models.mutations.create({ tenantId: actor.tenantId, actorUserId: actor.userId, mutationId: mutation.mutationId, fingerprint: expected, resultJson: JSON.stringify(result) }, { transaction }); return result; }); } catch (error: unknown) { if (!isLedgerConflictError(error)) throw error; return this.replayLedger<T>(actor, mutation.mutationId, expected); } }
  async register(actor: Actor, input: DurableCommerceMutation & { id: string; mimeType: string; privateMasterLocator: string }): Promise<DurableMediaAsset> { this.owner(actor); if (input.expectedResourceVersion !== null) throw new TrailsSyncInputError('新资源必须使用null版本'); const mimeType = value(input.mimeType, 'mimeType', 160).toLowerCase(); if (!mimeType.startsWith('image/')) throw new TrailsSyncInputError('mimeType必须是图片类型'); const locator = value(input.privateMasterLocator, 'privateMasterLocator', 512); if (!opaqueReference.test(locator)) throw new TrailsSyncInputError('privateMasterLocator必须是服务器部署工件引用'); return this.mutate(actor, input, 'asset:register', { id: input.id, mimeType, privateMasterLocator: locator, expectedResourceVersion: input.expectedResourceVersion }, async transaction => { const time = this.now(); return asset(await this.models.assets.create({ tenantId: actor.tenantId, id: value(input.id, 'id', 160), ownerUserId: this.owner(actor), mimeType, privateMasterLocator: locator, status: 'draft', resourceVersion: '1', createdAt: time, updatedAt: time }, { transaction })); }); }
  async registerVariant(actor: Actor, input: DurableCommerceMutation & { assetId: string; name: DurableMediaAssetVariantName; publicReference: string; width: number; height: number; state: 'ready' }): Promise<DurableMediaAsset> { if (!variants.includes(input.name)) throw new TrailsSyncInputError('variant名称无效'); if (input.state !== 'ready') throw new TrailsSyncInputError('variant必须处于ready状态'); if (!opaqueReference.test(input.publicReference)) throw new TrailsSyncInputError('publicReference必须是安全不透明引用'); if (!Number.isSafeInteger(input.width) || input.width <= 0 || !Number.isSafeInteger(input.height) || input.height <= 0) throw new TrailsSyncInputError('variant尺寸必须为正整数'); return this.mutate(actor, input, 'asset:variant:register', { assetId: input.assetId, name: input.name, publicReference: input.publicReference, width: input.width, height: input.height, state: input.state, expectedResourceVersion: input.expectedResourceVersion }, async transaction => { const row = await this.owned(actor, input.assetId, transaction); if (row.status === 'published') throw new TrailsSyncInputError('已发布资源不能变更variant'); if (input.expectedResourceVersion !== row.resourceVersion) throw new TrailsMediaAssetRegistryStaleVersionError('资源版本已过期'); const time = this.now(); await this.models.variants.upsert({ tenantId: row.tenantId, assetId: row.id, name: input.name, publicReference: input.publicReference, width: input.width, height: input.height, state: 'ready', createdAt: time, updatedAt: time }, { transaction }); const next: AssetRow = { ...row, resourceVersion: (BigInt(row.resourceVersion) + BigInt(1)).toString(), updatedAt: time }; const saved = await this.models.assets.cas({ tenantId: row.tenantId, id: row.id, expectedVersion: row.resourceVersion, next }, { transaction }); if (!saved) throw new TrailsMediaAssetRegistryStaleVersionError('资源版本已过期'); return asset(saved); }); }
  async persistArtifacts(actor: Actor, input: DurableCommerceMutation & { assetId: string; artifacts: readonly DurableMediaAssetArtifactDescriptor[] }): Promise<DurableMediaAsset> { const descriptors = artifacts(input.artifacts); return this.mutate(actor, input, 'asset:artifacts:persist', { assetId: input.assetId, artifacts: descriptors, expectedResourceVersion: input.expectedResourceVersion }, async transaction => { const row = await this.owned(actor, input.assetId, transaction); if (row.status === 'published') throw new TrailsSyncInputError('已发布资源不能变更artifact'); if (input.expectedResourceVersion !== row.resourceVersion) throw new TrailsMediaAssetRegistryStaleVersionError('资源版本已过期'); const time = this.now(); for (const descriptor of descriptors) await this.models.artifacts.upsert({ tenantId: row.tenantId, assetId: row.id, ...descriptor, byteLength: String(descriptor.byteLength), createdAt: time, updatedAt: time }, { transaction }); const next: AssetRow = { ...row, resourceVersion: (BigInt(row.resourceVersion) + BigInt(1)).toString(), updatedAt: time }; const saved = await this.models.assets.cas({ tenantId: row.tenantId, id: row.id, expectedVersion: row.resourceVersion, next }, { transaction }); if (!saved) throw new TrailsMediaAssetRegistryStaleVersionError('资源版本已过期'); return asset(saved); }); }
  async publish(actor: Actor, input: DurableCommerceMutation & { id: string }): Promise<DurableMediaAsset> { return this.mutate(actor, input, 'asset:publish', { id: input.id, expectedResourceVersion: input.expectedResourceVersion }, async transaction => { const row = await this.owned(actor, input.id, transaction); if (input.expectedResourceVersion !== row.resourceVersion) throw new TrailsMediaAssetRegistryStaleVersionError('资源版本已过期'); const ready = await this.models.variants.list({ tenantId: row.tenantId, assetId: row.id }, { transaction }); if (ready.length !== variants.length || variants.some(name => !ready.some(item => item.name === name && item.state === 'ready'))) throw new TrailsSyncInputError('发布前必须具备全部ready公开variant'); const next: AssetRow = { ...row, status: 'published', resourceVersion: (BigInt(row.resourceVersion) + BigInt(1)).toString(), updatedAt: this.now() }; const saved = await this.models.assets.cas({ tenantId: row.tenantId, id: row.id, expectedVersion: row.resourceVersion, next }, { transaction }); if (!saved) throw new TrailsMediaAssetRegistryStaleVersionError('资源版本已过期'); return asset(saved); }); }
}
export const createSequelizeMediaAssetRegistryModels = (assets: ModelStatic<TrailsMediaAssetRegistryTable>, variantsModel: ModelStatic<TrailsMediaAssetVariantTable>, artifactsModel: ModelStatic<TrailsMediaAssetArtifactTable>, mutations: ModelStatic<TrailsMediaAssetRegistryMutationTable>): MediaAssetRegistryModels => ({ assets: { async create(input, options) { return assetRow((await assets.create(input, { transaction: sequelizeTransaction(options.transaction) })).get()); }, async find(input, options) { const tx = sequelizeTransaction(options.transaction); const found = await assets.findOne({ where: input, transaction: tx, lock: tx.LOCK.UPDATE }); return found ? assetRow(found.get()) : undefined; }, async list(input, options) { return (await assets.findAll({ where: input, order: [['updatedAt', 'DESC'], ['id', 'ASC']], transaction: sequelizeTransaction(options.transaction) })).map(found => assetRow(found.get())); }, async cas(input, options) { const [affected] = await assets.update(input.next, { where: { tenantId: input.tenantId, id: input.id, resourceVersion: input.expectedVersion }, transaction: sequelizeTransaction(options.transaction) }); return affected === 1 ? input.next : undefined; } }, variants: { async upsert(input, options) { await variantsModel.upsert(input, { transaction: sequelizeTransaction(options.transaction) }); }, async list(input, options) { return (await variantsModel.findAll({ where: input, transaction: sequelizeTransaction(options.transaction) })).map(found => variantRow(found.get())); } }, artifacts: { async upsert(input, options) { await artifactsModel.upsert(input, { transaction: sequelizeTransaction(options.transaction) }); }, async list(input, options) { return (await artifactsModel.findAll({ where: input, transaction: sequelizeTransaction(options.transaction) })).map(found => artifactRow(found.get())); } }, mutations: { async find(input, options) { const tx = sequelizeTransaction(options.transaction); const found = await mutations.findOne({ where: input, transaction: tx, lock: tx.LOCK.UPDATE }); return found?.get(); }, async create(input, options) { await mutations.create(input, { transaction: sequelizeTransaction(options.transaction) }); } } });
