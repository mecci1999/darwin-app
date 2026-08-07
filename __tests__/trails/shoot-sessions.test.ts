import { Starlight } from '../../src/typings';
import trailsActions from '../../src/apps/starlight/trails/actions';
import { InMemoryTrailsRepository } from '../../src/apps/starlight/trails/repository';
import { Actor, ShootSession, TrailsState } from '../../src/apps/starlight/trails/types';

const owner: Actor = { tenantId: 'tenant-owner', userId: 'owner', isAdmin: false };
const admin: Actor = { tenantId: 'tenant-owner', userId: 'admin', isAdmin: true };
const otherOwner: Actor = { tenantId: 'tenant-owner', userId: 'other-owner', isAdmin: false };
const otherTenant: Actor = { tenantId: 'tenant-other', userId: 'owner', isAdmin: true };
const star = { emit: jest.fn() } as unknown as Starlight;
const context = (actor: Actor | undefined, actionParams: Record<string, unknown>) => ({ meta: actor ? { tenantId: actor.tenantId, user: actor } : {}, params: actionParams });
const createParams = {
  title: 'Dawn ridge study', latitude: 30.123456, longitude: 120.654321, publicLabel: 'North ridge', accessNotes: 'Use the service road before dawn', plannedFor: '2027-01-02T05:00:00.000Z',
  fieldObservations: ['low cloud over valley'], checklist: ['tripod', 'headlamp'], shotIntent: 'Capture first light', hikeId: 'hike_1', gearItemIds: ['gear_1'], workIds: ['work_1'], ledgerEntryIds: ['ledger_1'],
};

describe('ShootSession ownership, lifecycle, and public boundary', () => {
  it('rejects unauthenticated and non-owner workspace actions', async () => {
    const repository = new InMemoryTrailsRepository(); const actions = trailsActions(star, { repository } satisfies TrailsState);
    const unauthenticated = await actions['v1.shoot-sessions.create'].handler(context(undefined, createParams) as never);
    const created = await actions['v1.shoot-sessions.create'].handler(context(owner, createParams) as never);
    const session = created.data.content as ShootSession;
    const unauthorized = await actions['v1.shoot-sessions.transition'].handler(context(otherOwner, { id: session.id, status: 'in_field' }) as never);
    const crossTenant = await actions['v1.shoot-sessions.workspace'].handler(context(otherTenant, {}) as never);

    expect(unauthenticated.data.success).toBe(false);
    expect(unauthorized.data.success).toBe(false);
    expect(crossTenant.data.content).toEqual([]);
    expect(repository.getShootSession(session.id)?.status).toBe('planned');
  });

  it('allows only the owner to mutate a private session, including against a same-tenant admin', async () => {
    const repository = new InMemoryTrailsRepository(); const actions = trailsActions(star, { repository } satisfies TrailsState);
    const created = await actions['v1.shoot-sessions.create'].handler(context(owner, createParams) as never);
    const session = created.data.content as ShootSession;
    const deniedAdminTransition = await actions['v1.shoot-sessions.transition'].handler(context(admin, { id: session.id, status: 'in_field' }) as never);
    const transitioned = await actions['v1.shoot-sessions.transition'].handler(context(owner, { id: session.id, status: 'in_field' }) as never);

    expect(created.data.success).toBe(true);
    expect(deniedAdminTransition.data.success).toBe(false);
    expect(transitioned.data.success).toBe(true);
    expect(repository.getShootSession(session.id)).toEqual(expect.objectContaining({ status: 'in_field', visibility: 'private' }));
  });

  it('enforces the table-driven lifecycle and never reopens archived sessions', async () => {
    const repository = new InMemoryTrailsRepository(); const actions = trailsActions(star, { repository } satisfies TrailsState);
    const created = await actions['v1.shoot-sessions.create'].handler(context(owner, createParams) as never);
    const session = created.data.content as ShootSession;
    const invalid = await actions['v1.shoot-sessions.transition'].handler(context(owner, { id: session.id, status: 'published' }) as never);
    for (const status of ['in_field', 'processing', 'published', 'archived']) await actions['v1.shoot-sessions.transition'].handler(context(owner, { id: session.id, status }) as never);
    const reopen = await actions['v1.shoot-sessions.transition'].handler(context(owner, { id: session.id, status: 'processing' }) as never);

    expect(invalid.data.success).toBe(false);
    expect(reopen.data.success).toBe(false);
    expect(repository.getShootSession(session.id)?.status).toBe('archived');
  });

  it('omits exact locations and all ShootSession data from public projections', async () => {
    const repository = new InMemoryTrailsRepository(); const actions = trailsActions(star, { repository } satisfies TrailsState);
    const created = await actions['v1.shoot-sessions.create'].handler(context(owner, createParams) as never);
    const session = created.data.content as ShootSession;
    const overviewHandler = actions['v1.overview'].handler as (ctx: unknown) => Promise<typeof created>;
    const overview = await overviewHandler(context(undefined, {}));
    const publicPortfolios = await actions['v1.portfolio.public'].handler(context(undefined, {}) as never);
    const publicPayload = JSON.stringify([overview.data.content, publicPortfolios.data.content]);

    expect(publicPayload).not.toContain(session.id);
    expect(publicPayload).not.toContain('30.123456');
    expect(publicPayload).not.toContain('120.654321');
    expect(publicPayload).not.toContain('service road');
    expect(publicPayload).not.toContain('ledger_1');
  });
});
