import { ModelStatic, Transaction } from 'sequelize';
import { ITrailsDurableGearTableAttributes, TrailsDurableGearTable } from 'db/mysql/models/trailsDurableGear';
import { Actor, DurableGearCreateInput, DurableGearDeactivateInput, DurableGearItem, DurableGearStore, DurableGearUpdateInput } from '../types';
import { TrailsSyncInputError, TrailsSyncPersistenceError, TrailsSyncTransaction } from './mysqlPortfolioCategorySync';

type Row = Omit<ITrailsDurableGearTableAttributes, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date };
type Options = { transaction: TrailsSyncTransaction };
const maxUnsignedBigInt = BigInt('18446744073709551615');
const maxQuantity = 1000000;
export class TrailsDurableGearStaleVersionError extends Error {}
export interface DurableGearModel { create(row: Row, options: Options): Promise<Row>; find(input: { tenantId: string; id: string }, options: Options): Promise<Row | undefined>; list(input: { tenantId: string; ownerUserId: string }, options: Options): Promise<Row[]>; compareAndSwap(input: { tenantId: string; id: string; expectedVersion: string; next: Row }, options: Options): Promise<Row | undefined>; }
const text = (value: unknown, label: string, maximum: number): string => { if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new TrailsSyncInputError(`${label}无效`); return value.trim(); };
const version = (value: unknown): string => { if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw new TrailsSyncInputError('resourceVersion必须是规范十进制字符串'); return value; };
const weight = (value: unknown): number => { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 10000000) throw new TrailsSyncInputError('weightGrams必须是合理的非负整数'); return value; };
const quantity = (value: unknown): number => { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maxQuantity) throw new TrailsSyncInputError(`quantity必须是1至${maxQuantity}的整数`); return value; };
const fromRow = (row: Row): DurableGearItem => ({ id: row.id, tenantId: row.tenantId, ownerUserId: row.ownerUserId, name: row.name, weightGrams: row.weightGrams, quantity: row.quantity, active: row.active, visibility: 'private', lifecycle: 'draft', resourceVersion: row.resourceVersion, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });

export class MySqlDurableGearRepository implements DurableGearStore {
  constructor(private readonly connection: { transaction<T>(work: (transaction: TrailsSyncTransaction) => Promise<T>): Promise<T> }, private readonly gear: DurableGearModel, private readonly now: () => Date = () => new Date()) {}
  async create(actor: Actor, input: DurableGearCreateInput): Promise<DurableGearItem> {
    const timestamp = this.now();
    const row: Row = { id: text(input.id, 'id', 160), tenantId: text(actor.tenantId, 'tenantId', 64), ownerUserId: text(actor.userId, 'ownerUserId', 64), name: text(input.name, 'name', 160), weightGrams: weight(input.weightGrams), quantity: quantity(input.quantity), active: true, visibility: 'private', lifecycle: 'draft', resourceVersion: '1', createdAt: timestamp, updatedAt: timestamp };
    return this.connection.transaction(async (transaction) => fromRow(await this.gear.create(row, { transaction })));
  }
  async update(actor: Actor, input: DurableGearUpdateInput): Promise<DurableGearItem> { return this.mutate(actor, input.id, input.resourceVersion, (current) => ({ ...current, name: text(input.name, 'name', 160), weightGrams: weight(input.weightGrams), quantity: quantity(input.quantity) })); }
  async deactivate(actor: Actor, input: DurableGearDeactivateInput): Promise<DurableGearItem> { return this.mutate(actor, input.id, input.resourceVersion, (current) => ({ ...current, active: false })); }
  async listWorkspace(actor: Actor): Promise<DurableGearItem[]> { const tenantId = text(actor.tenantId, 'tenantId', 64); const ownerUserId = text(actor.userId, 'ownerUserId', 64); return this.connection.transaction(async (transaction) => (await this.gear.list({ tenantId, ownerUserId }, { transaction })).map(fromRow)); }
  private async mutate(actor: Actor, id: unknown, suppliedVersion: unknown, apply: (current: Row) => Row): Promise<DurableGearItem> {
    const tenantId = text(actor.tenantId, 'tenantId', 64); const ownerUserId = text(actor.userId, 'ownerUserId', 64); const gearId = text(id, 'id', 160); const expectedVersion = version(suppliedVersion);
    return this.connection.transaction(async (transaction) => {
      const current = await this.gear.find({ tenantId, id: gearId }, { transaction });
      if (!current || current.ownerUserId !== ownerUserId) throw new TrailsSyncInputError('装备不属于当前账号');
      if (current.resourceVersion !== expectedVersion) throw new TrailsDurableGearStaleVersionError('装备版本已过期');
      if (!current.active) throw new TrailsSyncInputError('装备已停用');
      if (BigInt(current.resourceVersion) >= maxUnsignedBigInt) throw new TrailsSyncInputError('装备版本已达到存储上限');
      const next = { ...apply(current), resourceVersion: (BigInt(current.resourceVersion) + BigInt(1)).toString(), updatedAt: this.now() };
      const saved = await this.gear.compareAndSwap({ tenantId, id: current.id, expectedVersion, next }, { transaction });
      if (!saved) throw new TrailsDurableGearStaleVersionError('装备版本已过期');
      return fromRow(saved);
    });
  }
}

const sequelizeTransaction = (transaction: TrailsSyncTransaction): Transaction => { if (transaction instanceof Transaction) return transaction; throw new TrailsSyncPersistenceError('Sequelize adapter requires a managed transaction'); };
const databaseVersion = (value: unknown): string => { if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) return value; if (typeof value === 'bigint' && value >= BigInt(0)) return value.toString(); if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value); throw new TrailsSyncPersistenceError('gear resource version is invalid'); };
const row = (attributes: ITrailsDurableGearTableAttributes): Row => { if (!attributes.createdAt || !attributes.updatedAt || !Number.isSafeInteger(Number(attributes.weightGrams)) || !Number.isSafeInteger(Number(attributes.quantity))) throw new TrailsSyncPersistenceError('gear row is invalid'); return { ...attributes, weightGrams: Number(attributes.weightGrams), quantity: Number(attributes.quantity), resourceVersion: databaseVersion(attributes.resourceVersion), createdAt: attributes.createdAt, updatedAt: attributes.updatedAt }; };
export const createSequelizeDurableGearModel = (model: ModelStatic<TrailsDurableGearTable>): DurableGearModel => ({
  async create(input, options) { return row((await model.create(input, { transaction: sequelizeTransaction(options.transaction) })).get()); },
  async find(input, options) { const transaction = sequelizeTransaction(options.transaction); const result = await model.findOne({ where: input, transaction, lock: transaction.LOCK.UPDATE }); return result ? row(result.get()) : undefined; },
  async list(input, options) { return (await model.findAll({ where: input, order: [['updatedAt', 'DESC'], ['id', 'ASC']], transaction: sequelizeTransaction(options.transaction) })).map((result) => row(result.get())); },
  async compareAndSwap(input, options) { const transaction = sequelizeTransaction(options.transaction); const [affected] = await model.update(input.next, { where: { tenantId: input.tenantId, id: input.id, resourceVersion: input.expectedVersion }, transaction }); return affected === 1 ? input.next : undefined; },
});
