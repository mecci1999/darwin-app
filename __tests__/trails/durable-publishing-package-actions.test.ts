import { HttpResponseItem, Starlight } from '../../src/typings';
import trailsActions from '../../src/apps/trails/actions';
import { InMemoryTrailsRepository } from '../../src/apps/trails/repository';
import { Actor, DurablePublishingPackage, DurablePublishingPackageStore, TrailsState } from '../../src/apps/trails/types';

const actor = { userId: 'owner', tenantId: 'tenant', creatorSpaceRole: 'creator-space-owner' };
const star = { emit: jest.fn() } as unknown as Starlight;
type PublishingPackageContext = { params: Record<string, unknown>; meta: Record<string, unknown> };
type StatusHandler = (context: unknown) => Promise<HttpResponseItem>;
type PublishingPackageAction = 'v2.publishing-packages.workspace' | 'v2.publishing-packages.create' | 'v2.publishing-packages.transition';
const context = (params: Record<string, unknown>, meta: Record<string, unknown> = { user: actor, tenantId: 'tenant' }): PublishingPackageContext => ({ params, meta });
const createInput = { mutationId: 'create-1', expectedResourceVersion: null, sourceWorkId: 'work_1', platform: 'instagram', copy: 'private copy', contentOrigin: 'human', exportVariants: [{ mediaId: 'media_1', cropIntent: 'square', intendedUse: 'feed' }], locationPolicy: 'withheld', containsGpsOrRouteHints: false, rightsStatus: 'cleared', factualClaims: [], approvals: { copyApproved: true, mediaSelectionApproved: true, rightsApproved: true, locationPrivacyApproved: true, factualClaimsApproved: true } };
const responseStatus = (value: HttpResponseItem) => value.status;
const state = (store?: DurablePublishingPackageStore): TrailsState => ({ repository: new InMemoryTrailsRepository(), ...(store ? { durablePublishingPackageStore: store } : {}) });
const handler = (actions: ReturnType<typeof trailsActions>, action: PublishingPackageAction): StatusHandler => actions[action].handler as StatusHandler;
const unavailableStore = (): DurablePublishingPackageStore => ({ create: jest.fn(async () => { throw new Error('unexpected create'); }), transition: jest.fn(async () => { throw new Error('unexpected transition'); }), measure: jest.fn(async () => { throw new Error('unexpected measure'); }), learn: jest.fn(async () => { throw new Error('unexpected learn'); }), listWorkspace: jest.fn(async () => []) });
const publishingPackage = (requestActor: Actor, input: Parameters<DurablePublishingPackageStore['create']>[1]): DurablePublishingPackage => ({ id: input.id, tenantId: requestActor.tenantId, ownerUserId: requestActor.creatorSpaceOwnerUserId || requestActor.userId, sourceWorkId: input.sourceWorkId, platform: input.platform, copy: input.copy, contentOrigin: input.contentOrigin, exportVariants: input.exportVariants, locationPolicy: input.locationPolicy, containsGpsOrRouteHints: input.containsGpsOrRouteHints, rightsStatus: input.rightsStatus, rightsDisclosure: input.rightsDisclosure, factualClaims: input.factualClaims, approvals: input.approvals, status: 'draft', measurementEvents: [], resourceVersion: '1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });

describe('v2 durable publishing package actions', () => {
  it('fails closed at 503 and never falls back to v1 memory packages', async () => {
    const memory = new InMemoryTrailsRepository(); memory.savePublishingPackage({ id: 'v1', tenantId: 'tenant', ownerUserId: 'owner', portfolioId: 'p', platform: 'instagram', publishingPath: 'manual_handoff', status: 'draft', copy: 'v1', contentOrigin: 'human', exportVariants: [], locationPolicy: 'withheld', containsGpsOrRouteHints: false, rightsStatus: 'cleared', factualClaims: [], approvals: { copyApproved: false, mediaSelectionApproved: false, rightsApproved: false, locationPrivacyApproved: false, factualClaimsApproved: false }, destinationUrl: 'https://example.com', utmUrl: 'https://example.com', measurementEvents: [], createdAt: '', updatedAt: '', resourceVersion: 0 });
    const actions = trailsActions(star, { repository: memory } satisfies TrailsState);
    expect(responseStatus(await handler(actions, 'v2.publishing-packages.workspace')(context({})))).toBe(503);
  });
  it('requires authentication and creator-manager access', async () => {
    const store = unavailableStore(); const actions = trailsActions(star, state(store));
    expect(responseStatus(await handler(actions, 'v2.publishing-packages.workspace')(context({}, {})))).toBe(401);
    expect(responseStatus(await handler(actions, 'v2.publishing-packages.workspace')(context({}, { user: { userId: 'p', creatorSpaceRole: 'participant' }, tenantId: 'tenant' })))).toBe(403);
  });
  it('rejects prohibited fields before calling the durable store and maps stale to 409', async () => {
    const create = jest.fn(async () => { throw new Error('unexpected create'); }); const transition = jest.fn(async () => { const { TrailsDurablePublishingPackageStaleVersionError } = require('../../src/apps/trails/repository/mysqlDurablePublishingPackage'); throw new TrailsDurablePublishingPackageStaleVersionError(); });
    const store: DurablePublishingPackageStore = { ...unavailableStore(), create, transition };
    const actions = trailsActions(star, state(store));
    expect(responseStatus(await handler(actions, 'v2.publishing-packages.create')(context({ ...createInput, destinationUrl: 'https://forbidden.example' })))).toBe(400); expect(create).not.toHaveBeenCalled();
    expect(responseStatus(await handler(actions, 'v2.publishing-packages.transition')(context({ mutationId: 'transition', expectedResourceVersion: '1', id: 'pkg_1', status: 'prepared' })))).toBe(409);
  });
  it('scopes deterministic create IDs by trusted actor and replays the same actor result', async () => {
    const replay = new Map<string, DurablePublishingPackage>();
    const create = jest.fn(async (requestActor: Actor, input: Parameters<DurablePublishingPackageStore['create']>[1]) => {
      const key = `${requestActor.tenantId}:${requestActor.userId}:${input.mutationId}`;
      const existing = replay.get(key);
      if (existing) return existing;
      const created = publishingPackage(requestActor, input);
      replay.set(key, created);
      return created;
    });
    const store: DurablePublishingPackageStore = { ...unavailableStore(), create };
    const actions = trailsActions(star, state(store));
    const editor = { userId: 'editor', tenantId: 'tenant', creatorSpaceRole: 'creator-space-editor', creatorSpaceOwnerUserId: 'owner' };
    const ownerFirst = await handler(actions, 'v2.publishing-packages.create')(context(createInput));
    const editorFirst = await handler(actions, 'v2.publishing-packages.create')(context(createInput, { user: editor, tenantId: 'tenant' }));
    const ownerRetry = await handler(actions, 'v2.publishing-packages.create')(context(createInput));
    const ownerId = (ownerFirst.data.content as DurablePublishingPackage).id;
    const editorId = (editorFirst.data.content as DurablePublishingPackage).id;
    expect(responseStatus(ownerFirst)).toBe(201);
    expect(responseStatus(editorFirst)).toBe(201);
    expect(ownerId).not.toBe(editorId);
    expect((ownerRetry.data.content as DurablePublishingPackage).id).toBe(ownerId);
    expect(create).toHaveBeenCalledTimes(3);
    expect(create.mock.calls[0][1].id).toBe(ownerId);
    expect(create.mock.calls[1][1].id).toBe(editorId);
    expect(create.mock.calls[2][1].id).toBe(ownerId);
  });
});
