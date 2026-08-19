import { createHash } from 'crypto';
import { Actor, DurableTripPayment, DurableTripPaymentStatus, DurableTripPaymentStore, DurableTripPaymentTerms, DurableTripPaymentWorkspace, DurableTripRegistration } from '../types';
import { actorCanManageCreatorSpace } from '../utils/actor';
import { TrailsSyncInputError } from './mysqlPortfolioCategorySync';

type Connection = { transaction<T>(work: (transaction: object) => Promise<T>): Promise<T>; query(sql: string, options: { replacements: unknown[]; transaction: object }): Promise<[unknown, unknown]> };
type RegistrationRow = { id: string; tenant_id: string; trip_id: string; participant_user_id: string; status: DurableTripRegistration['status']; required_acknowledgement_accepted_at: Date; release_accepted_at: Date; release_version: string; resource_version: string | number; created_at: Date; updated_at: Date };
type TripRow = { id: string; tenant_id: string; owner_user_id: string; status: 'draft' | 'published' | 'cancelled' };
type TermsRow = { tenant_id: string; trip_id: string; currency: string; deposit_minor: number | string; balance_minor: number | string; deposit_due_hours: number | string; balance_due_days: number | string; refund_policy_summary: string; resource_version: string | number; updated_at: Date };
type PaymentRow = { id: string; tenant_id: string; trip_id: string; registration_id: string; stage: 'deposit' | 'balance'; amount_minor: number | string; currency: string; due_at: Date; status: DurableTripPaymentStatus; resource_version: string | number; created_at: Date; updated_at: Date; confirmed_at?: Date; refund_requested_at?: Date; refunded_at?: Date };

const rows = <T>(value: unknown): T[] => Array.isArray(value) ? value.filter((item): item is T => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : [];
const opaque = (value: unknown, label: string) => { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw new TrailsSyncInputError(`${label}无效`); return value; };
const version = (value: unknown, label: string) => { if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw new TrailsSyncInputError(`${label}无效`); return value; };
const integer = (value: unknown, label: string, minimum: number, maximum: number) => { if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new TrailsSyncInputError(`${label}无效`); return value as number; };
const currency = (value: unknown) => { if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) throw new TrailsSyncInputError('currency无效'); return value; };
const policy = (value: unknown) => { if (typeof value !== 'string') throw new TrailsSyncInputError('refundPolicySummary无效'); const result = value.trim(); if (!result || result.length > 2000 || /[<>]|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(result)) throw new TrailsSyncInputError('refundPolicySummary无效'); return result; };
const registration = (row: RegistrationRow): DurableTripRegistration => ({ id: row.id, tripId: row.trip_id, status: row.status, requiredAcknowledgementAcceptedAt: row.required_acknowledgement_accepted_at.toISOString(), releaseAcceptedAt: row.release_accepted_at.toISOString(), releaseVersion: row.release_version, resourceVersion: String(row.resource_version), createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() });
const terms = (row: TermsRow): DurableTripPaymentTerms => ({ tripId: row.trip_id, currency: row.currency, depositMinor: Number(row.deposit_minor), balanceMinor: Number(row.balance_minor), depositDueHours: Number(row.deposit_due_hours), balanceDueDays: Number(row.balance_due_days), refundPolicySummary: row.refund_policy_summary, resourceVersion: String(row.resource_version), updatedAt: row.updated_at.toISOString() });
const payment = (row: PaymentRow): DurableTripPayment => ({ id: row.id, tripId: row.trip_id, registrationId: row.registration_id, stage: row.stage, amountMinor: Number(row.amount_minor), currency: row.currency, dueAt: row.due_at.toISOString(), status: row.status, resourceVersion: String(row.resource_version), createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), ...(row.confirmed_at ? { confirmedAt: row.confirmed_at.toISOString() } : {}), ...(row.refund_requested_at ? { refundRequestedAt: row.refund_requested_at.toISOString() } : {}), ...(row.refunded_at ? { refundedAt: row.refunded_at.toISOString() } : {}) });

/**
 * Private back-office payment queue for guided trips. Payment instructions and
 * participant data stay outside this boundary; this table records only states
 * the creator can verify from their own account.
 */
export class MySqlDurableTripPaymentRepository implements DurableTripPaymentStore {
  constructor(private readonly connection: Connection, private readonly now: () => Date = () => new Date()) {}

  private async trip(transaction: object, actor: Actor, tripId: string): Promise<TripRow> {
    const [found] = await this.connection.query('SELECT id, tenant_id, owner_user_id, status FROM TrailsDurableGuidedTrip WHERE tenant_id = ? AND id = ? FOR UPDATE', { replacements: [actor.tenantId, opaque(tripId, 'tripId')], transaction });
    const row = rows<TripRow>(found)[0];
    if (!row || !actorCanManageCreatorSpace(actor, { tenantId: row.tenant_id, ownerUserId: row.owner_user_id })) throw new TrailsSyncInputError('行摄计划不存在或不属于当前创作空间');
    return row;
  }

  private async registration(transaction: object, actor: Actor, id: string): Promise<RegistrationRow> {
    const [found] = await this.connection.query('SELECT * FROM TrailsDurableTripRegistration WHERE tenant_id = ? AND id = ? FOR UPDATE', { replacements: [actor.tenantId, opaque(id, 'registrationId')], transaction });
    const row = rows<RegistrationRow>(found)[0];
    if (!row) throw new TrailsSyncInputError('报名不存在');
    await this.trip(transaction, actor, row.trip_id);
    return row;
  }

  private async terms(transaction: object, actor: Actor, tripId: string): Promise<TermsRow | undefined> {
    const [found] = await this.connection.query('SELECT * FROM TrailsDurableTripPaymentTerms WHERE tenant_id = ? AND trip_id = ? FOR UPDATE', { replacements: [actor.tenantId, tripId], transaction });
    return rows<TermsRow>(found)[0];
  }

  private async payment(transaction: object, actor: Actor, id: string): Promise<PaymentRow> {
    const [found] = await this.connection.query('SELECT * FROM TrailsDurableTripPayment WHERE tenant_id = ? AND id = ? FOR UPDATE', { replacements: [actor.tenantId, opaque(id, 'paymentId')], transaction });
    const row = rows<PaymentRow>(found)[0];
    if (!row) throw new TrailsSyncInputError('付款记录不存在');
    await this.trip(transaction, actor, row.trip_id);
    return row;
  }

  private async mutation<T>(transaction: object, actor: Actor, mutationId: string, input: unknown, work: () => Promise<T>): Promise<T> {
    const id = opaque(mutationId, 'mutationId');
    const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const [found] = await this.connection.query('SELECT fingerprint, result_json FROM TrailsDurableTripPaymentMutation WHERE tenant_id = ? AND actor_user_id = ? AND mutation_id = ? FOR UPDATE', { replacements: [actor.tenantId, actor.userId, id], transaction });
    const prior = rows<{ fingerprint: string; result_json: string }>(found)[0];
    if (prior) { if (prior.fingerprint !== fingerprint) throw new TrailsSyncInputError('mutationId不能用于不同的写入'); return JSON.parse(prior.result_json) as T; }
    const result = await work();
    await this.connection.query('INSERT INTO TrailsDurableTripPaymentMutation (tenant_id, actor_user_id, mutation_id, fingerprint, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?)', { replacements: [actor.tenantId, actor.userId, id, fingerprint, JSON.stringify(result), this.now()], transaction });
    return result;
  }

  private async audit(transaction: object, actor: Actor, tripId: string, registrationId: string, paymentId: string | undefined, operation: string): Promise<void> {
    const occurredAt = this.now();
    const eventId = `trip-payment-audit_${createHash('sha256').update(`${actor.tenantId}:${actor.userId}:${tripId}:${registrationId}:${paymentId ?? 'terms'}:${operation}:${occurredAt.toISOString()}`).digest('hex')}`;
    await this.connection.query('INSERT INTO TrailsDurableTripPaymentAudit (event_id, tenant_id, trip_id, registration_id, payment_id, actor_user_id, operation, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', { replacements: [eventId, actor.tenantId, tripId, registrationId, paymentId ?? null, actor.userId, operation, occurredAt], transaction });
  }

  async workspace(actor: Actor): Promise<DurableTripPaymentWorkspace> {
    return this.connection.transaction(async transaction => {
      const time = this.now();
      // A lapsed deposit never keeps a seat merely because an owner has not opened the queue.
      await this.connection.query("UPDATE TrailsDurableTripPayment AS payment INNER JOIN TrailsDurableTripRegistration AS registration ON registration.id = payment.registration_id AND registration.tenant_id = payment.tenant_id SET payment.status = 'expired', payment.resource_version = payment.resource_version + 1, payment.updated_at = ?, registration.status = 'cancelled', registration.resource_version = registration.resource_version + 1, registration.updated_at = ? WHERE payment.tenant_id = ? AND payment.stage = 'deposit' AND payment.status = 'awaiting-payment' AND payment.due_at < ? AND registration.status = 'deposit-pending'", { replacements: [time, time, actor.tenantId, time], transaction });
      const [tripRows] = await this.connection.query('SELECT id, tenant_id, owner_user_id, status FROM TrailsDurableGuidedTrip WHERE tenant_id = ? FOR UPDATE', { replacements: [actor.tenantId], transaction });
      const tripIds = rows<TripRow>(tripRows).filter(row => actorCanManageCreatorSpace(actor, { tenantId: row.tenant_id, ownerUserId: row.owner_user_id })).map(row => row.id);
      if (!tripIds.length) return { terms: [], registrations: [], payments: [] };
      const placeholders = tripIds.map(() => '?').join(', ');
      const [termRows] = await this.connection.query(`SELECT * FROM TrailsDurableTripPaymentTerms WHERE tenant_id = ? AND trip_id IN (${placeholders}) ORDER BY trip_id ASC FOR UPDATE`, { replacements: [actor.tenantId, ...tripIds], transaction });
      const [registrationRows] = await this.connection.query(`SELECT * FROM TrailsDurableTripRegistration WHERE tenant_id = ? AND trip_id IN (${placeholders}) ORDER BY created_at DESC, id DESC FOR UPDATE`, { replacements: [actor.tenantId, ...tripIds], transaction });
      const [paymentRows] = await this.connection.query(`SELECT * FROM TrailsDurableTripPayment WHERE tenant_id = ? AND trip_id IN (${placeholders}) ORDER BY created_at DESC, id DESC FOR UPDATE`, { replacements: [actor.tenantId, ...tripIds], transaction });
      return { terms: rows<TermsRow>(termRows).map(terms), registrations: rows<RegistrationRow>(registrationRows).map(registration), payments: rows<PaymentRow>(paymentRows).map(payment) };
    });
  }

  async saveTerms(actor: Actor, input: { tripId: string; currency: string; depositMinor: number; balanceMinor: number; depositDueHours: number; balanceDueDays: number; refundPolicySummary: string; expectedResourceVersion: string | null; mutationId: string }): Promise<DurableTripPaymentTerms> {
    const tripId = opaque(input.tripId, 'tripId'); const expected = input.expectedResourceVersion === null ? null : version(input.expectedResourceVersion, 'expectedResourceVersion');
    const values = { tripId, currency: currency(input.currency), depositMinor: integer(input.depositMinor, 'depositMinor', 1, 1000000000), balanceMinor: integer(input.balanceMinor, 'balanceMinor', 1, 1000000000), depositDueHours: integer(input.depositDueHours, 'depositDueHours', 1, 168), balanceDueDays: integer(input.balanceDueDays, 'balanceDueDays', 1, 730), refundPolicySummary: policy(input.refundPolicySummary) };
    return this.connection.transaction(transaction => this.mutation(transaction, actor, input.mutationId, { operation: 'save-terms', expected, ...values }, async () => {
      const trip = await this.trip(transaction, actor, tripId); if (trip.status === 'cancelled') throw new TrailsSyncInputError('已取消的摄影计划不能配置付款条款');
      const existing = await this.terms(transaction, actor, tripId); if (existing && String(existing.resource_version) !== expected) throw new TrailsSyncInputError('付款条款版本已过期'); if (!existing && expected !== null) throw new TrailsSyncInputError('付款条款版本已过期');
      const time = this.now(); const nextVersion = existing ? (BigInt(String(existing.resource_version)) + BigInt(1)).toString() : '1';
      await this.connection.query('INSERT INTO TrailsDurableTripPaymentTerms (tenant_id, trip_id, currency, deposit_minor, balance_minor, deposit_due_hours, balance_due_days, refund_policy_summary, resource_version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE currency = VALUES(currency), deposit_minor = VALUES(deposit_minor), balance_minor = VALUES(balance_minor), deposit_due_hours = VALUES(deposit_due_hours), balance_due_days = VALUES(balance_due_days), refund_policy_summary = VALUES(refund_policy_summary), resource_version = VALUES(resource_version), updated_at = VALUES(updated_at)', { replacements: [actor.tenantId, tripId, values.currency, values.depositMinor, values.balanceMinor, values.depositDueHours, values.balanceDueDays, values.refundPolicySummary, nextVersion, time], transaction });
      const saved: DurableTripPaymentTerms = { ...values, resourceVersion: nextVersion, updatedAt: time.toISOString() }; await this.audit(transaction, actor, tripId, `terms_${tripId}`, undefined, 'terms-saved'); return saved;
    }));
  }

  async approveDeposit(actor: Actor, input: { registrationId: string; expectedResourceVersion: string; mutationId: string }): Promise<{ registration: DurableTripRegistration; payment: DurableTripPayment }> {
    const expected = version(input.expectedResourceVersion, 'expectedResourceVersion');
    return this.connection.transaction(transaction => this.mutation(transaction, actor, input.mutationId, { operation: 'approve-deposit', registrationId: input.registrationId, expected }, async () => {
      const row = await this.registration(transaction, actor, input.registrationId); if (row.status !== 'submitted') throw new TrailsSyncInputError('只有已提交的报名可以审核并进入定金流程'); if (String(row.resource_version) !== expected) throw new TrailsSyncInputError('报名版本已过期');
      const trip = await this.trip(transaction, actor, row.trip_id); if (trip.status !== 'published') throw new TrailsSyncInputError('仅已发布摄影计划可以进入定金流程'); const paymentTerms = await this.terms(transaction, actor, row.trip_id); if (!paymentTerms) throw new TrailsSyncInputError('请先配置定金、尾款和退款条款');
      const [capacityRows] = await this.connection.query('SELECT capacity FROM TrailsDurableTripCapacity WHERE tenant_id = ? AND trip_id = ? FOR UPDATE', { replacements: [actor.tenantId, row.trip_id], transaction }); const capacity = Number(rows<{ capacity: string | number }>(capacityRows)[0]?.capacity); if (!Number.isSafeInteger(capacity)) throw new TrailsSyncInputError('请先配置行摄名额');
      const [reservedRows] = await this.connection.query("SELECT COUNT(*) AS count FROM TrailsDurableTripRegistration WHERE tenant_id = ? AND trip_id = ? AND status IN ('deposit-pending', 'balance-pending', 'confirmed') FOR UPDATE", { replacements: [actor.tenantId, row.trip_id], transaction }); if (Number(rows<{ count: string | number }>(reservedRows)[0]?.count ?? 0) >= capacity) throw new TrailsSyncInputError('行摄名额已满');
      const time = this.now(); const dueAt = new Date(time.getTime() + Number(paymentTerms.deposit_due_hours) * 60 * 60 * 1000); const nextVersion = (BigInt(String(row.resource_version)) + BigInt(1)).toString(); const paymentId = `trip-payment_${createHash('sha256').update(`${actor.tenantId}:${row.id}:deposit`).digest('hex').slice(0, 32)}`;
      await this.connection.query('UPDATE TrailsDurableTripRegistration SET status = ?, resource_version = ?, updated_at = ? WHERE id = ? AND resource_version = ?', { replacements: ['deposit-pending', nextVersion, time, row.id, expected], transaction });
      await this.connection.query("INSERT INTO TrailsDurableTripPayment (id, tenant_id, trip_id, registration_id, stage, amount_minor, currency, due_at, status, resource_version, created_at, updated_at) VALUES (?, ?, ?, ?, 'deposit', ?, ?, ?, 'awaiting-payment', 1, ?, ?)", { replacements: [paymentId, actor.tenantId, row.trip_id, row.id, Number(paymentTerms.deposit_minor), paymentTerms.currency, dueAt, time, time], transaction });
      const changed = { ...registration(row), status: 'deposit-pending' as const, resourceVersion: nextVersion, updatedAt: time.toISOString() }; const created: DurableTripPayment = { id: paymentId, tripId: row.trip_id, registrationId: row.id, stage: 'deposit', amountMinor: Number(paymentTerms.deposit_minor), currency: paymentTerms.currency, dueAt: dueAt.toISOString(), status: 'awaiting-payment', resourceVersion: '1', createdAt: time.toISOString(), updatedAt: time.toISOString() }; await this.audit(transaction, actor, row.trip_id, row.id, paymentId, 'deposit-requested'); return { registration: changed, payment: created };
    }));
  }

  async transitionPayment(actor: Actor, input: { id: string; status: DurableTripPaymentStatus; expectedResourceVersion: string; mutationId: string }): Promise<{ registration: DurableTripRegistration; payment: DurableTripPayment }> {
    const expected = version(input.expectedResourceVersion, 'expectedResourceVersion'); if (!['confirmed', 'cancelled', 'refund-pending', 'refunded'].includes(input.status)) throw new TrailsSyncInputError('付款状态无效');
    return this.connection.transaction(transaction => this.mutation(transaction, actor, input.mutationId, { operation: 'transition-payment', id: input.id, status: input.status, expected }, async () => {
      const row = await this.payment(transaction, actor, input.id); if (String(row.resource_version) !== expected) throw new TrailsSyncInputError('付款记录版本已过期'); const reg = await this.registration(transaction, actor, row.registration_id); const time = this.now();
      const expired = row.status === 'awaiting-payment' && row.due_at.getTime() < time.getTime(); if (expired) { const nextPayment = { ...payment(row), status: 'expired' as const, resourceVersion: (BigInt(String(row.resource_version)) + BigInt(1)).toString(), updatedAt: time.toISOString() }; let nextRegistration = registration(reg); if (row.stage === 'deposit' && reg.status === 'deposit-pending') { const registrationVersion = (BigInt(String(reg.resource_version)) + BigInt(1)).toString(); await this.connection.query('UPDATE TrailsDurableTripRegistration SET status = ?, resource_version = ?, updated_at = ? WHERE id = ? AND resource_version = ?', { replacements: ['cancelled', registrationVersion, time, reg.id, String(reg.resource_version)], transaction }); nextRegistration = { ...nextRegistration, status: 'cancelled', resourceVersion: registrationVersion, updatedAt: time.toISOString() }; } await this.connection.query('UPDATE TrailsDurableTripPayment SET status = ?, resource_version = ?, updated_at = ? WHERE id = ? AND resource_version = ?', { replacements: ['expired', nextPayment.resourceVersion, time, row.id, expected], transaction }); await this.audit(transaction, actor, row.trip_id, reg.id, row.id, `${row.stage}-expired`); return { registration: nextRegistration, payment: nextPayment }; }
      const allowed: Record<DurableTripPaymentStatus, DurableTripPaymentStatus[]> = { 'awaiting-payment': ['confirmed', 'cancelled'], confirmed: ['refund-pending'], 'refund-pending': ['refunded'], refunded: [], expired: [], cancelled: [] }; if (!allowed[row.status].includes(input.status)) throw new TrailsSyncInputError('当前付款状态不允许该转换');
      let nextRegistration = registration(reg); let nextStatus = reg.status; let nextPayment: DurableTripPayment = { ...payment(row), status: input.status, resourceVersion: (BigInt(String(row.resource_version)) + BigInt(1)).toString(), updatedAt: time.toISOString() };
      if (row.stage === 'deposit' && row.status === 'awaiting-payment' && input.status === 'confirmed') { const currentTerms = await this.terms(transaction, actor, row.trip_id); if (!currentTerms) throw new TrailsSyncInputError('付款条款不存在'); nextStatus = 'balance-pending'; const dueAt = new Date(time.getTime() + Number(currentTerms.balance_due_days) * 24 * 60 * 60 * 1000); const balanceId = `trip-payment_${createHash('sha256').update(`${actor.tenantId}:${reg.id}:balance`).digest('hex').slice(0, 32)}`; await this.connection.query("INSERT INTO TrailsDurableTripPayment (id, tenant_id, trip_id, registration_id, stage, amount_minor, currency, due_at, status, resource_version, created_at, updated_at) VALUES (?, ?, ?, ?, 'balance', ?, ?, ?, 'awaiting-payment', 1, ?, ?)", { replacements: [balanceId, actor.tenantId, row.trip_id, reg.id, Number(currentTerms.balance_minor), currentTerms.currency, dueAt, time, time], transaction }); nextPayment = { ...nextPayment, confirmedAt: time.toISOString() }; }
      if (row.stage === 'balance' && row.status === 'awaiting-payment' && input.status === 'confirmed') { nextStatus = 'confirmed'; nextPayment = { ...nextPayment, confirmedAt: time.toISOString() }; }
      if (row.stage === 'deposit' && row.status === 'awaiting-payment' && input.status === 'cancelled') nextStatus = 'cancelled';
      if (input.status === 'refund-pending') nextPayment = { ...nextPayment, refundRequestedAt: time.toISOString() };
      if (input.status === 'refunded') { nextPayment = { ...nextPayment, refundedAt: time.toISOString() }; const [unrefunded] = await this.connection.query("SELECT id FROM TrailsDurableTripPayment WHERE tenant_id = ? AND registration_id = ? AND status = 'confirmed' FOR UPDATE", { replacements: [actor.tenantId, reg.id], transaction }); if (!rows<{ id: string }>(unrefunded).length) nextStatus = 'cancelled'; }
      await this.connection.query('UPDATE TrailsDurableTripPayment SET status = ?, resource_version = ?, updated_at = ?, confirmed_at = ?, refund_requested_at = ?, refunded_at = ? WHERE id = ? AND resource_version = ?', { replacements: [input.status, nextPayment.resourceVersion, time, nextPayment.confirmedAt ? time : row.confirmed_at ?? null, nextPayment.refundRequestedAt ? time : row.refund_requested_at ?? null, nextPayment.refundedAt ? time : row.refunded_at ?? null, row.id, expected], transaction });
      if (nextStatus !== reg.status) { const nextVersion = (BigInt(String(reg.resource_version)) + BigInt(1)).toString(); await this.connection.query('UPDATE TrailsDurableTripRegistration SET status = ?, resource_version = ?, updated_at = ? WHERE id = ? AND resource_version = ?', { replacements: [nextStatus, nextVersion, time, reg.id, String(reg.resource_version)], transaction }); nextRegistration = { ...nextRegistration, status: nextStatus, resourceVersion: nextVersion, updatedAt: time.toISOString() }; }
      await this.audit(transaction, actor, row.trip_id, reg.id, row.id, `${row.stage}-${input.status}`); return { registration: nextRegistration, payment: nextPayment };
    }));
  }
}
