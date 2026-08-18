import { Starlight } from '../../src/typings';
import trailsActions from '../../src/apps/trails/actions';
import { InMemoryTrailsRepository } from '../../src/apps/trails/repository';
import { Actor, DurableMediaAssetRegistryStore, WorkspaceMediaAssetPickerItem } from '../../src/apps/trails/types';

const owner: Actor = { tenantId: 'tenant-a', userId: 'owner-a', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const participant: Actor = { tenantId: 'tenant-a', userId: 'person-a', isAdmin: false, creatorSpaceRole: 'participant' };
const star = { emit: jest.fn() } as unknown as Starlight;
const ctx = (actor: Actor | undefined, params: object) => ({ meta: actor ? { tenantId: actor.tenantId, user: actor } : {}, params });
const record = { id: 'asset-1', tenantId: owner.tenantId, ownerUserId: owner.userId, mimeType: 'image/jpeg', status: 'draft' as const, resourceVersion: '1', createdAt: '', updatedAt: '' };
const pickerRecord: WorkspaceMediaAssetPickerItem = { id: 'asset-1', lifecycle: 'published', readiness: 'ready', mimeType: 'image/jpeg', renditions: [{ name: 'grid-960', width: 960, height: 600, reference: 'grid_ref' }, { name: 'cover-2048', width: 2048, height: 1000, reference: 'cover_ref' }, { name: 'preview-4096', width: 4096, height: 1365, reference: 'preview_ref' }] };
const registry = (overrides: Partial<DurableMediaAssetRegistryStore> = {}): DurableMediaAssetRegistryStore => ({ listWorkspacePicker: jest.fn(async () => [pickerRecord]), listPublic: jest.fn(async () => [pickerRecord]), register: jest.fn(async () => record), approvePublicDerivatives: jest.fn(async () => record), persistArtifacts: jest.fn(async () => record), publish: jest.fn(async () => ({ ...record, status: 'published' as const })), ...overrides });

describe('v2 durable media asset registry actions', () => {
  afterEach(() => { delete process.env.TRAILS_MEDIA_PRIVATE_MASTER_LOCATORS; });
  it('fails closed without the registry and denies a non-creator before any call', async () => {
    const noStore = await trailsActions(star, { repository: new InMemoryTrailsRepository() })['v2.media-assets.publish'].handler(ctx(owner, {}) as never);
    const durable = registry();
    const denied = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durableMediaAssetRegistryStore: durable })['v2.media-assets.publish'].handler(ctx(participant, { mutationId: 'm', expectedResourceVersion: '1', id: 'asset-1' }) as never);
    expect(noStore.status).toBe(503);
    expect(denied.status).toBe(403);
    expect(durable.publish).not.toHaveBeenCalled();
  });
  it('derives scope from trusted actor and obtains the locator only from server configuration', async () => {
    process.env.TRAILS_MEDIA_PRIVATE_MASTER_LOCATORS = JSON.stringify({ source_artifact: 'private_locator' });
    const durable = registry();
    const response = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durableMediaAssetRegistryStore: durable })['v2.media-assets.register'].handler(ctx(owner, { mutationId: 'm', expectedResourceVersion: null, mimeType: 'image/jpeg', privateMasterArtifact: 'source_artifact', tenantId: 'spoofed', ownerUserId: 'spoofed', privateMasterLocator: 'browser-value' }) as never);
    expect(response.status).toBe(201);
    expect(durable.register).toHaveBeenCalledWith(owner, expect.objectContaining({ privateMasterLocator: 'private_locator', expectedResourceVersion: null }));
    expect(JSON.stringify(response)).not.toContain('private_locator');
  });
  it('does not expose a client action that can submit derivative URLs, object keys, or opaque references', async () => {
    const durable = registry();
    const actions = trailsActions(star, { repository: new InMemoryTrailsRepository(), durableMediaAssetRegistryStore: durable });
    expect(Object.prototype.hasOwnProperty.call(actions, 'v2.media-assets.variants.register')).toBe(false);
    expect(durable.approvePublicDerivatives).not.toHaveBeenCalled();
  });
  it('requires a trusted creator actor, fails closed, and returns only the picker projection', async () => {
    const missingActor = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durableMediaAssetRegistryStore: registry() })['v2.media-assets.workspace-picker'].handler(ctx(undefined, {}) as never);
    const noStore = await trailsActions(star, { repository: new InMemoryTrailsRepository() })['v2.media-assets.workspace-picker'].handler(ctx(owner, {}) as never);
    const durable = registry();
    const denied = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durableMediaAssetRegistryStore: durable })['v2.media-assets.workspace-picker'].handler(ctx(participant, { tenantId: 'spoofed', ownerUserId: 'spoofed' }) as never);
    const response = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durableMediaAssetRegistryStore: durable })['v2.media-assets.workspace-picker'].handler(ctx(owner, {}) as never);
    expect(missingActor.status).toBe(401);
    expect(noStore.status).toBe(503);
    expect(denied.status).toBe(403);
    expect(durable.listWorkspacePicker).toHaveBeenCalledTimes(1);
    expect(durable.listWorkspacePicker).toHaveBeenCalledWith(owner);
    expect(JSON.stringify(response)).toContain('grid_ref');
    expect(JSON.stringify(response)).not.toMatch(/tenantId|ownerUserId|privateMasterLocator|privateLocator|objectKey|https?:\/\//);
  });
  it('sanitizes picker store failures as unavailable', async () => {
    const durable = registry({ listWorkspacePicker: jest.fn(async () => { throw new Error('mysql password=secret'); }) });
    const response = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durableMediaAssetRegistryStore: durable })['v2.media-assets.workspace-picker'].handler(ctx(owner, {}) as never);
    expect(response.status).toBe(503);
    expect(JSON.stringify(response)).not.toContain('password=secret');
  });
  it('projects configured-owner ready assets publicly without registry, ownership, or storage metadata', async () => {
    const durable = registry();
    const response = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durableMediaAssetRegistryStore: durable, publicOwnerResolver: { resolve: () => ({ tenantId: owner.tenantId, ownerUserId: owner.userId }) } })['v2.media-assets.public'].handler(ctx(undefined, { ownerUserId: 'spoofed' }) as never);
    expect(response.status).toBe(200);
    expect(durable.listPublic).toHaveBeenCalledWith({ tenantId: owner.tenantId, userId: owner.userId });
    expect(response.data.content).toEqual([{ id: 'asset-1', renditions: [{ reference: 'grid_ref', width: 960, height: 600 }, { reference: 'cover_ref', width: 2048, height: 1000 }, { reference: 'preview_ref', width: 4096, height: 1365 }] }]);
    expect(JSON.stringify(response)).not.toMatch(/tenantId|ownerUserId|privateMasterLocator|privateLocator|objectKey|https?:\/\//);
  });
  it('caches anonymous public projections and clears them after a successful configured-owner publication', async () => {
    const durable = registry();
    const actions = trailsActions(star, { repository: new InMemoryTrailsRepository(), durableMediaAssetRegistryStore: durable, publicOwnerResolver: { resolve: () => ({ tenantId: owner.tenantId, ownerUserId: owner.userId }) } });

    await actions['v2.media-assets.public'].handler(ctx(undefined, {}) as never);
    await actions['v2.media-assets.public'].handler(ctx(undefined, {}) as never);
    await actions['v2.media-assets.publish'].handler(ctx(owner, { mutationId: 'm', expectedResourceVersion: '1', id: 'asset-1' }) as never);
    await actions['v2.media-assets.public'].handler(ctx(undefined, {}) as never);

    expect(durable.listPublic).toHaveBeenCalledTimes(2);
    expect(durable.publish).toHaveBeenCalledTimes(1);
  });
});
