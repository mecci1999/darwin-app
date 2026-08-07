import { Starlight } from '../../src/typings';
import trailsActions from '../../src/apps/starlight/trails/actions';
import { InMemoryTrailsRepository } from '../../src/apps/starlight/trails/repository';
import { Actor, PublishingPackage, TrailsState } from '../../src/apps/starlight/trails/types';

const owner: Actor = { tenantId: 'tenant-a', userId: 'creator', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const editor: Actor = { tenantId: 'tenant-a', userId: 'editor', isAdmin: false, creatorSpaceRole: 'creator-space-editor', creatorSpaceOwnerUserId: 'creator' };
const participant: Actor = { tenantId: 'tenant-a', userId: 'participant', isAdmin: false, creatorSpaceRole: 'participant' };
const otherTenantOwner: Actor = { tenantId: 'tenant-b', userId: 'creator', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const star = { emit: jest.fn() } as unknown as Starlight;
const context = (actor: Actor, actionParams: Record<string, unknown>) => ({ meta: { tenantId: actor.tenantId, user: actor }, params: actionParams });
const approvals = { copyApproved: true, mediaSelectionApproved: true, rightsApproved: true, locationPrivacyApproved: true, factualClaimsApproved: true };

const makeActions = () => {
  const repository = new InMemoryTrailsRepository();
  const actions = trailsActions(star, { repository, publishingAllowedOrigins: ['https://portfolio.example'] } satisfies TrailsState);
  return { repository, actions };
};

const createPublishedPortfolio = async (actions: ReturnType<typeof trailsActions>) => {
  const draft = await actions['v1.portfolio.draft'].handler(context(owner, { title: 'Published work', summary: 'Safe work', mediaIds: ['media_1'], visibility: 'public' }) as never);
  const portfolio = draft.data.content as { id: string };
  await actions['v1.portfolio.publish'].handler(context(owner, { id: portfolio.id }) as never);
  return portfolio.id;
};

const packageParams = (portfolioId: string, overrides: Record<string, unknown> = {}) => ({
  portfolioId, platform: 'xiaohongshu', publishingPath: 'manual_handoff', copy: 'A carefully reviewed field note.', contentOrigin: 'ai-draft-requires-review',
  exportVariants: [{ mediaId: 'media_1', cropIntent: 'portrait', intendedUse: 'cover composition intent only' }],
  locationPolicy: 'withheld', containsGpsOrRouteHints: false, rightsStatus: 'cleared', factualClaims: [{ text: 'Captured at dawn.', verification: 'verified' }],
  approvals, destinationUrl: 'https://portfolio.example/works/published-work?ref=home', ...overrides,
});

const createPackage = async (actions: ReturnType<typeof trailsActions>, overrides: Record<string, unknown> = {}) => {
  const portfolioId = await createPublishedPortfolio(actions);
  const result = await actions['v1.publishing-packages.create'].handler(context(owner, packageParams(portfolioId, overrides)) as never);
  return result.data.content as PublishingPackage;
};

const transition = (actions: ReturnType<typeof trailsActions>, actor: Actor, id: string, status: string, extra: Record<string, unknown> = {}) =>
  actions['v1.publishing-packages.transition'].handler(context(actor, { id, status, ...extra }) as never);

describe('Trails publishing packages', () => {
  it('uses trusted creator-space ownership and ignores caller role, owner, and tenant claims', async () => {
    const { repository, actions } = makeActions(); const created = await createPackage(actions);
    const blocked = await transition(actions, participant, created.id, 'prepared', { creatorSpaceRole: 'creator-space-editor', creatorSpaceOwnerUserId: 'creator', ownerUserId: 'creator', tenantId: 'tenant-a' });
    const editorAllowed = await transition(actions, editor, created.id, 'prepared');
    const crossTenant = await actions['v1.publishing-packages.workspace'].handler(context(otherTenantOwner, {}) as never);

    expect(blocked.data.success).toBe(false);
    expect(editorAllowed.data.success).toBe(true);
    expect(repository.getPublishingPackage(created.id)?.ownerUserId).toBe('creator');
    expect(crossTenant.data.content).toEqual([]);
  });

  it('requires published public portfolio work and produces exact safe UTM attribution', async () => {
    const { actions } = makeActions(); const portfolioDraft = await actions['v1.portfolio.draft'].handler(context(owner, { title: 'Draft', summary: 'No', mediaIds: ['media_1'], visibility: 'public' }) as never);
    const blockedDraft = await actions['v1.publishing-packages.create'].handler(context(owner, packageParams((portfolioDraft.data.content as { id: string }).id)) as never);
    const created = await createPackage(actions, { platform: 'instagram', publishingPath: 'official_api_candidate' });

    expect(blockedDraft.data.success).toBe(false);
    expect(created.utmUrl).toBe('https://portfolio.example/works/published-work?ref=home&utm_source=instagram&utm_medium=social');
  });

  it('rejects unsafe attribution URLs and disallows non-manual Xiaohongshu paths', async () => {
    const { actions } = makeActions(); const portfolioId = await createPublishedPortfolio(actions);
    const unsafe = await actions['v1.publishing-packages.create'].handler(context(owner, packageParams(portfolioId, { destinationUrl: 'https://portfolio.example/redirect?next=https://evil.example' })) as never);
    const offOrigin = await actions['v1.publishing-packages.create'].handler(context(owner, packageParams(portfolioId, { destinationUrl: 'http://portfolio.example/works/x' })) as never);
    const xiaohongshuApi = await actions['v1.publishing-packages.create'].handler(context(owner, packageParams(portfolioId, { publishingPath: 'official_api_candidate' })) as never);

    expect(unsafe.data.success).toBe(false);
    expect(offOrigin.data.success).toBe(false);
    expect(xiaohongshuApi.data.success).toBe(false);
  });

  it('blocks approval for withheld GPS or route hints, restricted rights without disclosure, unverified facts, or missing human approvals', async () => {
    const restricted = makeActions(); const restrictedPortfolioId = await createPublishedPortfolio(restricted.actions);
    const missingDisclosure = await restricted.actions['v1.publishing-packages.create'].handler(context(owner, packageParams(restrictedPortfolioId, { rightsStatus: 'restricted', rightsDisclosure: undefined })) as never);
    expect(missingDisclosure.data.success).toBe(false);

    const cases = [
      { locationPolicy: 'withheld', containsGpsOrRouteHints: true },
      { factualClaims: [{ text: 'Claim', verification: 'unverified' }] },
      { approvals: { ...approvals, factualClaimsApproved: false } },
    ];
    for (const overrides of cases) {
      const { actions } = makeActions(); const created = await createPackage(actions, overrides);
      await transition(actions, owner, created.id, 'prepared'); await transition(actions, owner, created.id, 'reviewed');
      const blocked = await transition(actions, owner, created.id, 'approved');
      expect(blocked.data.success).toBe(false);
    }
  });

  it('supports only recorded manual-handoff intent and human-confirmed manual publication', async () => {
    const { actions } = makeActions(); const created = await createPackage(actions);
    await transition(actions, owner, created.id, 'prepared'); await transition(actions, owner, created.id, 'reviewed'); await transition(actions, owner, created.id, 'approved');
    const scheduled = await transition(actions, owner, created.id, 'scheduled', { scheduledFor: '2027-01-02T03:04:05.000Z' });
    const noConfirmation = await transition(actions, owner, created.id, 'published');
    const published = await transition(actions, owner, created.id, 'published', { manualConfirmation: true });

    expect(scheduled.data.success).toBe(true);
    expect(noConfirmation.data.success).toBe(false);
    expect(published.data.success).toBe(true);
  });

  it('never allows an Instagram official-api candidate to enter a publish path without future OAuth and policy capability', async () => {
    const { actions } = makeActions(); const created = await createPackage(actions, { platform: 'instagram', publishingPath: 'official_api_candidate' });
    await transition(actions, owner, created.id, 'prepared'); await transition(actions, owner, created.id, 'reviewed'); await transition(actions, owner, created.id, 'approved');
    const blocked = await transition(actions, owner, created.id, 'ready_manual_publish');

    expect(blocked.data.success).toBe(false);
  });

  it('records measurements and confidence-labeled learnings only after manual publication', async () => {
    const { actions } = makeActions(); const created = await createPackage(actions);
    const earlyMeasure = await actions['v1.publishing-packages.measure'].handler(context(owner, { id: created.id, measurementEvents: [{ occurredAt: '2027-01-02T03:04:05.000Z', metric: 'reach', value: 12 }] }) as never);
    await transition(actions, owner, created.id, 'prepared'); await transition(actions, owner, created.id, 'reviewed'); await transition(actions, owner, created.id, 'approved'); await transition(actions, owner, created.id, 'ready_manual_publish'); await transition(actions, owner, created.id, 'published', { manualConfirmation: true });
    const measured = await actions['v1.publishing-packages.measure'].handler(context(owner, { id: created.id, measurementEvents: [{ occurredAt: '2027-01-02T03:04:05.000Z', metric: 'qualified_inquiries', value: 2 }] }) as never);
    const learned = await actions['v1.publishing-packages.learn'].handler(context(owner, { id: created.id, summary: 'Portrait crops led to qualified inquiries in this small sample.', confidence: 'low' }) as never);

    expect(earlyMeasure.data.success).toBe(false);
    expect(measured.data.success).toBe(true);
    expect(learned.data.content).toMatchObject({ status: 'learned', learning: { confidence: 'low' } });
  });
});
