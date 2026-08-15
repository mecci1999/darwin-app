import { HttpResponseItem, Starlight } from '../../src/typings';
import trailsActions from '../../src/apps/trails/actions';
import { InMemoryTrailsRepository } from '../../src/apps/trails/repository';
import { Actor, DurableExternalVideoReference, DurableExternalVideoReferenceStore, TrailsState } from '../../src/apps/trails/types';
import { TrailsSyncInputError } from '../../src/apps/trails/repository/mysqlPortfolioCategorySync';

const owner: Actor = { tenantId: 'tenant-a', userId: 'owner-a', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const reference: DurableExternalVideoReference = { id: 'video_1', portfolioId: 'portfolio_1', title: '晨雾', summary: '外部作品链接', canonicalUrl: 'https://www.bilibili.com/video/BV1Q541167Qg', sortOrder: 0, tenantId: owner.tenantId, ownerUserId: owner.userId, status: 'draft', resourceVersion: '1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
const store = (): DurableExternalVideoReferenceStore => ({ createDraft: jest.fn(async (_actor, input) => { if (input.canonicalUrl !== input.canonicalUrl.trim()) throw new TrailsSyncInputError('canonicalUrl必须是规范Bilibili视频URL'); return reference; }), updateDraft: jest.fn(async (_actor, input) => { if (input.canonicalUrl !== input.canonicalUrl.trim()) throw new TrailsSyncInputError('canonicalUrl必须是规范Bilibili视频URL'); return reference; }), publish: jest.fn(async () => reference), unpublish: jest.fn(async () => reference), archive: jest.fn(async () => reference), listWorkspace: jest.fn(async () => [reference]), listPublic: jest.fn(async () => [reference]) });
const context = (params: Record<string, unknown>) => ({ params, meta: { tenantId: owner.tenantId, user: owner } });

describe('v2 durable external video reference actions', () => {
  it('keeps only v2 video-reference actions and maps raw padded URLs to 400', async () => {
    const durable = store(); const actions = trailsActions({ emit: jest.fn() } as unknown as Starlight, { repository: new InMemoryTrailsRepository(), durableExternalVideoReferenceStore: durable } as TrailsState);
    for (const legacy of ['v1.portfolio-videos.public', 'v1.portfolio-videos.workspace', 'v1.portfolio-videos.create', 'v1.portfolio-videos.update', 'v1.portfolio-videos.publish', 'v1.portfolio-videos.delete']) expect(Object.prototype.hasOwnProperty.call(actions, legacy)).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(actions, 'v2.video-references.workspace.draft')).toBe(true);
    const result = await (actions['v2.video-references.workspace.draft'].handler as (ctx: unknown) => Promise<HttpResponseItem>)(context({ id: reference.id, portfolioId: reference.portfolioId, title: reference.title, summary: reference.summary, canonicalUrl: ` ${reference.canonicalUrl}`, sortOrder: 0, mutationId: 'padded-url', expectedResourceVersion: null }));
    expect(result.status).toBe(400);
  });
});
