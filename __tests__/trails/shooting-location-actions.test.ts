import { HttpResponseItem, Starlight } from '../../src/typings';
import trailsActions from '../../src/apps/trails/actions';
import { InMemoryTrailsRepository } from '../../src/apps/trails/repository';
import { Actor, ShootingLocation, ShootingLocationStore, TrailsState } from '../../src/apps/trails/types';

const owner: Actor = { tenantId: 'tenant-a', userId: 'owner-a', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const location: ShootingLocation = { id: 'shoot_1', tenantId: owner.tenantId, ownerUserId: owner.userId, name: 'Ridge', latitude: 30.1, longitude: 120.1, notes: 'Private note', status: 'active', resourceVersion: '1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
const store = (): ShootingLocationStore => ({ create: jest.fn(async () => location), update: jest.fn(async () => location), archive: jest.fn(async () => ({ ...location, status: 'archived' as const })), listWorkspace: jest.fn(async () => [location]) });
const app = (shootingLocationStore?: ShootingLocationStore) => trailsActions({ emit: jest.fn() } as unknown as Starlight, { repository: new InMemoryTrailsRepository(), shootingLocationStore } as TrailsState);
const context = (params: Record<string, unknown>, actor: Actor | null = owner) => ({ params, meta: actor ? { tenantId: actor.tenantId, user: actor } : {} });

describe('v2 shooting-location actions', () => {
  it('fails closed outside the trusted owner workspace and has no public action', async () => {
    const actions = app(store());
    expect((await actions['v2.shooting-locations.workspace'].handler(context({}, null) as never)).status).toBe(401);
    expect((await actions['v2.shooting-locations.workspace'].handler(context({}, { ...owner, creatorSpaceRole: 'creator-space-editor' }) as never)).status).toBe(403);
    expect(actions).not.toHaveProperty('v2.shooting-locations.public');
  });
  it('rejects caller identity and non-contract fields before private persistence', async () => {
    const shootingLocationStore = store(); const actions = app(shootingLocationStore);
    const result = await actions['v2.shooting-locations.create'].handler(context({ id: location.id, name: location.name, latitude: location.latitude, longitude: location.longitude, mutationId: 'create_1', expectedResourceVersion: null, tenantId: 'spoofed' }) as never) as HttpResponseItem;
    expect(result.status).toBe(400); expect(shootingLocationStore.create).not.toHaveBeenCalled();
  });
});
