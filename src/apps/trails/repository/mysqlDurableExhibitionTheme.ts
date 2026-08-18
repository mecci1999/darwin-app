import { ModelStatic, Transaction } from 'sequelize';
import { ITrailsDurableExhibitionThemeTableAttributes, TrailsDurableExhibitionThemeTable } from 'db/mysql/models/trailsDurableExhibitionTheme';
import { Actor, DurableExhibitionTheme, DurableExhibitionThemeDraftInput, DurableExhibitionThemeMutation, DurableExhibitionThemeStore, ExhibitionLayoutId, exhibitionLayoutIds } from '../types';
import { creatorSpaceOwnerId } from '../utils/actor';
import { TrailsSyncInputError, TrailsSyncPersistenceError, TrailsSyncTransaction } from './mysqlPortfolioCategorySync';

type Row = Omit<ITrailsDurableExhibitionThemeTableAttributes, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date };
type Options = { transaction: TrailsSyncTransaction };
type PortfolioRow = { ownerUserId: string; visibility: string; lifecycle: string };
const opaque = (value: unknown, field: string) => { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw new TrailsSyncInputError(`${field}无效`); return value; };
const text = (value: unknown, field: string, max: number, optional = false) => { if (value === undefined && optional) return undefined; if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[<>\u0000-\u001f\u007f]/.test(value)) throw new TrailsSyncInputError(`${field}无效`); return value.trim(); };
const slug = (value: unknown) => { const result = text(value, 'slug', 120)!; if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result)) throw new TrailsSyncInputError('slug必须为小写连字符标识'); return result; };
const version = (value: unknown) => { if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw new TrailsSyncInputError('resourceVersion无效'); return value; };
const draft = (value: DurableExhibitionThemeDraftInput): DurableExhibitionThemeDraftInput => {
  const layoutId = value.layoutId;
  if (!(exhibitionLayoutIds as readonly string[]).includes(layoutId)) throw new TrailsSyncInputError('layoutId不属于展览语言库');
  if (!Array.isArray(value.portfolioIds) || value.portfolioIds.length < 1 || value.portfolioIds.length > 60) throw new TrailsSyncInputError('portfolioIds必须为1至60项作品集编号');
  const portfolioIds = value.portfolioIds.map(id => opaque(id, 'portfolioId'));
  if (new Set(portfolioIds).size !== portfolioIds.length) throw new TrailsSyncInputError('portfolioIds不能重复');
  return { id: opaque(value.id, 'id'), slug: slug(value.slug), title: text(value.title, 'title', 160)!, introduction: text(value.introduction, 'introduction', 12000)!, ...(value.closingNote === undefined ? {} : { closingNote: text(value.closingNote, 'closingNote', 4000, true) }), layoutId: layoutId as ExhibitionLayoutId, portfolioIds, ...(value.coverMediaId === undefined ? {} : { coverMediaId: opaque(value.coverMediaId, 'coverMediaId') }) };
};
const fromRow = (row: Row): DurableExhibitionTheme => {
  let payload: Omit<DurableExhibitionThemeDraftInput, 'id'>;
  try { payload = JSON.parse(row.payloadJson) as Omit<DurableExhibitionThemeDraftInput, 'id'>; } catch { throw new TrailsSyncPersistenceError('展览主题载荷无效'); }
  const parsed = draft({ id: row.id, ...payload });
  return { ...parsed, tenantId: row.tenantId, ownerUserId: row.ownerUserId, status: row.status as DurableExhibitionTheme['status'], resourceVersion: String(row.resourceVersion), ...(row.publishedAt ? { publishedAt: row.publishedAt.toISOString() } : {}), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
};
export class TrailsDurableExhibitionThemeStaleVersionError extends Error {}
export interface ExhibitionThemeModel { create(row: Row, options: Options): Promise<Row>; find(input: { tenantId: string; id: string }, options: Options): Promise<Row | undefined>; list(input: { tenantId: string; ownerUserId: string; status?: string }, options: Options): Promise<Row[]>; cas(input: { tenantId: string; id: string; expectedVersion: string; next: Row }, options: Options): Promise<Row | undefined>; }
export interface ExhibitionThemePortfolioModel { find(input: { tenantId: string; id: string }, options: Options): Promise<PortfolioRow | undefined>; }
export class MySqlDurableExhibitionThemeRepository implements DurableExhibitionThemeStore {
  constructor(private readonly connection: { transaction<T>(work: (transaction: TrailsSyncTransaction) => Promise<T>): Promise<T> }, private readonly themes: ExhibitionThemeModel, private readonly portfolios: ExhibitionThemePortfolioModel, private readonly now: () => Date = () => new Date()) {}
  private owner(actor: Actor) { const owner = creatorSpaceOwnerId(actor); if (!owner) throw new TrailsSyncInputError('当前账号没有创作空间管理权限'); return owner; }
  private async validatePortfolios(tenantId: string, ownerUserId: string, ids: string[], transaction: TrailsSyncTransaction, publicOnly: boolean) { for (const id of ids) { const portfolio = await this.portfolios.find({ tenantId, id }, { transaction }); if (!portfolio || portfolio.ownerUserId !== ownerUserId || (publicOnly && (portfolio.visibility !== 'public' || portfolio.lifecycle !== 'published'))) throw new TrailsSyncInputError('主题只能引用当前创作空间中已发布的公开作品集'); } }
  async listWorkspace(actor: Actor) { return this.connection.transaction(async transaction => (await this.themes.list({ tenantId: actor.tenantId, ownerUserId: this.owner(actor) }, { transaction })).map(fromRow)); }
  async mutate(actor: Actor, input: DurableExhibitionThemeMutation) {
    const owner = this.owner(actor);
    return this.connection.transaction(async transaction => {
      if (input.operation === 'create') {
        if (!input.draft || input.id !== undefined || input.resourceVersion !== undefined) throw new TrailsSyncInputError('新展览主题输入无效');
        const next = draft(input.draft); await this.validatePortfolios(actor.tenantId, owner, next.portfolioIds, transaction, false);
        const time = this.now(); const row: Row = { tenantId: actor.tenantId, id: next.id, ownerUserId: owner, slug: next.slug, status: 'draft', resourceVersion: '1', payloadJson: JSON.stringify({ ...next, id: undefined }), createdAt: time, updatedAt: time };
        return fromRow(await this.themes.create(row, { transaction }));
      }
      const id = opaque(input.id, 'id'); const expected = version(input.resourceVersion); const current = await this.themes.find({ tenantId: actor.tenantId, id }, { transaction });
      if (!current || current.ownerUserId !== owner) throw new TrailsSyncInputError('展览主题不存在或不属于当前创作空间');
      if (current.resourceVersion !== expected) throw new TrailsDurableExhibitionThemeStaleVersionError('展览主题版本已过期');
      if (current.status === 'archived') throw new TrailsSyncInputError('已归档展览主题不可修改');
      let next: Row;
      if (input.operation === 'update') { if (!input.draft || current.status !== 'draft') throw new TrailsSyncInputError('只有草稿展览主题可以编辑'); const values = draft({ ...input.draft, id }); await this.validatePortfolios(actor.tenantId, owner, values.portfolioIds, transaction, false); next = { ...current, slug: values.slug, payloadJson: JSON.stringify({ ...values, id: undefined }) }; }
      else if (input.operation === 'publish') { if (current.status !== 'draft') throw new TrailsSyncInputError('只有草稿展览主题可以发布'); const values = fromRow(current); await this.validatePortfolios(actor.tenantId, owner, values.portfolioIds, transaction, true); next = { ...current, status: 'published', publishedAt: this.now() }; }
      else if (input.operation === 'unpublish') { if (current.status !== 'published') throw new TrailsSyncInputError('只有已发布展览主题可以取消发布'); next = { ...current, status: 'draft', publishedAt: undefined }; }
      else if (input.operation === 'archive') next = { ...current, status: 'archived' };
      else throw new TrailsSyncInputError('展览主题操作无效');
      next = { ...next, resourceVersion: (BigInt(current.resourceVersion) + BigInt(1)).toString(), updatedAt: this.now() };
      const saved = await this.themes.cas({ tenantId: actor.tenantId, id, expectedVersion: expected, next }, { transaction });
      if (!saved) throw new TrailsDurableExhibitionThemeStaleVersionError('展览主题版本已过期');
      return fromRow(saved);
    });
  }
  async listPublic(owner: Pick<Actor, 'tenantId' | 'userId'>) { return this.connection.transaction(async transaction => { const rows = await this.themes.list({ tenantId: owner.tenantId, ownerUserId: owner.userId, status: 'published' }, { transaction }); const result: DurableExhibitionTheme[] = []; for (const row of rows) { const theme = fromRow(row); await this.validatePortfolios(owner.tenantId, owner.userId, theme.portfolioIds, transaction, true); result.push(theme); } return result; }); }
}
const row = (entry: ITrailsDurableExhibitionThemeTableAttributes): Row => { if (!entry.createdAt || !entry.updatedAt) throw new TrailsSyncPersistenceError('展览主题数据不完整'); return { ...entry, resourceVersion: String(entry.resourceVersion), createdAt: entry.createdAt, updatedAt: entry.updatedAt }; };
export const createSequelizeDurableExhibitionThemeModel = (model: ModelStatic<TrailsDurableExhibitionThemeTable>): ExhibitionThemeModel => ({
  async create(value, options) { if (!(options.transaction instanceof Transaction)) throw new TrailsSyncPersistenceError('展览主题事务无效'); return row(await model.create(value, { transaction: options.transaction })); },
  async find(input, options) { if (!(options.transaction instanceof Transaction)) throw new TrailsSyncPersistenceError('展览主题事务无效'); const value = await model.findOne({ where: input, transaction: options.transaction, lock: options.transaction.LOCK.UPDATE }); return value ? row(value.get({ plain: true })) : undefined; },
  async list(input, options) { if (!(options.transaction instanceof Transaction)) throw new TrailsSyncPersistenceError('展览主题事务无效'); const values = await model.findAll({ where: input, transaction: options.transaction, order: [['publishedAt', 'DESC'], ['updatedAt', 'DESC']], lock: options.transaction.LOCK.UPDATE }); return values.map(value => row(value.get({ plain: true }))); },
  async cas(input, options) { if (!(options.transaction instanceof Transaction)) throw new TrailsSyncPersistenceError('展览主题事务无效'); const [affected] = await model.update(input.next, { where: { tenantId: input.tenantId, id: input.id, resourceVersion: input.expectedVersion }, transaction: options.transaction }); return affected === 1 ? input.next : undefined; },
});
