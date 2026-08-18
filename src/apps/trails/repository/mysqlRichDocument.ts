import { ModelStatic, Transaction } from 'sequelize';
import { ITrailsRichDocumentTableAttributes, TrailsRichDocumentTable } from 'db/mysql/models/trailsRichDocument';
import { ITrailsRichDocumentRevisionTableAttributes, TrailsRichDocumentRevisionTable } from 'db/mysql/models/trailsRichDocumentRevision';
import { TrailsDurablePortfolioTable } from 'db/mysql/models/trailsDurablePortfolio';
import { TrailsDurableJournalTable } from 'db/mysql/models/trailsDurableJournal';
import { Actor, DurableRichDocument, DurableRichDocumentSaveResult, DurableRichDocumentStore, RichDocumentJson, RichDocumentMark, RichDocumentNode, RichDocumentSubjectType } from '../types';
import { creatorSpaceOwnerId } from '../utils/actor';
import { TrailsSyncInputError, TrailsSyncPersistenceError, TrailsSyncTransaction } from './mysqlPortfolioCategorySync';
import { MediaAssetRegistryModels } from './mysqlMediaAssetRegistry';

type DocumentRow = Omit<ITrailsRichDocumentTableAttributes, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date };
type RevisionRow = Omit<ITrailsRichDocumentRevisionTableAttributes, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date };
type Options = { transaction: TrailsSyncTransaction };
type SubjectModel = { find(input: { tenantId: string; id: string }, options: Options): Promise<{ ownerUserId: string; visibility?: 'public' | 'private' | 'unlisted'; lifecycle?: 'draft' | 'published' | 'archived' } | undefined> };
export interface RichDocumentModel { create(row: DocumentRow, options: Options): Promise<DocumentRow>; find(input: { tenantId: string; subjectType: RichDocumentSubjectType; subjectId: string }, options: Options): Promise<DocumentRow | undefined>; compareAndSwap(input: { current: DocumentRow; next: DocumentRow }, options: Options): Promise<DocumentRow | undefined>; }
export interface RichDocumentRevisionModel { create(row: RevisionRow, options: Options): Promise<RevisionRow>; }
export interface RichDocumentPublishValidator { validate(transaction: TrailsSyncTransaction, input: { tenantId: string; ownerUserId: string; subjectType: RichDocumentSubjectType; subjectId: string }): Promise<void>; }
export interface RichDocumentMediaValidator { validate(transaction: TrailsSyncTransaction, input: { tenantId: string; ownerUserId: string; document: RichDocumentJson }): Promise<void>; }
const maximumVersion = BigInt('18446744073709551615');
const decimal = (value: unknown, label: string): string => { if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw new TrailsSyncInputError(`${label}必须是规范十进制字符串`); return value; };
const opaque = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const plain = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max && !/[<>]/.test(value);
const restrictedAttrs = (value: unknown, allowed: readonly string[]): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key));
export const validateRichDocument = (value: unknown): RichDocumentJson => {
  let serialized: string; try { serialized = JSON.stringify(value); } catch { throw new TrailsSyncInputError('富文档必须是JSON'); }
  if (serialized.length > 65536 || !value || typeof value !== 'object' || Array.isArray(value)) throw new TrailsSyncInputError('富文档大小或结构无效');
  if ((value as Record<string, unknown>).type !== 'doc') throw new TrailsSyncInputError('富文档根节点必须是doc');
  let nodes = 0; let textLength = 0;
  const sameKeys = (candidate: Record<string, unknown>, allowed: readonly string[]) => Object.keys(candidate).every(key => allowed.includes(key));
  const href = (input: unknown): string => {
    if (typeof input !== 'string') throw new TrailsSyncInputError('富文档链接无效');
    try {
      const url = new URL(input);
      const ipv4 = /^(?:25[0-5]|2[0-4][0-9]|1?[0-9]{1,2})(?:\.(?:25[0-5]|2[0-4][0-9]|1?[0-9]{1,2})){3}$/.test(url.hostname);
      if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.port || !url.hostname || url.hostname.startsWith('[') || ipv4) throw new Error('unsafe');
      return url.href;
    } catch { throw new TrailsSyncInputError('富文档链接无效'); }
  };
  const marksOf = (marks: unknown): RichDocumentMark[] => {
    if (!Array.isArray(marks) || marks.length > 4) throw new TrailsSyncInputError('富文档标记无效');
    const types = new Set<string>();
    return marks.map(mark => {
      if (!mark || typeof mark !== 'object' || Array.isArray(mark)) throw new TrailsSyncInputError('富文档标记无效');
      const candidate = mark as Record<string, unknown>;
      if (typeof candidate.type !== 'string' || types.has(candidate.type)) throw new TrailsSyncInputError('富文档标记无效');
      types.add(candidate.type);
      if (candidate.type === 'bold' || candidate.type === 'italic' || candidate.type === 'strike') { if (!sameKeys(candidate, ['type'])) throw new TrailsSyncInputError('富文档标记无效'); return { type: candidate.type }; }
      if (candidate.type !== 'link' || !sameKeys(candidate, ['type', 'attrs']) || !restrictedAttrs(candidate.attrs, ['href'])) throw new TrailsSyncInputError('富文档标记无效');
      return { type: 'link', attrs: { href: href(candidate.attrs.href) } };
    });
  };
  const attrsOf = (type: string, attrs: unknown): Record<string, unknown> | undefined => {
    if (attrs === undefined) {
      if (type === 'heading' || type === 'photo' || type === 'gallery') throw new TrailsSyncInputError('富文档属性无效');
      return undefined;
    }
    const photo = type === 'photo'; const gallery = type === 'gallery'; const note = type === 'caption' || type === 'callout';
    const allowed = photo ? ['mediaId', 'display', 'alt', 'caption'] : gallery ? ['mediaIds', 'display', 'caption'] : type === 'heading' ? ['level'] : type === 'orderedList' ? ['start'] : note ? ['tone'] : [];
    if (!restrictedAttrs(attrs, allowed)) throw new TrailsSyncInputError('富文档属性无效');
    if (photo && (!opaque(attrs.mediaId) || (attrs.display !== undefined && !['inline', 'wide', 'full'].includes(attrs.display as string)) || (attrs.alt !== undefined && !plain(attrs.alt, 500)) || (attrs.caption !== undefined && !plain(attrs.caption, 1000)))) throw new TrailsSyncInputError('图片属性无效');
    if (gallery && (!Array.isArray(attrs.mediaIds) || attrs.mediaIds.length < 1 || attrs.mediaIds.length > 20 || !attrs.mediaIds.every(opaque) || new Set(attrs.mediaIds).size !== attrs.mediaIds.length || (attrs.display !== undefined && !['grid', 'carousel'].includes(attrs.display as string)) || (attrs.caption !== undefined && !plain(attrs.caption, 1000)))) throw new TrailsSyncInputError('画廊属性无效');
    if (type === 'heading' && (!Number.isInteger(attrs.level) || (attrs.level !== 1 && attrs.level !== 2 && attrs.level !== 3))) throw new TrailsSyncInputError('标题属性无效');
    if (type === 'orderedList' && (attrs.start !== undefined && (!Number.isInteger(attrs.start) || (attrs.start as number) < 1))) throw new TrailsSyncInputError('有序列表属性无效');
    if (note && (attrs.tone !== undefined && !['info', 'warning'].includes(attrs.tone as string))) throw new TrailsSyncInputError('富文档属性无效');
    return attrs;
  };
  const node = (entry: unknown, depth: number): RichDocumentNode => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || depth > 24 || ++nodes > 1000) throw new TrailsSyncInputError('富文档结构超过限制');
    const candidate = entry as Record<string, unknown>; const type = candidate.type;
    if (typeof type !== 'string' || !['doc', 'paragraph', 'heading', 'text', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'photo', 'gallery', 'caption', 'callout'].includes(type)) throw new TrailsSyncInputError('富文档节点不受支持');
    if (type === 'text') { if (!sameKeys(candidate, ['type', 'text', 'marks']) || !plain(candidate.text, 4096)) throw new TrailsSyncInputError('富文档文本无效'); textLength += candidate.text.length; if (textLength > 50000) throw new TrailsSyncInputError('富文档文本超过限制'); const marks = candidate.marks === undefined ? undefined : marksOf(candidate.marks); return { type, text: candidate.text, ...(marks ? { marks } : {}) }; }
    if (!sameKeys(candidate, ['type', 'attrs', 'content'])) throw new TrailsSyncInputError('富文档节点属性无效');
    if ((type === 'photo' || type === 'gallery') && candidate.content !== undefined) throw new TrailsSyncInputError('媒体块不能包含嵌套内容');
    const attrs = attrsOf(type, candidate.attrs);
    const content = candidate.content === undefined ? undefined : contentOf(candidate.content, depth + 1);
    if (type === 'doc' && (depth !== 0 || attrs !== undefined)) throw new TrailsSyncInputError('文档根节点无效');
    const allowed = type === 'doc' ? ['paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote', 'photo', 'gallery', 'caption', 'callout'] : type === 'heading' || type === 'paragraph' ? ['text'] : type === 'blockquote' ? ['paragraph'] : type === 'bulletList' || type === 'orderedList' ? ['listItem'] : type === 'listItem' ? ['paragraph', 'bulletList', 'orderedList'] : type === 'caption' || type === 'callout' ? ['text'] : [];
    if ((content ?? []).some(child => !allowed.includes(child.type))) throw new TrailsSyncInputError('富文档节点层级无效');
    if ((type === 'caption' || type === 'callout') && (content?.length ?? 0) > 1) throw new TrailsSyncInputError('题注或提示内容无效');
    if (type === 'listItem' && (!content?.length || content[0].type !== 'paragraph' || content.slice(1).some(child => child.type !== 'bulletList' && child.type !== 'orderedList'))) throw new TrailsSyncInputError('列表项结构无效');
    return { type, ...(attrs ? { attrs } : {}), ...(content ? { content } : {}) };
  };
  const contentOf = (entries: unknown, depth: number): RichDocumentNode[] => { if (!Array.isArray(entries) || entries.length > 200) throw new TrailsSyncInputError('富文档子节点无效'); return entries.map(entry => node(entry, depth)); };
  return node(value, 0) as RichDocumentJson;
};
const parse = (value: string): RichDocumentJson => { try { return validateRichDocument(JSON.parse(value)); } catch (error: unknown) { if (error instanceof TrailsSyncInputError) throw new TrailsSyncPersistenceError('stored rich document is invalid'); throw error; } };
const databaseDecimal = (value: unknown): string => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) ? value : typeof value === 'bigint' && value >= BigInt(0) ? value.toString() : typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : (() => { throw new TrailsSyncPersistenceError('rich document version is invalid'); })();
const document = (row: DocumentRow): DurableRichDocument => ({ subjectType: row.subjectType, subjectId: row.subjectId, document: parse(row.documentJson), revision: databaseDecimal(row.revision), resourceVersion: databaseDecimal(row.resourceVersion), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
export const richDocumentTextProjection = (doc: RichDocumentJson): string => { const parts: string[] = []; const walk = (nodes: readonly RichDocumentNode[] | undefined) => nodes?.forEach(node => { if (node.text) parts.push(node.text); walk(node.content); }); walk(doc.content); return parts.join(' ').replace(/\s+/g, ' ').trim(); };
export const richDocumentHasPublicContent = (doc: RichDocumentJson): boolean => Boolean(doc.content?.length);
const referencedMediaIds = (document: RichDocumentJson): string[] => {
  const ids = new Set<string>();
  const walk = (nodes: readonly RichDocumentNode[] | undefined): void => nodes?.forEach(node => { if (node.type === 'photo' && typeof node.attrs?.mediaId === 'string') ids.add(node.attrs.mediaId); if (node.type === 'gallery' && Array.isArray(node.attrs?.mediaIds)) node.attrs.mediaIds.forEach(id => { if (typeof id === 'string') ids.add(id); }); walk(node.content); });
  walk(document.content);
  return [...ids];
};
export const createRichDocumentMediaValidator = (media: Pick<MediaAssetRegistryModels, 'assets' | 'variants'>): RichDocumentMediaValidator => ({
  async validate(transaction, input) {
    for (const id of referencedMediaIds(input.document)) {
      const asset = await media.assets.find({ tenantId: input.tenantId, id }, { transaction });
      if (!asset || asset.ownerUserId !== input.ownerUserId || asset.status !== 'published') throw new TrailsSyncInputError('富文档媒体必须属于当前创作空间且已发布就绪');
      const variants = await media.variants.list({ tenantId: input.tenantId, assetId: id }, { transaction });
      if (!['grid-960', 'cover-2048', 'preview-4096'].every(name => variants.some(variant => variant.name === name && variant.state === 'ready'))) throw new TrailsSyncInputError('富文档媒体必须属于当前创作空间且已发布就绪');
    }
  },
});
export const createRichDocumentPublishValidator = (documents: RichDocumentModel, media: RichDocumentMediaValidator): RichDocumentPublishValidator => ({
  async validate(transaction, input) {
    const current = await documents.find({ tenantId: input.tenantId, subjectType: input.subjectType, subjectId: input.subjectId }, { transaction });
    if (!current || current.ownerUserId !== input.ownerUserId) throw new TrailsSyncInputError('发布内容必须先保存有效富文档');
    const value = parse(current.documentJson);
    if (!richDocumentHasPublicContent(value)) throw new TrailsSyncInputError('发布内容必须包含非空富文档');
    await media.validate(transaction, { tenantId: input.tenantId, ownerUserId: input.ownerUserId, document: value });
  },
});
export class MySqlRichDocumentRepository implements DurableRichDocumentStore {
  constructor(private readonly connection: { transaction<T>(work: (transaction: TrailsSyncTransaction) => Promise<T>): Promise<T> }, private readonly documents: RichDocumentModel, private readonly revisions: RichDocumentRevisionModel, private readonly subjects: Record<RichDocumentSubjectType, SubjectModel>, private readonly media: RichDocumentMediaValidator, private readonly now: () => Date = () => new Date()) {}
  async read(actor: Actor, input: { subjectType: RichDocumentSubjectType; subjectId: string }): Promise<DurableRichDocument | undefined> { const owner = creatorSpaceOwnerId(actor); if (!owner) throw new TrailsSyncInputError('当前账号没有创作空间管理权限'); return this.connection.transaction(async transaction => { const subject = await this.subject(actor, owner, input, transaction); if (!subject) throw new TrailsSyncInputError('内容不属于当前创作空间'); const current = await this.documents.find({ tenantId: actor.tenantId, ...input }, { transaction }); return current && current.ownerUserId === owner ? document(current) : undefined; }); }
  async readPublic(owner: Pick<Actor, 'tenantId' | 'userId'>, input: { subjectType: RichDocumentSubjectType; subjectId: string }): Promise<DurableRichDocument | undefined> { return this.connection.transaction(async transaction => { if (!opaque(input.subjectId)) return undefined; const subject = await this.subjects[input.subjectType].find({ tenantId: owner.tenantId, id: input.subjectId }, { transaction }); if (!subject || subject.ownerUserId !== owner.userId || subject.visibility !== 'public' || subject.lifecycle !== 'published') return undefined; const current = await this.documents.find({ tenantId: owner.tenantId, ...input }, { transaction }); return current && current.ownerUserId === owner.userId ? document(current) : undefined; }); }
  async save(actor: Actor, input: { subjectType: RichDocumentSubjectType; subjectId: string; baseRevision: string; document: RichDocumentJson }): Promise<DurableRichDocumentSaveResult> { const owner = creatorSpaceOwnerId(actor); if (!owner) throw new TrailsSyncInputError('当前账号没有创作空间管理权限'); const baseRevision = decimal(input.baseRevision, 'baseRevision'); const json = JSON.stringify(validateRichDocument(input.document)); return this.connection.transaction(async transaction => { const subject = await this.subject(actor, owner, input, transaction); if (!subject) throw new TrailsSyncInputError('内容不属于当前创作空间'); const current = await this.documents.find({ tenantId: actor.tenantId, subjectType: input.subjectType, subjectId: input.subjectId }, { transaction }); if (current && current.ownerUserId !== owner) throw new TrailsSyncInputError('内容不属于当前创作空间'); if (current && databaseDecimal(current.revision) !== baseRevision) return { kind: 'conflict', current: document(current) }; const timestamp = this.now(); const nextRevision = current ? BigInt(databaseDecimal(current.revision)) + BigInt(1) : BigInt(1); const nextVersion = current ? BigInt(databaseDecimal(current.resourceVersion)) + BigInt(1) : BigInt(1); if (nextRevision > maximumVersion || nextVersion > maximumVersion) throw new TrailsSyncInputError('富文档版本已达到存储上限'); const next: DocumentRow = { tenantId: actor.tenantId, subjectType: input.subjectType, subjectId: input.subjectId, ownerUserId: owner, documentJson: json, revision: nextRevision.toString(), resourceVersion: nextVersion.toString(), createdAt: current?.createdAt || timestamp, updatedAt: timestamp }; const saved = current ? await this.documents.compareAndSwap({ current, next }, { transaction }) : await this.documents.create(next, { transaction }); if (!saved) { const authoritative = await this.documents.find({ tenantId: actor.tenantId, subjectType: input.subjectType, subjectId: input.subjectId }, { transaction }); if (!authoritative) throw new TrailsSyncPersistenceError('rich document compare-and-swap failed'); return { kind: 'conflict', current: document(authoritative) }; } await this.revisions.create({ tenantId: actor.tenantId, subjectType: input.subjectType, subjectId: input.subjectId, revision: saved.revision, documentJson: json, createdByUserId: actor.userId, createdAt: timestamp, updatedAt: timestamp }, { transaction }); return { kind: 'saved', document: document(saved) }; }); }
  async preview(actor: Actor, input: { subjectType: RichDocumentSubjectType; subjectId: string; document: RichDocumentJson }): Promise<{ document: RichDocumentJson; text: string }> { const owner = creatorSpaceOwnerId(actor); if (!owner) throw new TrailsSyncInputError('当前账号没有创作空间管理权限'); const value = validateRichDocument(input.document); return this.connection.transaction(async transaction => { if (!await this.subject(actor, owner, input, transaction)) throw new TrailsSyncInputError('内容不属于当前创作空间'); return { document: value, text: richDocumentTextProjection(value) }; }); }
  private async subject(actor: Actor, owner: string, input: { subjectType: RichDocumentSubjectType; subjectId: string }, transaction: TrailsSyncTransaction): Promise<{ ownerUserId: string } | undefined> { if (!opaque(input.subjectId)) throw new TrailsSyncInputError('内容编号无效'); const subject = await this.subjects[input.subjectType].find({ tenantId: actor.tenantId, id: input.subjectId }, { transaction }); return subject?.ownerUserId === owner ? subject : undefined; }
}
const sequelizeTransaction = (transaction: TrailsSyncTransaction): Transaction => { if (transaction instanceof Transaction) return transaction; throw new TrailsSyncPersistenceError('Sequelize adapter requires a managed transaction'); };
const richRow = (entry: ITrailsRichDocumentTableAttributes): DocumentRow => { if (!entry.createdAt || !entry.updatedAt) throw new TrailsSyncPersistenceError('rich document row is invalid'); return { ...entry, revision: databaseDecimal(entry.revision), resourceVersion: databaseDecimal(entry.resourceVersion), createdAt: entry.createdAt, updatedAt: entry.updatedAt }; };
export const createSequelizeRichDocumentModels = (documents: ModelStatic<TrailsRichDocumentTable>, revisions: ModelStatic<TrailsRichDocumentRevisionTable>, portfolios: ModelStatic<TrailsDurablePortfolioTable>, journals: ModelStatic<TrailsDurableJournalTable>): { documents: RichDocumentModel; revisions: RichDocumentRevisionModel; subjects: Record<RichDocumentSubjectType, SubjectModel> } => ({
  documents: { async create(input, options) { return richRow((await documents.create(input, { transaction: sequelizeTransaction(options.transaction) })).get()); }, async find(input, options) { const transaction = sequelizeTransaction(options.transaction); const found = await documents.findOne({ where: input, transaction, lock: transaction.LOCK.UPDATE }); return found ? richRow(found.get()) : undefined; }, async compareAndSwap(input, options) { const [affected] = await documents.update(input.next, { where: { tenantId: input.current.tenantId, subjectType: input.current.subjectType, subjectId: input.current.subjectId, revision: input.current.revision }, transaction: sequelizeTransaction(options.transaction) }); return affected === 1 ? input.next : undefined; } },
  revisions: { async create(input, options) { const created = await revisions.create(input, { transaction: sequelizeTransaction(options.transaction) }); const attributes = created.get() as ITrailsRichDocumentRevisionTableAttributes; if (!attributes.createdAt || !attributes.updatedAt) throw new TrailsSyncPersistenceError('rich document revision row is invalid'); return { ...attributes, revision: databaseDecimal(attributes.revision), createdAt: attributes.createdAt, updatedAt: attributes.updatedAt }; } },
  subjects: { portfolio: { async find(input, options) { const transaction = sequelizeTransaction(options.transaction); const found = await portfolios.findOne({ where: input, transaction, lock: transaction.LOCK.UPDATE }); return found ? { ownerUserId: found.get().ownerUserId, visibility: found.get().visibility, lifecycle: found.get().lifecycle } : undefined; } }, journal: { async find(input, options) { const transaction = sequelizeTransaction(options.transaction); const found = await journals.findOne({ where: input, transaction, lock: transaction.LOCK.UPDATE }); return found ? { ownerUserId: found.get().ownerUserId, visibility: found.get().visibility, lifecycle: found.get().lifecycle } : undefined; } } },
});
