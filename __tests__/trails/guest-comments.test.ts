import { Starlight } from '../../src/typings';
import trailsActions from '../../src/apps/trails/actions';
import { InMemoryTrailsRepository } from '../../src/apps/trails/repository';
import { Actor, GuestComment, Portfolio, TrailsState } from '../../src/apps/trails/types';

const owner: Actor = { tenantId: 'tenant-owner', userId: 'owner', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const otherOwner: Actor = { tenantId: 'tenant-other', userId: 'other-owner', isAdmin: false };
const star = { emit: jest.fn() } as unknown as Starlight;
const context = (actor: Actor | undefined, actionParams: Record<string, unknown>) => ({
  meta: actor ? { tenantId: actor.tenantId, user: actor } : {},
  params: actionParams,
});
const antiAbuse = { assessSubmission: async () => ({ allowed: true }) };

const createActions = () => {
  const repository = new InMemoryTrailsRepository();
  const state: TrailsState = { repository, antiAbuse };
  return { actions: trailsActions(star, state), repository };
};
const publicPortfolio = (id: string, visibility: Portfolio['visibility'] = 'public', lifecycle: Portfolio['lifecycle'] = 'published'): Portfolio => ({
  id, tenantId: owner.tenantId, ownerUserId: owner.userId, visibility, lifecycle, title: 'Public work', summary: 'Summary', mediaIds: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', resourceVersion: 0,
});
const submission = (subjectId: string) => ({ subjectType: 'portfolio', subjectId, displayName: 'Guest', email: 'Guest@Example.COM', avatarId: 'amber-fox', body: 'A plain text note.' });

describe('guest comment privacy and lifecycle', () => {
  it('requires a public published subject and creates only a private pending-email-verification record', async () => {
    const { actions, repository } = createActions();
    repository.savePortfolio(publicPortfolio('private-work', 'private'));
    repository.savePortfolio(publicPortfolio('public-work'));

    const privateResult = await actions['v1.comments.submit'].handler(context(undefined, submission('private-work')) as never);
    const created = await actions['v1.comments.submit'].handler(context(undefined, submission('public-work')) as never);
    const comment = repository.getGuestComment((created.data.content as { id: string }).id);

    expect(privateResult.data.success).toBe(false);
    expect(created.data.content).toEqual(expect.objectContaining({ status: 'pending-email-verification' }));
    expect(comment).toEqual(expect.objectContaining({ normalizedEmail: 'guest@example.com', status: 'pending-email-verification' }));
    expect(created.data.content).not.toHaveProperty('email');
    expect(created.data.content).not.toHaveProperty('developmentVerificationTokenReference');
  });

  it('never returns emails or verification references publicly and hides unverified or unapproved comments', async () => {
    const { actions, repository } = createActions();
    repository.savePortfolio(publicPortfolio('public-work'));
    const created = await actions['v1.comments.submit'].handler(context(undefined, submission('public-work')) as never);
    const comment = repository.getGuestComment((created.data.content as { id: string }).id) as GuestComment;
    const beforeApproval = await actions['v1.comments.public'].handler(context(undefined, { subjectType: 'portfolio', subjectId: 'public-work' }) as never);

    comment.status = 'approved'; repository.saveGuestComment(comment);
    const publicList = await actions['v1.comments.public'].handler(context(undefined, { subjectType: 'portfolio', subjectId: 'public-work' }) as never);
    const listed = (publicList.data.content as Array<Record<string, unknown>>)[0];

    expect(beforeApproval.data.content).toEqual([]);
    expect(listed).toEqual(expect.objectContaining({ displayName: 'Guest', avatarId: 'amber-fox', body: 'A plain text note.' }));
    expect(listed).not.toHaveProperty('normalizedEmail');
    expect(listed).not.toHaveProperty('developmentVerificationTokenReference');
  });

  it('requires verification before owner moderation and makes withdrawn subjects unavailable publicly', async () => {
    const { actions, repository } = createActions();
    repository.savePortfolio(publicPortfolio('public-work'));
    const created = await actions['v1.comments.submit'].handler(context(undefined, submission('public-work')) as never);
    const comment = repository.getGuestComment((created.data.content as { id: string }).id) as GuestComment;
    const prematureModeration = await actions['v1.comments.moderate'].handler(context(owner, { id: comment.id, status: 'approved' }) as never);
    const verified = await actions['v1.comments.verify'].handler(context(undefined, { verificationTokenReference: comment.developmentVerificationTokenReference }) as never);
    const approved = await actions['v1.comments.moderate'].handler(context(owner, { id: comment.id, status: 'approved' }) as never);
    const portfolio = repository.getPortfolio('public-work') as Portfolio;
    portfolio.lifecycle = 'archived'; repository.savePortfolio(portfolio);
    const withdrawn = await actions['v1.comments.public'].handler(context(undefined, { subjectType: 'portfolio', subjectId: 'public-work' }) as never);

    expect(prematureModeration.data.success).toBe(false);
    expect(verified.data.content).toEqual(expect.objectContaining({ status: 'pending-approval' }));
    expect(approved.data.success).toBe(true);
    expect(withdrawn.data.success).toBe(false);
  });

  it('enforces controlled avatars, plain text, and owner-only moderation queues', async () => {
    const { actions, repository } = createActions();
    repository.savePortfolio(publicPortfolio('public-work'));
    const unsafe = await actions['v1.comments.submit'].handler(context(undefined, { ...submission('public-work'), avatarId: 'https://attacker.invalid/avatar.png', body: '<b>not text</b>' }) as never);
    const created = await actions['v1.comments.submit'].handler(context(undefined, submission('public-work')) as never);
    const comment = repository.getGuestComment((created.data.content as { id: string }).id) as GuestComment;
    await actions['v1.comments.verify'].handler(context(undefined, { verificationTokenReference: comment.developmentVerificationTokenReference }) as never);
    const otherQueue = await actions['v1.comments.moderation-queue'].handler(context(otherOwner, {}) as never);
    const otherModeration = await actions['v1.comments.moderate'].handler(context(otherOwner, { id: comment.id, status: 'approved' }) as never);
    const ownerQueue = await actions['v1.comments.moderation-queue'].handler(context(owner, {}) as never);

    expect(unsafe.data.success).toBe(false);
    expect(otherQueue.data.content).toEqual([]);
    expect(otherModeration.data.success).toBe(false);
    expect(ownerQueue.data.content).toEqual([expect.objectContaining({ id: comment.id, normalizedEmail: 'guest@example.com' })]);
  });

  it('does not bypass a denied anti-abuse assessment', async () => {
    const repository = new InMemoryTrailsRepository();
    repository.savePortfolio(publicPortfolio('public-work'));
    const actions = trailsActions(star, { repository, antiAbuse: { assessSubmission: async () => ({ allowed: false }) } });

    const result = await actions['v1.comments.submit'].handler(context(undefined, submission('public-work')) as never);

    expect(result.data.success).toBe(false);
    expect(repository.listGuestComments({})).toEqual([]);
  });
});

describe('public profile contract', () => {
  it('returns only a public profile projection with safe contact links', async () => {
    const { actions } = createActions();
    const result = await actions['v1.profile.public'].handler(context(undefined, {}) as never);

    expect(result.data.content).toEqual({ displayName: 'StarLight', biography: 'Photography portfolio and journal.', contactLinks: [{ kind: 'website', href: 'https://example.com' }] });
  });
});
