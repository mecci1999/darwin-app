import { MySqlDurableJournalRepository, DurableJournalModel } from '../../src/apps/trails/repository/mysqlDurableJournal';
import { Actor } from '../../src/apps/trails/types';
import { RichDocumentPublishValidator } from '../../src/apps/trails/repository/mysqlRichDocument';

const owner: Actor = { tenantId: 'tenant-1', userId: 'owner-1', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const timestamp = new Date('2026-07-31T00:00:00.000Z');
type Row = Parameters<DurableJournalModel['create']>[0];

const setup = (validator: RichDocumentPublishValidator = { validate: jest.fn(async () => undefined) }) => {
  const rows = new Map<string, Row>();
  const journals: DurableJournalModel = {
    create: jest.fn(async row => { rows.set(row.id, row); return row; }),
    find: jest.fn(async ({ id }) => rows.get(id)),
    list: jest.fn(async () => []),
    compareAndSwap: jest.fn(async ({ expectedVersion, next }) => rows.get(next.id)?.resourceVersion === expectedVersion ? (rows.set(next.id, next), next) : undefined),
  };
  return { journals, validator, repository: new MySqlDurableJournalRepository({ transaction: async work => work({}) }, journals, () => timestamp, validator) };
};

describe('MySqlDurableJournalRepository lifecycle', () => {
  it('updates drafts with CAS and rejects stale resource versions', async () => {
    const { repository } = setup();
    await expect(repository.createDraft(owner, { id: 'journal-1', title: 'Aurora', excerpt: 'Night', body: 'Working', visibility: 'private' })).resolves.toMatchObject({ isPinned: false });
    await expect(repository.update(owner, { id: 'journal-1', resourceVersion: '1', title: 'Dawn', excerpt: 'Light', body: 'Edited', visibility: 'public' })).resolves.toMatchObject({ resourceVersion: '2', title: 'Dawn' });
    await expect(repository.update(owner, { id: 'journal-1', resourceVersion: '1', title: 'Stale', excerpt: 'Stale', body: 'Stale', visibility: 'private' })).rejects.toThrow('版本已过期');
  });

  it('requires rich-document validation on publish and unpublishes through CAS while clearing publishedAt and isPinned', async () => {
    const validator: RichDocumentPublishValidator = { validate: jest.fn(async () => undefined) };
    const { repository, journals } = setup(validator);
    await repository.createDraft(owner, { id: 'journal-1', title: 'Aurora', excerpt: 'Night', body: 'Working', visibility: 'public' });
    const published = await repository.publish(owner, { id: 'journal-1', resourceVersion: '1' });
    expect(validator.validate).toHaveBeenCalledWith(expect.anything(), { tenantId: owner.tenantId, ownerUserId: owner.userId, subjectType: 'journal', subjectId: 'journal-1' });
    expect(published.publishedAt).toBe(timestamp.toISOString());
    const pinned = await repository.setPinned(owner, { id: 'journal-1', resourceVersion: '2', isPinned: true });
    expect(pinned).toMatchObject({ isPinned: true, resourceVersion: '3' });
    const unpublished = await repository.unpublish(owner, { id: 'journal-1', resourceVersion: '3' });
    expect(unpublished).toMatchObject({ lifecycle: 'draft', isPinned: false, resourceVersion: '4' });
    expect(unpublished).not.toHaveProperty('publishedAt');
    expect(journals.compareAndSwap).toHaveBeenCalledTimes(3);
  });

  it('allows pinning only public published journals and rejects stale pin writes', async () => {
    const { repository } = setup();
    await repository.createDraft(owner, { id: 'journal-1', title: 'Aurora', excerpt: 'Night', body: 'Working', visibility: 'private' });
    await expect(repository.setPinned(owner, { id: 'journal-1', resourceVersion: '1', isPinned: true })).rejects.toThrow('只有公开的已发布日记可以置顶');
    await repository.update(owner, { id: 'journal-1', resourceVersion: '1', title: 'Aurora', excerpt: 'Night', body: 'Working', visibility: 'public' });
    await repository.publish(owner, { id: 'journal-1', resourceVersion: '2' });
    await repository.setPinned(owner, { id: 'journal-1', resourceVersion: '3', isPinned: true });
    await expect(repository.setPinned(owner, { id: 'journal-1', resourceVersion: '3', isPinned: false })).rejects.toThrow('版本已过期');
  });

  it('fails closed for a missing or invalid rich document before transitioning lifecycle', async () => {
    const validator: RichDocumentPublishValidator = { validate: jest.fn(async () => { throw new Error('发布内容必须先保存有效富文档'); }) };
    const { repository, journals } = setup(validator);
    await repository.createDraft(owner, { id: 'journal-1', title: 'Aurora', excerpt: 'Night', body: 'Working', visibility: 'public' });
    await expect(repository.publish(owner, { id: 'journal-1', resourceVersion: '1' })).rejects.toThrow('发布内容必须先保存有效富文档');
    expect(journals.compareAndSwap).not.toHaveBeenCalled();
  });
});
