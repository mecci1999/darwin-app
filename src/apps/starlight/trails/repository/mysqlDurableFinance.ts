import { createHash, randomUUID } from 'crypto';
import { ModelStatic, Op, Transaction } from 'sequelize';
import { ITrailsDurableFinanceTableAttributes, TrailsDurableFinanceTable } from '../../../../db/mysql/models/trailsDurableFinance';
import { ITrailsDurableFinanceDeletionAuditTableAttributes, TrailsDurableFinanceDeletionAuditTable } from '../../../../db/mysql/models/trailsDurableFinanceDeletionAudit';
import { ITrailsDurableFinanceBalanceSnapshotTableAttributes, TrailsDurableFinanceBalanceSnapshotTable } from '../../../../db/mysql/models/trailsDurableFinanceBalanceSnapshot';
import { Actor, DurableFinanceBalanceRecordInput, DurableFinanceBalanceSnapshot, DurableFinanceCreateInput, DurableFinanceDisposalResult, DurableFinanceEntry, DurableFinanceStore, DurableFinanceUpdateInput } from '../types';
import { TrailsSyncInputError, TrailsSyncPersistenceError, TrailsSyncTransaction } from './mysqlPortfolioCategorySync';

type Row = Omit<ITrailsDurableFinanceTableAttributes, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date };
type AuditRow = Omit<ITrailsDurableFinanceDeletionAuditTableAttributes, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date };
type SnapshotRow = Omit<ITrailsDurableFinanceBalanceSnapshotTableAttributes, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date };
type Options = { transaction: TrailsSyncTransaction };
const maxUnsignedBigInt = BigInt('18446744073709551615');
const policyVersion = 'trails-finance-retention-v2-10y';
export class TrailsDurableFinanceStaleVersionError extends Error {}
export interface DurableFinanceModel { create(row: Row, options: Options): Promise<Row>; find(input: { tenantId: string; id: string }, options: Options): Promise<Row | undefined>; list(input: { tenantId: string; ownerUserId: string }, options: Options): Promise<Row[]>; listEligible(input: { tenantId: string; ownerUserId: string; eligibleAt: Date }, options: Options): Promise<Row[]>; compareAndSwap(input: { tenantId: string; id: string; expectedVersion: string; next: Row }, options: Options): Promise<Row | undefined>; }
export interface DurableFinanceDeletionAuditModel { create(row: AuditRow, options: Options): Promise<AuditRow>; }
export interface DurableFinanceBalanceSnapshotModel { create(row: SnapshotRow, options: Options): Promise<SnapshotRow>; listCurrent(input: { tenantId: string; ownerUserId: string; currency?: string }, options: Options): Promise<SnapshotRow[]>; listEligible(input: { tenantId: string; ownerUserId: string; eligibleAt: Date }, options: Options): Promise<SnapshotRow[]>; compareAndSwap(input: { tenantId: string; id: string; expectedVersion: string; next: SnapshotRow }, options: Options): Promise<SnapshotRow | undefined>; }
const text = (value: unknown, label: string, maximum: number): string => { if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new TrailsSyncInputError(`${label}无效`); return value.trim(); };
const version = (value: unknown): string => { if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw new TrailsSyncInputError('resourceVersion必须是规范十进制字符串'); return value; };
const occurredOn = (value: unknown): { value: string; year: number } => { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) throw new TrailsSyncInputError('occurredOn必须是有效ISO日期'); return { value, year: Number(value.slice(0, 4)) }; };
const amount = (value: unknown): number => { if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TrailsSyncInputError('amountCents必须是安全整数的最小货币单位'); return value; };
const balance = (value: unknown): number => { if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TrailsSyncInputError('balanceCents必须是安全整数的最小货币单位'); return value; };
const currency = (value: unknown): string => { if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) throw new TrailsSyncInputError('currency必须是3位大写ISO货币代码'); return value; };
export const retentionExpiresAtForCalendarFinancialYear = (year: number): Date => new Date(Date.UTC(year + 11, 0, 1));
const scopeDigest = (actor: Actor): string => createHash('sha256').update(`${actor.tenantId}\u0000${actor.userId}`).digest('hex');
const fromRow = (row: Row): DurableFinanceEntry => ({ id: row.id, tenantId: row.tenantId, ownerUserId: row.ownerUserId, ...(row.disposedAt ? {} : { occurredOn: row.occurredOn, category: row.category, amountCents: row.amountCents, currency: row.currency }), calendarFinancialYear: row.calendarFinancialYear, retentionExpiresAt: row.retentionExpiresAt.toISOString(), ...(row.disposedAt ? { disposedAt: row.disposedAt.toISOString() } : {}), visibility: 'private', lifecycle: 'draft', resourceVersion: row.resourceVersion, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
const snapshotFromRow = (row: SnapshotRow): DurableFinanceBalanceSnapshot => ({ id: row.id, tenantId: row.tenantId, ownerUserId: row.ownerUserId, ...(row.disposedAt ? {} : { observedAt: row.observedAt?.toISOString(), balanceCents: row.balanceCents, currency: row.currency }), calendarFinancialYear: row.calendarFinancialYear, retentionExpiresAt: row.retentionExpiresAt.toISOString(), ...(row.disposedAt ? { disposedAt: row.disposedAt.toISOString() } : {}), visibility: 'private', lifecycle: 'draft', resourceVersion: row.resourceVersion, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });

export class MySqlDurableFinanceRepository implements DurableFinanceStore {
  constructor(private readonly connection: { transaction<T>(work: (transaction: TrailsSyncTransaction) => Promise<T>): Promise<T> }, private readonly finance: DurableFinanceModel, private readonly audits: DurableFinanceDeletionAuditModel, private readonly snapshots: DurableFinanceBalanceSnapshotModel, private readonly now: () => Date = () => new Date()) {}
  async create(actor: Actor, input: DurableFinanceCreateInput): Promise<DurableFinanceEntry> {
    const timestamp = this.now(); const occurred = occurredOn(input.occurredOn);
    const row: Row = { id: text(input.id, 'id', 160), tenantId: text(actor.tenantId, 'tenantId', 64), ownerUserId: text(actor.userId, 'ownerUserId', 64), occurredOn: occurred.value, category: text(input.category, 'category', 160), amountCents: amount(input.amountCents), currency: currency(input.currency), calendarFinancialYear: occurred.year, retentionExpiresAt: retentionExpiresAtForCalendarFinancialYear(occurred.year), visibility: 'private', lifecycle: 'draft', resourceVersion: '1', createdAt: timestamp, updatedAt: timestamp };
    return this.connection.transaction(async (transaction) => fromRow(await this.finance.create(row, { transaction })));
  }
  async update(actor: Actor, input: DurableFinanceUpdateInput): Promise<DurableFinanceEntry> {
    const tenantId = text(actor.tenantId, 'tenantId', 64); const ownerUserId = text(actor.userId, 'ownerUserId', 64); const id = text(input.id, 'id', 160); const expectedVersion = version(input.resourceVersion); const occurred = occurredOn(input.occurredOn);
    return this.connection.transaction(async (transaction) => {
      const current = await this.finance.find({ tenantId, id }, { transaction });
      if (!current || current.ownerUserId !== ownerUserId) throw new TrailsSyncInputError('账目不属于当前账号');
      if (current.resourceVersion !== expectedVersion) throw new TrailsDurableFinanceStaleVersionError('账目版本已过期');
      if (current.disposedAt) throw new TrailsSyncInputError('账目已按保留策略处置');
      if (occurred.year !== current.calendarFinancialYear) throw new TrailsSyncInputError('不能跨财年更新账目；保留到期时间不可变');
      if (BigInt(current.resourceVersion) >= maxUnsignedBigInt) throw new TrailsSyncInputError('账目版本已达到存储上限');
      const next: Row = { ...current, occurredOn: occurred.value, category: text(input.category, 'category', 160), amountCents: amount(input.amountCents), currency: currency(input.currency), resourceVersion: (BigInt(current.resourceVersion) + BigInt(1)).toString(), updatedAt: this.now() };
      const saved = await this.finance.compareAndSwap({ tenantId, id, expectedVersion, next }, { transaction });
      if (!saved) throw new TrailsDurableFinanceStaleVersionError('账目版本已过期');
      return fromRow(saved);
    });
  }
  async listWorkspace(actor: Actor): Promise<DurableFinanceEntry[]> { const tenantId = text(actor.tenantId, 'tenantId', 64); const ownerUserId = text(actor.userId, 'ownerUserId', 64); return this.connection.transaction(async (transaction) => (await this.finance.list({ tenantId, ownerUserId }, { transaction })).map(fromRow)); }
  async recordBalance(actor: Actor, input: DurableFinanceBalanceRecordInput): Promise<DurableFinanceBalanceSnapshot> {
    const timestamp = this.now(); const tenantId = text(actor.tenantId, 'tenantId', 64); const ownerUserId = text(actor.userId, 'ownerUserId', 64);
    const snapshot: SnapshotRow = { id: text(input.id, 'id', 160), tenantId, ownerUserId, observedAt: timestamp, balanceCents: balance(input.balanceCents), currency: currency(input.currency), calendarFinancialYear: timestamp.getUTCFullYear(), retentionExpiresAt: retentionExpiresAtForCalendarFinancialYear(timestamp.getUTCFullYear()), visibility: 'private', lifecycle: 'draft', resourceVersion: '1', createdAt: timestamp, updatedAt: timestamp };
    return this.connection.transaction(async (transaction) => snapshotFromRow(await this.snapshots.create(snapshot, { transaction })));
  }
  async currentBalances(actor: Actor, requestedCurrency?: string): Promise<DurableFinanceBalanceSnapshot[]> {
    const tenantId = text(actor.tenantId, 'tenantId', 64); const ownerUserId = text(actor.userId, 'ownerUserId', 64); const requested = requestedCurrency === undefined ? undefined : currency(requestedCurrency);
    return this.connection.transaction(async (transaction) => (await this.snapshots.listCurrent({ tenantId, ownerUserId, currency: requested }, { transaction })).map(snapshotFromRow));
  }
  async disposeEligible(actor: Actor): Promise<DurableFinanceDisposalResult> {
    const tenantId = text(actor.tenantId, 'tenantId', 64); const ownerUserId = text(actor.userId, 'ownerUserId', 64); const executedAt = this.now();
    return this.connection.transaction(async (transaction) => {
      const eligible = await this.finance.listEligible({ tenantId, ownerUserId, eligibleAt: executedAt }, { transaction });
      const eligibleSnapshots = await this.snapshots.listEligible({ tenantId, ownerUserId, eligibleAt: executedAt }, { transaction });
      for (const current of eligible) {
        if (BigInt(current.resourceVersion) >= maxUnsignedBigInt) throw new TrailsSyncInputError('账目版本已达到存储上限');
        const next: Row = { ...current, occurredOn: undefined, category: undefined, amountCents: undefined, currency: undefined, disposedAt: executedAt, resourceVersion: (BigInt(current.resourceVersion) + BigInt(1)).toString(), updatedAt: executedAt };
        if (!await this.finance.compareAndSwap({ tenantId, id: current.id, expectedVersion: current.resourceVersion, next }, { transaction })) throw new TrailsDurableFinanceStaleVersionError('账目版本已过期');
      }
      for (const current of eligibleSnapshots) {
        if (BigInt(current.resourceVersion) >= maxUnsignedBigInt) throw new TrailsSyncInputError('余额快照版本已达到存储上限');
        const next: SnapshotRow = { ...current, observedAt: undefined, balanceCents: undefined, currency: undefined, disposedAt: executedAt, resourceVersion: (BigInt(current.resourceVersion) + BigInt(1)).toString(), updatedAt: executedAt };
        if (!await this.snapshots.compareAndSwap({ tenantId, id: current.id, expectedVersion: current.resourceVersion, next }, { transaction })) throw new TrailsDurableFinanceStaleVersionError('余额快照版本已过期');
      }
      const disposedCount = eligible.length + eligibleSnapshots.length;
      const outcome = disposedCount > 0 ? 'disposed' as const : 'nothing-eligible' as const;
      const audit: AuditRow = { eventId: randomUUID(), eventType: 'retention-disposal', scopeDigest: scopeDigest(actor), policyVersion, eligibleAt: executedAt, executedAt, outcome, createdAt: executedAt, updatedAt: executedAt };
      await this.audits.create(audit, { transaction });
      return { outcome, eligibleAt: executedAt.toISOString(), executedAt: executedAt.toISOString(), disposedCount };
    });
  }
}
const sequelizeTransaction = (transaction: TrailsSyncTransaction): Transaction => { if (transaction instanceof Transaction) return transaction; throw new TrailsSyncPersistenceError('Sequelize adapter requires a managed transaction'); };
const databaseVersion = (value: unknown): string => { if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) return value; if (typeof value === 'bigint' && value >= BigInt(0)) return value.toString(); if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value); throw new TrailsSyncPersistenceError('finance resource version is invalid'); };
const row = (attributes: ITrailsDurableFinanceTableAttributes): Row => { if (!attributes.createdAt || !attributes.updatedAt || !attributes.retentionExpiresAt || !Number.isInteger(attributes.calendarFinancialYear)) throw new TrailsSyncPersistenceError('finance row is invalid'); return { ...attributes, amountCents: attributes.amountCents == null ? undefined : Number(attributes.amountCents), resourceVersion: databaseVersion(attributes.resourceVersion), createdAt: attributes.createdAt, updatedAt: attributes.updatedAt }; };
const snapshotRow = (attributes: ITrailsDurableFinanceBalanceSnapshotTableAttributes): SnapshotRow => { if (!attributes.createdAt || !attributes.updatedAt || !attributes.retentionExpiresAt || !Number.isInteger(attributes.calendarFinancialYear)) throw new TrailsSyncPersistenceError('finance balance snapshot row is invalid'); return { ...attributes, balanceCents: attributes.balanceCents == null ? undefined : Number(attributes.balanceCents), resourceVersion: databaseVersion(attributes.resourceVersion), createdAt: attributes.createdAt, updatedAt: attributes.updatedAt }; };
export const createSequelizeDurableFinanceModels = (finance: ModelStatic<TrailsDurableFinanceTable>, audits: ModelStatic<TrailsDurableFinanceDeletionAuditTable>, snapshots: ModelStatic<TrailsDurableFinanceBalanceSnapshotTable>): { finance: DurableFinanceModel; audits: DurableFinanceDeletionAuditModel; snapshots: DurableFinanceBalanceSnapshotModel } => ({
  finance: { async create(input, options) { return row((await finance.create(input, { transaction: sequelizeTransaction(options.transaction) })).get()); }, async find(input, options) { const transaction = sequelizeTransaction(options.transaction); const result = await finance.findOne({ where: input, transaction, lock: transaction.LOCK.UPDATE }); return result ? row(result.get()) : undefined; }, async list(input, options) { return (await finance.findAll({ where: input, order: [['updatedAt', 'DESC'], ['id', 'ASC']], transaction: sequelizeTransaction(options.transaction) })).map((result) => row(result.get())); }, async listEligible(input, options) { const transaction = sequelizeTransaction(options.transaction); return (await finance.findAll({ where: { tenantId: input.tenantId, ownerUserId: input.ownerUserId, disposedAt: { [Op.is]: null }, retentionExpiresAt: { [Op.lte]: input.eligibleAt } }, transaction, lock: transaction.LOCK.UPDATE })).map((result) => row(result.get())); }, async compareAndSwap(input, options) { const transaction = sequelizeTransaction(options.transaction); const [affected] = await finance.update(input.next, { where: { tenantId: input.tenantId, id: input.id, resourceVersion: input.expectedVersion }, transaction }); return affected === 1 ? input.next : undefined; } },
  audits: { async create(input, options) { return (await audits.create(input, { transaction: sequelizeTransaction(options.transaction) })).get() as AuditRow; } },
  snapshots: { async create(input, options) { return snapshotRow((await snapshots.create(input, { transaction: sequelizeTransaction(options.transaction) })).get()); }, async listCurrent(input, options) { const transaction = sequelizeTransaction(options.transaction); const where = { tenantId: input.tenantId, ownerUserId: input.ownerUserId, disposedAt: { [Op.is]: null }, ...(input.currency === undefined ? {} : { currency: input.currency }) }; const rows = await snapshots.findAll({ where, order: [['currency', 'ASC'], ['observedAt', 'DESC'], ['id', 'DESC']], transaction }); const current = new Map<string, SnapshotRow>(); for (const result of rows) { const currentRow = snapshotRow(result.get()); if (currentRow.currency && !current.has(currentRow.currency)) current.set(currentRow.currency, currentRow); } return [...current.values()]; }, async listEligible(input, options) { const transaction = sequelizeTransaction(options.transaction); return (await snapshots.findAll({ where: { tenantId: input.tenantId, ownerUserId: input.ownerUserId, disposedAt: { [Op.is]: null }, retentionExpiresAt: { [Op.lte]: input.eligibleAt } }, transaction, lock: transaction.LOCK.UPDATE })).map((result) => snapshotRow(result.get())); }, async compareAndSwap(input, options) { const transaction = sequelizeTransaction(options.transaction); const [affected] = await snapshots.update(input.next, { where: { tenantId: input.tenantId, id: input.id, resourceVersion: input.expectedVersion }, transaction }); return affected === 1 ? input.next : undefined; } },
});
