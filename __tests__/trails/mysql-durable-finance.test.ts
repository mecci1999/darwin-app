import { Actor, DurableFinanceEntry } from '../../src/apps/starlight/trails/types';
import { DurableFinanceBalanceSnapshotModel, DurableFinanceDeletionAuditModel, DurableFinanceModel, MySqlDurableFinanceRepository, retentionExpiresAtForCalendarFinancialYear, TrailsDurableFinanceStaleVersionError } from '../../src/apps/starlight/trails/repository/mysqlDurableFinance';

const actor: Actor = { tenantId: 'tenant-1', userId: 'owner-1', isAdmin: false };
const other: Actor = { tenantId: actor.tenantId, userId: 'owner-2', isAdmin: true, creatorSpaceRole: 'creator-space-owner' };
const timestamp = new Date('2037-01-01T00:00:00.000Z');
const row = (overrides: Partial<Parameters<DurableFinanceModel['create']>[0]> = {}): Parameters<DurableFinanceModel['create']>[0] => ({ id: 'finance-1', tenantId: actor.tenantId, ownerUserId: actor.userId, occurredOn: '2026-07-31', category: 'equipment', amountCents: 1000, currency: 'CNY', calendarFinancialYear: 2026, retentionExpiresAt: new Date('2037-01-01T00:00:00.000Z'), visibility: 'private', lifecycle: 'draft', resourceVersion: '1', createdAt: timestamp, updatedAt: timestamp, ...overrides });
const snapshots = (rows: Array<Parameters<DurableFinanceBalanceSnapshotModel['create']>[0]> = []): DurableFinanceBalanceSnapshotModel => ({
  create: jest.fn(async (value) => { rows.push(value); return value; }),
  listCurrent: jest.fn(async ({ tenantId, ownerUserId, currency }) => {
    const latest = new Map<string, Parameters<DurableFinanceBalanceSnapshotModel['create']>[0]>();
    for (const value of rows.filter((row) => row.tenantId === tenantId && row.ownerUserId === ownerUserId && !row.disposedAt && (currency === undefined || row.currency === currency))) {
      if (!value.currency) continue;
      const current = latest.get(value.currency);
      if (!current || (value.observedAt?.getTime() || 0) > (current.observedAt?.getTime() || 0) || ((value.observedAt?.getTime() || 0) === (current.observedAt?.getTime() || 0) && value.id > current.id)) latest.set(value.currency, value);
    }
    return [...latest.values()].sort((left, right) => left.currency!.localeCompare(right.currency!));
  }),
  listEligible: jest.fn(async ({ tenantId, ownerUserId, eligibleAt }) => rows.filter((value) => value.tenantId === tenantId && value.ownerUserId === ownerUserId && !value.disposedAt && value.retentionExpiresAt <= eligibleAt)),
  compareAndSwap: jest.fn(async ({ id, expectedVersion, next }) => { const index = rows.findIndex((value) => value.id === id && value.resourceVersion === expectedVersion); if (index === -1) return undefined; rows[index] = next; return next; }),
});

describe('MySqlDurableFinanceRepository', () => {
  it('creates private owner-scoped records with immutable calendar expiry and validates integer minor units', async () => {
    const rows: Array<Parameters<DurableFinanceModel['create']>[0]> = [];
    const finance: DurableFinanceModel = { create: jest.fn(async (value) => { rows.push(value); return value; }), find: jest.fn(), list: jest.fn(async ({ tenantId, ownerUserId }) => rows.filter((value) => value.tenantId === tenantId && value.ownerUserId === ownerUserId)), listEligible: jest.fn(async () => []), compareAndSwap: jest.fn() };
    const audits: DurableFinanceDeletionAuditModel = { create: jest.fn() };
    const repository = new MySqlDurableFinanceRepository({ transaction: async (work) => work({}) }, finance, audits, snapshots(), () => timestamp);
    const created = await repository.create(actor, { id: 'finance-1', occurredOn: '2026-07-31', category: 'equipment', amountCents: -1000, currency: 'CNY' });
    expect(retentionExpiresAtForCalendarFinancialYear(2026).toISOString()).toBe('2037-01-01T00:00:00.000Z');
    expect(created).toEqual(expect.objectContaining({ ownerUserId: actor.userId, visibility: 'private', lifecycle: 'draft', calendarFinancialYear: 2026, retentionExpiresAt: '2037-01-01T00:00:00.000Z', resourceVersion: '1' }));
    expect(await repository.listWorkspace(other)).toEqual([]);
    await expect(repository.create(actor, { id: 'bad', occurredOn: '2026-07-31', category: 'equipment', amountCents: 1.2, currency: 'CNY' })).rejects.toThrow('amountCents必须是安全整数');
  });

  it('uses canonical BIGINT CAS, retains expiry across same-year updates, and rejects ownership or stale changes', async () => {
    const rows = [row()];
    const finance: DurableFinanceModel = { create: jest.fn(), find: jest.fn(async ({ tenantId, id }) => rows.find((value) => value.tenantId === tenantId && value.id === id)), list: jest.fn(async () => rows), listEligible: jest.fn(async () => []), compareAndSwap: jest.fn(async ({ expectedVersion, next }) => { const index = rows.findIndex((value) => value.resourceVersion === expectedVersion); if (index === -1) return undefined; rows[index] = next; return next; }) };
    const repository = new MySqlDurableFinanceRepository({ transaction: async (work) => work({}) }, finance, { create: jest.fn() }, snapshots(), () => timestamp);
    const updated = await repository.update(actor, { id: 'finance-1', resourceVersion: '1', occurredOn: '2026-08-01', category: 'travel', amountCents: 1200, currency: 'CNY' });
    expect(updated).toEqual(expect.objectContaining({ resourceVersion: '2', retentionExpiresAt: '2037-01-01T00:00:00.000Z' }));
    await expect(repository.update(other, { id: 'finance-1', resourceVersion: '2', occurredOn: '2026-08-01', category: 'travel', amountCents: 1200, currency: 'CNY' })).rejects.toThrow('账目不属于当前账号');
    await expect(repository.update(actor, { id: 'finance-1', resourceVersion: '1', occurredOn: '2026-08-01', category: 'travel', amountCents: 1200, currency: 'CNY' })).rejects.toBeInstanceOf(TrailsDurableFinanceStaleVersionError);
    await expect(repository.update(actor, { id: 'finance-1', resourceVersion: '2', occurredOn: '2027-01-01', category: 'travel', amountCents: 1200, currency: 'CNY' })).rejects.toThrow('不能跨财年');
  });

  it('redacts eligible payloads, records only minimal audit evidence, and is idempotent', async () => {
    const rows = [row()]; const audits: Array<Parameters<DurableFinanceDeletionAuditModel['create']>[0]> = [];
    const finance: DurableFinanceModel = { create: jest.fn(), find: jest.fn(), list: jest.fn(async () => rows), listEligible: jest.fn(async ({ eligibleAt }) => rows.filter((value) => !value.disposedAt && value.retentionExpiresAt <= eligibleAt)), compareAndSwap: jest.fn(async ({ next }) => { rows[0] = next; return next; }) };
    const repository = new MySqlDurableFinanceRepository({ transaction: async (work) => work({}) }, finance, { create: jest.fn(async (audit) => { audits.push(audit); return audit; }) }, snapshots(), () => timestamp);
    const disposed = await repository.disposeEligible(actor);
    const repeated = await repository.disposeEligible(actor);
    expect(disposed).toEqual(expect.objectContaining({ outcome: 'disposed', disposedCount: 1 }));
    expect(repeated).toEqual(expect.objectContaining({ outcome: 'nothing-eligible', disposedCount: 0 }));
    expect(rows[0]).toEqual(expect.objectContaining({ occurredOn: undefined, category: undefined, amountCents: undefined, currency: undefined, disposedAt: timestamp }));
    expect(repository.listWorkspace(actor)).resolves.toEqual([expect.not.objectContaining({ occurredOn: expect.anything(), category: expect.anything(), amountCents: expect.anything(), currency: expect.anything() })] as DurableFinanceEntry[]);
    expect(Object.keys(audits[0]).sort()).toEqual(['createdAt', 'eligibleAt', 'eventId', 'eventType', 'executedAt', 'outcome', 'policyVersion', 'scopeDigest', 'updatedAt']);
    expect(JSON.stringify(audits)).not.toContain('finance-1'); expect(JSON.stringify(audits)).not.toContain('equipment'); expect(JSON.stringify(audits)).not.toContain('1000');
  });

  it('records immutable server-observed signed snapshots and returns only each owner latest non-disposed snapshot per currency', async () => {
    const finance: DurableFinanceModel = { create: jest.fn(), find: jest.fn(), list: jest.fn(async () => []), listEligible: jest.fn(async () => []), compareAndSwap: jest.fn() };
    const rows: Array<Parameters<DurableFinanceBalanceSnapshotModel['create']>[0]> = [];
    const observedAt = [new Date('2037-01-01T00:00:00.000Z'), new Date('2037-01-01T00:00:01.000Z'), new Date('2037-01-01T00:00:02.000Z')];
    const repository = new MySqlDurableFinanceRepository({ transaction: async (work) => work({}) }, finance, { create: jest.fn() }, snapshots(rows), () => observedAt.shift() || timestamp);
    const older = await repository.recordBalance(actor, { id: 'balance-old', balanceCents: -100, currency: 'CNY' });
    const newer = await repository.recordBalance(actor, { id: 'balance-new', balanceCents: 200, currency: 'CNY' });
    await repository.recordBalance(actor, { id: 'balance-usd', balanceCents: 300, currency: 'USD' });
    expect(older).toEqual(expect.objectContaining({ observedAt: timestamp.toISOString(), calendarFinancialYear: 2037, retentionExpiresAt: '2048-01-01T00:00:00.000Z', balanceCents: -100 }));
    expect((await repository.currentBalances(actor)).map((item) => item.id)).toEqual(['balance-new', 'balance-usd']);
    expect(await repository.currentBalances(actor, 'CNY')).toEqual([expect.objectContaining({ id: 'balance-new', balanceCents: 200 })]);
    expect(await repository.currentBalances(other)).toEqual([]);
    await expect(repository.recordBalance(actor, { id: 'bad', balanceCents: 1.2, currency: 'CNY' })).rejects.toThrow('balanceCents必须是安全整数');
    expect(newer).toEqual(expect.objectContaining({ id: 'balance-new' }));
  });

  it('atomically redacts eligible ledger and snapshot payloads while keeping audit non-reconstructive', async () => {
    const financeRows = [row()]; const snapshotRows: Array<Parameters<DurableFinanceBalanceSnapshotModel['create']>[0]> = [{ id: 'balance-1', tenantId: actor.tenantId, ownerUserId: actor.userId, observedAt: new Date('2026-07-31T00:00:00.000Z'), balanceCents: -500, currency: 'CNY', calendarFinancialYear: 2026, retentionExpiresAt: timestamp, visibility: 'private', lifecycle: 'draft', resourceVersion: '1', createdAt: timestamp, updatedAt: timestamp }]; const audits: Array<Parameters<DurableFinanceDeletionAuditModel['create']>[0]> = [];
    const finance: DurableFinanceModel = { create: jest.fn(), find: jest.fn(), list: jest.fn(async () => financeRows), listEligible: jest.fn(async () => financeRows.filter((value) => !value.disposedAt)), compareAndSwap: jest.fn(async ({ next }) => { financeRows[0] = next; return next; }) };
    const repository = new MySqlDurableFinanceRepository({ transaction: async (work) => work({}) }, finance, { create: jest.fn(async (audit) => { audits.push(audit); return audit; }) }, snapshots(snapshotRows), () => timestamp);
    expect(await repository.disposeEligible(actor)).toEqual(expect.objectContaining({ outcome: 'disposed', disposedCount: 2 }));
    expect(snapshotRows[0]).toEqual(expect.objectContaining({ observedAt: undefined, balanceCents: undefined, currency: undefined, disposedAt: timestamp }));
    expect(await repository.currentBalances(actor)).toEqual([]);
    expect(JSON.stringify(audits)).not.toContain('balance-1'); expect(JSON.stringify(audits)).not.toContain('-500'); expect(Object.keys(audits[0]).sort()).toEqual(['createdAt', 'eligibleAt', 'eventId', 'eventType', 'executedAt', 'outcome', 'policyVersion', 'scopeDigest', 'updatedAt']);
  });
});
