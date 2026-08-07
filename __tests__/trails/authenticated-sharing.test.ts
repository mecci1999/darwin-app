import { Starlight } from '../../src/typings';
import trailsActions from '../../src/apps/starlight/trails/actions';
import { InMemoryTrailsRepository } from '../../src/apps/starlight/trails/repository';
import { Actor, FinanceEntry, GearItem, Hike, PackingPlan, ShootSession, TrailsState } from '../../src/apps/starlight/trails/types';

const owner: Actor = { tenantId: 'tenant-a', userId: 'owner', isAdmin: false };
const recipient: Actor = { tenantId: 'tenant-a', userId: 'recipient', isAdmin: false };
const otherUser: Actor = { tenantId: 'tenant-a', userId: 'other-user', isAdmin: false };
const crossTenant: Actor = { tenantId: 'tenant-b', userId: 'recipient', isAdmin: false };
const star = { emit: jest.fn() } as unknown as Starlight;
const context = (actor: Actor | undefined, actionParams: Record<string, unknown>) => ({ meta: actor ? { tenantId: actor.tenantId, user: actor } : {}, params: actionParams });
const timestamp = '2026-07-30T00:00:00.000Z';
const recipientDirectory = { isAuthenticatedMember: jest.fn(async ({ tenantId, userId }: { tenantId: string; userId: string }) => tenantId === 'tenant-a' && ['recipient', 'other-user'].includes(userId)) };

const setup = () => {
  const repository = new InMemoryTrailsRepository();
  const hike: Hike = {
    id: 'hike-private', tenantId: owner.tenantId, ownerUserId: owner.userId, title: 'Ridge traverse', startedAt: '2026-07-30T04:15:00.000Z', distanceKm: 18.2, elevationGainM: 1200,
    route: { provider: 'private-provider', externalId: 'private-route-123', label: 'Northern ridge' }, privateGeometry: 'PRIVATE_GPX_COORDINATES', visibility: 'private', lifecycle: 'draft', createdAt: timestamp, updatedAt: timestamp, resourceVersion: 0,
  };
  const gear: GearItem = { id: 'gear-private', tenantId: owner.tenantId, ownerUserId: owner.userId, name: 'Shelter', weightGrams: 780, quantity: 1, active: true, createdAt: timestamp, updatedAt: timestamp, resourceVersion: 0 };
  const plan: PackingPlan = { id: 'packing-private', tenantId: owner.tenantId, ownerUserId: owner.userId, name: 'Three-day pack', gearItemIds: [gear.id], snapshotWeightGrams: 780, visibility: 'private', lifecycle: 'draft', createdAt: timestamp, updatedAt: timestamp, resourceVersion: 0 };
  const finance: FinanceEntry = { id: 'finance-private', tenantId: owner.tenantId, ownerUserId: owner.userId, occurredOn: '2026-07-30', category: 'equipment', amountCents: 1000, currency: 'CNY', createdAt: timestamp, updatedAt: timestamp, resourceVersion: 0 };
  const session: ShootSession = { id: 'session-private', tenantId: owner.tenantId, ownerUserId: owner.userId, visibility: 'private', status: 'planned', title: 'Private session', location: { latitude: 30.123456, longitude: 120.654321, accessNotes: 'PRIVATE_ACCESS_NOTE' }, fieldObservations: [], checklist: [], gearItemIds: [], workIds: [], ledgerEntryIds: [finance.id], createdAt: timestamp, updatedAt: timestamp, resourceVersion: 0 };
  repository.saveHike(hike); repository.saveGear(gear); repository.savePackingPlan(plan); repository.saveFinanceEntry(finance); repository.saveShootSession(session);
  return { repository, hike, gear, plan, finance, session, actions: trailsActions(star, { repository, recipientDirectory } satisfies TrailsState) };
};

describe('authenticated sharing for routes and equipment', () => {
  it('returns only allowlisted route, gear, and packing projections to the explicitly granted recipient', async () => {
    const { actions, hike, gear, plan } = setup();
    for (const [resourceType, resourceId] of [['hike', hike.id], ['gear-item', gear.id], ['packing-plan', plan.id]] as const) {
      const created = await actions['v1.shares.create'].handler(context(owner, { resourceType, resourceId, recipientUserId: recipient.userId }) as never);
      expect(created.data.success).toBe(true);
    }
    const inbox = await actions['v1.shares.inbox'].handler(context(recipient, {}) as never);
    const serialized = JSON.stringify(inbox.data.content);

    expect(inbox.data.success).toBe(true);
    expect(inbox.data.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: hike.title, occurredOn: '2026-07-30', routeLabel: 'Northern ridge', distanceKm: 18.2, elevationGainM: 1200 }),
      expect.objectContaining({ shareId: expect.any(String), name: gear.name, weightGrams: 780, quantity: 1 }),
      expect.objectContaining({ name: plan.name, snapshotWeightGrams: 780, gear: [expect.objectContaining({ name: gear.name, weightGrams: 780, quantity: 1 })] }),
    ]));
    for (const forbidden of ['PRIVATE_GPX_COORDINATES', 'private-provider', 'private-route-123', '04:15:00', 'gear-private', 'tenant-a', 'owner', 'resourceVersion']) expect(serialized).not.toContain(forbidden);
  });

  it('rejects unauthenticated, non-owner, cross-tenant, finance, and ShootSession sharing attempts', async () => {
    const { actions, hike, finance, session } = setup();
    const unauthenticated = await actions['v1.shares.create'].handler(context(undefined, { resourceType: 'hike', resourceId: hike.id, recipientUserId: recipient.userId }) as never);
    const nonOwner = await actions['v1.shares.create'].handler(context(otherUser, { resourceType: 'hike', resourceId: hike.id, recipientUserId: recipient.userId }) as never);
    const crossTenantAttempt = await actions['v1.shares.create'].handler(context(crossTenant, { resourceType: 'hike', resourceId: hike.id, recipientUserId: owner.userId }) as never);
    const financeAttempt = await actions['v1.shares.create'].handler(context(owner, { resourceType: 'finance-entry', resourceId: finance.id, recipientUserId: recipient.userId }) as never);
    const sessionAttempt = await actions['v1.shares.create'].handler(context(owner, { resourceType: 'shoot-session', resourceId: session.id, recipientUserId: recipient.userId }) as never);

    expect(unauthenticated.data.success).toBe(false);
    expect(nonOwner.data.success).toBe(false);
    expect(crossTenantAttempt.data.success).toBe(false);
    expect(financeAttempt.data.success).toBe(false);
    expect(sessionAttempt.data.success).toBe(false);
  });

  it('keeps shares recipient-scoped and removes their projection immediately after revocation', async () => {
    const { actions, hike } = setup();
    const created = await actions['v1.shares.create'].handler(context(owner, { resourceType: 'hike', resourceId: hike.id, recipientUserId: recipient.userId }) as never);
    const grant = created.data.content as { id: string };
    const beforeRevoke = await actions['v1.shares.inbox'].handler(context(recipient, {}) as never);
    const otherInbox = await actions['v1.shares.inbox'].handler(context(otherUser, {}) as never);
    const revoke = await actions['v1.shares.revoke'].handler(context(owner, { id: grant.id }) as never);
    const afterRevoke = await actions['v1.shares.inbox'].handler(context(recipient, {}) as never);

    expect(beforeRevoke.data.content).toHaveLength(1);
    expect(otherInbox.data.content).toEqual([]);
    expect(revoke.data.success).toBe(true);
    expect(afterRevoke.data.content).toEqual([]);
  });

  it('does not surface finance or ShootSession data from any authenticated sharing response', async () => {
    const { actions, hike, finance, session } = setup();
    await actions['v1.shares.create'].handler(context(owner, { resourceType: 'hike', resourceId: hike.id, recipientUserId: recipient.userId }) as never);
    const inbox = await actions['v1.shares.inbox'].handler(context(recipient, {}) as never);
    const serialized = JSON.stringify(inbox.data.content);

    for (const forbidden of [finance.id, session.id, '30.123456', '120.654321', 'PRIVATE_ACCESS_NOTE', 'amountCents', 'receipt']) expect(serialized).not.toContain(forbidden);
  });

  it('fails closed without a trusted recipient directory and rejects a cross-tenant recipient identity', async () => {
    const { repository, hike } = setup();
    const withoutDirectory = trailsActions(star, { repository } satisfies TrailsState);
    const unavailable = await withoutDirectory['v1.shares.create'].handler(context(owner, { resourceType: 'hike', resourceId: hike.id, recipientUserId: recipient.userId }) as never);
    const { actions } = setup();
    const crossTenantRecipient = await actions['v1.shares.create'].handler(context(owner, { resourceType: 'hike', resourceId: hike.id, recipientUserId: 'same-id-in-other-tenant' }) as never);

    expect(unavailable.data.success).toBe(false);
    expect(crossTenantRecipient.data.success).toBe(false);
  });

  it('does not allow recipients or other users to revoke a grant, and suppresses expired and missing resources', async () => {
    const { actions, repository, hike } = setup();
    const created = await actions['v1.shares.create'].handler(context(owner, { resourceType: 'hike', resourceId: hike.id, recipientUserId: recipient.userId }) as never);
    const grant = created.data.content as { id: string };
    const recipientRevoke = await actions['v1.shares.revoke'].handler(context(recipient, { id: grant.id }) as never);
    const otherRevoke = await actions['v1.shares.revoke'].handler(context(otherUser, { id: grant.id }) as never);
    repository.saveShareGrant({ id: 'expired-grant', tenantId: owner.tenantId, ownerUserId: owner.userId, recipientUserId: recipient.userId, resourceType: 'hike', resourceId: hike.id, expiresAt: '2020-01-01T00:00:00.000Z', createdAt: timestamp });
    repository.saveShareGrant({ id: 'missing-grant', tenantId: owner.tenantId, ownerUserId: owner.userId, recipientUserId: recipient.userId, resourceType: 'hike', resourceId: 'missing-hike', createdAt: timestamp });
    const inbox = await actions['v1.shares.inbox'].handler(context(recipient, {}) as never);

    expect(recipientRevoke.data.success).toBe(false);
    expect(otherRevoke.data.success).toBe(false);
    expect(inbox.data.content).toHaveLength(1);
    expect(JSON.stringify(inbox.data.content)).not.toContain('expired-grant');
    expect(JSON.stringify(inbox.data.content)).not.toContain('missing-grant');
  });
});
