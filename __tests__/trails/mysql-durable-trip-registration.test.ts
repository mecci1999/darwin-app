import { Actor } from '../../src/apps/trails/types';
import { MySqlDurableTripRegistrationRepository } from '../../src/apps/trails/repository/mysqlDurableTripRegistration';

const owner: Actor = { tenantId: 'tenant-a', userId: 'owner-a', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const participant: Actor = { tenantId: 'tenant-a', userId: 'participant-a', isAdmin: false, creatorSpaceRole: 'participant' };
const otherParticipant: Actor = { tenantId: 'tenant-a', userId: 'participant-b', isAdmin: false, creatorSpaceRole: 'participant' };
const now = new Date('2026-08-05T10:00:00.000Z');

const setup = () => {
  const registrations = new Map<string, Record<string, unknown>>(); const mutations = new Map<string, Record<string, unknown>>(); const capacities = new Map<string, number>(); const audits: Record<string, unknown>[] = [];
  const connection = { transaction: async <T>(work: (transaction: object) => Promise<T>) => work({}), query: async (sql: string, options: { replacements: unknown[]; transaction: object }): Promise<[unknown, unknown]> => {
    const values = options.replacements;
    if (sql.startsWith('SELECT tenant_id, id, owner_user_id')) return [[{ tenant_id: 'tenant-a', id: 'trip_iceland_2027', owner_user_id: 'owner-a', status: 'published' }], {}];
    if (sql.startsWith('SELECT result_json')) { const row = mutations.get(`${values[0]}:${values[1]}:${values[2]}`); return [row ? [row] : [], {}]; }
    if (sql.startsWith('SELECT id FROM TrailsDurableTripRegistration WHERE tenant_id')) return [[...registrations.values()].filter(row => row.tenant_id === values[0] && row.trip_id === values[1] && row.participant_user_id === values[2]).map(row => ({ id: row.id })) , {}];
    if (sql.startsWith('SELECT * FROM TrailsDurableTripRegistration')) { const row = registrations.get(String(values[0])); return [row ? [row] : [], {}]; }
    if (sql.startsWith('INSERT INTO TrailsDurableTripRegistration (')) { const [id, tenantId, tripId, participantUserId, status, acknowledgedAt, releaseAt, releaseVersion, createdAt, updatedAt] = values; registrations.set(String(id), { id, tenant_id: tenantId, trip_id: tripId, participant_user_id: participantUserId, status, required_acknowledgement_accepted_at: acknowledgedAt, release_accepted_at: releaseAt, release_version: releaseVersion, resource_version: '1', created_at: createdAt, updated_at: updatedAt }); return [[], {}]; }
    if (sql.startsWith('INSERT INTO TrailsDurableTripRegistrationMutation')) { mutations.set(`${values[0]}:${values[1]}:${values[2]}`, { fingerprint: values[3], result_json: values[4] }); return [[], {}]; }
    if (sql.startsWith('UPDATE TrailsDurableTripRegistration')) { const row = registrations.get(String(values[3])); if (row && String(row.resource_version) === String(values[4])) { row.status = values[0]; row.resource_version = values[1]; row.updated_at = values[2]; } return [[], {}]; }
    if (sql.startsWith('INSERT INTO TrailsDurableTripRegistrationAudit')) { audits.push({ eventId: values[0], tenantId: values[1], tripId: values[2], registrationId: values[3], actorUserId: values[4], operation: values[5] }); return [[], {}]; }
    if (sql.startsWith('SELECT status, COUNT(*)')) { const count = new Map<string, number>(); for (const row of registrations.values()) if (row.tenant_id === values[0] && row.trip_id === values[1]) count.set(String(row.status), (count.get(String(row.status)) ?? 0) + 1); return [[...count.entries()].map(([status, count]) => ({ status, count })), {}]; }
    if (sql.startsWith('SELECT capacity FROM TrailsDurableTripCapacity')) { const capacity = capacities.get(`${values[0]}:${values[1]}`); return [capacity === undefined ? [] : [{ capacity }], {}]; }
    if (sql.startsWith('SELECT COUNT(*) AS count')) { return [[{ count: [...registrations.values()].filter(row => row.tenant_id === values[0] && row.trip_id === values[1] && row.status === 'confirmed').length }], {}]; }
    if (sql.startsWith('SELECT resource_version FROM TrailsDurableTripCapacity')) return [[], {}];
    if (sql.startsWith('INSERT INTO TrailsDurableTripCapacity')) { capacities.set(`${values[0]}:${values[1]}`, Number(values[2])); return [[], {}]; }
    return [[], {}];
  } };
  return { store: new MySqlDurableTripRegistrationRepository(connection, () => now), registrations, audits };
};

describe('durable v2 trip registrations', () => {
  it('persists a minimal idempotent participant submission without PII', async () => {
    const { store, registrations, audits } = setup(); const input = { mutationId: 'registration_mutation_1', tripId: 'trip_iceland_2027', requiredAcknowledgement: true as const, releaseAccepted: true as const, releaseVersion: 'release_2026_08' };
    const created = await store.submit(participant, input); const replayed = await store.submit(participant, input);
    expect(replayed).toEqual(created); expect(registrations.size).toBe(1); expect(created).toMatchObject({ tripId: 'trip_iceland_2027', status: 'submitted', resourceVersion: '1' }); expect(JSON.stringify([...registrations.values()])).not.toContain('email'); expect(audits).toHaveLength(1);
    await expect(store.submit(participant, { ...input, mutationId: 'registration_mutation_2' })).rejects.toThrow('当前账号已报名');
  });

  it('enforces owner-only status changes, participant-only reads/cancellation, and version checks', async () => {
    const { store } = setup(); const created = await store.submit(participant, { mutationId: 'registration_mutation_1', tripId: 'trip_iceland_2027', requiredAcknowledgement: true, releaseAccepted: true, releaseVersion: 'release_2026_08' });
    await expect(store.readMine(otherParticipant, { id: created.id })).resolves.toBeUndefined();
    await expect(store.transition(otherParticipant, { id: created.id, status: 'waitlisted', resourceVersion: '1', mutationId: 'owner_transition_1' })).rejects.toThrow('无权管理');
    const waitlisted = await store.transition(owner, { id: created.id, status: 'waitlisted', resourceVersion: '1', mutationId: 'owner_transition_1' });
    await expect(store.transition(owner, { id: created.id, status: 'waitlisted', resourceVersion: '1', mutationId: 'owner_transition_1' })).resolves.toEqual(waitlisted);
    await expect(store.cancelMine(otherParticipant, { id: created.id, resourceVersion: waitlisted.resourceVersion, mutationId: 'wrong_cancel' })).rejects.toThrow('当前报名不允许取消');
    const cancelled = await store.cancelMine(participant, { id: created.id, resourceVersion: waitlisted.resourceVersion, mutationId: 'cancel_mine_1' });
    expect(cancelled).toMatchObject({ status: 'cancelled', resourceVersion: '3' });
  });

  it('returns only aggregate status counts to the creator', async () => {
    const { store } = setup(); await store.submit(participant, { mutationId: 'registration_mutation_1', tripId: 'trip_iceland_2027', requiredAcknowledgement: true, releaseAccepted: true, releaseVersion: 'release_2026_08' });
    const summary = await store.summary(owner, { tripId: 'trip_iceland_2027' });
    expect(summary).toEqual({ tripId: 'trip_iceland_2027', capacity: 0, confirmed: 0, remaining: 0, counts: { submitted: 1, waitlisted: 0, confirmed: 0, rejected: 0, cancelled: 0 } }); expect(JSON.stringify(summary)).not.toContain('participant-a');
  });

  it('requires a private capacity before confirmation and rejects confirmation beyond that capacity', async () => {
    const { store } = setup(); const first = await store.submit(participant, { mutationId: 'registration_mutation_1', tripId: 'trip_iceland_2027', requiredAcknowledgement: true, releaseAccepted: true, releaseVersion: 'release_2026_08' });
    await expect(store.transition(owner, { id: first.id, status: 'confirmed', resourceVersion: '1', mutationId: 'confirm_without_capacity' })).rejects.toThrow('请先配置行摄名额');
    await expect(store.configureCapacity(owner, { tripId: 'trip_iceland_2027', capacity: 1, mutationId: 'capacity_mutation_1' })).resolves.toEqual({ tripId: 'trip_iceland_2027', capacity: 1 });
    await expect(store.configureCapacity(owner, { tripId: 'trip_iceland_2027', capacity: 1, mutationId: 'capacity_mutation_1' })).resolves.toEqual({ tripId: 'trip_iceland_2027', capacity: 1 });
    await expect(store.transition(owner, { id: first.id, status: 'confirmed', resourceVersion: '1', mutationId: 'confirm_first' })).resolves.toMatchObject({ status: 'confirmed' });
  });
});
