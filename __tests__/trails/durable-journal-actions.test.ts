import { Starlight } from '../../src/typings';
import trailsActions from '../../src/apps/trails/actions';
import { InMemoryTrailsRepository } from '../../src/apps/trails/repository';
import { Actor, DurableJournal, DurableJournalStore, DurableRichDocument, DurableRichDocumentStore } from '../../src/apps/trails/types';
import { TrailsSyncInputError } from '../../src/apps/trails/repository/mysqlPortfolioCategorySync';
import { TrailsDurableJournalStaleVersionError } from '../../src/apps/trails/repository/mysqlDurableJournal';

const owner: Actor = { tenantId: 'tenant-1', userId: 'owner-1', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const editor: Actor = { tenantId: owner.tenantId, userId: 'editor-1', isAdmin: false, creatorSpaceRole: 'creator-space-editor', creatorSpaceOwnerUserId: owner.userId };
const participant: Actor = { tenantId: owner.tenantId, userId: 'participant-1', isAdmin: false };
const star = { emit: jest.fn() } as unknown as Starlight;
const context = (actor: Actor, params: object) => ({ meta: { tenantId: actor.tenantId, user: actor }, params });
const journal: DurableJournal = { id: 'journal-1', tenantId: owner.tenantId, ownerUserId: owner.userId, title: 'Aurora', excerpt: 'Night sky', body: 'Private working text', coverMediaId: 'media-1', isPinned: false, visibility: 'public', lifecycle: 'draft', resourceVersion: '1', createdAt: '2026-07-31T00:00:00.000Z', updatedAt: '2026-07-31T00:00:00.000Z' };
const publishedJournal = (): DurableJournal => ({ ...journal, lifecycle: 'published', publishedAt: '2026-07-31T01:00:00.000Z', resourceVersion: '2' });
const durable = (overrides: Partial<DurableJournalStore> = {}): DurableJournalStore => ({ createDraft: jest.fn(async () => journal), update: jest.fn(async (): Promise<DurableJournal> => ({ ...journal, resourceVersion: '2' })), publish: jest.fn(async (): Promise<DurableJournal> => publishedJournal()), unpublish: jest.fn(async (): Promise<DurableJournal> => ({ ...journal, lifecycle: 'draft', resourceVersion: '3' })), setPinned: jest.fn(async (_actor, input): Promise<DurableJournal> => ({ ...publishedJournal(), isPinned: input.isPinned, resourceVersion: '3' })), listWorkspace: jest.fn(async (): Promise<DurableJournal[]> => [journal]), listPublic: jest.fn(async (): Promise<DurableJournal[]> => [publishedJournal()]), ...overrides });

describe('v2 durable journal actions', () => {
  it('returns 503 without a durable dependency and never falls back to v1', async () => {
    const repository = new InMemoryTrailsRepository();
    const actions = trailsActions(star, { repository });
    const response = await actions['v2.journals.draft'].handler(context(owner, { title: 'Aurora', excerpt: 'Night sky', body: 'Text', visibility: 'public' }) as never);
    expect(response.status).toBe(503);
    expect(repository.getJournal('journal-1')).toBeUndefined();
  });

  it('uses trusted creator editor scope and ignores spoofed ownership', async () => {
    const store = durable();
    const response = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durableJournalStore: store })['v2.journals.draft'].handler(context(editor, { title: 'Aurora', excerpt: 'Night sky', body: 'Text', coverMediaId: 'media-1', visibility: 'private', tenantId: 'spoofed', ownerUserId: 'spoofed' }) as never);
    expect(response.status).toBe(201);
    expect(store.createDraft).toHaveBeenCalledWith(editor, expect.objectContaining({ id: expect.stringMatching(/^journal_/), title: 'Aurora', excerpt: 'Night sky', body: 'Text', coverMediaId: 'media-1', visibility: 'private' }));
  });

  it('defaults omitted journal body to empty string so rich-document can own the narrative', async () => {
    const store = durable();
    const response = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durableJournalStore: store })['v2.journals.draft'].handler(context(owner, { title: 'Aurora', excerpt: 'Night sky', visibility: 'private' }) as never);
    expect(response.status).toBe(201);
    expect(store.createDraft).toHaveBeenCalledWith(owner, expect.objectContaining({ body: '', excerpt: 'Night sky', title: 'Aurora' }));
  });

  it('blocks untrusted participants before calling durable storage', async () => {
    const store = durable();
    const response = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durableJournalStore: store })['v2.journals.workspace'].handler(context(participant, {}) as never);
    expect(response.status).toBe(403);
    expect(store.listWorkspace).not.toHaveBeenCalled();
  });

  it('delegates only server-owned publish transitions with canonical versions', async () => {
    const store = durable();
    const actions = trailsActions(star, { repository: new InMemoryTrailsRepository(), durableJournalStore: store });
    const response = await actions['v2.journals.publish'].handler(context(owner, { id: journal.id, resourceVersion: '1', lifecycle: 'published', publishedAt: 'spoofed' }) as never);
    const invalid = await actions['v2.journals.publish'].handler(context(owner, { id: journal.id, resourceVersion: 1 }) as never);
    expect(response.status).toBe(200);
    expect(store.publish).toHaveBeenCalledWith(owner, { id: journal.id, resourceVersion: '1' });
    expect(invalid.status).toBe(400);
  });

  it('updates and unpublishes only allowlisted draft fields with server-derived authority', async () => {
    const store = durable(); const actions = trailsActions(star, { repository: new InMemoryTrailsRepository(), durableJournalStore: store });
    const update = await actions['v2.journals.update'].handler(context(editor, { id: journal.id, resourceVersion: '1', title: 'New', excerpt: 'Updated', body: 'Working text', visibility: 'private', tenantId: 'spoofed', ownerUserId: 'spoofed', lifecycle: 'published' }) as never);
    const unpublish = await actions['v2.journals.unpublish'].handler(context(owner, { id: journal.id, resourceVersion: '2', publishedAt: 'spoofed' }) as never);
    expect(update.status).toBe(200);
    expect(store.update).toHaveBeenCalledWith(editor, { id: journal.id, resourceVersion: '1', title: 'New', excerpt: 'Updated', body: 'Working text', coverMediaId: undefined, visibility: 'private' });
    expect(unpublish.status).toBe(200);
    expect(store.unpublish).toHaveBeenCalledWith(owner, { id: journal.id, resourceVersion: '2' });
  });

  it('delegates strict optimistic pin input without accepting lifecycle or ownership fields', async () => {
    const store = durable(); const actions = trailsActions(star, { repository: new InMemoryTrailsRepository(), durableJournalStore: store });
    const pinned = await actions['v2.journals.pin'].handler(context(owner, { id: journal.id, resourceVersion: '2', isPinned: true }) as never);
    const extra = await actions['v2.journals.pin'].handler(context(owner, { id: journal.id, resourceVersion: '2', isPinned: true, lifecycle: 'published' }) as never);
    const invalid = await actions['v2.journals.pin'].handler(context(owner, { id: journal.id, resourceVersion: '2', isPinned: 'true' }) as never);
    expect(pinned.status).toBe(200);
    expect(store.setPinned).toHaveBeenCalledWith(owner, { id: journal.id, resourceVersion: '2', isPinned: true });
    expect(extra.status).toBe(400);
    expect(invalid.status).toBe(400);
  });

  it('returns 401/403/409/503 for update and unpublish without invoking unauthorized storage', async () => {
    const stale = durable({ update: jest.fn(async () => { throw new TrailsDurableJournalStaleVersionError('stale'); }) });
    const actions = trailsActions(star, { repository: new InMemoryTrailsRepository(), durableJournalStore: stale });
    expect((await actions['v2.journals.update'].handler({ meta: {}, params: {} } as never)).status).toBe(401);
    expect((await actions['v2.journals.unpublish'].handler(context(participant, { id: journal.id, resourceVersion: '1' }) as never)).status).toBe(403);
    expect(stale.unpublish).not.toHaveBeenCalled();
    expect((await actions['v2.journals.update'].handler(context(owner, { id: journal.id, resourceVersion: '1', title: 'New', excerpt: 'Updated', body: 'Working text', visibility: 'private' }) as never)).status).toBe(409);
    expect((await trailsActions(star, { repository: new InMemoryTrailsRepository() })['v2.journals.unpublish'].handler(context(owner, { id: journal.id, resourceVersion: '1' }) as never)).status).toBe(503);
  });

  it('maps a durable stale publish to 409 without falling back to v1', async () => {
    const store = durable({ publish: jest.fn(async () => { throw new TrailsDurableJournalStaleVersionError('stale'); }) });
    const response = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durableJournalStore: store })['v2.journals.publish'].handler(context(owner, { id: journal.id, resourceVersion: '1' }) as never);
    expect(response.status).toBe(409);
    expect(response.data.message).toBe('日记已被更新；请基于current重试');
  });

  it('returns only public published records with the strict journal projection', async () => {
    const store = durable({ listPublic: jest.fn(async (): Promise<DurableJournal[]> => [publishedJournal(), { ...journal, id: 'draft' }, { ...publishedJournal(), id: 'private', visibility: 'private' }]) });
    const response = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durableJournalStore: store })['v2.journals.public'].handler({ meta: {}, params: {} } as never);
    expect(response.data.content).toEqual([{ id: journal.id, title: journal.title, excerpt: journal.excerpt, isPinned: false, coverMediaId: journal.coverMediaId, publishedAt: publishedJournal().publishedAt }]);
    const record = (response.data.content as Array<Record<string, unknown>>)[0];
    expect(record).not.toHaveProperty('body');
    expect(record).not.toHaveProperty('tenantId');
    expect(record).not.toHaveProperty('ownerUserId');
    expect(record).not.toHaveProperty('resourceVersion');
  });

  it('adds only canonical rich JSON and generated text while preserving legacy metadata-only public records', async () => {
    const documents: DurableRichDocumentStore = { read: jest.fn(), readPublic: jest.fn(async () => undefined), save: jest.fn(), preview: jest.fn() };
    const response = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durableJournalStore: durable(), durableRichDocumentStore: documents, publicOwnerResolver: { resolve: () => ({ tenantId: owner.tenantId, ownerUserId: owner.userId }) } })['v2.journals.public'].handler({ meta: {}, params: {} } as never);
    const record = (response.data.content as Array<Record<string, unknown>>)[0];
    expect(record).not.toHaveProperty('richDocument');
    expect(record).not.toHaveProperty('plainText');
    expect(record).not.toHaveProperty('body');
  });

  it('returns exactly one safe public journal detail with canonical rich content', async () => {
    const richDocument: DurableRichDocument = { subjectType: 'journal', subjectId: journal.id, document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '安全正文' }] }] }, revision: '1', resourceVersion: '1', createdAt: '2026-07-31T01:00:00.000Z', updatedAt: '2026-07-31T01:00:00.000Z' };
    const documents: DurableRichDocumentStore = { read: jest.fn(), readPublic: jest.fn(async () => richDocument), save: jest.fn(), preview: jest.fn() };
    const store = durable();
    const response = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durableJournalStore: store, durableRichDocumentStore: documents, publicOwnerResolver: { resolve: () => ({ tenantId: owner.tenantId, ownerUserId: owner.userId }) } })['v2.journals.public-detail'].handler({ meta: {}, params: { id: journal.id, tenantId: 'spoofed', ownerUserId: 'spoofed' } } as never);
    expect(response.status).toBe(200);
    expect(response.data.content).toEqual({ id: journal.id, title: journal.title, excerpt: journal.excerpt, isPinned: false, coverMediaId: journal.coverMediaId, publishedAt: publishedJournal().publishedAt, richDocument: richDocument.document, plainText: '安全正文' });
    expect(store.listPublic).toHaveBeenCalledWith({ tenantId: owner.tenantId, userId: owner.userId });
    const record = response.data.content as Record<string, unknown>;
    expect(record).not.toHaveProperty('body');
    expect(record).not.toHaveProperty('tenantId');
    expect(record).not.toHaveProperty('ownerUserId');
    expect(record).not.toHaveProperty('resourceVersion');
  });

  it('returns 404 for missing, unpublished, and cross-owner public journal detail requests', async () => {
    const ownerResolver = { resolve: () => ({ tenantId: owner.tenantId, ownerUserId: owner.userId }) };
    const missing = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durableJournalStore: durable(), publicOwnerResolver: ownerResolver })['v2.journals.public-detail'].handler({ meta: {}, params: { id: 'missing' } } as never);
    const unpublished = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durableJournalStore: durable({ listPublic: jest.fn(async () => [journal]) }), publicOwnerResolver: ownerResolver })['v2.journals.public-detail'].handler({ meta: {}, params: { id: journal.id } } as never);
    const crossOwner = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durableJournalStore: durable({ listPublic: jest.fn(async () => [{ ...publishedJournal(), tenantId: 'other-tenant', ownerUserId: 'other-owner' }]) }), publicOwnerResolver: ownerResolver })['v2.journals.public-detail'].handler({ meta: {}, params: { id: journal.id } } as never);
    expect(missing.status).toBe(404);
    expect(unpublished.status).toBe(404);
    expect(crossOwner.status).toBe(404);
  });

  it('returns 503 when public journal detail durable dependencies fail', async () => {
    const unavailable = await trailsActions(star, { repository: new InMemoryTrailsRepository() })['v2.journals.public-detail'].handler({ meta: {}, params: { id: journal.id } } as never);
    const failed = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durableJournalStore: durable({ listPublic: jest.fn(async () => { throw new Error('database unavailable'); }) }), publicOwnerResolver: { resolve: () => ({ tenantId: owner.tenantId, ownerUserId: owner.userId }) } })['v2.journals.public-detail'].handler({ meta: {}, params: { id: journal.id } } as never);
    expect(unavailable.status).toBe(503);
    expect(failed.status).toBe(503);
  });

  it('maps input errors to 400 and unknown durable failures to a fixed 503 message', async () => {
    const inputStore = durable({ publish: jest.fn(async () => { throw new TrailsSyncInputError('bad transition'); }) });
    const failureStore = durable({ listWorkspace: jest.fn(async () => { throw new Error('ER_ACCESS_DENIED private SQL'); }) });
    const input = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durableJournalStore: inputStore })['v2.journals.publish'].handler(context(owner, { id: journal.id, resourceVersion: '1' }) as never);
    const failure = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durableJournalStore: failureStore })['v2.journals.workspace'].handler(context(owner, {}) as never);
    expect(input.status).toBe(400);
    expect(failure.status).toBe(503);
    expect(failure.data.message).toBe('耐久日记当前不可用');
  });
});
