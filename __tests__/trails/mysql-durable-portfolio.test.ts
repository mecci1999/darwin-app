import { MySqlDurablePortfolioRepository, DurablePortfolioCategoryLookup, DurablePortfolioModel } from '../../src/apps/trails/repository/mysqlDurablePortfolio';
import { Actor, PhotoTechnicalMetadata } from '../../src/apps/trails/types';
import { RichDocumentPublishValidator } from '../../src/apps/trails/repository/mysqlRichDocument';

const owner: Actor = { tenantId: 'tenant-1', userId: 'owner-1', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const timestamp = new Date('2026-07-31T00:00:00.000Z');
type Row = Parameters<DurablePortfolioModel['create']>[0];
const sampleMetadata: PhotoTechnicalMetadata = {
  camera: 'Camera & Co.', lens: '24-70mm', focalLengthMm: 35, aperture: 8, shutterSpeed: '1/125', iso: 100,
  captureDate: '2026-06-15', technicalTags: ['panorama-stitch'], ownerCustomLabels: ['Dawn'],
  visibility: { captureSettings: true, locationLabel: false, technicalTags: true, creationNote: false },
};

const setup = (category: Awaited<ReturnType<DurablePortfolioCategoryLookup['find']>>) => {
  const rows = new Map<string, Row>();
  const transaction = {};
  const portfolios: DurablePortfolioModel = {
    create: jest.fn(async (row) => { rows.set(row.id, row); return row; }),
    find: jest.fn(async ({ id }) => rows.get(id)),
    list: jest.fn(async () => [...rows.values()]),
    compareAndSwap: jest.fn(async ({ next }) => { rows.set(next.id, next); return next; }),
  };
  const categories: DurablePortfolioCategoryLookup = { find: jest.fn(async () => category) };
  const repository = new MySqlDurablePortfolioRepository({ transaction: async (work) => work(transaction) }, portfolios, categories, () => timestamp);
  return { repository, portfolios, categories, rows };
};

describe('MySqlDurablePortfolioRepository category references', () => {
  it.each([
    ['missing', undefined],
    ['other owner', { ownerUserId: 'owner-2', visibility: 'public' as const, status: 'active' as const, lifecycle: 'published' as const }],
    ['archived', { ownerUserId: owner.userId, visibility: 'public' as const, status: 'archived' as const, lifecycle: 'archived' as const }],
  ])('rejects a %s category reference before durable portfolio creation', async (_label, category) => {
    const { repository, portfolios } = setup(category);
    await expect(repository.createDraft(owner, { id: 'portfolio-1', title: 'Aurora', summary: 'Night sky', categoryId: 'category-1', mediaIds: [], visibility: 'private' })).rejects.toThrow('作品集分类不存在或不属于当前创作空间');
    expect(portfolios.create).not.toHaveBeenCalled();
  });

  it('requires an active published public category before publishing a public portfolio', async () => {
    const { repository, portfolios } = setup({ ownerUserId: owner.userId, visibility: 'private', status: 'active', lifecycle: 'draft' });
    await repository.createDraft(owner, { id: 'portfolio-1', title: 'Aurora', summary: 'Night sky', categoryId: 'category-1', mediaIds: [], visibility: 'public' });
    await expect(repository.publish(owner, { id: 'portfolio-1', resourceVersion: '1' })).rejects.toThrow('公开作品集必须关联已发布的公开分类');
    expect(portfolios.compareAndSwap).not.toHaveBeenCalled();
  });

  it('CAS-updates drafts, fails stale updates, and removes unpublished content from a public-capable lifecycle', async () => {
    const { repository, portfolios } = setup(undefined);
    await repository.createDraft(owner, { id: 'portfolio-1', title: 'Aurora', summary: 'Night sky', mediaIds: [], visibility: 'public' });
    const updated = await repository.update(owner, { id: 'portfolio-1', resourceVersion: '1', title: 'Dawn', summary: 'First light', mediaIds: ['media-1'], visibility: 'private' });
    expect(updated).toMatchObject({ title: 'Dawn', visibility: 'private', resourceVersion: '2' });
    await expect(repository.update(owner, { id: 'portfolio-1', resourceVersion: '1', title: 'Stale', summary: 'Stale', mediaIds: [], visibility: 'private' })).rejects.toThrow('版本已过期');
    expect(portfolios.compareAndSwap).toHaveBeenCalledTimes(1);
  });

  it('requires the injected validated rich document before publishing and leaves the draft unchanged on rejection', async () => {
    const { portfolios, categories } = setup(undefined);
    const validator: RichDocumentPublishValidator = { validate: jest.fn(async () => { throw new Error('missing document'); }) };
    const repository = new MySqlDurablePortfolioRepository({ transaction: async (work) => work({}) }, portfolios, categories, () => timestamp, validator);
    await repository.createDraft(owner, { id: 'portfolio-1', title: 'Aurora', summary: 'Night sky', mediaIds: [], visibility: 'private' });
    await expect(repository.publish(owner, { id: 'portfolio-1', resourceVersion: '1' })).rejects.toThrow('missing document');
    expect(portfolios.compareAndSwap).not.toHaveBeenCalled();
  });

  it('round-trips photo technical metadata as JSON TEXT on create, list, and update', async () => {
    const { repository, portfolios, rows } = setup(undefined);
    const created = await repository.createDraft(owner, { id: 'portfolio-1', title: 'Aurora', summary: 'Night sky', mediaIds: ['media-1'], visibility: 'public', photoTechnicalMetadata: sampleMetadata });
    expect(created.photoTechnicalMetadata).toEqual(expect.objectContaining({ camera: 'Camera & Co.', shutterSpeed: '1/125', technicalTags: ['panorama-stitch'] }));
    expect(JSON.parse(String(rows.get('portfolio-1')?.photoTechnicalMetadata))).toMatchObject({ camera: 'Camera & Co.', iso: 100 });
    expect(portfolios.create).toHaveBeenCalledWith(expect.objectContaining({ photoTechnicalMetadata: expect.stringContaining('"camera":"Camera & Co."') }), expect.anything());

    const listed = await repository.listWorkspace(owner);
    expect(listed[0]?.photoTechnicalMetadata?.lens).toBe('24-70mm');

    const without = await repository.update(owner, { id: 'portfolio-1', resourceVersion: '1', title: 'Dawn', summary: 'First light', mediaIds: ['media-1'], visibility: 'private' });
    expect(without.photoTechnicalMetadata).toBeUndefined();
    expect(rows.get('portfolio-1')?.photoTechnicalMetadata).toBeNull();
  });

  it('rejects invalid photo technical metadata before durable writes', async () => {
    const { repository, portfolios } = setup(undefined);
    await expect(repository.createDraft(owner, {
      id: 'portfolio-1', title: 'Aurora', summary: 'Night sky', mediaIds: [], visibility: 'private',
      photoTechnicalMetadata: { ...sampleMetadata, iso: 0, shutterSpeed: '125' },
    })).rejects.toThrow(/photoTechnicalMetadata|快门|iso/i);
    expect(portfolios.create).not.toHaveBeenCalled();
  });
});
