import { Starlight } from '../../src/typings';
import trailsActions from '../../src/apps/trails/actions';
import { InMemoryTrailsRepository } from '../../src/apps/trails/repository';
import { Actor, GuidedTripPlan, SyncMutation, TrailsState } from '../../src/apps/trails/types';

const owner: Actor = { tenantId: 'tenant-owner', userId: 'owner', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const participant: Actor = { tenantId: 'tenant-owner', userId: 'participant', isAdmin: false };
const editor: Actor = { tenantId: 'tenant-owner', userId: 'editor', isAdmin: false, creatorSpaceRole: 'creator-space-editor', creatorSpaceOwnerUserId: owner.userId };
const mismatchedEditor: Actor = { ...editor, creatorSpaceOwnerUserId: 'another-creator' };
const crossTenantEditor: Actor = { ...editor, tenantId: 'tenant-other' };
const star = { emit: jest.fn() } as unknown as Starlight;

const context = (actor: Actor, actionParams: object) => ({
  meta: { tenantId: actor.tenantId, user: actor },
  params: actionParams,
});

const tripParams = {
  capacity: 4,
  checklist: ['water'],
  endsOn: '2026-10-02',
  planStatus: 'open',
  publicItinerary: [{ dayLabel: 'Day 1', summary: 'Arrival' }],
  publicLocationLabel: 'Mountain area',
  publicMaterialReferences: [],
  startsOn: '2026-10-01',
  summary: 'Autumn mountain photography',
  title: 'Autumn Mountain',
  visibility: 'public',
};

const mutation = (mutationId: string, resourceId: string, slug: string): SyncMutation => ({
  baseVersion: null,
  deviceId: 'device-1',
  mutationId,
  operation: 'upsert',
  payload: { nameZh: slug, slug },
  resourceId,
  resourceType: 'portfolio-category',
});

describe('guided trip terminal and cancellation invariants', () => {
  it('does not reopen a cancelled trip', async () => {
    const repository = new InMemoryTrailsRepository();
    const state: TrailsState = { repository };
    const actions = trailsActions(star, state);
    const created = await actions['v1.trips.create'].handler(context(owner, tripParams) as never);
    const trip = created.data.content as GuidedTripPlan;

    const cancelled = await actions['v1.trips.update-status'].handler(context(owner, { id: trip.id, planStatus: 'cancelled' }) as never);
    const reopened = await actions['v1.trips.update-status'].handler(context(owner, { id: trip.id, planStatus: 'open' }) as never);

    expect(cancelled.data.success).toBe(true);
    expect(reopened.data.success).toBe(false);
    expect(repository.getGuidedTripPlan(trip.id)?.planStatus).toBe('cancelled');
  });

  it('makes a contingency cancellation terminal, non-public, and unavailable for registration', async () => {
    const repository = new InMemoryTrailsRepository();
    const state: TrailsState = { repository };
    const actions = trailsActions(star, state);
    const created = await actions['v1.trips.create'].handler(context(owner, tripParams) as never);
    const trip = created.data.content as GuidedTripPlan;

    const cancelled = await actions['v1.trips.update-contingency'].handler(context(owner, { contingencyStatus: 'cancelled', id: trip.id }) as never);
    const contingencyReopened = await actions['v1.trips.update-contingency'].handler(context(owner, { contingencyStatus: 'normal', id: trip.id }) as never);
    const registration = await actions['v1.trips.register'].handler(context(participant, {
      releaseAccepted: true,
      releaseVersion: 'v1',
      requiredAcknowledgement: true,
      tripPlanId: trip.id,
    }) as never);

    expect(cancelled.data.success).toBe(true);
    expect(repository.getGuidedTripPlan(trip.id)).toEqual(expect.objectContaining({ contingencyStatus: 'cancelled', lifecycle: 'draft', planStatus: 'cancelled' }));
    expect(contingencyReopened.data.success).toBe(false);
    expect(registration.data.success).toBe(false);
  });

  it.each(['cancelled', 'completed'] as const)('does not promote registrations after a %s trip becomes terminal', async (planStatus) => {
    const repository = new InMemoryTrailsRepository();
    const state: TrailsState = { repository };
    const actions = trailsActions(star, state);
    const created = await actions['v1.trips.create'].handler(context(owner, tripParams) as never);
    const trip = created.data.content as GuidedTripPlan;
    const registrationResult = await actions['v1.trips.register'].handler(context(participant, {
      releaseAccepted: true,
      releaseVersion: 'v1',
      requiredAcknowledgement: true,
      tripPlanId: trip.id,
    }) as never);
    const registration = registrationResult.data.content as { id: string };

    const terminal = await actions['v1.trips.update-status'].handler(context(owner, { id: trip.id, planStatus }) as never);
    const promotion = await actions['v1.trips.registration-status'].handler(context(owner, {
      registrationId: registration.id,
      status: 'approved-awaiting-payment',
    }) as never);

    expect(terminal.data.success).toBe(true);
    expect(promotion.data.success).toBe(false);
    expect(repository.getGuidedTripRegistration(registration.id)?.status).toBe('submitted');
  });
});

describe('sync mutation invariants', () => {
  it('enforces a slug unique to the trusted actor before saving', () => {
    const repository = new InMemoryTrailsRepository();

    repository.pushMutation(owner, mutation('mutation-1', 'category-1', 'mountains'));

    expect(() => repository.pushMutation(owner, mutation('mutation-2', 'category-2', 'mountains'))).toThrow('slug已被当前所有者使用');
    expect(repository.pushMutation({ ...owner, userId: 'other-owner' }, mutation('mutation-3', 'category-3', 'mountains')).kind).toBe('applied');
  });

  it('uses the body mutationId without requiring an idempotency header', async () => {
    const repository = new InMemoryTrailsRepository();
    const state: TrailsState = { repository };
    const actions = trailsActions(star, state);

    const result = await actions['v1.sync.push'].handler(context(owner, { ...mutation('mutation-body-only', 'category-body-only', 'body-only') }) as never);

    expect(result.data.success).toBe(true);
    expect(repository.getPortfolioCategory('category-body-only')).toEqual(expect.objectContaining({ slug: 'body-only' }));
  });

  it('rejects a participant before a public category can be synced', async () => {
    const repository = new InMemoryTrailsRepository();
    const actions = trailsActions(star, { repository } satisfies TrailsState);

    const result = await actions['v1.sync.push'].handler(context(participant, {
      ...mutation('participant-public', 'participant-public-category', 'participant-public'),
      payload: { nameZh: 'Participant public', slug: 'participant-public', visibility: 'public' },
    }) as never);

    expect(result.data.success).toBe(false);
    expect(repository.getPortfolioCategory('participant-public-category')).toBeUndefined();
  });

  it('allows a creator-space owner to sync a category into their own space', async () => {
    const repository = new InMemoryTrailsRepository();
    const actions = trailsActions(star, { repository } satisfies TrailsState);

    const result = await actions['v1.sync.push'].handler(context(owner, mutation('owner-category', 'owner-category', 'owner-category')) as never);

    expect(result.data.success).toBe(true);
    expect(repository.getPortfolioCategory('owner-category')).toEqual(expect.objectContaining({ tenantId: owner.tenantId, ownerUserId: owner.userId }));
  });

  it('allows a scoped editor to sync a category attributed to the creator-space owner', async () => {
    const repository = new InMemoryTrailsRepository();
    const actions = trailsActions(star, { repository } satisfies TrailsState);

    const result = await actions['v1.sync.push'].handler(context(editor, mutation('editor-category', 'editor-category', 'editor-category')) as never);

    expect(result.data.success).toBe(true);
    expect(repository.getPortfolioCategory('editor-category')).toEqual(expect.objectContaining({ tenantId: editor.tenantId, ownerUserId: owner.userId }));
    expect(repository.getPortfolioCategory('editor-category')?.ownerUserId).not.toBe(editor.userId);
  });

  it('rejects an editor attempting to sync another creator space in the same tenant', async () => {
    const repository = new InMemoryTrailsRepository();
    const seeded = repository.pushMutation(owner, mutation('seed-owner-category', 'owner-category', 'owner-category'));
    const actions = trailsActions(star, { repository } satisfies TrailsState);

    const result = await actions['v1.sync.push'].handler(context(mismatchedEditor, {
      ...mutation('mismatched-editor-update', 'owner-category', 'owner-category-updated'),
      baseVersion: seeded.kind === 'applied' ? seeded.resource.resourceVersion : 1,
      payload: { nameZh: 'Mismatched editor update', slug: 'owner-category-updated' },
    }) as never);

    expect(result.data.success).toBe(false);
    expect(repository.getPortfolioCategory('owner-category')).toEqual(expect.objectContaining({ slug: 'owner-category', ownerUserId: owner.userId }));
  });

  it('rejects an editor attempting to sync a category from another tenant', async () => {
    const repository = new InMemoryTrailsRepository();
    const seeded = repository.pushMutation(owner, mutation('seed-tenant-category', 'tenant-category', 'tenant-category'));
    const actions = trailsActions(star, { repository } satisfies TrailsState);

    const result = await actions['v1.sync.push'].handler(context(crossTenantEditor, {
      ...mutation('cross-tenant-update', 'tenant-category', 'tenant-category-updated'),
      baseVersion: seeded.kind === 'applied' ? seeded.resource.resourceVersion : 1,
      payload: { nameZh: 'Cross tenant update', slug: 'tenant-category-updated' },
    }) as never);

    expect(result.data.success).toBe(false);
    expect(repository.getPortfolioCategory('tenant-category')).toEqual(expect.objectContaining({ slug: 'tenant-category', tenantId: owner.tenantId, ownerUserId: owner.userId }));
  });
});
