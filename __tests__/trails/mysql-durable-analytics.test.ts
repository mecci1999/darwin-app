import { Actor, PublicAnalyticsEvent } from '../../src/apps/starlight/trails/types';
import { MySqlDurableAnalyticsRepository } from '../../src/apps/starlight/trails/repository/mysqlDurableAnalytics';

const owner: Actor = { tenantId: 'tenant-a', userId: 'owner-a', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
const timestamp = '2026-08-05T10:00:00.000Z';
const event = (overrides: Partial<PublicAnalyticsEvent> = {}): PublicAnalyticsEvent => ({ eventId: '6f9619ff-8b86-4011-b42d-00c04fc964ff', eventName: 'content-view', contentType: 'portfolio', contentId: 'work_aurora_001', occurredAt: timestamp, visitorId: 'visitor_aurora_001', ...overrides });

type Daily = { eventCount: number; visitorCount: number };
const setup = () => {
  const dedup = new Set<string>(); const visitors = new Set<string>(); const contentVisitors = new Set<string>(); const daily = new Map<string, Daily>(); const queries: Array<{ sql: string; replacements: unknown[] }> = [];
  const connection = { transaction: async <T>(work: (transaction: object) => Promise<T>) => work({}), query: async (sql: string, options: { replacements: unknown[]; transaction: object }): Promise<[unknown, unknown]> => {
    queries.push({ sql, replacements: options.replacements });
    if (sql.startsWith('SELECT event_id')) return [[...dedup].filter(value => value === `${options.replacements[0]}:${options.replacements[1]}`).map(() => ({ event_id: options.replacements[1] })) , {}];
    if (sql.startsWith('INSERT INTO TrailsAnalyticsEventDedup')) { dedup.add(`${options.replacements[0]}:${options.replacements[1]}`); return [[], {}]; }
    if (sql.startsWith('SELECT visitor_digest FROM TrailsAnalyticsVisitorDay')) { const key = options.replacements.join(':'); return [visitors.has(key) ? [{ visitor_digest: 'digest' }] : [], {}]; }
    if (sql.startsWith('INSERT INTO TrailsAnalyticsVisitorDay')) { visitors.add(options.replacements.join(':')); return [[], {}]; }
    if (sql.startsWith('SELECT visitor_digest FROM TrailsAnalyticsContentVisitorDay')) { const key = options.replacements.join(':'); return [contentVisitors.has(key) ? [{ visitor_digest: 'digest' }] : [], {}]; }
    if (sql.startsWith('INSERT INTO TrailsAnalyticsContentVisitorDay')) { contentVisitors.add(options.replacements.join(':')); return [[], {}]; }
    if (sql.startsWith('INSERT INTO TrailsAnalyticsDaily')) { const key = options.replacements.slice(0, 6).join(':'); const current = daily.get(key) ?? { eventCount: 0, visitorCount: 0 }; current.eventCount += 1; current.visitorCount += Number(options.replacements[6]); daily.set(key, current); return [[], {}]; }
    if (sql.startsWith('SELECT content_type AS contentType')) return [[{ contentType: 'portfolio', contentId: 'work_aurora_001', pageViews: '7' }], {}];
    if (sql.startsWith('SELECT subject_type AS contentType')) return [[{ contentType: 'portfolio', contentId: 'work_aurora_001', approvedCommentCount: '3' }], {}];
    return [[], {}];
  } };
  return { store: new MySqlDurableAnalyticsRepository(connection, 'analytics-test-secret', () => new Date(timestamp)), daily, visitors, contentVisitors, queries };
};

describe('durable aggregate analytics', () => {
  it('deduplicates event IDs and stores only keyed visitor digests in daily aggregate paths', async () => {
    const { store, daily, visitors, contentVisitors, queries } = setup();
    await store.ingest(owner, event()); await store.ingest(owner, event());
    expect(daily.size).toBe(1); expect([...daily.values()][0]).toEqual({ eventCount: 1, visitorCount: 1 });
    expect(visitors.size).toBe(1); expect(contentVisitors.size).toBe(1);
    expect([...visitors, ...contentVisitors].join(' ')).not.toContain('visitor_aurora_001');
  });

  it('keeps content visitor deduplication separate while global daily visitors remain one anonymous person', async () => {
    const { store, daily, visitors, contentVisitors } = setup();
    await store.ingest(owner, event());
    await store.ingest(owner, event({ eventId: '7f9619ff-8b86-4011-b42d-00c04fc964ff', contentId: 'work_twilight_002' }));
    expect(visitors.size).toBe(1); expect(contentVisitors.size).toBe(2);
    expect([...daily.values()].map(value => value.visitorCount)).toEqual([1, 1]);
  });

  it('records only fixed acquisition and device categories in a separate aggregate table', async () => {
    const { store, queries } = setup();
    await store.ingest(owner, event({ acquisitionChannel: 'campaign', deviceClass: 'mobile' }));
    const audience = queries.find(({ sql }) => sql.startsWith('INSERT INTO TrailsAnalyticsAudienceDaily'));
    expect(audience?.replacements.slice(3, 5)).toEqual(['campaign', 'mobile']);
    expect(JSON.stringify(audience)).not.toContain('utm_source');
    expect(JSON.stringify(audience)).not.toContain('userAgent');
  });

  it('rejects identity-shaped visitor values and timestamps outside the bounded retention window', async () => {
    const { store } = setup();
    await expect(store.ingest(owner, event({ visitorId: 'visitor@example.com' }))).rejects.toThrow('visitorId无效');
    await expect(store.ingest(owner, event({ occurredAt: '2026-06-01T10:00:00.000Z' }))).rejects.toThrow('occurredAt超出允许范围');
    await expect(store.readWorkspace(owner, { from: '2026-06-01', to: '2026-08-05' })).rejects.toThrow('analytics范围必须在最近31天内');
  });

  it('returns only requested owner-scoped portfolio and journal aggregates, zero-filling absent IDs', async () => {
    const { store, queries } = setup();
    const result = await store.readContentMetrics(owner, { from: '2026-08-01', to: '2026-08-05', content: { portfolioIds: ['work_aurora_001', 'work_zero_002'], journalIds: ['journal_zero_001'] } });

    expect(result).toEqual({ range: { from: '2026-08-01', to: '2026-08-05' }, metrics: [
      { contentType: 'portfolio', contentId: 'work_aurora_001', pageViews: 7, approvedCommentCount: 3 },
      { contentType: 'portfolio', contentId: 'work_zero_002', pageViews: 0, approvedCommentCount: 0 },
      { contentType: 'journal', contentId: 'journal_zero_001', pageViews: 0, approvedCommentCount: 0 },
    ] });
    const pageViews = queries.find(({ sql }) => sql.startsWith('SELECT content_type AS contentType'))!;
    const comments = queries.find(({ sql }) => sql.startsWith('SELECT subject_type AS contentType'))!;
    expect(pageViews.sql).toContain("event_name IN ('page-view', 'content-view')");
    expect(comments.sql).toContain("status = 'approved'");
    expect(comments.sql).toContain('created_at >= ?');
    expect(JSON.stringify([pageViews, comments])).not.toMatch(/visitor|email|body|tenantId|ownerUserId/i);
    expect(pageViews.replacements.slice(0, 4)).toEqual(['tenant-a', 'owner-a', '2026-08-01', '2026-08-05']);
    expect(comments.replacements.slice(0, 4)).toEqual(['tenant-a', 'owner-a', '2026-08-01', '2026-08-05']);
  });

  it.each([
    [{ from: '2026-08-01', to: '2026-08-05', content: { portfolioIds: [], journalIds: [] } }, 'content至少需要一个内容编号'],
    [{ from: '2026-08-01', to: '2026-08-05', content: { portfolioIds: ['duplicate', 'duplicate'], journalIds: [] } }, 'portfolioIds不能重复'],
    [{ from: '2026-08-01', to: '2026-08-05', content: { portfolioIds: ['not valid'], journalIds: [] } }, 'portfolioIds无效'],
    [{ from: '2026-08-01', to: '2026-08-05', content: { portfolioIds: Array.from({ length: 101 }, (_, index) => `work_${index}`), journalIds: [] } }, 'portfolioIds必须是最多100项数组'],
    [{ from: '2026-08-01', to: '2026-08-05', content: { portfolioIds: ['work_1'], journalIds: [], ownerUserId: 'forged' } }, 'content无效'],
  ])('rejects invalid content metric input %#', async (input, message) => {
    const { store } = setup();
    await expect(store.readContentMetrics(owner, input as never)).rejects.toThrow(message);
  });
});
