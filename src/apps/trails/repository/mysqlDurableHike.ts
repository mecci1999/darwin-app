import { ModelStatic, Transaction } from 'sequelize';
import { ITrailsDurableHikeTableAttributes, TrailsDurableHikeTable } from 'db/mysql/models/trailsDurableHike';
import { Actor, DurableHike, DurableHikeCreateInput, DurableHikeStore } from '../types';
import { TrailsSyncInputError, TrailsSyncPersistenceError, TrailsSyncTransaction } from './mysqlPortfolioCategorySync';

type Row = Omit<ITrailsDurableHikeTableAttributes, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date };
type Options = { transaction: TrailsSyncTransaction };
export interface DurableHikeModel { create(row: Row, options: Options): Promise<Row>; list(input: { tenantId: string; ownerUserId: string }, options: Options): Promise<Row[]>; }
const text = (value: unknown, label: string, maximum: number): string => { if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new TrailsSyncInputError(`${label}无效`); return value.trim(); };
const optional = (value: unknown, label: string, maximum: number): string | undefined => value === undefined ? undefined : text(value, label, maximum);
const nonNegative = (value: unknown, label: string): number | undefined => { if (value === undefined) return undefined; if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10000000) throw new TrailsSyncInputError(`${label}必须是有限的非负数字`); return value; };
const timestamp = (value: unknown): Date => { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) throw new TrailsSyncInputError('startedAt必须是规范UTC ISO时间'); const parsed = new Date(value); if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) throw new TrailsSyncInputError('startedAt必须是有效UTC ISO时间'); return parsed; };
const fromRow = (row: Row): DurableHike => ({ id: row.id, tenantId: row.tenantId, ownerUserId: row.ownerUserId, title: row.title, startedAt: row.startedAt.toISOString(), ...(row.distanceKm == null ? {} : { distanceKm: row.distanceKm }), ...(row.elevationGainM == null ? {} : { elevationGainM: row.elevationGainM }), route: { provider: row.routeProvider, externalId: row.routeExternalId, label: row.routeLabel }, ...(row.privateGeometry == null ? {} : { privateGeometry: row.privateGeometry }), visibility: 'private', lifecycle: 'draft', resourceVersion: row.resourceVersion, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });

export class MySqlDurableHikeRepository implements DurableHikeStore {
  constructor(private readonly connection: { transaction<T>(work: (transaction: TrailsSyncTransaction) => Promise<T>): Promise<T> }, private readonly hikes: DurableHikeModel, private readonly now: () => Date = () => new Date()) {}
  async create(actor: Actor, input: DurableHikeCreateInput): Promise<DurableHike> {
    const createdAt = this.now();
    const row: Row = { id: text(input.id, 'id', 160), tenantId: text(actor.tenantId, 'tenantId', 64), ownerUserId: text(actor.userId, 'ownerUserId', 64), title: text(input.title, 'title', 160), startedAt: timestamp(input.startedAt), distanceKm: nonNegative(input.distanceKm, 'distanceKm'), elevationGainM: nonNegative(input.elevationGainM, 'elevationGainM'), routeProvider: text(input.route?.provider, 'route.provider', 160), routeExternalId: text(input.route?.externalId, 'route.externalId', 160), routeLabel: text(input.route?.label, 'route.label', 240), privateGeometry: optional(input.privateGeometry, 'privateGeometry', 1048576), visibility: 'private', lifecycle: 'draft', resourceVersion: '1', createdAt, updatedAt: createdAt };
    return this.connection.transaction(async (transaction) => fromRow(await this.hikes.create(row, { transaction })));
  }
  async listWorkspace(actor: Actor): Promise<DurableHike[]> {
    const tenantId = text(actor.tenantId, 'tenantId', 64); const ownerUserId = text(actor.userId, 'ownerUserId', 64);
    return this.connection.transaction(async (transaction) => (await this.hikes.list({ tenantId, ownerUserId }, { transaction })).map(fromRow));
  }
}

const sequelizeTransaction = (transaction: TrailsSyncTransaction): Transaction => { if (transaction instanceof Transaction) return transaction; throw new TrailsSyncPersistenceError('Sequelize adapter requires a managed transaction'); };
const databaseVersion = (value: unknown): string => { if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) return value; if (typeof value === 'bigint' && value >= BigInt(0)) return value.toString(); if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value); throw new TrailsSyncPersistenceError('hike resource version is invalid'); };
const row = (attributes: ITrailsDurableHikeTableAttributes): Row => { if (!attributes.createdAt || !attributes.updatedAt) throw new TrailsSyncPersistenceError('hike row is invalid'); return { ...attributes, distanceKm: attributes.distanceKm == null ? undefined : Number(attributes.distanceKm), elevationGainM: attributes.elevationGainM == null ? undefined : Number(attributes.elevationGainM), privateGeometry: attributes.privateGeometry == null ? undefined : attributes.privateGeometry, resourceVersion: databaseVersion(attributes.resourceVersion), createdAt: attributes.createdAt, updatedAt: attributes.updatedAt }; };
export const createSequelizeDurableHikeModel = (model: ModelStatic<TrailsDurableHikeTable>): DurableHikeModel => ({
  async create(input, options) { return row((await model.create(input, { transaction: sequelizeTransaction(options.transaction) })).get()); },
  async list(input, options) { return (await model.findAll({ where: input, order: [['updatedAt', 'DESC'], ['id', 'ASC']], transaction: sequelizeTransaction(options.transaction) })).map((result) => row(result.get())); },
});
