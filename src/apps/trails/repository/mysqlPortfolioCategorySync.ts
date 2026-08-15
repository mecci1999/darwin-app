import { createHash } from 'crypto';
import { ModelStatic, Op, Transaction } from 'sequelize';
import { ITrailsPortfolioCategoryTableAttributes, TrailsPortfolioCategoryTable } from 'db/mysql/models/trailsPortfolioCategory';
import { ITrailsSyncChangeTableAttributes, TrailsSyncChangeTable } from 'db/mysql/models/trailsSyncChange';
import { ITrailsSyncMutationTableAttributes, TrailsSyncMutationTable } from 'db/mysql/models/trailsSyncMutation';
import { Actor, CategoryStatus, Lifecycle, PortfolioCategorySyncPayload, Visibility } from '../types';
import { actorCanManageCreatorSpace, creatorSpaceOwnerId } from '../utils/actor';

export type DecimalString = string;
export interface AsyncPortfolioCategoryMutation { mutationId: string; resourceId: string; baseVersion: DecimalString | null; payload: PortfolioCategorySyncPayload; }
export interface AsyncPortfolioCategory { id: string; tenantId: string; ownerUserId: string; slug: string; nameZh: string; description: string; sortOrder: number; visibility: Visibility; status: CategoryStatus; lifecycle: Lifecycle; resourceVersion: DecimalString; createdAt: string; updatedAt: string; }
export interface AsyncSyncApplied { kind: 'applied' | 'duplicate'; mutationId: string; resource: AsyncPortfolioCategory; }
export interface AsyncSyncConflict { kind: 'conflict'; mutationId: string; code: 'STALE_VERSION'; resourceId: string; baseVersion: DecimalString | null; current: AsyncPortfolioCategory; }
export type AsyncPortfolioCategoryPushResult = AsyncSyncApplied | AsyncSyncConflict;
export interface AsyncPortfolioCategoryChange { cursor: DecimalString; resourceId: string; updatedAt: string; resource: AsyncPortfolioCategory; }
export interface AsyncPortfolioCategoryPullResult { changes: AsyncPortfolioCategoryChange[]; nextCursor: DecimalString; }

export class TrailsSyncInputError extends Error {}
export class TrailsSyncDuplicateSlugError extends Error {}
export class TrailsSyncPersistenceError extends Error {}

export type TrailsSyncTransaction = object;
export interface TrailsSyncConnection { transaction<T>(work: (transaction: TrailsSyncTransaction) => Promise<T>): Promise<T>; }
type TransactionOptions = { transaction: TrailsSyncTransaction; lock?: unknown };
export type CategoryRow = Omit<AsyncPortfolioCategory, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date };
export type MutationRow = { tenantId: string; actorUserId: string; mutationId: string; fingerprint: string; resultKind: 'applied' | 'conflict'; resultJson: string };
export type ChangeRow = { cursor: DecimalString; resourceId: string; resourceJson: string; createdAt: Date };
export type ChangeWrite = { tenantId: string; ownerUserId: string; resourceType: 'portfolio-category'; resourceId: string; operation: 'upsert'; resourceVersion: DecimalString; resourceJson: string };
export type CategoryCasOutcome = { kind: 'updated'; row: CategoryRow } | { kind: 'stale'; current?: CategoryRow };

export interface TrailsPortfolioCategoryModel {
  findByTenantResource(input: { tenantId: string; resourceId: string }, options: TransactionOptions): Promise<CategoryRow | undefined>;
  findByOwnerSlug(input: { tenantId: string; ownerUserId: string; slug: string }, options: TransactionOptions): Promise<Pick<CategoryRow, 'id'> | undefined>;
  create(row: CategoryRow, options: TransactionOptions): Promise<CategoryRow>;
  compareAndSwap(input: { tenantId: string; resourceId: string; expectedVersion: DecimalString; next: CategoryRow }, options: TransactionOptions): Promise<CategoryCasOutcome>;
  listByOwner(input: { tenantId: string; ownerUserId: string; publicOnly?: boolean }, options: TransactionOptions): Promise<CategoryRow[]>;
  findPublicByOwnerSlug(input: { tenantId: string; ownerUserId: string; slug: string }, options: TransactionOptions): Promise<CategoryRow | undefined>;
}
export interface TrailsSyncMutationModel {
  findByActorMutation(input: { tenantId: string; actorUserId: string; mutationId: string }, options: TransactionOptions): Promise<MutationRow | undefined>;
  create(row: MutationRow, options: TransactionOptions): Promise<void>;
}
export interface TrailsSyncChangeModel {
  create(row: ChangeWrite, options: TransactionOptions): Promise<Pick<ChangeRow, 'cursor'>>;
  listAfter(input: { tenantId: string; ownerUserId: string; after: DecimalString; limit: number }, options: TransactionOptions): Promise<ChangeRow[]>;
  latestCursor(input: { tenantId: string; ownerUserId: string }, options: TransactionOptions): Promise<DecimalString | undefined>;
}
export interface TrailsPortfolioCategorySyncModels { categories: TrailsPortfolioCategoryModel; changes: TrailsSyncChangeModel; mutations: TrailsSyncMutationModel; }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const decimal = (value: unknown, label: string): DecimalString => {
  if (typeof value !== 'string') throw new TrailsSyncInputError(`${label}必须是十进制非负整数字符串`);
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new TrailsSyncInputError(`${label}必须是十进制非负整数字符串`);
  return value;
};
const databaseDecimal = (value: unknown, label: string): DecimalString => {
  if (typeof value === 'string') return decimal(value, label);
  if (typeof value === 'bigint') return decimal(value.toString(), label);
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  throw new TrailsSyncPersistenceError(`${label}不是安全的数据库BIGINT值`);
};
const requiredString = (value: unknown, label: string, maximum: number): string => {
  if (typeof value !== 'string') throw new TrailsSyncInputError(`${label}必须是1至${maximum}字符`);
  if (!value.trim() || value.length > maximum) throw new TrailsSyncInputError(`${label}必须是1至${maximum}字符`);
  return value;
};
const transactionOptions = (transaction: TrailsSyncTransaction): TransactionOptions => {
  if ('lock' in transaction && transaction.lock !== undefined) return { transaction, lock: transaction.lock };
  return { transaction };
};
const iso = (value: Date): string => value.toISOString();
const increment = (version: DecimalString): DecimalString => (BigInt(version) + BigInt(1)).toString();
const fingerprint = (mutation: InternalCategoryMutation): string => createHash('sha256').update(JSON.stringify({ resourceType: 'portfolio-category', resourceId: mutation.resourceId, operation: mutation.transition ?? 'upsert', baseVersion: mutation.baseVersion, payload: mutation.payload })).digest('hex');
const fromRow = (row: CategoryRow): AsyncPortfolioCategory => ({ ...row, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) });
const isVisibility = (value: unknown): value is Visibility => value === 'public' || value === 'private' || value === 'unlisted';
const isStatus = (value: unknown): value is CategoryStatus => value === 'active' || value === 'archived';
const isLifecycle = (value: unknown): value is Lifecycle => value === 'draft' || value === 'published' || value === 'archived';
const isCategory = (value: unknown): value is AsyncPortfolioCategory => isRecord(value)
  && typeof value.id === 'string' && typeof value.tenantId === 'string' && typeof value.ownerUserId === 'string' && typeof value.slug === 'string' && typeof value.nameZh === 'string' && typeof value.description === 'string'
  && typeof value.sortOrder === 'number' && isVisibility(value.visibility) && isStatus(value.status) && isLifecycle(value.lifecycle) && typeof value.resourceVersion === 'string' && /^(0|[1-9][0-9]*)$/.test(value.resourceVersion) && typeof value.createdAt === 'string' && typeof value.updatedAt === 'string';
const parseCategory = (value: string, label: string): AsyncPortfolioCategory => {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new TrailsSyncPersistenceError(`${label}不是有效JSON`); }
  if (!isCategory(parsed)) throw new TrailsSyncPersistenceError(`${label}包含无效的portfolio-category结果`);
  return parsed;
};
const isUniqueError = (error: unknown): boolean => isRecord(error) && (error.name === 'SequelizeUniqueConstraintError' || error.code === 'ER_DUP_ENTRY');
type CategoryStateTransition = 'create-published' | 'archive';
type InternalCategoryMutation = AsyncPortfolioCategoryMutation & { transition?: CategoryStateTransition };

const validateMutation = (actor: Actor, mutation: AsyncPortfolioCategoryMutation): void => {
  requiredString(actor.tenantId, 'tenantId', 64); requiredString(actor.userId, 'actorUserId', 64);
  requiredString(mutation.mutationId, 'mutationId', 160); requiredString(mutation.resourceId, 'resourceId', 160);
  if (mutation.baseVersion !== null) decimal(mutation.baseVersion, 'baseVersion');
  const payload = mutation.payload;
  if (!isRecord(payload)) throw new TrailsSyncInputError('payload必须是对象');
  if (payload.slug !== undefined && (typeof payload.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(payload.slug) || payload.slug.length > 160)) throw new TrailsSyncInputError('payload.slug无效');
  if (payload.nameZh !== undefined && (typeof payload.nameZh !== 'string' || !payload.nameZh.trim() || payload.nameZh.length > 160)) throw new TrailsSyncInputError('payload.nameZh无效');
  if (payload.description !== undefined && (typeof payload.description !== 'string' || payload.description.length > 65535)) throw new TrailsSyncInputError('payload.description无效');
  if (payload.sortOrder !== undefined && (typeof payload.sortOrder !== 'number' || !Number.isFinite(payload.sortOrder) || !Number.isInteger(payload.sortOrder) || payload.sortOrder < 0 || payload.sortOrder > 4294967295)) throw new TrailsSyncInputError('payload.sortOrder无效');
  if (payload.visibility !== undefined && !isVisibility(payload.visibility)) throw new TrailsSyncInputError('payload.visibility无效');
};

/** Durable-only category sync. It is intentionally not live-wired and does not implement TrailsRepository. */
export class MySqlPortfolioCategorySyncRepository {
  private readonly pullLimit: number;
  private readonly now: () => Date;
  constructor(private readonly connection: TrailsSyncConnection, private readonly models: TrailsPortfolioCategorySyncModels, options: { pullLimit?: number; now?: () => Date } = {}) {
    const limit = options.pullLimit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new TrailsSyncInputError('pullLimit必须是1至500的安全整数');
    this.pullLimit = limit; this.now = options.now ?? (() => new Date());
  }

  async push(actor: Actor, mutation: AsyncPortfolioCategoryMutation): Promise<AsyncPortfolioCategoryPushResult> {
    return this.pushWithTransition(actor, mutation);
  }

  async create(actor: Actor, mutation: AsyncPortfolioCategoryMutation): Promise<AsyncPortfolioCategoryPushResult> {
    return this.pushWithTransition(actor, mutation, 'create-published');
  }

  async archive(actor: Actor, mutation: AsyncPortfolioCategoryMutation): Promise<AsyncPortfolioCategoryPushResult> {
    return this.pushWithTransition(actor, mutation, 'archive');
  }

  private async pushWithTransition(actor: Actor, mutation: AsyncPortfolioCategoryMutation, transition?: CategoryStateTransition): Promise<AsyncPortfolioCategoryPushResult> {
    const ownerUserId = creatorSpaceOwnerId(actor);
    if (!ownerUserId) throw new TrailsSyncInputError('当前账号没有创作空间管理权限');
    validateMutation(actor, mutation);
    const internalMutation: InternalCategoryMutation = { ...mutation, ...(transition ? { transition } : {}) };
    const expectedFingerprint = fingerprint(internalMutation);
    try { return await this.connection.transaction((transaction) => this.pushAttempt(actor, ownerUserId, internalMutation, expectedFingerprint, transaction)); }
    catch (error) {
      if (!isUniqueError(error)) throw error;
      return this.connection.transaction(async (transaction) => {
        const stored = await this.models.mutations.findByActorMutation({ tenantId: actor.tenantId, actorUserId: actor.userId, mutationId: mutation.mutationId }, transactionOptions(transaction));
        if (stored) return this.replay(stored, expectedFingerprint);
        throw new TrailsSyncPersistenceError('同步写入遇到未确认的唯一键冲突');
      });
    }
  }

  async pull(actor: Actor, cursor?: DecimalString): Promise<AsyncPortfolioCategoryPullResult> {
    const ownerUserId = creatorSpaceOwnerId(actor);
    if (!ownerUserId) throw new TrailsSyncInputError('当前账号没有创作空间管理权限');
    requiredString(actor.tenantId, 'tenantId', 64); requiredString(actor.userId, 'actorUserId', 64);
    const after = cursor === undefined ? '0' : decimal(cursor, 'cursor');
    return this.connection.transaction(async (transaction) => {
      const options = transactionOptions(transaction);
      const rows = await this.models.changes.listAfter({ tenantId: actor.tenantId, ownerUserId, after, limit: this.pullLimit }, options);
      const changes = rows.map((row) => ({ cursor: decimal(row.cursor, 'cursor'), resourceId: row.resourceId, updatedAt: iso(row.createdAt), resource: parseCategory(row.resourceJson, '同步变更') }));
      const nextCursor = changes.length > 0 ? changes[changes.length - 1].cursor : await this.models.changes.latestCursor({ tenantId: actor.tenantId, ownerUserId }, options) ?? after;
      return { changes, nextCursor: decimal(nextCursor, 'cursor') };
    });
  }

  async listWorkspace(actor: Actor): Promise<AsyncPortfolioCategory[]> {
    const ownerUserId = creatorSpaceOwnerId(actor);
    if (!ownerUserId) throw new TrailsSyncInputError('当前账号没有创作空间管理权限');
    return this.connection.transaction(async (transaction) => this.models.categories.listByOwner({ tenantId: actor.tenantId, ownerUserId }, transactionOptions(transaction)).then((rows) => rows.map(fromRow)));
  }

  async listPublic(owner: Pick<Actor, 'tenantId' | 'userId'>): Promise<AsyncPortfolioCategory[]> {
    return this.connection.transaction(async (transaction) => this.models.categories.listByOwner({ tenantId: owner.tenantId, ownerUserId: owner.userId, publicOnly: true }, transactionOptions(transaction)).then((rows) => rows.map(fromRow)));
  }

  async resolvePublic(owner: Pick<Actor, 'tenantId' | 'userId'>, slug: string): Promise<AsyncPortfolioCategory | undefined> {
    return this.connection.transaction(async (transaction) => {
      const result = await this.models.categories.findPublicByOwnerSlug({ tenantId: owner.tenantId, ownerUserId: owner.userId, slug }, transactionOptions(transaction));
      return result ? fromRow(result) : undefined;
    });
  }

  async reorder(actor: Actor, mutations: AsyncPortfolioCategoryMutation[]): Promise<AsyncPortfolioCategoryPushResult[]> {
    const ownerUserId = creatorSpaceOwnerId(actor);
    if (!ownerUserId) throw new TrailsSyncInputError('当前账号没有创作空间管理权限');
    if (mutations.length === 0 || new Set(mutations.map((mutation) => mutation.resourceId)).size !== mutations.length) throw new TrailsSyncInputError('重排序分类必须非空且不能重复');
    mutations.forEach((mutation) => validateMutation(actor, mutation));
    try { return await this.connection.transaction((transaction) => this.reorderAttempt(actor, ownerUserId, mutations, transaction)); }
    catch (error) {
      if (!isUniqueError(error)) throw error;
      return this.connection.transaction((transaction) => this.replayReorder(actor, mutations, transaction));
    }
  }

  private async reorderAttempt(actor: Actor, ownerUserId: string, mutations: AsyncPortfolioCategoryMutation[], transaction: TrailsSyncTransaction): Promise<AsyncPortfolioCategoryPushResult[]> {
      const options = transactionOptions(transaction);
      const replays = await Promise.all(mutations.map(async (mutation) => {
        const stored = await this.models.mutations.findByActorMutation({ tenantId: actor.tenantId, actorUserId: actor.userId, mutationId: mutation.mutationId }, options);
        return stored ? this.replay(stored, fingerprint(mutation)) : undefined;
      }));
      if (replays.every((result) => result !== undefined)) return replays as AsyncPortfolioCategoryPushResult[];
      if (replays.some((result) => result !== undefined)) throw new TrailsSyncInputError('重排序mutation重放状态不完整');
      const locked = new Map<string, CategoryRow>();
      for (const mutation of [...mutations].sort((left, right) => left.resourceId.localeCompare(right.resourceId))) {
        const current = await this.models.categories.findByTenantResource({ tenantId: actor.tenantId, resourceId: mutation.resourceId }, options);
        if (!current || !actorCanManageCreatorSpace(actor, current) || current.ownerUserId !== ownerUserId || current.status !== 'active') throw new TrailsSyncInputError('重排序分类不属于当前创作空间或不可用');
        if (mutation.baseVersion !== current.resourceVersion) return [await this.pushAttempt(actor, ownerUserId, mutation, fingerprint(mutation), transaction)];
        locked.set(mutation.resourceId, current);
      }
      const results: AsyncPortfolioCategoryPushResult[] = [];
      for (const mutation of mutations) {
        const current = locked.get(mutation.resourceId);
        if (!current) throw new TrailsSyncPersistenceError('重排序锁定分类丢失');
        results.push(await this.pushAttempt(actor, ownerUserId, mutation, fingerprint(mutation), transaction));
      }
      return results;
  }

  private async replayReorder(actor: Actor, mutations: AsyncPortfolioCategoryMutation[], transaction: TrailsSyncTransaction): Promise<AsyncPortfolioCategoryPushResult[]> {
    const options = transactionOptions(transaction);
    const results = await Promise.all(mutations.map(async (mutation) => {
      const stored = await this.models.mutations.findByActorMutation({ tenantId: actor.tenantId, actorUserId: actor.userId, mutationId: mutation.mutationId }, options);
      if (!stored) throw new TrailsSyncPersistenceError('重排序写入遇到未确认的唯一键冲突');
      return this.replay(stored, fingerprint(mutation));
    }));
    return results;
  }

  private async pushAttempt(actor: Actor, ownerUserId: string, mutation: InternalCategoryMutation, expectedFingerprint: string, transaction: TrailsSyncTransaction): Promise<AsyncPortfolioCategoryPushResult> {
    const options = transactionOptions(transaction);
    const stored = await this.models.mutations.findByActorMutation({ tenantId: actor.tenantId, actorUserId: actor.userId, mutationId: mutation.mutationId }, options);
    if (stored) return this.replay(stored, expectedFingerprint);
    const current = await this.models.categories.findByTenantResource({ tenantId: actor.tenantId, resourceId: mutation.resourceId }, options);
    if (current && !actorCanManageCreatorSpace(actor, current)) throw new TrailsSyncInputError('同步资源不属于当前创作空间');
    if (current && mutation.baseVersion !== current.resourceVersion) return this.storeConflict(actor, mutation, expectedFingerprint, current, options);
    if (!current && mutation.baseVersion !== null) throw new TrailsSyncInputError('新资源必须使用空的baseVersion');
    if (!current && (mutation.payload.slug === undefined || mutation.payload.nameZh === undefined)) throw new TrailsSyncInputError('新资源必须提供payload.slug和payload.nameZh');
    if (!current && mutation.transition === 'archive') throw new TrailsSyncInputError('新分类不能归档');
    if (current && current.status === 'archived') throw new TrailsSyncInputError('已归档分类不能更新或恢复');
    if (current && mutation.transition === 'create-published') throw new TrailsSyncInputError('已存在分类不能再次创建');
    const next = this.merge(current, actor.tenantId, ownerUserId, mutation, this.now());
    const duplicateSlug = await this.models.categories.findByOwnerSlug({ tenantId: next.tenantId, ownerUserId: next.ownerUserId, slug: next.slug }, options);
    if (duplicateSlug && duplicateSlug.id !== next.id) throw new TrailsSyncDuplicateSlugError('slug已被当前所有者使用');
    let saved: CategoryRow;
    try {
      if (!current) saved = await this.models.categories.create(next, options);
      else {
        const outcome = await this.models.categories.compareAndSwap({ tenantId: actor.tenantId, resourceId: current.id, expectedVersion: current.resourceVersion, next }, options);
        if (outcome.kind === 'stale') {
          if (!outcome.current) throw new TrailsSyncPersistenceError('同步资源在比较更新后不存在');
          return this.storeConflict(actor, mutation, expectedFingerprint, outcome.current, options);
        }
        saved = outcome.row;
      }
    } catch (error) {
      if (isUniqueError(error) && current) throw new TrailsSyncDuplicateSlugError('slug已被当前所有者使用');
      if (isUniqueError(error)) throw new TrailsSyncPersistenceError('同步资源编号已存在或写入冲突');
      throw error;
    }
    const result: AsyncSyncApplied = { kind: 'applied', mutationId: mutation.mutationId, resource: fromRow(saved) };
    await this.models.changes.create({ tenantId: saved.tenantId, ownerUserId: saved.ownerUserId, resourceType: 'portfolio-category', resourceId: saved.id, operation: 'upsert', resourceVersion: saved.resourceVersion, resourceJson: JSON.stringify(result.resource) }, options);
    await this.storeMutation(actor, mutation, expectedFingerprint, result, options);
    return result;
  }

  private async storeConflict(actor: Actor, mutation: AsyncPortfolioCategoryMutation, expectedFingerprint: string, current: CategoryRow, options: TransactionOptions): Promise<AsyncSyncConflict> {
    const conflict: AsyncSyncConflict = { kind: 'conflict', mutationId: mutation.mutationId, code: 'STALE_VERSION', resourceId: mutation.resourceId, baseVersion: mutation.baseVersion, current: fromRow(current) };
    await this.storeMutation(actor, mutation, expectedFingerprint, conflict, options);
    return conflict;
  }
  private merge(current: CategoryRow | undefined, tenantId: string, ownerUserId: string, mutation: InternalCategoryMutation, timestamp: Date): CategoryRow {
    const payload = mutation.payload;
    if (current) return { ...current, slug: payload.slug ?? current.slug, nameZh: payload.nameZh ?? current.nameZh, description: payload.description ?? current.description, sortOrder: payload.sortOrder ?? current.sortOrder, visibility: payload.visibility ?? current.visibility, ...(mutation.transition === 'archive' ? { status: 'archived' as const, lifecycle: 'archived' as const } : {}), resourceVersion: increment(current.resourceVersion), updatedAt: timestamp };
    return { id: mutation.resourceId, tenantId, ownerUserId, slug: payload.slug ?? '', nameZh: payload.nameZh ?? '', description: payload.description ?? '', sortOrder: payload.sortOrder ?? 0, visibility: payload.visibility ?? 'private', status: 'active', lifecycle: mutation.transition === 'create-published' ? 'published' : 'draft', resourceVersion: '1', createdAt: timestamp, updatedAt: timestamp };
  }
  private async storeMutation(actor: Actor, mutation: AsyncPortfolioCategoryMutation, expectedFingerprint: string, result: AsyncPortfolioCategoryPushResult, options: TransactionOptions): Promise<void> {
    await this.models.mutations.create({ tenantId: actor.tenantId, actorUserId: actor.userId, mutationId: mutation.mutationId, fingerprint: expectedFingerprint, resultKind: result.kind === 'conflict' ? 'conflict' : 'applied', resultJson: JSON.stringify({ ...result, kind: result.kind === 'duplicate' ? 'applied' : result.kind }) }, options);
  }
  private replay(stored: MutationRow, expectedFingerprint: string): AsyncPortfolioCategoryPushResult {
    if (stored.fingerprint !== expectedFingerprint) throw new TrailsSyncInputError('mutationId不能用于不同的同步变更');
    const parsed = parseStoredResult(stored.resultJson);
    return parsed.kind === 'applied' ? { ...parsed, kind: 'duplicate' } : parsed;
  }
}

const parseStoredResult = (value: string): Exclude<AsyncPortfolioCategoryPushResult, AsyncSyncApplied & { kind: 'duplicate' }> => {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new TrailsSyncPersistenceError('同步mutation结果不是有效JSON'); }
  if (!isRecord(parsed)) throw new TrailsSyncPersistenceError('同步mutation包含无效结果');
  if (parsed.kind === 'applied' && typeof parsed.mutationId === 'string' && isCategory(parsed.resource)) return { kind: 'applied', mutationId: parsed.mutationId, resource: parsed.resource };
  if (parsed.kind === 'conflict' && typeof parsed.mutationId === 'string' && parsed.code === 'STALE_VERSION' && typeof parsed.resourceId === 'string' && (parsed.baseVersion === null || typeof parsed.baseVersion === 'string') && isCategory(parsed.current)) return { kind: 'conflict', mutationId: parsed.mutationId, code: 'STALE_VERSION', resourceId: parsed.resourceId, baseVersion: parsed.baseVersion, current: parsed.current };
  throw new TrailsSyncPersistenceError('同步mutation包含无效结果');
};

export class SequelizeTrailsSyncConnection implements TrailsSyncConnection {
  constructor(private readonly sequelize: TrailsSyncConnection) {}
  async transaction<T>(work: (transaction: TrailsSyncTransaction) => Promise<T>): Promise<T> { return this.sequelize.transaction(async (transaction) => work(transaction)); }
}

const sequelizeTransaction = (transaction: TrailsSyncTransaction): Transaction => {
  if (transaction instanceof Transaction) return transaction;
  throw new TrailsSyncPersistenceError('Sequelize适配器需要受管Sequelize事务');
};
const categoryRowFromAttributes = (value: ITrailsPortfolioCategoryTableAttributes): CategoryRow => {
  if (!value.createdAt || !value.updatedAt) throw new TrailsSyncPersistenceError('类别行缺少时间戳');
  return { ...value, resourceVersion: databaseDecimal(value.resourceVersion, 'resourceVersion'), createdAt: value.createdAt, updatedAt: value.updatedAt };
};
const mutationRowFromAttributes = (value: ITrailsSyncMutationTableAttributes): MutationRow => ({ tenantId: value.tenantId, actorUserId: value.actorUserId, mutationId: value.mutationId, fingerprint: value.fingerprint, resultKind: value.resultKind, resultJson: value.resultJson });
const changeRowFromAttributes = (value: ITrailsSyncChangeTableAttributes): ChangeRow => {
  if (!value.createdAt || value.cursor === undefined) throw new TrailsSyncPersistenceError('同步变更行缺少游标或时间戳');
  return { cursor: databaseDecimal(value.cursor, 'cursor'), resourceId: value.resourceId, resourceJson: value.resourceJson, createdAt: value.createdAt };
};

/** Concrete ports for the just-added Sequelize model classes. It is exported for future composition only. */
export const createSequelizeTrailsPortfolioCategorySyncModels = (models: { categories: ModelStatic<TrailsPortfolioCategoryTable>; changes: ModelStatic<TrailsSyncChangeTable>; mutations: ModelStatic<TrailsSyncMutationTable> }): TrailsPortfolioCategorySyncModels => ({
  categories: {
    async findByTenantResource(input, options) {
      const transaction = sequelizeTransaction(options.transaction);
      const row = await models.categories.findOne({ where: { tenantId: input.tenantId, id: input.resourceId }, transaction, lock: transaction.LOCK.UPDATE });
      return row ? categoryRowFromAttributes(row.get()) : undefined;
    },
    async findByOwnerSlug(input, options) {
      const transaction = sequelizeTransaction(options.transaction);
      const row = await models.categories.findOne({ where: input, transaction, lock: transaction.LOCK.UPDATE, attributes: ['id'] });
      return row ? { id: row.id } : undefined;
    },
    async create(row, options) { const saved = await models.categories.create(row, { transaction: sequelizeTransaction(options.transaction) }); return categoryRowFromAttributes(saved.get()); },
    async compareAndSwap(input, options) {
      const transaction = sequelizeTransaction(options.transaction);
      const [affected] = await models.categories.update(input.next, { where: { tenantId: input.tenantId, id: input.resourceId, resourceVersion: input.expectedVersion }, transaction });
      if (affected === 1) return { kind: 'updated', row: input.next };
      const current = await models.categories.findOne({ where: { tenantId: input.tenantId, id: input.resourceId }, transaction, lock: transaction.LOCK.UPDATE });
      return { kind: 'stale', ...(current ? { current: categoryRowFromAttributes(current.get()) } : {}) };
    },
    async listByOwner(input, options) {
      const where = input.publicOnly
        ? { tenantId: input.tenantId, ownerUserId: input.ownerUserId, visibility: 'public', status: 'active', lifecycle: 'published' }
        : { tenantId: input.tenantId, ownerUserId: input.ownerUserId };
      const rows = await models.categories.findAll({ where, order: [['sortOrder', 'ASC'], ['slug', 'ASC']], transaction: sequelizeTransaction(options.transaction) });
      return rows.map((row) => categoryRowFromAttributes(row.get()));
    },
    async findPublicByOwnerSlug(input, options) {
      const transaction = sequelizeTransaction(options.transaction);
      const result = await models.categories.findOne({ where: { ...input, visibility: 'public', status: 'active', lifecycle: 'published' }, transaction });
      return result ? categoryRowFromAttributes(result.get()) : undefined;
    },
  },
  changes: {
    async create(row, options) { const saved = await models.changes.create(row, { transaction: sequelizeTransaction(options.transaction) }); return { cursor: databaseDecimal(saved.cursor, 'cursor') }; },
    async listAfter(input, options) {
      const rows = await models.changes.findAll({ where: { tenantId: input.tenantId, ownerUserId: input.ownerUserId, cursor: { [Op.gt]: input.after } }, order: [['cursor', 'ASC']], limit: input.limit, transaction: sequelizeTransaction(options.transaction) });
      return rows.map((row) => changeRowFromAttributes(row.get()));
    },
    async latestCursor(input, options) {
      const row = await models.changes.findOne({ where: input, order: [['cursor', 'DESC']], limit: 1, transaction: sequelizeTransaction(options.transaction) });
      return row ? databaseDecimal(row.cursor, 'cursor') : undefined;
    },
  },
  mutations: {
    async findByActorMutation(input, options) { const row = await models.mutations.findOne({ where: input, transaction: sequelizeTransaction(options.transaction), lock: sequelizeTransaction(options.transaction).LOCK.UPDATE }); return row ? mutationRowFromAttributes(row.get()) : undefined; },
    async create(row, options) { await models.mutations.create(row, { transaction: sequelizeTransaction(options.transaction) }); },
  },
});
