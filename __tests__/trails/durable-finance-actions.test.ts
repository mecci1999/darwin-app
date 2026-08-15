import { Starlight } from '../../src/typings';
import trailsActions from '../../src/apps/trails/actions';
import { InMemoryTrailsRepository } from '../../src/apps/trails/repository';
import { Actor, DurableFinanceBalanceSnapshot, DurableFinanceEntry, DurableFinanceStore } from '../../src/apps/trails/types';
import { TrailsDurableFinanceStaleVersionError } from '../../src/apps/trails/repository/mysqlDurableFinance';

const actor: Actor = { tenantId: 'tenant-1', userId: 'owner-1', isAdmin: false };
const other: Actor = { tenantId: actor.tenantId, userId: 'owner-2', isAdmin: true, creatorSpaceRole: 'creator-space-owner' };
const star = { emit: jest.fn() } as unknown as Starlight;
const context = (trustedActor: Actor, params: object) => ({ meta: { tenantId: trustedActor.tenantId, user: trustedActor }, params });
const entry: DurableFinanceEntry = { id: 'finance-1', tenantId: actor.tenantId, ownerUserId: actor.userId, occurredOn: '2026-07-31', category: 'equipment', amountCents: 1000, currency: 'CNY', calendarFinancialYear: 2026, retentionExpiresAt: '2037-01-01T00:00:00.000Z', visibility: 'private', lifecycle: 'draft', resourceVersion: '1', createdAt: '2026-07-31T00:00:00.000Z', updatedAt: '2026-07-31T00:00:00.000Z' };
const snapshot: DurableFinanceBalanceSnapshot = { id: 'finance-balance-1', tenantId: actor.tenantId, ownerUserId: actor.userId, observedAt: '2026-07-31T00:00:00.000Z', balanceCents: -2500, currency: 'CNY', calendarFinancialYear: 2026, retentionExpiresAt: '2037-01-01T00:00:00.000Z', visibility: 'private', lifecycle: 'draft', resourceVersion: '1', createdAt: '2026-07-31T00:00:00.000Z', updatedAt: '2026-07-31T00:00:00.000Z' };
const durable = (overrides: Partial<DurableFinanceStore> = {}): DurableFinanceStore => ({ create: jest.fn(async () => entry), update: jest.fn(async () => entry), listWorkspace: jest.fn(async (trustedActor) => trustedActor.userId === actor.userId ? [entry] : []), recordBalance: jest.fn(async () => snapshot), currentBalances: jest.fn(async (trustedActor) => trustedActor.userId === actor.userId ? [snapshot] : []), disposeEligible: jest.fn(async () => ({ outcome: 'nothing-eligible' as const, eligibleAt: entry.retentionExpiresAt, executedAt: entry.retentionExpiresAt, disposedCount: 0 })), ...overrides });

describe('v2 durable private finance actions', () => {
  it('registers exactly the five ordinary finance actions and no retention disposal action', () => {
    const actions = trailsActions(star, { repository: new InMemoryTrailsRepository(), durableFinanceStore: durable() });
    const financeActionNames = Object.keys(actions).filter((name) => name.startsWith('v2.finance.')).sort();
    expect(financeActionNames).toEqual(['v2.finance.balance.current', 'v2.finance.balance.record', 'v2.finance.create', 'v2.finance.update', 'v2.finance.workspace']);
    expect(actions).not.toHaveProperty('v2.finance.dispose-retained');
  });
  it('rejects unauthenticated finance access with 401', async () => {
    const actions = trailsActions(star, { repository: new InMemoryTrailsRepository(), durableFinanceStore: durable() });
    const response = await actions['v2.finance.workspace'].handler({ meta: {}, params: {} } as never);
    expect(response.status).toBe(401);
  });
  it('returns 503 without the durable store and never falls back to v1 finance', async () => {
    const repository = new InMemoryTrailsRepository();
    const response = await trailsActions(star, { repository })['v2.finance.create'].handler(context(actor, { occurredOn: '2026-07-31', category: 'equipment', amountCents: 1000, currency: 'CNY' }) as never);
    expect(response.status).toBe(503); expect(repository.listFinanceEntries({ tenantId: actor.tenantId, ownerUserId: actor.userId })).toEqual([]);
  });
  it('uses direct trusted ownership, rejects invalid payloads, and maps stale failures', async () => {
    const store = durable(); const actions = trailsActions(star, { repository: new InMemoryTrailsRepository(), durableFinanceStore: store });
    const created = await actions['v2.finance.create'].handler(context(actor, { occurredOn: '2026-07-31', category: 'equipment', amountCents: 1000, currency: 'CNY' }) as never);
    const spoofed = await actions['v2.finance.create'].handler(context(actor, { occurredOn: '2026-07-31', category: 'equipment', amountCents: 1000, currency: 'CNY', ownerUserId: 'spoofed' }) as never);
    const listed = await actions['v2.finance.workspace'].handler(context(other, {}) as never);
    const invalid = await actions['v2.finance.create'].handler(context(actor, { occurredOn: 'bad', category: 'equipment', amountCents: 1.2, currency: 'cny' }) as never);
    const stale = await trailsActions(star, { repository: new InMemoryTrailsRepository(), durableFinanceStore: durable({ update: jest.fn(async () => { throw new TrailsDurableFinanceStaleVersionError(); }) }) })['v2.finance.update'].handler(context(actor, { id: entry.id, resourceVersion: '1', occurredOn: entry.occurredOn, category: entry.category, amountCents: entry.amountCents, currency: entry.currency }) as never);
    expect(created.status).toBe(201); expect(created.data.content).toEqual({ id: entry.id, occurredOn: entry.occurredOn, category: entry.category, amountCents: entry.amountCents, currency: entry.currency, resourceVersion: entry.resourceVersion, createdAt: entry.createdAt, updatedAt: entry.updatedAt }); expect(store.create).toHaveBeenCalledWith(actor, expect.objectContaining({ id: expect.stringMatching(/^finance_/), occurredOn: entry.occurredOn })); expect(spoofed.status).toBe(400); expect(listed.data.content).toEqual([]); expect(invalid.status).toBe(400); expect(stale.status).toBe(409);
  });

  it('records signed owner-private balance snapshots, returns only the direct owner current values, and has no v1 fallback', async () => {
    const store = durable(); const actions = trailsActions(star, { repository: new InMemoryTrailsRepository(), durableFinanceStore: store });
    const recorded = await actions['v2.finance.balance.record'].handler(context(actor, { balanceCents: -2500, currency: 'CNY' }) as never);
    const spoofed = await actions['v2.finance.balance.record'].handler(context(actor, { balanceCents: -2500, currency: 'CNY', ownerUserId: 'spoofed' }) as never);
    const current = await actions['v2.finance.balance.current'].handler(context(actor, { currency: 'CNY' }) as never);
    const otherCurrent = await actions['v2.finance.balance.current'].handler(context(other, {}) as never);
    const invalid = await actions['v2.finance.balance.record'].handler(context(actor, { balanceCents: 1.1, currency: 'cny' }) as never);
    const unavailable = await trailsActions(star, { repository: new InMemoryTrailsRepository() })['v2.finance.balance.current'].handler(context(actor, {}) as never);
    expect(recorded.status).toBe(201); expect(recorded.data.content).toEqual({ id: snapshot.id, observedAt: snapshot.observedAt, balanceCents: snapshot.balanceCents, currency: snapshot.currency, resourceVersion: snapshot.resourceVersion, createdAt: snapshot.createdAt }); expect(store.recordBalance).toHaveBeenCalledWith(actor, expect.objectContaining({ id: expect.stringMatching(/^finance-balance_/), balanceCents: -2500, currency: 'CNY' }));
    expect(current.data.content).toEqual([{ id: snapshot.id, observedAt: snapshot.observedAt, balanceCents: snapshot.balanceCents, currency: snapshot.currency, resourceVersion: snapshot.resourceVersion, createdAt: snapshot.createdAt }]); expect(otherCurrent.data.content).toEqual([]); expect(spoofed.status).toBe(400); expect(invalid.status).toBe(400); expect(unavailable.status).toBe(503);
  });
});
