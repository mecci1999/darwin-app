import { Starlight } from '../../src/typings';
import trailsActions from '../../src/apps/trails/actions';
import { InMemoryTrailsRepository } from '../../src/apps/trails/repository';
import { Actor, DurablePortfolio, DurablePortfolioCategory, DurablePortfolioCategorySync, DurablePortfolioStore, DurableRichDocument, DurableRichDocumentStore, PhotoTechnicalMetadata } from '../../src/apps/trails/types';
import { TrailsSyncInputError } from '../../src/apps/trails/repository/mysqlPortfolioCategorySync';
import { TrailsDurablePortfolioStaleVersionError } from '../../src/apps/trails/repository/mysqlDurablePortfolio';

const owner: Actor = { tenantId: 'tenant-1', userId: 'owner-1', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const editor: Actor = { tenantId: owner.tenantId, userId: 'editor-1', isAdmin: false, creatorSpaceRole: 'creator-space-editor', creatorSpaceOwnerUserId: owner.userId };
const participant: Actor = { tenantId: owner.tenantId, userId: 'participant-1', isAdmin: false };
const star = { emit: jest.fn() } as unknown as Starlight;
const context = (actor: Actor, params: object) => ({ meta: { tenantId: actor.tenantId, user: actor }, params });
const portfolio: DurablePortfolio = { id: 'portfolio-1', tenantId: owner.tenantId, ownerUserId: owner.userId, title: 'Aurora', summary: 'Night sky', mediaIds: ['media-1'], visibility: 'public', lifecycle: 'draft', resourceVersion: '1', createdAt: '2026-07-31T00:00:00.000Z', updatedAt: '2026-07-31T00:00:00.000Z' };
const publishedPortfolio = (): DurablePortfolio => ({ ...portfolio, lifecycle: 'published', resourceVersion: '2' });
const durable = (overrides: Partial<DurablePortfolioStore> = {}): DurablePortfolioStore => ({ createDraft: jest.fn(async () => portfolio), update: jest.fn(async (): Promise<DurablePortfolio> => ({ ...portfolio, resourceVersion: '2' })), publish: jest.fn(async (): Promise<DurablePortfolio> => publishedPortfolio()), unpublish: jest.fn(async (): Promise<DurablePortfolio> => ({ ...portfolio, lifecycle: 'draft', resourceVersion: '3' })), listWorkspace: jest.fn(async (): Promise<DurablePortfolio[]> => [portfolio]), listPublic: jest.fn(async (): Promise<DurablePortfolio[]> => [publishedPortfolio()]), ...overrides });
const categories = (overrides: Partial<DurablePortfolioCategorySync> = {}): DurablePortfolioCategorySync => ({
  push: jest.fn(), create: jest.fn(), archive: jest.fn(), pull: jest.fn(), listWorkspace: jest.fn(), listPublic: jest.fn(), reorder: jest.fn(),
  resolvePublic: jest.fn(async () => ({ id: 'category-1', tenantId: 'configured-tenant', ownerUserId: 'configured-owner', slug: 'alps', nameZh: '阿尔卑斯', description: '', sortOrder: 0, visibility: 'public' as const, status: 'active' as const, lifecycle: 'published' as const, resourceVersion: '1', createdAt: '2026-07-31T00:00:00.000Z', updatedAt: '2026-07-31T00:00:00.000Z' } satisfies DurablePortfolioCategory)),
  ...overrides,
});

describe('v2 durable portfolio actions', () => {
  it('returns 503 without a durable dependency and never falls back to v1', async () => {
    const repository = new InMemoryTrailsRepository();
    const actions = trailsActions(star, { repository });
    const response = await actions['v2.portfolios.draft'].handler(context(owner, { title: 'Aurora', summary: 'Night sky', mediaIds: [], visibility: 'public' }) as never);
    expect(response.status).toBe(503);
    expect(repository.getPortfolio('portfolio-1')).toBeUndefined();
  });

  it('uses trusted creator editor scope and ignores spoofed ownership', async () => {
    const store = durable();
    const response = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durablePortfolioStore: store })['v2.portfolios.draft'].handler(context(editor, { title: 'Aurora', summary: 'Night sky', mediaIds: ['media-1'], visibility: 'private', tenantId: 'spoofed', ownerUserId: 'spoofed' }) as never);
    expect(response.status).toBe(201);
    expect(store.createDraft).toHaveBeenCalledWith(editor, expect.objectContaining({ id: expect.stringMatching(/^portfolio_/), title: 'Aurora', mediaIds: ['media-1'], visibility: 'private' }));
  });

  it('blocks untrusted participants before calling durable storage', async () => {
    const store = durable();
    const response = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durablePortfolioStore: store })['v2.portfolios.workspace'].handler(context(participant, {}) as never);
    expect(response.status).toBe(403);
    expect(store.listWorkspace).not.toHaveBeenCalled();
  });

  it('delegates only server-owned publish transitions with canonical versions', async () => {
    const store = durable();
    const actions = trailsActions(star, { repository: new InMemoryTrailsRepository(), durablePortfolioStore: store });
    const response = await actions['v2.portfolios.publish'].handler(context(owner, { id: portfolio.id, resourceVersion: '1', lifecycle: 'published' }) as never);
    const invalid = await actions['v2.portfolios.publish'].handler(context(owner, { id: portfolio.id, resourceVersion: 1 }) as never);
    expect(response.status).toBe(200);
    expect(store.publish).toHaveBeenCalledWith(owner, { id: portfolio.id, resourceVersion: '1' });
    expect(invalid.status).toBe(400);
  });

  it('updates and unpublishes only allowlisted draft fields with server-derived authority', async () => {
    const store = durable(); const actions = trailsActions(star, { repository: new InMemoryTrailsRepository(), durablePortfolioStore: store });
    const update = await actions['v2.portfolios.update'].handler(context(editor, { id: portfolio.id, resourceVersion: '1', title: 'New', summary: 'Updated', mediaIds: ['media-2'], visibility: 'private', tenantId: 'spoofed', ownerUserId: 'spoofed', lifecycle: 'published' }) as never);
    const unpublish = await actions['v2.portfolios.unpublish'].handler(context(owner, { id: portfolio.id, resourceVersion: '2', tenantId: 'spoofed', lifecycle: 'draft' }) as never);
    expect(update.status).toBe(200);
    expect(store.update).toHaveBeenCalledWith(editor, { id: portfolio.id, resourceVersion: '1', title: 'New', summary: 'Updated', mediaIds: ['media-2'], categoryId: undefined, coverMediaId: undefined, locationLabel: undefined, photoTechnicalMetadata: undefined, visibility: 'private' });
    expect(unpublish.status).toBe(200);
    expect(store.unpublish).toHaveBeenCalledWith(owner, { id: portfolio.id, resourceVersion: '2' });
  });

  it('returns 401/403/409/503 for update and unpublish without invoking unauthorized storage', async () => {
    const stale = durable({ update: jest.fn(async () => { throw new TrailsDurablePortfolioStaleVersionError('stale'); }) });
    const actions = trailsActions(star, { repository: new InMemoryTrailsRepository(), durablePortfolioStore: stale });
    expect((await actions['v2.portfolios.update'].handler({ meta: {}, params: {} } as never)).status).toBe(401);
    expect((await actions['v2.portfolios.unpublish'].handler(context(participant, { id: portfolio.id, resourceVersion: '1' }) as never)).status).toBe(403);
    expect(stale.unpublish).not.toHaveBeenCalled();
    expect((await actions['v2.portfolios.update'].handler(context(owner, { id: portfolio.id, resourceVersion: '1', title: 'New', summary: 'Updated', mediaIds: [], visibility: 'private' }) as never)).status).toBe(409);
    expect((await trailsActions(star, { repository: new InMemoryTrailsRepository() })['v2.portfolios.unpublish'].handler(context(owner, { id: portfolio.id, resourceVersion: '1' }) as never)).status).toBe(503);
  });

  it('maps a durable stale publish to 409 without falling back to v1', async () => {
    const store = durable({ publish: jest.fn(async () => { throw new TrailsDurablePortfolioStaleVersionError('stale'); }) });
    const response = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durablePortfolioStore: store })['v2.portfolios.publish'].handler(context(owner, { id: portfolio.id, resourceVersion: '1' }) as never);

    expect(response.status).toBe(409);
    expect(response.data.message).toBe('作品集已被更新；请基于current重试');
  });

  it('returns allowlisted public records only after public published filtering', async () => {
    const store = durable({ listPublic: jest.fn(async (): Promise<DurablePortfolio[]> => [
      publishedPortfolio(), { ...portfolio, id: 'draft' }, { ...publishedPortfolio(), id: 'private', visibility: 'private' },
    ]) });
    const response = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durablePortfolioStore: store })['v2.portfolios.public'].handler({ meta: {}, params: {} } as never);
    expect(response.data.content).toEqual([expect.objectContaining({ id: portfolio.id, title: portfolio.title })]);
    expect((response.data.content as Array<Record<string, unknown>>)[0]).not.toHaveProperty('ownerUserId');
    expect((response.data.content as Array<Record<string, unknown>>)[0]).not.toHaveProperty('resourceVersion');
  });
  it('projects only validated canonical rich JSON and server-generated text for new public content', async () => {
    const publicDocument: DurableRichDocument = { subjectType: 'portfolio', subjectId: portfolio.id, document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Safe copy' }] }] }, revision: '1', resourceVersion: '1', createdAt: portfolio.createdAt, updatedAt: portfolio.updatedAt };
    const documents: DurableRichDocumentStore = { read: jest.fn(), readPublic: jest.fn(async (): Promise<DurableRichDocument> => publicDocument), save: jest.fn(), preview: jest.fn() };
    const response = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durablePortfolioStore: durable(), durableRichDocumentStore: documents, publicOwnerResolver: { resolve: () => ({ tenantId: owner.tenantId, ownerUserId: owner.userId }) } })['v2.portfolios.public'].handler({ meta: {}, params: {} } as never);
    const record = (response.data.content as Array<Record<string, unknown>>)[0];
    expect(record).toMatchObject({ id: portfolio.id, richDocument: { type: 'doc' }, plainText: 'Safe copy' });
    expect(JSON.stringify(record)).not.toMatch(/ownerUserId|tenantId|resourceVersion|<|objectKey|locator|https?:\/\//);
  });
  it('returns an opaque cover ID without resolving or projecting media delivery data', async () => {
    const store = durable({ listPublic: jest.fn(async (): Promise<DurablePortfolio[]> => [{ ...publishedPortfolio(), coverMediaId: 'media-cover' }]) });
    const response = await trailsActions(star, {
      repository: new InMemoryTrailsRepository(), durablePortfolioStore: store,
      publicOwnerResolver: { resolve: () => ({ tenantId: 'configured-tenant', ownerUserId: 'configured-owner' }) },
    })['v2.portfolios.public'].handler({ meta: { tenantId: 'spoofed', user: participant }, params: { coverMediaId: 'attacker-media', derivativeKey: 'attacker-variant' } } as never);

    const result = (response.data.content as Array<Record<string, unknown>>)[0];
    expect(response.status).toBe(200);
    expect(result).toMatchObject({ coverMediaId: 'media-cover' });
    expect(result).not.toHaveProperty('coverImage');
    expect(JSON.stringify(result)).not.toMatch(/https?:\/\/|derivative|configured-(tenant|owner)|private|locator|objectKey|capability|resourceVersion/);
  });
  it('omits the opaque cover ID when none is stored and filters non-public records', async () => {
    const store = durable({ listPublic: jest.fn(async (): Promise<DurablePortfolio[]> => [publishedPortfolio(), { ...portfolio, id: 'draft' }, { ...publishedPortfolio(), id: 'private', visibility: 'private' }]) });
    const response = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durablePortfolioStore: store })['v2.portfolios.public'].handler({ meta: {}, params: {} } as never);

    expect(response.status).toBe(200);
    expect(response.data.content).toEqual([expect.not.objectContaining({ coverMediaId: expect.anything() })]);
  });
  it('resolves categorySlug only through the configured owner and applies its opaque ID in the durable query', async () => {
    const store = durable(); const categorySync = categories();
    const response = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durablePortfolioStore: store, durablePortfolioCategorySync: categorySync, publicOwnerResolver: { resolve: () => ({ tenantId: 'configured-tenant', ownerUserId: 'configured-owner' }) } })['v2.portfolios.public'].handler({ meta: { tenantId: 'spoofed', user: participant }, params: { categorySlug: 'alps', tenantId: 'spoofed', ownerUserId: 'spoofed' } } as never);

    expect(response.status).toBe(200);
    expect(categorySync.resolvePublic).toHaveBeenCalledWith({ tenantId: 'configured-tenant', userId: 'configured-owner' }, 'alps');
    expect(store.listPublic).toHaveBeenCalledWith({ tenantId: 'configured-tenant', userId: 'configured-owner' }, 'category-1');
  });
  it.each(['missing', 'hidden', 'archived'])('returns not-found for a %s category without querying portfolios', async () => {
    const store = durable(); const categorySync = categories({ resolvePublic: jest.fn(async () => undefined) });
    const response = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durablePortfolioStore: store, durablePortfolioCategorySync: categorySync, publicOwnerResolver: { resolve: () => ({ tenantId: 'configured-tenant', ownerUserId: 'configured-owner' }) } })['v2.portfolios.public'].handler({ meta: {}, params: { categorySlug: 'missing' } } as never);
    expect(response.status).toBe(404);
    expect(store.listPublic).not.toHaveBeenCalled();
  });

  it('maps input errors to 400 and durable failures to a fixed 503 message', async () => {
    const inputStore = durable({ publish: jest.fn(async () => { throw new TrailsSyncInputError('bad transition'); }) });
    const failureStore = durable({ listWorkspace: jest.fn(async () => { throw new Error('ER_ACCESS_DENIED private SQL'); }) });
    const input = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durablePortfolioStore: inputStore })['v2.portfolios.publish'].handler(context(owner, { id: portfolio.id, resourceVersion: '1' }) as never);
    const failure = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durablePortfolioStore: failureStore })['v2.portfolios.workspace'].handler(context(owner, {}) as never);
    expect(input.status).toBe(400);
    expect(failure.status).toBe(503);
    expect(failure.data.message).toBe('耐久作品集当前不可用');
  });

  it('passes validated photo technical metadata on durable draft create and projects only opted-in public groups', async () => {
    const metadata: PhotoTechnicalMetadata = {
      camera: 'Camera & Co.', lens: '24-70mm', focalLengthMm: 35, aperture: 8, shutterSpeed: '1/125', iso: 100,
      captureDate: '2026-06-15', calibratedLocationLabel: 'North ridge', technicalTags: ['panorama-stitch'],
      ownerCustomLabels: ['Dawn'], creationNote: 'Blended sky.', visibility: { captureSettings: true, locationLabel: false, technicalTags: true, creationNote: false },
    };
    const store = durable({
      createDraft: jest.fn(async (): Promise<DurablePortfolio> => ({ ...portfolio, photoTechnicalMetadata: metadata })),
      listPublic: jest.fn(async (): Promise<DurablePortfolio[]> => [{ ...publishedPortfolio(), photoTechnicalMetadata: metadata }]),
    });
    const actions = trailsActions(star, { repository: new InMemoryTrailsRepository(), durablePortfolioStore: store, publicOwnerResolver: { resolve: () => ({ tenantId: owner.tenantId, ownerUserId: owner.userId }) } });
    const draft = await actions['v2.portfolios.draft'].handler(context(owner, { title: 'Aurora', summary: 'Night sky', mediaIds: ['media-1'], visibility: 'public', photoTechnicalMetadata: metadata }) as never);
    const published = await actions['v2.portfolios.public'].handler({ meta: {}, params: {} } as never);
    const projected = (published.data.content as Array<Record<string, unknown>>)[0].photoTechnicalMetadata as Record<string, unknown>;
    expect(draft.status).toBe(201);
    expect(store.createDraft).toHaveBeenCalledWith(owner, expect.objectContaining({ photoTechnicalMetadata: expect.objectContaining({ camera: 'Camera & Co.', visibility: expect.objectContaining({ captureSettings: true, locationLabel: false }) }) }));
    expect(projected).toEqual({ camera: 'Camera & Co.', lens: '24-70mm', focalLengthMm: 35, aperture: 8, shutterSpeed: '1/125', iso: 100, captureDate: '2026-06-15', technicalTags: ['panorama-stitch'], ownerCustomLabels: ['Dawn'] });
    expect(projected).not.toHaveProperty('calibratedLocationLabel');
    expect(projected).not.toHaveProperty('creationNote');
    expect(projected).not.toHaveProperty('visibility');
  });
});
