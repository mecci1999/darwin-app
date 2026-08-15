import { Starlight } from '../../src/typings';
import trailsActions from '../../src/apps/trails/actions';
import { InMemoryTrailsRepository } from '../../src/apps/trails/repository';
import { Actor, PhotoTechnicalMetadata, Portfolio, TrailsState } from '../../src/apps/trails/types';

const owner: Actor = { tenantId: 'tenant-owner', userId: 'owner', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const otherOwner: Actor = { tenantId: 'tenant-owner', userId: 'other-owner', isAdmin: false };
const tenantOutsider: Actor = { tenantId: 'other-tenant', userId: 'owner', isAdmin: false };
const admin: Actor = { tenantId: 'tenant-owner', userId: 'administrator', isAdmin: true };
const star = { emit: jest.fn() } as unknown as Starlight;
const context = (actor: Actor | undefined, actionParams: Record<string, unknown>) => ({ meta: actor ? { tenantId: actor.tenantId, user: actor } : {}, params: actionParams });

const metadata = (visibility: PhotoTechnicalMetadata['visibility']): PhotoTechnicalMetadata => ({
  camera: 'Camera & Co.', lens: '24-70mm', focalLengthMm: 35, aperture: 8, shutterSpeed: '1/125', iso: 100,
  captureDate: '2026-06-15', calibratedLocationLabel: 'North ridge', technicalTags: ['panorama-stitch', 'sky-ground-blend'],
  ownerCustomLabels: ['Dawn color work'], creationNote: 'Blended the sky and foreground after a panorama stitch.', visibility,
});
const work = (id: string, photoTechnicalMetadata?: PhotoTechnicalMetadata, lifecycle: Portfolio['lifecycle'] = 'published'): Portfolio => ({
  id, tenantId: owner.tenantId, ownerUserId: owner.userId, visibility: 'public', lifecycle, title: 'Alpine dawn', summary: 'A safe public summary.', mediaIds: ['display-asset'], createdAt: '2026-06-15T00:00:00.000Z', updatedAt: '2026-06-15T00:00:00.000Z', resourceVersion: 0, photoTechnicalMetadata,
});
const createActions = () => {
  const repository = new InMemoryTrailsRepository();
  const state: TrailsState = { repository };
  return { actions: trailsActions(star, state), repository };
};

describe('portfolio photo technical metadata', () => {
  it('projects only opted-in metadata groups for a public, published parent work', async () => {
    const { actions, repository } = createActions();
    repository.savePortfolio(work('work-public', metadata({ captureSettings: true, locationLabel: false, technicalTags: true, creationNote: false })));

    const result = await actions['v1.portfolio.public'].handler(context(owner, {}) as never);
    const projected = (result.data.content as Array<Record<string, unknown>>)[0].photoTechnicalMetadata as Record<string, unknown>;

    expect(projected).toEqual({ camera: 'Camera & Co.', lens: '24-70mm', focalLengthMm: 35, aperture: 8, shutterSpeed: '1/125', iso: 100, captureDate: '2026-06-15', technicalTags: ['panorama-stitch', 'sky-ground-blend'], ownerCustomLabels: ['Dawn color work'] });
    expect(projected).not.toHaveProperty('calibratedLocationLabel');
    expect(projected).not.toHaveProperty('creationNote');
    expect(projected).not.toHaveProperty('visibility');
    expect(projected).not.toHaveProperty('original');
  });

  it('does not project metadata for draft parents or when no groups are public', async () => {
    const { actions, repository } = createActions();
    repository.savePortfolio(work('work-draft', metadata({ captureSettings: true, locationLabel: true, technicalTags: true, creationNote: true }), 'draft'));
    repository.savePortfolio(work('work-private-metadata', metadata({ captureSettings: false, locationLabel: false, technicalTags: false, creationNote: false })));

    const result = await actions['v1.portfolio.public'].handler(context(owner, {}) as never);
    const projected = result.data.content as Array<Record<string, unknown>>;

    expect(projected).toHaveLength(1);
    expect(projected[0]).not.toHaveProperty('photoTechnicalMetadata');
  });

  it('requires trusted owner/admin access for complete workspace metadata and edits', async () => {
    const { actions, repository } = createActions();
    repository.savePortfolio(work('work-private', metadata({ captureSettings: false, locationLabel: false, technicalTags: false, creationNote: false })));

    const anonymous = await actions['v1.portfolio.metadata.workspace'].handler(context(undefined, { id: 'work-private' }) as never);
    const denied = await actions['v1.portfolio.metadata.workspace'].handler(context(otherOwner, { id: 'work-private' }) as never);
    const crossTenant = await actions['v1.portfolio.metadata.update'].handler(context(tenantOutsider, { id: 'work-private', photoTechnicalMetadata: metadata({ captureSettings: true, locationLabel: true, technicalTags: true, creationNote: true }) }) as never);
    const readByAdmin = await actions['v1.portfolio.metadata.workspace'].handler(context(admin, { id: 'work-private' }) as never);
    const updatedByOwner = await actions['v1.portfolio.metadata.update'].handler(context(owner, { id: 'work-private', photoTechnicalMetadata: metadata({ captureSettings: true, locationLabel: true, technicalTags: true, creationNote: true }) }) as never);

    expect(anonymous.data.success).toBe(false);
    expect(denied.data.success).toBe(false);
    expect(crossTenant.data.success).toBe(false);
    expect((readByAdmin.data.content as { photoTechnicalMetadata: PhotoTechnicalMetadata }).photoTechnicalMetadata.creationNote).toContain('Blended');
    expect((updatedByOwner.data.content as Portfolio).photoTechnicalMetadata?.visibility.creationNote).toBe(true);
  });

  it('rejects unsafe text and invalid capture values before writing metadata', async () => {
    const { actions, repository } = createActions();
    repository.savePortfolio(work('work-validation'));
    const invalid = { ...metadata({ captureSettings: true, locationLabel: true, technicalTags: true, creationNote: true }), iso: 0, shutterSpeed: '125', creationNote: '<b>unsafe</b>' };

    const result = await actions['v1.portfolio.metadata.update'].handler(context(owner, { id: 'work-validation', photoTechnicalMetadata: invalid }) as never);

    expect(result.data.success).toBe(false);
    expect(repository.getPortfolio('work-validation')?.photoTechnicalMetadata).toBeUndefined();
  });
});
