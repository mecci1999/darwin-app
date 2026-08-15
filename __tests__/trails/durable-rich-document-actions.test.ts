import { Starlight } from '../../src/typings';
import trailsActions from '../../src/apps/trails/actions';
import { InMemoryTrailsRepository } from '../../src/apps/trails/repository';
import { Actor, DurableRichDocument, DurableRichDocumentSaveResult, DurableRichDocumentStore } from '../../src/apps/trails/types';

const owner: Actor = { tenantId: 'tenant-1', userId: 'owner-1', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const editor: Actor = { tenantId: owner.tenantId, userId: 'editor-1', isAdmin: false, creatorSpaceRole: 'creator-space-editor', creatorSpaceOwnerUserId: owner.userId };
const participant: Actor = { tenantId: owner.tenantId, userId: 'participant-1', isAdmin: false };
const star = { emit: jest.fn() } as unknown as Starlight;
const context = (actor: Actor | undefined, params: object) => ({ meta: actor ? { tenantId: actor.tenantId, user: actor } : {}, params });
const json = { type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Quiet light.' }] }] };
const current: DurableRichDocument = { subjectType: 'journal', subjectId: 'journal-1', document: json, revision: '2', resourceVersion: '2', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' };
const durable = (overrides: Partial<DurableRichDocumentStore> = {}): DurableRichDocumentStore => ({ read: jest.fn(async () => current), readPublic: jest.fn(async () => current), save: jest.fn(async (): Promise<DurableRichDocumentSaveResult> => ({ kind: 'saved', document: current })), preview: jest.fn(async () => ({ document: json, text: 'Quiet light.' })), ...overrides });

describe('v2 durable rich-document actions', () => {
  it('saves an allowed journal document through trusted editor scope without payload authority', async () => {
    const store = durable();
    const response = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durableRichDocumentStore: store })['v2.journals.rich-document.save'].handler(context(editor, { id: 'journal-1', baseRevision: '1', document: json, tenantId: 'other', ownerUserId: 'other', subjectType: 'portfolio' }) as never);
    expect(response.status).toBe(200);
    expect(store.save).toHaveBeenCalledWith(editor, { subjectType: 'journal', subjectId: 'journal-1', baseRevision: '1', document: json });
  });

  it('returns 401, blocks participants, and fails closed when durable storage is unavailable', async () => {
    const store = durable();
    const actions = trailsActions(star, { repository: new InMemoryTrailsRepository(), durableRichDocumentStore: store });
    expect((await actions['v2.portfolios.rich-document.read'].handler(context(undefined, { id: 'portfolio-1' }) as never)).status).toBe(401);
    expect((await actions['v2.portfolios.rich-document.read'].handler(context(participant, { id: 'portfolio-1' }) as never)).status).toBe(403);
    expect(store.read).not.toHaveBeenCalled();
    expect((await trailsActions(star, { repository: new InMemoryTrailsRepository() })['v2.portfolios.rich-document.read'].handler(context(owner, { id: 'portfolio-1' }) as never)).status).toBe(503);
  });

  it('returns authoritative current content on base revision conflict', async () => {
    const store = durable({ save: jest.fn(async (): Promise<DurableRichDocumentSaveResult> => ({ kind: 'conflict', current })) });
    const response = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durableRichDocumentStore: store })['v2.journals.rich-document.save'].handler(context(owner, { id: 'journal-1', baseRevision: '1', document: json }) as never);
    expect(response.status).toBe(409);
    expect(response.data.content).toEqual(current);
  });

  it.each([
    { type: 'paragraph', content: [{ type: 'text', text: 'not a document' }] },
    { type: 'doc', content: [{ type: 'script' }] },
    { type: 'doc', content: [{ type: 'paragraph', attrs: { onclick: 'alert(1)' } }] },
    { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '<b>html</b>' }] }] },
    { type: 'doc', content: [{ type: 'photo', attrs: { mediaId: 'https://private.example/key' } }] },
  ])('rejects unsafe JSON before a write: %#', async document => {
    const store = durable();
    const response = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durableRichDocumentStore: store })['v2.portfolios.rich-document.save'].handler(context(owner, { id: 'portfolio-1', baseRevision: '0', document }) as never);
    expect(response.status).toBe(400);
    expect(store.save).not.toHaveBeenCalled();
  });

  it('rejects a syntactically valid media ID when the trusted ready-media registry does not authorize it', async () => {
    const store = durable();
    const document = { type: 'doc' as const, content: [{ type: 'photo', attrs: { mediaId: 'foreign_ready_media' } }] };
    const registry = { listWorkspacePicker: jest.fn(async () => []) };
    const response = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durableRichDocumentStore: store, durableMediaAssetRegistryStore: registry as never })['v2.portfolios.rich-document.save'].handler(context(owner, { id: 'portfolio-1', baseRevision: '0', document }) as never);
    expect(response.status).toBe(400);
    expect(registry.listWorkspacePicker).toHaveBeenCalledWith(owner);
    expect(store.save).not.toHaveBeenCalled();
  });

  it('rejects noncanonical revision and keeps previews private to the authorized subject', async () => {
    const store = durable();
    const actions = trailsActions(star, { repository: new InMemoryTrailsRepository(), durableRichDocumentStore: store });
    const invalid = await actions['v2.portfolios.rich-document.save'].handler(context(owner, { id: 'portfolio-1', baseRevision: 1, document: json }) as never);
    const preview = await actions['v2.journals.rich-document.preview'].handler(context(owner, { id: 'journal-1', document: json }) as never);
    expect(invalid.status).toBe(400);
    expect(preview.data.content).toEqual({ document: json, text: 'Quiet light.' });
    expect(preview.data.content).not.toHaveProperty('tenantId');
    expect(preview.data.content).not.toHaveProperty('ownerUserId');
  });

  it.each(['portfolio', 'journal'] as const)('bootstraps an empty %s rich-document shell with revision 0 when no row exists', async (kind) => {
    const store = durable({ read: jest.fn(async () => undefined) });
    const action = kind === 'portfolio' ? 'v2.portfolios.rich-document.read' : 'v2.journals.rich-document.read';
    const id = kind === 'portfolio' ? 'portfolio-1' : 'journal-1';
    const response = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durableRichDocumentStore: store })[action].handler(context(owner, { id }) as never);
    expect(response.status).toBe(200);
    expect(response.data.content).toMatchObject({
      subjectType: kind,
      subjectId: id,
      document: { type: 'doc', content: [{ type: 'paragraph' }] },
      revision: '0',
      resourceVersion: '0',
    });
    expect(typeof (response.data.content as DurableRichDocument).createdAt).toBe('string');
    expect(typeof (response.data.content as DurableRichDocument).updatedAt).toBe('string');
    expect(store.read).toHaveBeenCalledWith(owner, { subjectType: kind, subjectId: id });
  });
});
