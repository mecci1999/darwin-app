import { ModelStatic, Transaction } from 'sequelize';
import { ITrailsDurablePortfolioTableAttributes, TrailsDurablePortfolioTable } from '../../../../db/mysql/models/trailsDurablePortfolio';
import { Actor, DurablePortfolio, DurablePortfolioDraftInput, DurablePortfolioStore, DurablePortfolioTransitionInput, DurablePortfolioUpdateInput, PhotoTechnicalMetadata } from '../types';
import { photoTechnicalMetadata as parsePhotoTechnicalMetadata } from '../validators';
import { RichDocumentPublishValidator } from './mysqlRichDocument';
import { creatorSpaceOwnerId } from '../utils/actor';
import { TrailsSyncInputError, TrailsSyncPersistenceError, TrailsSyncTransaction } from './mysqlPortfolioCategorySync';

type Row = Omit<ITrailsDurablePortfolioTableAttributes, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date };
type Options = { transaction: TrailsSyncTransaction };
export class TrailsDurablePortfolioStaleVersionError extends Error {}
const maxUnsignedBigInt = BigInt('18446744073709551615');
export interface DurablePortfolioModel { create(row: Row, options: Options): Promise<Row>; find(input: { tenantId: string; id: string }, options: Options): Promise<Row | undefined>; list(input: { tenantId: string; ownerUserId: string; publicOnly?: boolean; categoryId?: string }, options: Options): Promise<Row[]>; compareAndSwap(input: { tenantId: string; id: string; expectedVersion: string; next: Row }, options: Options): Promise<Row | undefined>; }
export interface DurablePortfolioCategoryLookup { find(input: { tenantId: string; id: string }, options: Options): Promise<{ ownerUserId: string; visibility: 'public' | 'private' | 'unlisted'; status: 'active' | 'archived'; lifecycle: 'draft' | 'published' | 'archived' } | undefined>; }
const text = (value: unknown, label: string, maximum: number): string => { if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new TrailsSyncInputError(`${label}无效`); return value.trim(); };
const optional = (value: unknown, label: string, maximum: number): string | undefined => { if (value === undefined) return undefined; return text(value, label, maximum); };
const version = (value: unknown): string => { if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw new TrailsSyncInputError('resourceVersion必须是规范十进制字符串'); return value; };
const mediaIds = (value: unknown): string[] => { if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !id.trim() || id.length > 160)) throw new TrailsSyncInputError('mediaIds必须是opaque ID数组'); return value; };
const serializePhotoTechnicalMetadata = (value: PhotoTechnicalMetadata | undefined): string | undefined => {
  if (value === undefined) return undefined;
  try {
    const validated = parsePhotoTechnicalMetadata({ photoTechnicalMetadata: value });
    if (!validated) throw new TrailsSyncInputError('photoTechnicalMetadata无效');
    return JSON.stringify(validated);
  } catch (error: unknown) {
    if (error instanceof TrailsSyncInputError) throw error;
    throw new TrailsSyncInputError(error instanceof Error ? error.message : 'photoTechnicalMetadata无效');
  }
};
const parseStoredPhotoTechnicalMetadata = (value: string | null | undefined): PhotoTechnicalMetadata | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TrailsSyncPersistenceError('portfolio photo technical metadata is invalid');
    const validated = parsePhotoTechnicalMetadata({ photoTechnicalMetadata: parsed as Record<string, unknown> });
    if (!validated) throw new TrailsSyncPersistenceError('portfolio photo technical metadata is invalid');
    return validated;
  } catch (error: unknown) {
    if (error instanceof TrailsSyncPersistenceError) throw error;
    throw new TrailsSyncPersistenceError('portfolio photo technical metadata is invalid');
  }
};
const fromRow = (row: Row): DurablePortfolio => {
  const metadata = parseStoredPhotoTechnicalMetadata(row.photoTechnicalMetadata);
  return {
    id: row.id, tenantId: row.tenantId, ownerUserId: row.ownerUserId, title: row.title, summary: row.summary,
    ...(row.categoryId ? { categoryId: row.categoryId } : {}), ...(row.coverMediaId ? { coverMediaId: row.coverMediaId } : {}),
    mediaIds: parseMediaIds(row.mediaIds), ...(row.locationLabel ? { locationLabel: row.locationLabel } : {}),
    ...(metadata ? { photoTechnicalMetadata: metadata } : {}),
    visibility: row.visibility, lifecycle: row.lifecycle, resourceVersion: row.resourceVersion,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
};
const parseMediaIds = (value: string): string[] => { try { const parsed: unknown = JSON.parse(value); return mediaIds(parsed); } catch (error: unknown) { if (error instanceof TrailsSyncInputError) throw new TrailsSyncPersistenceError('portfolio media IDs are invalid'); throw new TrailsSyncPersistenceError('portfolio media IDs are invalid'); } };

export class MySqlDurablePortfolioRepository implements DurablePortfolioStore {
  constructor(private readonly connection: { transaction<T>(work: (transaction: TrailsSyncTransaction) => Promise<T>): Promise<T> }, private readonly portfolios: DurablePortfolioModel, private readonly categories?: DurablePortfolioCategoryLookup, private readonly now: () => Date = () => new Date(), private readonly richDocuments?: RichDocumentPublishValidator) {}
  private async validateCategory(transaction: TrailsSyncTransaction, tenantId: string, ownerUserId: string, categoryId: string | undefined, requirePublic: boolean): Promise<void> {
    if (!categoryId) return;
    if (!this.categories) throw new TrailsSyncPersistenceError('portfolio category lookup is unavailable');
    const category = await this.categories.find({ tenantId, id: categoryId }, { transaction });
    if (!category || category.ownerUserId !== ownerUserId || category.status !== 'active') throw new TrailsSyncInputError('作品集分类不存在或不属于当前创作空间');
    if (requirePublic && (category.visibility !== 'public' || category.lifecycle !== 'published')) throw new TrailsSyncInputError('公开作品集必须关联已发布的公开分类');
  }
  async createDraft(actor: Actor, input: DurablePortfolioDraftInput): Promise<DurablePortfolio> {
    const ownerUserId = creatorSpaceOwnerId(actor); if (!ownerUserId) throw new TrailsSyncInputError('当前账号没有创作空间管理权限');
    const id = text(input.id, 'id', 160); const timestamp = this.now();
    const metadataJson = serializePhotoTechnicalMetadata(input.photoTechnicalMetadata);
    const row: Row = {
      id, tenantId: actor.tenantId, ownerUserId, title: text(input.title, 'title', 160), summary: text(input.summary, 'summary', 65535),
      categoryId: optional(input.categoryId, 'categoryId', 160), coverMediaId: optional(input.coverMediaId, 'coverMediaId', 160),
      mediaIds: JSON.stringify(mediaIds(input.mediaIds)), locationLabel: optional(input.locationLabel, 'locationLabel', 240),
      ...(metadataJson !== undefined ? { photoTechnicalMetadata: metadataJson } : {}),
      visibility: input.visibility, lifecycle: 'draft', resourceVersion: '1', createdAt: timestamp, updatedAt: timestamp,
    };
    if (row.visibility !== 'public' && row.visibility !== 'private' && row.visibility !== 'unlisted') throw new TrailsSyncInputError('visibility无效');
    return this.connection.transaction(async (transaction) => { await this.validateCategory(transaction, row.tenantId, ownerUserId, row.categoryId, false); return fromRow(await this.portfolios.create(row, { transaction })); });
  }
  async update(actor: Actor, input: DurablePortfolioUpdateInput): Promise<DurablePortfolio> {
    const ownerUserId = creatorSpaceOwnerId(actor); if (!ownerUserId) throw new TrailsSyncInputError('当前账号没有创作空间管理权限');
    const expectedVersion = version(input.resourceVersion);
    return this.connection.transaction(async transaction => {
      const current = await this.portfolios.find({ tenantId: actor.tenantId, id: text(input.id, 'id', 160) }, { transaction });
      if (!current || current.ownerUserId !== ownerUserId) throw new TrailsSyncInputError('作品集不属于当前创作空间');
      if (current.lifecycle !== 'draft') throw new TrailsSyncInputError('只有草稿作品集可以更新');
      if (current.resourceVersion !== expectedVersion) throw new TrailsDurablePortfolioStaleVersionError('作品集版本已过期');
      const metadataJson = serializePhotoTechnicalMetadata(input.photoTechnicalMetadata);
      const next: Row = {
        ...current,
        title: text(input.title, 'title', 160), summary: text(input.summary, 'summary', 65535),
        categoryId: optional(input.categoryId, 'categoryId', 160), coverMediaId: optional(input.coverMediaId, 'coverMediaId', 160),
        mediaIds: JSON.stringify(mediaIds(input.mediaIds)), locationLabel: optional(input.locationLabel, 'locationLabel', 240),
        photoTechnicalMetadata: metadataJson === undefined ? null : metadataJson,
        visibility: input.visibility, resourceVersion: (BigInt(current.resourceVersion) + BigInt(1)).toString(), updatedAt: this.now(),
      };
      if (!['public', 'private', 'unlisted'].includes(next.visibility)) throw new TrailsSyncInputError('visibility无效');
      await this.validateCategory(transaction, current.tenantId, ownerUserId, next.categoryId, false);
      const saved = await this.portfolios.compareAndSwap({ tenantId: actor.tenantId, id: current.id, expectedVersion, next }, { transaction });
      if (!saved) throw new TrailsDurablePortfolioStaleVersionError('作品集版本已过期');
      return fromRow(saved);
    });
  }
  async publish(actor: Actor, input: DurablePortfolioTransitionInput): Promise<DurablePortfolio> {
    const ownerUserId = creatorSpaceOwnerId(actor); if (!ownerUserId) throw new TrailsSyncInputError('当前账号没有创作空间管理权限'); const expectedVersion = version(input.resourceVersion);
    return this.connection.transaction(async (transaction) => { const current = await this.portfolios.find({ tenantId: actor.tenantId, id: input.id }, { transaction }); if (!current || current.ownerUserId !== ownerUserId) throw new TrailsSyncInputError('作品集不属于当前创作空间'); if (current.lifecycle !== 'draft') throw new TrailsSyncInputError('只有草稿作品集可以发布'); if (current.resourceVersion !== expectedVersion) throw new TrailsDurablePortfolioStaleVersionError('作品集版本已过期'); await this.validateCategory(transaction, current.tenantId, ownerUserId, current.categoryId, current.visibility === 'public'); if (!this.richDocuments) throw new TrailsSyncPersistenceError('rich document publish validator is unavailable'); await this.richDocuments.validate(transaction, { tenantId: current.tenantId, ownerUserId, subjectType: 'portfolio', subjectId: current.id }); if (BigInt(current.resourceVersion) >= maxUnsignedBigInt) throw new TrailsSyncInputError('作品集版本已达到存储上限'); const next = { ...current, lifecycle: 'published' as const, resourceVersion: (BigInt(current.resourceVersion) + BigInt(1)).toString(), updatedAt: this.now() }; const saved = await this.portfolios.compareAndSwap({ tenantId: actor.tenantId, id: current.id, expectedVersion, next }, { transaction }); if (!saved) throw new TrailsDurablePortfolioStaleVersionError('作品集版本已过期'); return fromRow(saved); });
  }
  async unpublish(actor: Actor, input: DurablePortfolioTransitionInput): Promise<DurablePortfolio> { const ownerUserId = creatorSpaceOwnerId(actor); if (!ownerUserId) throw new TrailsSyncInputError('当前账号没有创作空间管理权限'); const expectedVersion = version(input.resourceVersion); return this.connection.transaction(async transaction => { const current = await this.portfolios.find({ tenantId: actor.tenantId, id: text(input.id, 'id', 160) }, { transaction }); if (!current || current.ownerUserId !== ownerUserId) throw new TrailsSyncInputError('作品集不属于当前创作空间'); if (current.lifecycle !== 'published') throw new TrailsSyncInputError('只有已发布作品集可以取消发布'); if (current.resourceVersion !== expectedVersion) throw new TrailsDurablePortfolioStaleVersionError('作品集版本已过期'); const next = { ...current, lifecycle: 'draft' as const, resourceVersion: (BigInt(current.resourceVersion) + BigInt(1)).toString(), updatedAt: this.now() }; const saved = await this.portfolios.compareAndSwap({ tenantId: actor.tenantId, id: current.id, expectedVersion, next }, { transaction }); if (!saved) throw new TrailsDurablePortfolioStaleVersionError('作品集版本已过期'); return fromRow(saved); }); }
  async listWorkspace(actor: Actor): Promise<DurablePortfolio[]> { const ownerUserId = creatorSpaceOwnerId(actor); if (!ownerUserId) throw new TrailsSyncInputError('当前账号没有创作空间管理权限'); return this.connection.transaction(async (transaction) => (await this.portfolios.list({ tenantId: actor.tenantId, ownerUserId }, { transaction })).map(fromRow)); }
  async listPublic(owner: Pick<Actor, 'tenantId' | 'userId'>, categoryId?: string): Promise<DurablePortfolio[]> { return this.connection.transaction(async (transaction) => (await this.portfolios.list({ tenantId: owner.tenantId, ownerUserId: owner.userId, publicOnly: true, ...(categoryId ? { categoryId } : {}) }, { transaction })).map(fromRow)); }
}

const sequelizeTransaction = (transaction: TrailsSyncTransaction): Transaction => { if (transaction instanceof Transaction) return transaction; throw new TrailsSyncPersistenceError('Sequelize adapter requires a managed transaction'); };
const databaseVersion = (value: unknown): string => {
  if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) return value;
  if (typeof value === 'bigint' && value >= BigInt(0)) return value.toString();
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  throw new TrailsSyncPersistenceError('portfolio resource version is invalid');
};
const row = (attributes: ITrailsDurablePortfolioTableAttributes): Row => {
  if (!attributes.createdAt || !attributes.updatedAt) throw new TrailsSyncPersistenceError('portfolio row is invalid');
  return { ...attributes, resourceVersion: databaseVersion(attributes.resourceVersion), createdAt: attributes.createdAt, updatedAt: attributes.updatedAt };
};
export const createSequelizeDurablePortfolioModel = (model: ModelStatic<TrailsDurablePortfolioTable>): DurablePortfolioModel => ({
  async create(input, options) { return row((await model.create(input, { transaction: sequelizeTransaction(options.transaction) })).get()); },
  async find(input, options) { const result = await model.findOne({ where: input, transaction: sequelizeTransaction(options.transaction), lock: sequelizeTransaction(options.transaction).LOCK.UPDATE }); return result ? row(result.get()) : undefined; },
  async list(input, options) { const where = input.publicOnly ? { tenantId: input.tenantId, ownerUserId: input.ownerUserId, visibility: 'public', lifecycle: 'published', ...(input.categoryId ? { categoryId: input.categoryId } : {}) } : { tenantId: input.tenantId, ownerUserId: input.ownerUserId }; return (await model.findAll({ where, order: [['updatedAt', 'DESC'], ['id', 'ASC']], transaction: sequelizeTransaction(options.transaction) })).map((result) => row(result.get())); },
  async compareAndSwap(input, options) { const transaction = sequelizeTransaction(options.transaction); const [affected] = await model.update(input.next, { where: { tenantId: input.tenantId, id: input.id, resourceVersion: input.expectedVersion }, transaction }); return affected === 1 ? input.next : undefined; },
});
