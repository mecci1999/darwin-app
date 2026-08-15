import { Starlight } from '../../src/typings';
import trailsActions from '../../src/apps/trails/actions';
import { InMemoryTrailsRepository } from '../../src/apps/trails/repository';
import { Actor, DEFAULT_PUBLIC_SITE_CHROME, DurableGuestComment, DurableGuestCommentStore, DurablePublicSiteContent, DurablePublicSiteContentStore, publicChromeTargets, TrailsState } from '../../src/apps/trails/types';
import { TrailsGuestCommentStaleVersionError } from '../../src/apps/trails/repository/mysqlGuestComment';
import { TrailsPublicSiteContentStaleVersionError } from '../../src/apps/trails/repository/mysqlPublicSiteContent';

const owner: Actor = { tenantId: 'tenant-public', userId: 'owner-public', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const participant: Actor = { tenantId: owner.tenantId, userId: 'participant', isAdmin: false, creatorSpaceRole: 'participant' };
const star = { emit: jest.fn() } as unknown as Starlight;
const context = (actor: Actor | undefined, params: object) => ({ meta: actor ? { tenantId: actor.tenantId, user: actor } : {}, params });
const chrome = { navigation: [{ label: 'Home', target: 'home' as const }], footer: { links: [{ label: 'About', target: 'about' as const }], copyright: '© Creator' } };
const site: DurablePublicSiteContent = { tenantId: owner.tenantId, ownerUserId: owner.userId, status: 'published', displayName: 'Creator', biography: { plainText: 'Safe plain biography.' }, contactLinks: [{ kind: 'website', href: 'https://example.com' }], licensingCopy: 'All rights reserved.', seo: { title: 'Creator', description: 'Photography' }, chrome, resourceVersion: '2', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', publishedAt: '2026-01-01T00:00:00.000Z' };
const comment: DurableGuestComment = { id: 'comment-1', tenantId: owner.tenantId, ownerUserId: owner.userId, subjectType: 'guestbook', displayName: 'Guest', avatarId: 'amber-fox', body: 'A plain text note.', verificationTokenHash: 'b'.repeat(64), verificationExpiresAt: '2026-01-01T01:00:00.000Z', status: 'pending-moderation', resourceVersion: '2', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
const profileStore = (overrides: Partial<DurablePublicSiteContentStore> = {}): DurablePublicSiteContentStore => ({ readWorkspace: jest.fn(async (): Promise<DurablePublicSiteContent> => site), saveDraft: jest.fn(async (): Promise<DurablePublicSiteContent> => ({ ...site, status: 'draft' })), publish: jest.fn(async (): Promise<DurablePublicSiteContent> => site), unpublish: jest.fn(async (): Promise<DurablePublicSiteContent> => ({ ...site, status: 'draft' })), readPublic: jest.fn(async (): Promise<DurablePublicSiteContent> => site), ...overrides });
const commentStore = (overrides: Partial<DurableGuestCommentStore> = {}): DurableGuestCommentStore => ({ submit: jest.fn(async (): Promise<DurableGuestComment> => ({ ...comment, id: 'submitted', status: 'pending-verification' })), verify: jest.fn(async (): Promise<DurableGuestComment> => comment), listModeration: jest.fn(async (): Promise<DurableGuestComment[]> => [comment]), moderate: jest.fn(async (): Promise<DurableGuestComment> => ({ ...comment, status: 'approved' })), listPublic: jest.fn(async (): Promise<DurableGuestComment[]> => [{ ...comment, status: 'approved' }]), redactRetained: jest.fn(async (): Promise<number> => 1), dispatchPending: jest.fn(async () => ({ outcome: 'sent' as const })), retryNotifications: jest.fn(async () => ({ attempted: 0, sent: 0, retryableFailures: 0 })), ...overrides });
const state = (overrides: Partial<TrailsState> = {}): TrailsState => ({ repository: new InMemoryTrailsRepository(), publicOwnerResolver: { resolve: () => ({ tenantId: owner.tenantId, ownerUserId: owner.userId }) }, durablePublicSiteContentStore: profileStore(), ...overrides });
const draftPayload = { displayName: 'Creator', biography: { plainText: 'Safe plain biography.' }, contactLinks: [{ kind: 'website', href: 'https://example.com' }], licensingCopy: 'All rights reserved.', seo: { title: 'Creator', description: 'Photography' }, chrome, resourceVersion: null };
const aboutProfile = { professionalIdentity: { headline: 'Landscape photographer', disciplines: ['Long exposure'] }, practiceStatement: 'I work slowly with weather and changing light.', collaborationDirections: ['Editorial commissions'], selectedCredentials: ['Selected group exhibition'], selectedProjects: [{ title: 'Quiet horizons', summary: 'A study of low light and open ground.' }] };

describe('v2 durable public content actions', () => {
  it('omits temporarily hidden tabs from default chrome while retaining their fixed targets for a future re-enable', () => {
    expect(DEFAULT_PUBLIC_SITE_CHROME.navigation).toContainEqual({ label: '影像', target: 'home' });
    expect(DEFAULT_PUBLIC_SITE_CHROME.navigation.map(link => link.target)).toEqual(['home', 'stories', 'trips', 'about', 'guestbook']);
    expect(publicChromeTargets).toEqual(['home', 'editions', 'stories', 'trips', 'locations', 'about', 'guestbook']);
  });
  it('enforces 401/403/503/409 and returns the safe configured-owner projection only', async () => {
    const missing = await trailsActions(star, state({ durablePublicSiteContentStore: undefined }))['v2.site-content.draft'].handler(context(owner, draftPayload) as never);
    const unauthenticated = await trailsActions(star, state({ durablePublicSiteContentStore: profileStore() }))['v2.site-content.draft'].handler(context(undefined, draftPayload) as never);
    const forbidden = await trailsActions(star, state({ durablePublicSiteContentStore: profileStore() }))['v2.site-content.draft'].handler(context(participant, draftPayload) as never);
    const stale = await trailsActions(star, state({ durablePublicSiteContentStore: profileStore({ publish: jest.fn(async () => { throw new TrailsPublicSiteContentStaleVersionError(); }) }) }))['v2.site-content.publish'].handler(context(owner, { resourceVersion: '2' }) as never);
    const publicResult = await trailsActions(star, state({ durablePublicSiteContentStore: profileStore() }))['v2.site-content.public'].handler(context(undefined, { ownerUserId: 'spoofed' }) as never);
    expect(missing.status).toBe(503); expect(unauthenticated.status).toBe(401); expect(forbidden.status).toBe(403); expect(stale.status).toBe(409);
    expect(publicResult.data.content).toEqual({ displayName: 'Creator', biography: 'Safe plain biography.', contactLinks: [{ kind: 'website', href: 'https://example.com' }], licensingCopy: 'All rights reserved.', seo: { title: 'Creator', description: 'Photography' }, chrome });
  });
  it('excludes temporarily hidden legacy chrome from public output while retaining it in the workspace projection for future re-enable', async () => {
    const legacyChrome = { navigation: [{ label: 'Home', target: 'home' as const }, { label: 'Editions', target: 'editions' as const }, { label: 'Shooting Places', target: 'locations' as const }], footer: { links: [{ label: 'About', target: 'about' as const }, { label: 'Editions', target: 'editions' as const }, { label: 'Shooting Places', target: 'locations' as const }], copyright: '© Creator' } };
    const store = profileStore({ readPublic: jest.fn(async (): Promise<DurablePublicSiteContent> => ({ ...site, chrome: legacyChrome })), readWorkspace: jest.fn(async (): Promise<DurablePublicSiteContent> => ({ ...site, chrome: legacyChrome })) });
    const actions = trailsActions(star, state({ durablePublicSiteContentStore: store }));
    const published = await actions['v2.site-content.public'].handler(context(undefined, {}) as never);
    const workspace = await actions['v2.site-content.workspace'].handler(context(owner, {}) as never);
    expect(published.data.content).toMatchObject({ chrome: { navigation: [{ label: 'Home', target: 'home' }], footer: { links: [{ label: 'About', target: 'about' }], copyright: '© Creator' } } });
    expect(workspace.data.content).toMatchObject({ chrome: legacyChrome });
    expect(legacyChrome).toEqual({ navigation: [{ label: 'Home', target: 'home' }, { label: 'Editions', target: 'editions' }, { label: 'Shooting Places', target: 'locations' }], footer: { links: [{ label: 'About', target: 'about' }, { label: 'Editions', target: 'editions' }, { label: 'Shooting Places', target: 'locations' }], copyright: '© Creator' } });
  });
  it('uses one identity-free workspace projection and explicit null for the first-use no-row state', async () => {
    const persisted = profileStore(); const actions = trailsActions(star, state({ durablePublicSiteContentStore: persisted }));
    const workspace = await actions['v2.site-content.workspace'].handler(context(owner, {}) as never);
    const draft = await actions['v2.site-content.draft'].handler(context(owner, draftPayload) as never);
    const published = await actions['v2.site-content.publish'].handler(context(owner, { resourceVersion: '2' }) as never);
    const unpublished = await actions['v2.site-content.unpublish'].handler(context(owner, { resourceVersion: '2' }) as never);
    const expected = { displayName: 'Creator', biography: { plainText: 'Safe plain biography.' }, contactLinks: [{ kind: 'website', href: 'https://example.com' }], licensingCopy: 'All rights reserved.', seo: { title: 'Creator', description: 'Photography' }, chrome, status: 'published', resourceVersion: '2' };
    expect(workspace.data.content).toEqual(expected); expect(draft.data.content).toEqual({ ...expected, status: 'draft' }); expect(published.data.content).toEqual(expected); expect(unpublished.data.content).toEqual({ ...expected, status: 'draft' });
    expect(workspace.data.content).not.toHaveProperty('tenantId'); expect(workspace.data.content).not.toHaveProperty('ownerUserId'); expect(workspace.data.content).not.toHaveProperty('createdAt');
    const empty = profileStore({ readWorkspace: jest.fn(async () => undefined) }); const emptyResult = await trailsActions(star, state({ durablePublicSiteContentStore: empty }))['v2.site-content.workspace'].handler(context(owner, {}) as never);
    expect(emptyResult.status).toBe(200); expect(emptyResult.data.content).toBeNull();
  });
  it('rejects unsafe non-HTTPS contact links without invoking the durable store', async () => {
    const store = profileStore(); const result = await trailsActions(star, state({ durablePublicSiteContentStore: store }))['v2.site-content.draft'].handler(context(owner, { ...draftPayload, contactLinks: [{ kind: 'website', href: 'http://127.0.0.1/' }] }) as never);
    expect(result.status).toBe(400); expect(store.saveDraft).not.toHaveBeenCalled();
  });
  it('projects only a valid optional aboutProfile through owner draft and public reads', async () => {
    const store = profileStore({ saveDraft: jest.fn(async (): Promise<DurablePublicSiteContent> => ({ ...site, aboutProfile, status: 'draft' })), readPublic: jest.fn(async (): Promise<DurablePublicSiteContent> => ({ ...site, aboutProfile })) });
    const actions = trailsActions(star, state({ durablePublicSiteContentStore: store }));
    const drafted = await actions['v2.site-content.draft'].handler(context(owner, { ...draftPayload, aboutProfile }) as never);
    const published = await actions['v2.site-content.public'].handler(context(undefined, {}) as never);
    expect(drafted.data.content).toMatchObject({ aboutProfile, status: 'draft' }); expect(published.data.content).toMatchObject({ aboutProfile }); expect(published.data.content).not.toHaveProperty('resourceVersion'); expect(published.data.content).not.toHaveProperty('ownerUserId');
  });
  it('authorizes and projects only a creator-owned ready About portrait media ID', async () => {
    const registry = { listWorkspacePicker: jest.fn(async () => [{ id: 'media_portrait', lifecycle: 'published' as const, readiness: 'ready' as const, mimeType: 'image/jpeg', renditions: [] }]) };
    const store = profileStore({ saveDraft: jest.fn(async (): Promise<DurablePublicSiteContent> => ({ ...site, aboutPortraitMediaId: 'media_portrait', status: 'draft' })), readPublic: jest.fn(async (): Promise<DurablePublicSiteContent> => ({ ...site, aboutPortraitMediaId: 'media_portrait' })) });
    const actions = trailsActions(star, state({ durablePublicSiteContentStore: store, durableMediaAssetRegistryStore: registry as never }));
    const drafted = await actions['v2.site-content.draft'].handler(context(owner, { ...draftPayload, aboutPortraitMediaId: 'media_portrait' }) as never);
    const published = await actions['v2.site-content.public'].handler(context(undefined, {}) as never);
    expect(registry.listWorkspacePicker).toHaveBeenCalledWith(owner); expect(drafted.data.content).toMatchObject({ aboutPortraitMediaId: 'media_portrait' }); expect(published.data.content).toEqual(expect.objectContaining({ aboutPortraitMediaId: 'media_portrait' })); expect(published.data.content).not.toHaveProperty('privateMasterLocator');
  });
  it.each(['unknown_media', 'https://private.example/signed', '', '../object-key'])('rejects unavailable or malformed About portrait media %s before persistence', async (aboutPortraitMediaId) => {
    const store = profileStore(); const registry = { listWorkspacePicker: jest.fn(async () => []) };
    const result = await trailsActions(star, state({ durablePublicSiteContentStore: store, durableMediaAssetRegistryStore: registry as never }))['v2.site-content.draft'].handler(context(owner, { ...draftPayload, aboutPortraitMediaId }) as never);
    expect(result.status).toBe(400); expect(store.saveDraft).not.toHaveBeenCalled();
  });
  it('fails closed when portrait authorization registry is unavailable', async () => {
    const store = profileStore(); const result = await trailsActions(star, state({ durablePublicSiteContentStore: store }))['v2.site-content.draft'].handler(context(owner, { ...draftPayload, aboutPortraitMediaId: 'media_portrait' }) as never);
    expect(result.status).toBe(400); expect(store.saveDraft).not.toHaveBeenCalled();
  });
  it('accepts and projects a valid optional ICP filing number without adding a configurable destination', async () => {
    const icpFilingNumber = '粤ICP备2026110162号'; const store = profileStore({ saveDraft: jest.fn(async (): Promise<DurablePublicSiteContent> => ({ ...site, chrome: { ...chrome, footer: { ...chrome.footer, icpFilingNumber } }, status: 'draft' })), readPublic: jest.fn(async (): Promise<DurablePublicSiteContent> => ({ ...site, chrome: { ...chrome, footer: { ...chrome.footer, icpFilingNumber } } })) });
    const actions = trailsActions(star, state({ durablePublicSiteContentStore: store }));
    const drafted = await actions['v2.site-content.draft'].handler(context(owner, { ...draftPayload, chrome: { ...chrome, footer: { ...chrome.footer, icpFilingNumber } } }) as never);
    const published = await actions['v2.site-content.public'].handler(context(undefined, {}) as never);
    expect(drafted.data.content).toMatchObject({ chrome: { footer: { icpFilingNumber } } }); expect(published.data.content).toMatchObject({ chrome: { footer: { icpFilingNumber } } }); expect(published.data.content.chrome.footer).not.toHaveProperty('icpUrl');
  });
  it.each(['<b>粤ICP备2026110162号</b>', '粤ICP备2026110162号\u0001', '粤 ICP备2026110162号', 'https://beian.miit.gov.cn/', '粤ICP备2026110162号-1234'])('rejects invalid ICP filing number %s before persistence', async (icpFilingNumber) => {
    const store = profileStore(); const result = await trailsActions(star, state({ durablePublicSiteContentStore: store }))['v2.site-content.draft'].handler(context(owner, { ...draftPayload, chrome: { ...chrome, footer: { ...chrome.footer, icpFilingNumber } } }) as never);
    expect(result.status).toBe(400); expect(store.saveDraft).not.toHaveBeenCalled();
  });
  it.each([{ ...aboutProfile, href: 'https://example.com' }, { ...aboutProfile, practiceStatement: 'www.example.com' }, { ...aboutProfile, selectedCredentials: ['person@example.com'] }, { ...aboutProfile, collaborationDirections: ['+1 555 555 5555'] }, { ...aboutProfile, selectedProjects: [{ title: 'map', summary: '30.123, 120.456' }] }])('rejects unsafe or extra aboutProfile values before persistence', async (invalidProfile) => {
    const store = profileStore(); const result = await trailsActions(star, state({ durablePublicSiteContentStore: store }))['v2.site-content.draft'].handler(context(owner, { ...draftPayload, aboutProfile: invalidProfile }) as never);
    expect(result.status).toBe(400); expect(store.saveDraft).not.toHaveBeenCalled();
  });
  it.each([
    ['unknown top-level field', { ...draftPayload, canonical: 'https://evil.example' }],
    ['unknown nested field', { ...draftPayload, chrome: { ...chrome, rawHtml: '<script>' } }],
    ['configurable ICP destination', { ...draftPayload, chrome: { ...chrome, footer: { ...chrome.footer, icpUrl: 'https://evil.example/' } } }],
    ['raw target path', { ...draftPayload, chrome: { ...chrome, navigation: [{ label: 'Home', target: '/' }] } }],
    ['duplicate target', { ...draftPayload, chrome: { ...chrome, navigation: [{ label: 'Home', target: 'home' }, { label: 'Again', target: 'home' }] } }],
    ['contact extension', { ...draftPayload, contactLinks: [{ kind: 'website', href: 'https://example.com', hrefRaw: 'javascript:alert(1)' }] }],
    ['forbidden deployment field', { ...draftPayload, robots: 'noindex' }],
    ['forbidden structured payload', { ...draftPayload, jsonLd: { '@context': 'https://schema.org' } }],
  ])('rejects constrained chrome %s before persistence', async (_label, payload) => {
    const store = profileStore(); const result = await trailsActions(star, state({ durablePublicSiteContentStore: store }))['v2.site-content.draft'].handler(context(owner, payload) as never);
    expect(result.status).toBe(400); expect(store.saveDraft).not.toHaveBeenCalled();
  });
  it.each(['http://example.com/', 'https://localhost/', 'https://127.0.0.1/', 'https://[::1]/', 'https://user:pass@example.com/', 'https://example.com:8443/', 'https://example.com:443/', 'https://example.com/path', 'https://example.com/?q=1', 'https://example.com/#fragment'])('rejects unsafe draft contact URL %s before persistence', async (href) => {
    const store = profileStore(); const result = await trailsActions(star, state({ durablePublicSiteContentStore: store }))['v2.site-content.draft'].handler(context(owner, { ...draftPayload, contactLinks: [{ kind: 'website', href }] }) as never);
    expect(result.status).toBe(400); expect(store.saveDraft).not.toHaveBeenCalled();
  });
  it.each(['displayName', 'licensingCopy', 'biography', 'seoTitle', 'seoDescription'])('rejects markup and controls in %s', async (field) => {
    const store = profileStore(); const payload = { ...draftPayload, biography: { ...draftPayload.biography }, seo: { ...draftPayload.seo } };
    if (field === 'displayName') payload.displayName = '<b>Creator</b>';
    if (field === 'licensingCopy') payload.licensingCopy = 'ok\u0001';
    if (field === 'biography') payload.biography.plainText = '<p>bio</p>';
    if (field === 'seoTitle') payload.seo.title = 'bad\u007f';
    if (field === 'seoDescription') payload.seo.description = '<meta>';
    const result = await trailsActions(star, state({ durablePublicSiteContentStore: store }))['v2.site-content.draft'].handler(context(owner, payload) as never);
    expect(result.status).toBe(400); expect(store.saveDraft).not.toHaveBeenCalled();
  });
});

describe('v2 durable guest comments actions', () => {
  const submission = { subjectType: 'guestbook', displayName: 'Guest', email: 'Guest@Example.COM', avatarId: 'amber-fox', body: 'A plain text note.' };
  it('fails closed before persistence for missing/denied anti-abuse or notification configuration', async () => {
    const store = commentStore(); const missing = await trailsActions(star, state({ durableGuestCommentStore: store }))['v2.comments.submit'].handler(context(undefined, submission) as never);
    const denied = await trailsActions(star, state({ durableGuestCommentStore: store, antiAbuse: { assessSubmission: jest.fn(async () => ({ allowed: false })) }, commentVerificationNotificationDispatcher: { dispatchVerification: jest.fn(async () => undefined) } }))['v2.comments.submit'].handler(context(undefined, submission) as never);
    expect(missing.status).toBe(503); expect(denied.status).toBe(429); expect(store.submit).not.toHaveBeenCalled();
  });
  it('does not disclose email/token and guards moderation ownership and conflicts', async () => {
    const store = commentStore(); const actions = trailsActions(star, state({ durableGuestCommentStore: store, antiAbuse: { assessSubmission: jest.fn(async () => ({ allowed: true })) }, commentVerificationNotificationDispatcher: { dispatchVerification: jest.fn(async () => undefined) } }));
    const created = await actions['v2.comments.submit'].handler(context(undefined, submission) as never);
    const forbidden = await actions['v2.comments.moderate'].handler(context(participant, { id: comment.id, status: 'approved', resourceVersion: '2' }) as never);
    const conflict = await trailsActions(star, state({ durableGuestCommentStore: commentStore({ moderate: jest.fn(async () => { throw new TrailsGuestCommentStaleVersionError(); }) }) }))['v2.comments.moderate'].handler(context(owner, { id: comment.id, status: 'approved', resourceVersion: '2' }) as never);
    const queue = await actions['v2.comments.moderation-queue'].handler(context(owner, {}) as never);
    const publicResult = await actions['v2.comments.public'].handler(context(undefined, { subjectType: 'guestbook' }) as never);
    expect(created.status).toBe(201); expect(created.data.content).not.toHaveProperty('email'); expect(created.data.content).not.toHaveProperty('verificationToken'); expect(forbidden.status).toBe(403); expect(conflict.status).toBe(409); expect(queue.data.content).toEqual([expect.objectContaining({ id: comment.id, resourceVersion: comment.resourceVersion })]); expect(publicResult.data.content).toEqual([{ id: comment.id, subjectType: 'guestbook', displayName: 'Guest', avatarId: 'amber-fox', body: 'A plain text note.', createdAt: comment.createdAt }]);
  });
  it('requires published site content for guestbook submission and public listing', async () => {
    const store = commentStore(); const unpublished = profileStore({ readPublic: jest.fn(async () => undefined) }); const actions = trailsActions(star, state({ durableGuestCommentStore: store, durablePublicSiteContentStore: unpublished, antiAbuse: { assessSubmission: jest.fn(async () => ({ allowed: true })) }, commentVerificationNotificationDispatcher: { dispatchVerification: jest.fn(async () => undefined) } }));
    const submitted = await actions['v2.comments.submit'].handler(context(undefined, submission) as never);
    const listed = await actions['v2.comments.public'].handler(context(undefined, { subjectType: 'guestbook' }) as never);
    expect(submitted.status).toBe(404); expect(listed.status).toBe(404); expect(store.submit).not.toHaveBeenCalled(); expect(store.listPublic).not.toHaveBeenCalled();
  });
  it('returns queued after persistence even when the post-commit dispatch attempt fails', async () => {
    const order: string[] = []; const store = commentStore({ submit: jest.fn(async (): Promise<DurableGuestComment> => { order.push('persist'); return { ...comment, id: 'submitted', status: 'pending-verification' }; }), dispatchPending: jest.fn(async () => { order.push('dispatch'); throw new Error('transport unavailable'); }) }); const dispatcher = { dispatchVerification: jest.fn(async () => undefined) };
    const result = await trailsActions(star, state({ durableGuestCommentStore: store, antiAbuse: { assessSubmission: jest.fn(async () => ({ allowed: true })) }, commentVerificationNotificationDispatcher: dispatcher }))['v2.comments.submit'].handler(context(undefined, submission) as never);
    await Promise.resolve(); expect(result.status).toBe(201); expect(order).toEqual(['persist', 'dispatch']); expect(dispatcher.dispatchVerification).not.toHaveBeenCalled(); expect(result.data.content).toEqual(expect.objectContaining({ notification: 'queued' }));
  });
  it('maps malformed public comment input to 400 and does not persist', async () => {
    for (const invalid of [{ ...submission, displayName: '<bad>' }, { ...submission, email: 'bad-email' }, { ...submission, avatarId: 'attacker' }, { ...submission, body: '<b>bad</b>' }]) { const store = commentStore(); const result = await trailsActions(star, state({ durableGuestCommentStore: store, antiAbuse: { assessSubmission: jest.fn(async () => ({ allowed: true })) }, commentVerificationNotificationDispatcher: { dispatchVerification: jest.fn(async () => undefined) } }))['v2.comments.submit'].handler(context(undefined, invalid) as never); expect(result.status).toBe(400); expect(store.submit).not.toHaveBeenCalled(); }
  });
  it('rejects irrelevant guestbook subject IDs and invalid non-guestbook opaque IDs with 400', async () => {
    const store = commentStore(); const actions = trailsActions(star, state({ durableGuestCommentStore: store, antiAbuse: { assessSubmission: jest.fn(async () => ({ allowed: true })) }, commentVerificationNotificationDispatcher: { dispatchVerification: jest.fn(async () => undefined) } }));
    const guestbookWithSubject = await actions['v2.comments.submit'].handler(context(undefined, { ...submission, subjectId: 'irrelevant' }) as never);
    const malformedSubject = await actions['v2.comments.public'].handler(context(undefined, { subjectType: 'portfolio', subjectId: 'not an opaque id' }) as never);
    expect(guestbookWithSubject.status).toBe(400); expect(malformedSubject.status).toBe(400); expect(store.submit).not.toHaveBeenCalled(); expect(store.listPublic).not.toHaveBeenCalled();
  });
  it('exposes bounded notification retries only to trusted admins', async () => {
    const store = commentStore({ retryNotifications: jest.fn(async () => ({ attempted: 1, sent: 1, retryableFailures: 0 })) }); const admin: Actor = { ...owner, isAdmin: true };
    const forbidden = await trailsActions(star, state({ durableGuestCommentStore: store, commentVerificationNotificationDispatcher: { dispatchVerification: jest.fn(async () => undefined) } }))['v2.comments.notifications.retry'].handler(context(owner, { limit: 1 }) as never);
    const invalid = await trailsActions(star, state({ durableGuestCommentStore: store, commentVerificationNotificationDispatcher: { dispatchVerification: jest.fn(async () => undefined) } }))['v2.comments.notifications.retry'].handler(context(admin, { limit: 101 }) as never);
    const success = await trailsActions(star, state({ durableGuestCommentStore: store, commentVerificationNotificationDispatcher: { dispatchVerification: jest.fn(async () => undefined) } }))['v2.comments.notifications.retry'].handler(context(admin, { limit: 1 }) as never);
    expect(forbidden.status).toBe(403); expect(invalid.status).toBe(400); expect(success.data.content).toEqual({ attempted: 1, sent: 1, retryableFailures: 0 });
  });
  it('only permits owner retention redaction and validates an exact ISO cutoff', async () => {
    const store = commentStore(); const actions = trailsActions(star, state({ durableGuestCommentStore: store }));
    const forbidden = await actions['v2.comments.redact-retained'].handler(context(participant, { before: '2026-02-01T00:00:00.000Z' }) as never);
    const invalid = await actions['v2.comments.redact-retained'].handler(context(owner, { before: 'not-a-date' }) as never);
    const success = await actions['v2.comments.redact-retained'].handler(context(owner, { before: '2026-02-01T00:00:00.000Z' }) as never);
    expect(forbidden.status).toBe(403); expect(invalid.status).toBe(400); expect(success.data.content).toEqual({ redactedCount: 1 });
  });
});
