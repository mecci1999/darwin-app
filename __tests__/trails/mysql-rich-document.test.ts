import { Actor } from '../../src/apps/trails/types';
import { createRichDocumentMediaValidator, MySqlRichDocumentRepository, RichDocumentModel, RichDocumentRevisionModel, validateRichDocument } from '../../src/apps/trails/repository/mysqlRichDocument';

const actor: Actor = { tenantId: 'tenant-1', userId: 'owner-1', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const doc = { type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One.' }] }] };
const allowMedia = { validate: async () => undefined };
describe('MySqlRichDocumentRepository', () => {
  it('creates immutable snapshots and detects stale base revisions without another write', async () => {
    const records: Array<Record<string, unknown>> = [];
    const revisions: Array<Record<string, unknown>> = [];
    const documents: RichDocumentModel = {
      create: jest.fn(async row => { records.push(row); return row; }),
      find: jest.fn(async input => records.find(record => record.tenantId === input.tenantId && record.subjectType === input.subjectType && record.subjectId === input.subjectId) as never),
      compareAndSwap: jest.fn(async ({ current, next }) => { const index = records.indexOf(current); if (index === -1 || records[index].revision !== current.revision) return undefined; records[index] = next; return next; }),
    };
    const revisionModel: RichDocumentRevisionModel = { create: jest.fn(async row => { revisions.push(row); return row; }) };
    const repository = new MySqlRichDocumentRepository({ transaction: async work => work({}) }, documents, revisionModel, { portfolio: { find: async () => ({ ownerUserId: actor.userId }) }, journal: { find: async () => ({ ownerUserId: actor.userId }) } }, allowMedia, () => new Date('2026-08-01T00:00:00.000Z'));
    expect(await repository.save(actor, { subjectType: 'portfolio', subjectId: 'portfolio-1', baseRevision: '0', document: doc })).toMatchObject({ kind: 'saved', document: { revision: '1' } });
    expect(await repository.save(actor, { subjectType: 'portfolio', subjectId: 'portfolio-1', baseRevision: '0', document: doc })).toMatchObject({ kind: 'conflict', current: { revision: '1' } });
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ revision: '1', createdByUserId: actor.userId });
  });

  it('requires a doc root and rejects raw HTML, event attributes, unknown nodes, unsafe URLs, and private media references', () => {
    expect(() => validateRichDocument({ type: 'paragraph', content: [{ type: 'text', text: 'not a document' }] })).toThrow('富文档根节点必须是doc');
    expect(() => validateRichDocument({ type: 'text', text: 'not a document' })).toThrow('富文档根节点必须是doc');
    expect(() => validateRichDocument({ type: 'doc', content: [{ type: 'rawHtml', text: '<script>' }] })).toThrow();
    expect(() => validateRichDocument({ type: 'doc', content: [{ type: 'paragraph', attrs: { onload: 'x' } }] })).toThrow();
    expect(() => validateRichDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] })).toThrow();
    expect(() => validateRichDocument({ type: 'doc', content: [{ type: 'gallery', attrs: { mediaIds: ['cos/private/key'] } }] })).toThrow();
    for (const href of ['https://user@example.com/', 'https://example.com:8443/', 'https://[::1]/', 'https://127.0.0.1/', 'mailto:test@example.com']) expect(() => validateRichDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href } }] }] }] })).toThrow();
  });

  it('uses the workspace structural grammar and preserves canonical supported order', () => {
    const canonical = { type: 'doc' as const, content: [
      { type: 'paragraph', content: [{ type: 'text', text: '开场' }] },
      { type: 'photo', attrs: { mediaId: 'media_one' } },
      { type: 'caption', content: [{ type: 'text', text: '题注' }] },
      { type: 'gallery', attrs: { mediaIds: ['media_one', 'media_two'] } },
      { type: 'paragraph', content: [{ type: 'text', text: '结尾' }] },
    ] };
    expect(validateRichDocument(canonical)).toEqual(canonical);
    for (const invalid of [
      { type: 'doc', content: [{ type: 'text', text: 'root text' }] },
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'photo', attrs: { mediaId: 'media_one' } }] }] },
      { type: 'doc', content: [{ type: 'photo', attrs: { mediaId: 'media_one' }, content: [{ type: 'text', text: 'nested' }] }] },
      { type: 'doc', content: [{ type: 'caption', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'nested' }] }] }] },
      { type: 'doc', content: [{ type: 'heading', content: [{ type: 'text', text: 'missing attrs' }] }] },
      { type: 'doc', content: [{ type: 'photo' }] },
      { type: 'doc', content: [{ type: 'gallery' }] },
    ]) expect(() => validateRichDocument(invalid)).toThrow();
  });

  it('accepts only unique safe text-mark combinations and preserves validated links', () => {
    const marked = { type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'styled', marks: [{ type: 'bold' as const }, { type: 'italic' as const }, { type: 'strike' as const }, { type: 'link' as const, attrs: { href: 'https://example.com/path' } }] }] }] };
    expect(validateRichDocument(marked)).toEqual(marked);
    expect(() => validateRichDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'bold' }, { type: 'bold' }] }] }] })).toThrow('富文档标记无效');
    expect(() => validateRichDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'bold', attrs: {} }] }] }] })).toThrow('富文档标记无效');
    expect(() => validateRichDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'code' }] }] }] })).toThrow('富文档标记无效');
  });

  it('rejects missing, foreign, draft, and incomplete media before a rich document can be trusted', async () => {
    const ready = [{ name: 'grid-960', state: 'ready' as const }, { name: 'cover-2048', state: 'ready' as const }, { name: 'preview-4096', state: 'ready' as const }];
    const assets = new Map<string, { ownerUserId: string; status: 'draft' | 'published' }>([['ready', { ownerUserId: actor.userId, status: 'published' }], ['foreign', { ownerUserId: 'other', status: 'published' }], ['draft', { ownerUserId: actor.userId, status: 'draft' }], ['partial', { ownerUserId: actor.userId, status: 'published' }]]);
    const validator = createRichDocumentMediaValidator({ assets: { find: jest.fn(async ({ id }) => { const asset = assets.get(id); return asset ? { tenantId: actor.tenantId, id, ...asset } : undefined; }) }, variants: { list: jest.fn(async ({ assetId }) => assetId === 'partial' ? ready.slice(0, 2) : ready) } } as never);
    for (const id of ['missing', 'foreign', 'draft', 'partial']) await expect(validator.validate({}, { tenantId: actor.tenantId, ownerUserId: actor.userId, document: validateRichDocument({ type: 'doc', content: [{ type: 'photo', attrs: { mediaId: id } }] }) })).rejects.toThrow('富文档媒体必须属于当前创作空间且已发布就绪');
    await expect(validator.validate({}, { tenantId: actor.tenantId, ownerUserId: actor.userId, document: validateRichDocument({ type: 'doc', content: [{ type: 'photo', attrs: { mediaId: 'ready' } }, { type: 'gallery', attrs: { mediaIds: ['ready'] } }] }) })).resolves.toBeUndefined();
  });

  it('rejects a cross-tenant or revoked-owner subject before reading or writing a document', async () => {
    const documents: RichDocumentModel = { create: jest.fn(), find: jest.fn(), compareAndSwap: jest.fn() };
    const revisions: RichDocumentRevisionModel = { create: jest.fn() };
    const repository = new MySqlRichDocumentRepository({ transaction: async work => work({}) }, documents, revisions, { portfolio: { find: async () => ({ ownerUserId: 'other-owner' }) }, journal: { find: async () => undefined } }, allowMedia);
    await expect(repository.read(actor, { subjectType: 'portfolio', subjectId: 'portfolio-1' })).rejects.toThrow('内容不属于当前创作空间');
    await expect(repository.save(actor, { subjectType: 'portfolio', subjectId: 'portfolio-1', baseRevision: '0', document: doc })).rejects.toThrow('内容不属于当前创作空间');
    expect(documents.find).not.toHaveBeenCalled();
    expect(documents.create).not.toHaveBeenCalled();
    expect(revisions.create).not.toHaveBeenCalled();
  });
});
