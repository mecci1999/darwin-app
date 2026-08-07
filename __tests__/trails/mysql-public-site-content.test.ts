import { Actor, DEFAULT_PUBLIC_SITE_CHROME, EffectivePublicSiteContent } from '../../src/apps/starlight/trails/types';
import { MySqlPublicSiteContentRepository, PublicSiteContentModel } from '../../src/apps/starlight/trails/repository/mysqlPublicSiteContent';

const actor: Actor = { tenantId: 'tenant-site', userId: 'owner-site', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const timestamp = new Date('2026-08-01T00:00:00.000Z');
const connection = { transaction: async <T>(work: (transaction: object) => Promise<T>) => work({}) };
const validLegacyContent = { displayName: 'Creator', biography: { plainText: 'Safe biography.' }, contactLinks: [{ kind: 'website' as const, href: 'https://example.com/' }], licensingCopy: 'Rights reserved.', seo: { title: 'Creator', description: 'Photography.' } };
const validContent: EffectivePublicSiteContent = { ...validLegacyContent, chrome: { navigation: [{ label: 'Home', target: 'home' }], footer: { links: [], copyright: '© Creator' } } };
const aboutProfile = { professionalIdentity: { headline: 'Landscape photographer', disciplines: ['Long exposure'] }, practiceStatement: 'I work slowly with weather and changing light.', collaborationDirections: ['Editorial commissions'], selectedCredentials: ['Selected group exhibition'], selectedProjects: [{ title: 'Quiet horizons', summary: 'A study of low light and open ground.' }] };
const row = (contentJson: string) => ({ tenantId: actor.tenantId, ownerUserId: actor.userId, status: 'draft' as const, contentJson, resourceVersion: '1', createdAt: timestamp, updatedAt: timestamp });

describe('MySqlPublicSiteContentRepository canonicalization', () => {
  const model = (): jest.Mocked<PublicSiteContentModel> => ({ find: jest.fn(), create: jest.fn(), update: jest.fn() });

  it('rejects malformed persisted JSON on hydration without mutations', async () => {
    const store = model(); store.find.mockResolvedValue(row('{bad json'));
    const repository = new MySqlPublicSiteContentRepository(connection, store, () => timestamp);
    await expect(repository.readWorkspace(actor)).rejects.toThrow('contentJson无效');
    expect(store.create).not.toHaveBeenCalled(); expect(store.update).not.toHaveBeenCalled();
  });

  it('does not update malformed persisted content during a publish transition', async () => {
    const store = model(); store.find.mockResolvedValue(row(JSON.stringify({ ...validLegacyContent, contactLinks: [{ kind: 'website', href: 'https://127.0.0.1/' }] })));
    const repository = new MySqlPublicSiteContentRepository(connection, store, () => timestamp);
    await expect(repository.publish(actor, { resourceVersion: '1' })).rejects.toThrow('contentJson.contactLinks[0].href无效');
    expect(store.create).not.toHaveBeenCalled(); expect(store.update).not.toHaveBeenCalled();
  });

  it.each(['http://example.com/', 'https://localhost/', 'https://127.0.0.1/', 'https://[::1]/', 'https://user:pass@example.com/', 'https://example.com:8443/', 'https://example.com:443/', 'https://example.com/path', 'https://example.com/?q=1', 'https://example.com/#fragment'])('rejects unsafe persisted contact URL %s without an update', async (href) => {
    const store = model(); store.find.mockResolvedValue(row(JSON.stringify({ ...validContent, contactLinks: [{ kind: 'website', href }] })));
    const repository = new MySqlPublicSiteContentRepository(connection, store, () => timestamp);
    await expect(repository.publish(actor, { resourceVersion: '1' })).rejects.toThrow();
    expect(store.update).not.toHaveBeenCalled();
  });

  it('hydrates valid legacy content with the deterministic chrome default and persists it on the next draft', async () => {
    const store = model(); const legacy = row(JSON.stringify(validLegacyContent));
    store.find.mockResolvedValue(legacy); store.update.mockImplementation(async (_current, next) => next);
    const repository = new MySqlPublicSiteContentRepository(connection, store, () => timestamp);
    await expect(repository.readWorkspace(actor)).resolves.toMatchObject({ chrome: DEFAULT_PUBLIC_SITE_CHROME });
    const saved = await repository.saveDraft(actor, { ...validContent, resourceVersion: '1' });
    expect(saved.chrome).toEqual(validContent.chrome);
    expect(JSON.parse(store.update.mock.calls[0][1].contentJson).chrome).toEqual(validContent.chrome);
  });
  it('keeps legacy chrome footers without an ICP filing number valid and persists a valid optional number', async () => {
    const store = model(); store.find.mockResolvedValue(row(JSON.stringify(validContent))); store.update.mockImplementation(async (_current, next) => next);
    const repository = new MySqlPublicSiteContentRepository(connection, store, () => timestamp);
    await expect(repository.readWorkspace(actor)).resolves.not.toHaveProperty('chrome.footer.icpFilingNumber');
    await expect(repository.saveDraft(actor, { ...validContent, chrome: { ...validContent.chrome, footer: { ...validContent.chrome.footer, icpFilingNumber: '粤ICP备2026110162号' } }, resourceVersion: '1' })).resolves.toMatchObject({ chrome: { footer: { icpFilingNumber: '粤ICP备2026110162号' } } });
  });
  it.each(['<b>粤ICP备2026110162号</b>', '粤ICP备2026110162号\u0001', '粤 ICP备2026110162号', 'https://beian.miit.gov.cn/', '粤ICP备2026110162号-1234'])('rejects invalid persisted ICP filing number %s', async (icpFilingNumber) => {
    const store = model(); store.find.mockResolvedValue(row(JSON.stringify({ ...validContent, chrome: { ...validContent.chrome, footer: { ...validContent.chrome.footer, icpFilingNumber } } })));
    const repository = new MySqlPublicSiteContentRepository(connection, store, () => timestamp);
    await expect(repository.readWorkspace(actor)).rejects.toThrow();
  });
  it('rejects an extra persisted footer property', async () => {
    const store = model(); store.find.mockResolvedValue(row(JSON.stringify({ ...validContent, chrome: { ...validContent.chrome, footer: { ...validContent.chrome.footer, icpUrl: 'https://evil.example/' } } })));
    const repository = new MySqlPublicSiteContentRepository(connection, store, () => timestamp);
    await expect(repository.readWorkspace(actor)).rejects.toThrow();
  });
  it('keeps legacy Shooting Places chrome valid without a data migration while defaults omit it', async () => {
    const legacyChrome = { navigation: [{ label: 'Shooting Places', target: 'locations' }], footer: { links: [], copyright: '© Creator' } };
    const store = model(); store.find.mockResolvedValue(row(JSON.stringify({ ...validContent, chrome: legacyChrome })));
    const repository = new MySqlPublicSiteContentRepository(connection, store, () => timestamp);
    await expect(repository.readWorkspace(actor)).resolves.toMatchObject({ chrome: legacyChrome });
    expect(DEFAULT_PUBLIC_SITE_CHROME.navigation).not.toContainEqual({ label: 'Shooting Places', target: 'locations' });
  });
  it('hydrates and persists the closed optional about profile while retaining legacy documents without it', async () => {
    const store = model(); store.find.mockResolvedValue(row(JSON.stringify({ ...validContent, aboutProfile }))); store.update.mockImplementation(async (_current, next) => next);
    const repository = new MySqlPublicSiteContentRepository(connection, store, () => timestamp);
    await expect(repository.readWorkspace(actor)).resolves.toMatchObject({ aboutProfile });
    await expect(repository.saveDraft(actor, { ...validContent, aboutProfile, resourceVersion: '1' })).resolves.toMatchObject({ aboutProfile });
  });
  it('hydrates and persists an optional opaque About portrait media ID while legacy documents omit it', async () => {
    const store = model(); store.find.mockResolvedValue(row(JSON.stringify({ ...validContent, aboutPortraitMediaId: 'media_portrait' }))); store.update.mockImplementation(async (_current, next) => next);
    const repository = new MySqlPublicSiteContentRepository(connection, store, () => timestamp);
    await expect(repository.readWorkspace(actor)).resolves.toMatchObject({ aboutPortraitMediaId: 'media_portrait' });
    await expect(repository.saveDraft(actor, { ...validContent, aboutPortraitMediaId: 'media_portrait', resourceVersion: '1' })).resolves.toMatchObject({ aboutPortraitMediaId: 'media_portrait' });
    const legacyStore = model(); legacyStore.find.mockResolvedValue(row(JSON.stringify(validContent))); const legacyRepository = new MySqlPublicSiteContentRepository(connection, legacyStore, () => timestamp);
    await expect(legacyRepository.readWorkspace(actor)).resolves.not.toHaveProperty('aboutPortraitMediaId');
  });
  it.each(['', 'https://private.example/signed', '../object-key', 'with space'])('rejects invalid persisted About portrait ID %s', async (aboutPortraitMediaId) => {
    const store = model(); store.find.mockResolvedValue(row(JSON.stringify({ ...validContent, aboutPortraitMediaId })));
    const repository = new MySqlPublicSiteContentRepository(connection, store, () => timestamp);
    await expect(repository.readWorkspace(actor)).rejects.toThrow();
  });
  it.each([['unknown key', { ...aboutProfile, location: 'Private studio' }], ['unsafe URL', { ...aboutProfile, practiceStatement: 'See https://example.com' }], ['email', { ...aboutProfile, selectedCredentials: ['person@example.com'] }], ['phone', { ...aboutProfile, collaborationDirections: ['Call +1 555 555 5555'] }], ['coordinates', { ...aboutProfile, selectedProjects: [{ title: 'Coordinates', summary: '30.123, 120.456' }] }]])('rejects persisted aboutProfile with %s', async (_label, invalidProfile) => {
    const store = model(); store.find.mockResolvedValue(row(JSON.stringify({ ...validContent, aboutProfile: invalidProfile })));
    const repository = new MySqlPublicSiteContentRepository(connection, store, () => timestamp);
    await expect(repository.readWorkspace(actor)).rejects.toThrow();
  });
});
