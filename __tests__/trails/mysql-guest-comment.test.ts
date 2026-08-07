import { createHash } from 'crypto';
import { createSequelizeGuestCommentStorage, MySqlGuestCommentRepository, GuestCommentStorage, TrailsGuestCommentStaleVersionError } from '../../src/apps/starlight/trails/repository/mysqlGuestComment';
import { Actor, DurableGuestComment } from '../../src/apps/starlight/trails/types';
import { TrailsGuestCommentTable } from '../../src/db/mysql/models/trailsGuestComment';
import { TrailsGuestCommentAuditTable } from '../../src/db/mysql/models/trailsGuestCommentAudit';
import { ITrailsGuestCommentNotificationTableAttributes, TrailsGuestCommentNotificationTable } from '../../src/db/mysql/models/trailsGuestCommentNotification';
import { ModelStatic } from 'sequelize';

const owner: Actor = { tenantId: 'tenant-1', userId: 'owner-1', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const stored: DurableGuestComment[] = [];
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const key = Buffer.alloc(32, 9).toString('base64');
const matches = (item: DurableGuestComment, filter: Partial<DurableGuestComment>) => Object.entries(filter).every(([key, value]) => value === undefined || item[key as keyof DurableGuestComment] === value);
const storage = (): GuestCommentStorage => ({
  submit: jest.fn(async input => { const { email: _email, verificationToken: _token, notificationPayload: _payload, ...saved } = input; stored.push(saved); return structuredClone(saved); }),
  verify: jest.fn(async (tokenHash, now) => { const item = stored.find(value => value.verificationTokenHash === tokenHash && value.status === 'pending-verification' && value.verificationExpiresAt! > now); if (!item) return undefined; item.status = 'pending-moderation'; item.verificationTokenHash = undefined; item.verificationExpiresAt = undefined; item.resourceVersion = String(BigInt(item.resourceVersion) + BigInt(1)); item.verifiedAt = now; item.updatedAt = now; return structuredClone(item); }),
  list: jest.fn(async (filter): Promise<DurableGuestComment[]> => stored.filter(item => matches(item, filter)).map(item => structuredClone(item))),
  transition: jest.fn(async input => { const item = stored.find(value => value.id === input.id && value.tenantId === input.tenantId && value.resourceVersion === input.resourceVersion); if (!item) return undefined; item.status = input.status; item.resourceVersion = String(BigInt(item.resourceVersion) + BigInt(1)); item.moderatedByUserId = input.actorUserId; item.moderatedAt = input.now; item.updatedAt = input.now; return structuredClone(item); }),
  redact: jest.fn(async input => { let count = 0; for (const item of stored) if (item.tenantId === input.tenantId && item.ownerUserId === input.ownerUserId && item.createdAt < input.before && item.status !== 'redacted') { item.displayName = 'Deleted guest'; item.body = '[redacted]'; item.status = 'redacted'; item.verificationTokenHash = undefined; item.resourceVersion = String(BigInt(item.resourceVersion) + BigInt(1)); item.redactedAt = input.now; item.updatedAt = input.now; count += 1; } return count; }),
  claim: jest.fn(async () => []),
  complete: jest.fn(async () => true),
});

describe('MySqlGuestCommentRepository durable security seam', () => {
  beforeEach(() => { stored.splice(0); });
  it('stores only hashed verification material, rejects expiry, CAS-moderates, and redacts retained records', async () => {
    const adapter = storage(); const repository = new MySqlGuestCommentRepository(adapter, key, () => new Date('2026-01-01T00:00:00.000Z'));
    const saved = await repository.submit({ id: 'comment-1', tenantId: owner.tenantId, ownerUserId: owner.userId, subjectType: 'guestbook', displayName: 'Guest', avatarId: 'amber-fox', body: 'Plain text.', email: 'guest@example.com', verificationToken: 'secret-token', verificationExpiresAt: '2026-01-01T00:30:00.000Z' });
    expect(saved.verificationTokenHash).toBe(hash('secret-token')); expect(JSON.stringify(stored)).not.toContain('secret-token'); expect(JSON.stringify(stored)).not.toContain('guest@example.com');
    expect(await repository.verify({ token: 'wrong-token' })).toBeUndefined();
    const verified = await repository.verify({ token: 'secret-token' });
    expect(verified).toEqual(expect.objectContaining({ status: 'pending-moderation', resourceVersion: '2' })); expect(verified?.verificationTokenHash).toBeUndefined();
    const approved = await repository.moderate(owner, { id: saved.id, status: 'approved', resourceVersion: '2' });
    expect(approved).toEqual(expect.objectContaining({ status: 'approved', resourceVersion: '3', moderatedByUserId: owner.userId }));
    await expect(repository.moderate(owner, { id: saved.id, status: 'rejected', resourceVersion: '2' })).rejects.toBeInstanceOf(TrailsGuestCommentStaleVersionError);
    expect(await repository.redactRetained(owner, { before: '2026-02-01T00:00:00.000Z' })).toBe(1);
    expect(stored[0]).toEqual(expect.objectContaining({ status: 'redacted', displayName: 'Deleted guest', body: '[redacted]' }));
  });
  it('rejects a verification token once its TTL has expired', async () => {
    const repository = new MySqlGuestCommentRepository(storage(), key, () => new Date('2026-01-01T01:00:00.000Z'));
    await repository.submit({ id: 'expired', tenantId: owner.tenantId, ownerUserId: owner.userId, subjectType: 'guestbook', displayName: 'Guest', avatarId: 'amber-fox', body: 'Plain text.', email: 'guest@example.com', verificationToken: 'expired-token', verificationExpiresAt: '2026-01-01T00:30:00.000Z' });
    expect(await repository.verify({ token: 'expired-token' })).toBeUndefined();
  });
  it('does not load or mutate a same-ID comment from another tenant during moderation', async () => {
    const adapter = storage(); const repository = new MySqlGuestCommentRepository(adapter, key, () => new Date('2026-01-01T00:00:00.000Z'));
    stored.push({ ...commentForTenant('tenant-other', 'owner-other'), id: 'collision', status: 'pending-moderation', resourceVersion: '2' });
    await expect(repository.moderate(owner, { id: 'collision', status: 'approved', resourceVersion: '2' })).rejects.toThrow('未找到留言');
    expect(stored[0]).toEqual(expect.objectContaining({ tenantId: 'tenant-other', status: 'pending-moderation', resourceVersion: '2' })); expect(adapter.transition).not.toHaveBeenCalled();
  });
  it('uses a stable delivery id, dispatches outside claim storage, and schedules bounded retry failure', async () => {
    const adapter = storage(); const claim = { tenantId: owner.tenantId, commentId: 'comment-1', deliveryId: 'delivery-fixed', encryptedPayload: '', leaseToken: 'lease-1', attempts: 1 };
    (adapter.claim as jest.Mock).mockResolvedValueOnce([claim]).mockResolvedValueOnce([claim]);
    const repository = new MySqlGuestCommentRepository(adapter, key, () => new Date('2026-01-01T00:00:00.000Z'));
    const dispatcher = { dispatchVerification: jest.fn(async () => { throw new Error('offline'); }) };
    const outcome = await repository.dispatchPending(dispatcher, { commentId: 'comment-1' });
    expect(outcome).toEqual({ outcome: 'retryable-failure' }); expect(adapter.complete).toHaveBeenCalledWith(claim, 'retryable-failure', '2026-01-01T00:02:00.000Z', '2026-01-01T00:00:00.000Z'); expect(dispatcher.dispatchVerification).not.toHaveBeenCalled();
  });
  it('marks a fifth failed delivery terminally and does not schedule another retry', async () => {
    const adapter = storage(); const claim = { tenantId: owner.tenantId, commentId: 'comment-1', deliveryId: 'delivery-fixed', encryptedPayload: '', leaseToken: 'lease-5', attempts: 5 };
    (adapter.claim as jest.Mock).mockResolvedValueOnce([claim]);
    const repository = new MySqlGuestCommentRepository(adapter, key, () => new Date('2026-01-01T00:00:00.000Z'));
    const outcome = await repository.dispatchPending({ dispatchVerification: jest.fn(async () => { throw new Error('offline'); }) }, { commentId: claim.commentId });
    expect(outcome).toEqual({ outcome: 'failed' });
    expect(adapter.complete).toHaveBeenCalledWith(claim, 'failed', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  });
  it('reclaims an expired processing lease while retaining its stale-lease completion fence', async () => {
    const notification: ITrailsGuestCommentNotificationTableAttributes = { tenantId: owner.tenantId, commentId: 'comment-1', deliveryId: 'delivery-fixed', encryptedPayload: 'encrypted', status: 'processing', attempts: 1, nextAttemptAt: new Date('2026-01-01T01:00:00.000Z'), leaseToken: 'expired-lease', leaseExpiresAt: new Date('2026-01-01T00:00:00.000Z') };
    const update = jest.fn(async () => [1]);
    const notifications = { findAll: jest.fn(async () => [{ get: () => notification }]), update } as unknown as ModelStatic<TrailsGuestCommentNotificationTable>;
    const comments = { sequelize: { transaction: async <T>(work: (transaction: { LOCK: { UPDATE: string } }) => Promise<T>) => work({ LOCK: { UPDATE: 'UPDATE' } }) } } as unknown as ModelStatic<TrailsGuestCommentTable>;
    const audits = {} as ModelStatic<TrailsGuestCommentAuditTable>;
    const claimed = await createSequelizeGuestCommentStorage(comments, audits, notifications, key).claim(undefined, 1, '2026-01-01T00:01:00.000Z');
    expect(claimed).toEqual([expect.objectContaining({ commentId: notification.commentId, attempts: 2 })]);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'processing', attempts: 2 }), expect.objectContaining({ where: expect.objectContaining({ status: 'processing', leaseToken: 'expired-lease', leaseExpiresAt: notification.leaseExpiresAt }) }));
  });
  it('processes one concurrent claim only and reports nothing due for the second worker', async () => {
    const adapter = storage(); const claim = { tenantId: owner.tenantId, commentId: 'comment-1', deliveryId: 'delivery-fixed', encryptedPayload: '', leaseToken: 'lease-1', attempts: 1 };
    (adapter.claim as jest.Mock).mockResolvedValueOnce([claim]).mockResolvedValueOnce([]); const repository = new MySqlGuestCommentRepository(adapter, key, () => new Date('2026-01-01T00:00:00.000Z')); const dispatcher = { dispatchVerification: jest.fn(async () => undefined) };
    await Promise.all([repository.dispatchPending(dispatcher, { commentId: 'comment-1' }), repository.dispatchPending(dispatcher, { commentId: 'comment-1' })]);
    expect(adapter.claim).toHaveBeenCalledTimes(2); expect(adapter.complete).toHaveBeenCalledTimes(1);
  });
});

const commentForTenant = (tenantId: string, ownerUserId: string): DurableGuestComment => ({ id: 'comment', tenantId, ownerUserId, subjectType: 'guestbook', displayName: 'Guest', avatarId: 'amber-fox', body: 'Plain text.', verificationTokenHash: hash('token'), verificationExpiresAt: '2026-01-01T01:00:00.000Z', status: 'pending-verification', resourceVersion: '1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
