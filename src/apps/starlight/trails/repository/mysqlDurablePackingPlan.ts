import { ModelStatic, Op, Transaction } from 'sequelize';
import { ITrailsDurableGearTableAttributes, TrailsDurableGearTable } from '../../../../db/mysql/models/trailsDurableGear';
import { ITrailsDurablePackingPlanItemTableAttributes, TrailsDurablePackingPlanItemTable } from '../../../../db/mysql/models/trailsDurablePackingPlanItem';
import { ITrailsDurablePackingPlanTableAttributes, TrailsDurablePackingPlanTable } from '../../../../db/mysql/models/trailsDurablePackingPlan';
import { Actor, DurablePackingPlan, DurablePackingPlanCreateInput, DurablePackingPlanItem, DurablePackingPlanStore, DurablePackingPlanUpdateInput } from '../types';
import { TrailsSyncInputError, TrailsSyncPersistenceError, TrailsSyncTransaction } from './mysqlPortfolioCategorySync';

type PlanRow = Omit<ITrailsDurablePackingPlanTableAttributes, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date };
type ItemRow = Omit<ITrailsDurablePackingPlanItemTableAttributes, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date };
type GearRow = Omit<ITrailsDurableGearTableAttributes, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date };
type Options = { transaction: TrailsSyncTransaction };
const maxUnsignedBigInt = BigInt('18446744073709551615');
export class TrailsDurablePackingPlanStaleVersionError extends Error {}
export interface DurablePackingPlanModels {
  createPlan(row: PlanRow, options: Options): Promise<PlanRow>;
  findPlan(input: { tenantId: string; id: string }, options: Options): Promise<PlanRow | undefined>;
  listPlans(input: { tenantId: string; ownerUserId: string }, options: Options): Promise<PlanRow[]>;
  listItems(input: { tenantId: string; planIds: string[] }, options: Options): Promise<ItemRow[]>;
  lockGear(input: { tenantId: string; ownerUserId: string; ids: string[] }, options: Options): Promise<GearRow[]>;
  replaceItems(input: { tenantId: string; planId: string; items: ItemRow[] }, options: Options): Promise<void>;
  compareAndSwapPlan(input: { tenantId: string; id: string; expectedVersion: string; next: PlanRow }, options: Options): Promise<PlanRow | undefined>;
}
const text = (value: unknown, label: string, maximum: number): string => { if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new TrailsSyncInputError(`${label}无效`); return value.trim(); };
const version = (value: unknown): string => { if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw new TrailsSyncInputError('resourceVersion必须是规范十进制字符串'); return value; };
const gearIds = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) throw new TrailsSyncInputError('gearIds必须是1至100项数组');
  const ids = value.map((id, index) => text(id, `gearIds[${index}]`, 160));
  if (new Set(ids).size !== ids.length) throw new TrailsSyncInputError('gearIds不能包含重复装备');
  return ids;
};
const fromRows = (plan: PlanRow, items: ItemRow[]): DurablePackingPlan => {
  const ordered: DurablePackingPlanItem[] = items.sort((left, right) => left.sortOrder - right.sortOrder || left.gearId.localeCompare(right.gearId)).map((item) => ({ gearId: item.gearId, snapshotWeightGrams: item.snapshotWeightGrams, sortOrder: item.sortOrder }));
  return { id: plan.id, tenantId: plan.tenantId, ownerUserId: plan.ownerUserId, name: plan.name, visibility: 'private', lifecycle: 'draft', resourceVersion: plan.resourceVersion, createdAt: plan.createdAt.toISOString(), updatedAt: plan.updatedAt.toISOString(), items: ordered, snapshotWeightGrams: ordered.reduce((total, item) => total + item.snapshotWeightGrams, 0) };
};

export class MySqlDurablePackingPlanRepository implements DurablePackingPlanStore {
  constructor(private readonly connection: { transaction<T>(work: (transaction: TrailsSyncTransaction) => Promise<T>): Promise<T> }, private readonly models: DurablePackingPlanModels, private readonly now: () => Date = () => new Date()) {}
  async create(actor: Actor, input: DurablePackingPlanCreateInput): Promise<DurablePackingPlan> {
    const tenantId = text(actor.tenantId, 'tenantId', 64); const ownerUserId = text(actor.userId, 'ownerUserId', 64); const ids = gearIds(input.gearIds); const timestamp = this.now();
    const plan: PlanRow = { id: text(input.id, 'id', 160), tenantId, ownerUserId, name: text(input.name, 'name', 160), visibility: 'private', lifecycle: 'draft', resourceVersion: '1', createdAt: timestamp, updatedAt: timestamp };
    return this.connection.transaction(async (transaction) => {
      const items = this.snapshotItems(tenantId, ownerUserId, ids, await this.models.lockGear({ tenantId, ownerUserId, ids: [...ids].sort() }, { transaction }), plan.id, timestamp);
      const saved = await this.models.createPlan(plan, { transaction });
      await this.models.replaceItems({ tenantId, planId: plan.id, items }, { transaction });
      return fromRows(saved, items);
    });
  }
  async update(actor: Actor, input: DurablePackingPlanUpdateInput): Promise<DurablePackingPlan> {
    const tenantId = text(actor.tenantId, 'tenantId', 64); const ownerUserId = text(actor.userId, 'ownerUserId', 64); const planId = text(input.id, 'id', 160); const expectedVersion = version(input.resourceVersion); const ids = gearIds(input.gearIds); const name = text(input.name, 'name', 160);
    return this.connection.transaction(async (transaction) => {
      const current = await this.models.findPlan({ tenantId, id: planId }, { transaction });
      if (!current || current.ownerUserId !== ownerUserId) throw new TrailsSyncInputError('装包方案不属于当前账号');
      if (current.resourceVersion !== expectedVersion) throw new TrailsDurablePackingPlanStaleVersionError('装包方案版本已过期');
      if (BigInt(current.resourceVersion) >= maxUnsignedBigInt) throw new TrailsSyncInputError('装包方案版本已达到存储上限');
      const timestamp = this.now();
      const items = this.snapshotItems(tenantId, ownerUserId, ids, await this.models.lockGear({ tenantId, ownerUserId, ids: [...ids].sort() }, { transaction }), planId, timestamp);
      const next = { ...current, name, visibility: 'private' as const, lifecycle: 'draft' as const, resourceVersion: (BigInt(current.resourceVersion) + BigInt(1)).toString(), updatedAt: timestamp };
      const saved = await this.models.compareAndSwapPlan({ tenantId, id: planId, expectedVersion, next }, { transaction });
      if (!saved) throw new TrailsDurablePackingPlanStaleVersionError('装包方案版本已过期');
      await this.models.replaceItems({ tenantId, planId, items }, { transaction });
      return fromRows(saved, items);
    });
  }
  async listWorkspace(actor: Actor): Promise<DurablePackingPlan[]> {
    const tenantId = text(actor.tenantId, 'tenantId', 64); const ownerUserId = text(actor.userId, 'ownerUserId', 64);
    return this.connection.transaction(async (transaction) => { const plans = await this.models.listPlans({ tenantId, ownerUserId }, { transaction }); const items = await this.models.listItems({ tenantId, planIds: plans.map((plan) => plan.id) }, { transaction }); return plans.map((plan) => fromRows(plan, items.filter((item) => item.planId === plan.id))); });
  }
  private snapshotItems(tenantId: string, ownerUserId: string, ids: string[], gear: GearRow[], planId: string, timestamp: Date): ItemRow[] {
    const selected = new Map(gear.map((item) => [item.id, item]));
    if (selected.size !== ids.length) throw new TrailsSyncInputError('装备不存在');
    return ids.map((gearId, sortOrder) => { const item = selected.get(gearId); if (!item || item.ownerUserId !== ownerUserId) throw new TrailsSyncInputError('装备不可用'); if (!item.active) throw new TrailsSyncInputError('装备已停用'); return { tenantId, planId, gearId, snapshotWeightGrams: item.weightGrams, sortOrder, createdAt: timestamp, updatedAt: timestamp }; });
  }
}

const sequelizeTransaction = (transaction: TrailsSyncTransaction): Transaction => { if (transaction instanceof Transaction) return transaction; throw new TrailsSyncPersistenceError('Sequelize adapter requires a managed transaction'); };
const databaseVersion = (value: unknown): string => { if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) return value; if (typeof value === 'bigint' && value >= BigInt(0)) return value.toString(); if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value); throw new TrailsSyncPersistenceError('packing plan resource version is invalid'); };
const planRow = (value: ITrailsDurablePackingPlanTableAttributes): PlanRow => { if (!value.createdAt || !value.updatedAt) throw new TrailsSyncPersistenceError('packing plan row is invalid'); return { ...value, resourceVersion: databaseVersion(value.resourceVersion), createdAt: value.createdAt, updatedAt: value.updatedAt }; };
const itemRow = (value: ITrailsDurablePackingPlanItemTableAttributes): ItemRow => { if (!value.createdAt || !value.updatedAt || !Number.isSafeInteger(Number(value.snapshotWeightGrams)) || !Number.isSafeInteger(Number(value.sortOrder))) throw new TrailsSyncPersistenceError('packing plan item row is invalid'); return { ...value, snapshotWeightGrams: Number(value.snapshotWeightGrams), sortOrder: Number(value.sortOrder), createdAt: value.createdAt, updatedAt: value.updatedAt }; };
const gearRow = (value: ITrailsDurableGearTableAttributes): GearRow => { if (!value.createdAt || !value.updatedAt || !Number.isSafeInteger(Number(value.weightGrams))) throw new TrailsSyncPersistenceError('gear row is invalid'); return { ...value, weightGrams: Number(value.weightGrams), createdAt: value.createdAt, updatedAt: value.updatedAt }; };
export const createSequelizeDurablePackingPlanModels = (plans: ModelStatic<TrailsDurablePackingPlanTable>, items: ModelStatic<TrailsDurablePackingPlanItemTable>, gear: ModelStatic<TrailsDurableGearTable>): DurablePackingPlanModels => ({
  async createPlan(input, options) { return planRow((await plans.create(input, { transaction: sequelizeTransaction(options.transaction) })).get()); },
  async findPlan(input, options) { const transaction = sequelizeTransaction(options.transaction); const found = await plans.findOne({ where: input, transaction, lock: transaction.LOCK.UPDATE }); return found ? planRow(found.get()) : undefined; },
  async listPlans(input, options) { return (await plans.findAll({ where: input, order: [['updatedAt', 'DESC'], ['id', 'ASC']], transaction: sequelizeTransaction(options.transaction) })).map((item) => planRow(item.get())); },
  async listItems(input, options) { if (input.planIds.length === 0) return []; return (await items.findAll({ where: { tenantId: input.tenantId, planId: { [Op.in]: input.planIds } }, order: [['planId', 'ASC'], ['sortOrder', 'ASC'], ['gearId', 'ASC']], transaction: sequelizeTransaction(options.transaction) })).map((item) => itemRow(item.get())); },
  async lockGear(input, options) { if (input.ids.length === 0) return []; const transaction = sequelizeTransaction(options.transaction); return (await gear.findAll({ where: { tenantId: input.tenantId, ownerUserId: input.ownerUserId, id: { [Op.in]: input.ids } }, order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE })).map((item) => gearRow(item.get())); },
  async replaceItems(input, options) { const transaction = sequelizeTransaction(options.transaction); await items.destroy({ where: { tenantId: input.tenantId, planId: input.planId }, transaction }); await items.bulkCreate(input.items, { transaction }); },
  async compareAndSwapPlan(input, options) { const transaction = sequelizeTransaction(options.transaction); const [affected] = await plans.update(input.next, { where: { tenantId: input.tenantId, id: input.id, resourceVersion: input.expectedVersion }, transaction }); return affected === 1 ? input.next : undefined; },
});
