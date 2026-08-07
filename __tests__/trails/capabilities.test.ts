import { Starlight } from '../../src/typings';
import trailsActions from '../../src/apps/starlight/trails/actions';
import { InMemoryTrailsRepository } from '../../src/apps/starlight/trails/repository';
import { Actor, Portfolio, TrailsState } from '../../src/apps/starlight/trails/types';

const participant: Actor = { tenantId: 'tenant-a', userId: 'field-user', isAdmin: false, creatorSpaceRole: 'participant' };
const owner: Actor = { tenantId: 'tenant-a', userId: 'creator', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const editor: Actor = { tenantId: 'tenant-a', userId: 'editor', isAdmin: false, creatorSpaceRole: 'creator-space-editor', creatorSpaceOwnerUserId: 'creator' };
const star = { emit: jest.fn() } as unknown as Starlight;
const context = (actor: Actor | undefined, actionParams: Record<string, unknown>) => ({ meta: actor ? { tenantId: actor.tenantId, user: actor } : {}, params: actionParams });
const portfolioParams = { title: 'Ridge light', summary: 'A study', mediaIds: [], visibility: 'private' };

describe('Trails capability scopes', () => {
  it('allows every authenticated participant to use private field tools without creator access', async () => {
    const repository = new InMemoryTrailsRepository(); const actions = trailsActions(star, { repository } satisfies TrailsState);
    const hike = await actions['v1.hikes'].handler(context(participant, { title: 'Morning hike', startedAt: '2027-01-01T00:00:00.000Z', routeProvider: 'manual', routeId: 'route-1', visibility: 'private' }) as never);
    const capabilities = await actions['v1.capabilities'].handler(context(participant, {}) as never);
    const blockedPortfolio = await actions['v1.portfolio.draft'].handler(context(participant, portfolioParams) as never);

    expect(hike.data.success).toBe(true);
    expect(capabilities.data.content).toEqual({ privateFieldTools: true, creatorContent: false, creatorTrips: false, creatorSpaceRole: 'participant' });
    expect(blockedPortfolio.data.success).toBe(false);
  });

  it('allows a creator-space owner and scoped editor, but not an ordinary participant, to manage creator content', async () => {
    const repository = new InMemoryTrailsRepository(); const actions = trailsActions(star, { repository } satisfies TrailsState);
    const created = await actions['v1.portfolio.draft'].handler(context(owner, portfolioParams) as never);
    const portfolio = created.data.content as Portfolio;
    const participantPublish = await actions['v1.portfolio.publish'].handler(context(participant, { id: portfolio.id }) as never);
    const editorPublish = await actions['v1.portfolio.publish'].handler(context(editor, { id: portfolio.id }) as never);

    expect(created.data.success).toBe(true);
    expect(participantPublish.data.success).toBe(false);
    expect(editorPublish.data.success).toBe(true);
    expect(repository.getPortfolio(portfolio.id)?.lifecycle).toBe('published');
  });

  it('never accepts client-supplied role, owner, or tenant claims as an escalation', async () => {
    const repository = new InMemoryTrailsRepository(); const actions = trailsActions(star, { repository } satisfies TrailsState);
    const created = await actions['v1.portfolio.draft'].handler(context(owner, portfolioParams) as never);
    const portfolio = created.data.content as Portfolio;
    const spoofed = await actions['v1.portfolio.publish'].handler({
      meta: { tenantId: participant.tenantId, user: participant },
      params: { id: portfolio.id, creatorSpaceRole: 'creator-space-editor', creatorSpaceOwnerUserId: 'creator', ownerUserId: 'creator', tenantId: 'tenant-a' },
    } as never);

    expect(spoofed.data.success).toBe(false);
    expect(repository.getPortfolio(portfolio.id)?.lifecycle).toBe('draft');
  });
});
