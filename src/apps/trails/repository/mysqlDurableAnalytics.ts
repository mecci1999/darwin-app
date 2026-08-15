import { createHmac } from 'crypto';
import { Actor, AnalyticsContentMetrics, AnalyticsContentMetricsInput, AnalyticsWorkspaceOverview, DurableAnalyticsStore, PublicAnalyticsEvent } from '../types';
import { creatorSpaceOwnerId } from '../utils/actor';
import { TrailsSyncInputError } from './mysqlPortfolioCategorySync';

type QueryConnection = { transaction<T>(work: (transaction: object) => Promise<T>): Promise<T>; query(sql: string, options: { replacements: unknown[]; transaction: object }): Promise<[unknown, unknown]> };
const opaque = (value: unknown, label: string): string => { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw new TrailsSyncInputError(`${label}无效`); return value; };
const date = (value: unknown, label: string): string => { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) throw new TrailsSyncInputError(`${label}必须是ISO日期`); return value; };
const instant = (value: unknown, now: Date): string => { if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime()) || new Date(value).toISOString() !== value) throw new TrailsSyncInputError('occurredAt无效'); const occurredAt = new Date(value); if (occurredAt.getTime() < now.getTime() - 31 * 86400000 || occurredAt.getTime() > now.getTime() + 86400000) throw new TrailsSyncInputError('occurredAt超出允许范围'); return value; };
const integer = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
};
const rows = (value: unknown): Array<Record<string, unknown>> => Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && !Array.isArray(row)) : [];
const MAX_CONTENT_IDS_PER_TYPE = 100;
const contentMetricsInput = (input: AnalyticsContentMetricsInput) => {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.keys(input).every(key => key === 'from' || key === 'to' || key === 'content')) throw new TrailsSyncInputError('content metrics请求包含不允许字段');
  const from = date(input.from, 'from'); const to = date(input.to, 'to');
  if (!input.content || typeof input.content !== 'object' || Array.isArray(input.content) || !Object.keys(input.content).every(key => key === 'portfolioIds' || key === 'journalIds')) throw new TrailsSyncInputError('content无效');
  const list = (value: unknown, label: string) => {
    if (!Array.isArray(value) || value.length > MAX_CONTENT_IDS_PER_TYPE) throw new TrailsSyncInputError(`${label}必须是最多${MAX_CONTENT_IDS_PER_TYPE}项数组`);
    const ids = value.map(item => opaque(item, label));
    if (new Set(ids).size !== ids.length) throw new TrailsSyncInputError(`${label}不能重复`);
    return ids;
  };
  const portfolioIds = list(input.content.portfolioIds, 'portfolioIds'); const journalIds = list(input.content.journalIds, 'journalIds');
  if (!portfolioIds.length && !journalIds.length) throw new TrailsSyncInputError('content至少需要一个内容编号');
  return { from, to, content: { portfolioIds, journalIds } };
};

export class MySqlDurableAnalyticsRepository implements DurableAnalyticsStore {
  constructor(private readonly connection: QueryConnection, private readonly secret: string, private readonly now: () => Date = () => new Date()) {}
  private owner(actor: Actor): string { const owner = creatorSpaceOwnerId(actor); if (!owner) throw new TrailsSyncInputError('当前账号没有创作空间管理权限'); return owner; }
  private event(input: PublicAnalyticsEvent) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.eventId)) throw new TrailsSyncInputError('eventId无效');
    if (input.eventName !== 'page-view' && input.eventName !== 'content-view' && input.eventName !== 'outbound-click') throw new TrailsSyncInputError('eventName无效');
    if (!['site', 'portfolio', 'journal', 'trip', 'edition', 'location'].includes(input.contentType)) throw new TrailsSyncInputError('contentType无效');
    if ((input.contentType === 'site') !== (input.contentId === undefined)) throw new TrailsSyncInputError('contentId与contentType不匹配');
    if (input.acquisitionChannel !== undefined && !['direct', 'external-referral', 'campaign'].includes(input.acquisitionChannel)) throw new TrailsSyncInputError('acquisitionChannel无效');
    if (input.deviceClass !== undefined && !['desktop', 'mobile', 'tablet', 'other'].includes(input.deviceClass)) throw new TrailsSyncInputError('deviceClass无效');
    return { eventId: input.eventId, eventName: input.eventName, contentType: input.contentType, contentId: input.contentId ?? '', occurredAt: instant(input.occurredAt, this.now()), visitorId: input.visitorId === undefined ? undefined : opaque(input.visitorId, 'visitorId'), acquisitionChannel: input.acquisitionChannel ?? 'direct', deviceClass: input.deviceClass ?? 'other' };
  }
  async ingest(owner: Pick<Actor, 'tenantId' | 'userId'>, input: PublicAnalyticsEvent): Promise<void> {
    const event = this.event(input); const day = event.occurredAt.slice(0, 10); const ownerUserId = owner.userId;
    await this.connection.transaction(async transaction => {
      const [existing] = await this.connection.query('SELECT event_id FROM TrailsAnalyticsEventDedup WHERE tenant_id = ? AND event_id = ? FOR UPDATE', { replacements: [owner.tenantId, event.eventId], transaction });
      if (rows(existing).length) return;
      await this.connection.query('INSERT INTO TrailsAnalyticsEventDedup (tenant_id, event_id, received_at) VALUES (?, ?, ?)', { replacements: [owner.tenantId, event.eventId, this.now()], transaction });
      let uniqueContentVisitor = 0;
      if (event.visitorId) {
        const digest = createHmac('sha256', this.secret).update(`${owner.tenantId}:${ownerUserId}:${day}:${event.visitorId}`).digest('hex');
        const [seen] = await this.connection.query('SELECT visitor_digest FROM TrailsAnalyticsVisitorDay WHERE tenant_id = ? AND owner_user_id = ? AND day = ? AND visitor_digest = ? FOR UPDATE', { replacements: [owner.tenantId, ownerUserId, day, digest], transaction });
        if (!rows(seen).length) await this.connection.query('INSERT INTO TrailsAnalyticsVisitorDay (tenant_id, owner_user_id, day, visitor_digest) VALUES (?, ?, ?, ?)', { replacements: [owner.tenantId, ownerUserId, day, digest], transaction });
        const [contentSeen] = await this.connection.query('SELECT visitor_digest FROM TrailsAnalyticsContentVisitorDay WHERE tenant_id = ? AND owner_user_id = ? AND day = ? AND content_type = ? AND content_id = ? AND visitor_digest = ? FOR UPDATE', { replacements: [owner.tenantId, ownerUserId, day, event.contentType, event.contentId, digest], transaction });
        if (!rows(contentSeen).length) { await this.connection.query('INSERT INTO TrailsAnalyticsContentVisitorDay (tenant_id, owner_user_id, day, content_type, content_id, visitor_digest) VALUES (?, ?, ?, ?, ?, ?)', { replacements: [owner.tenantId, ownerUserId, day, event.contentType, event.contentId, digest], transaction }); uniqueContentVisitor = 1; }
      }
      await this.connection.query('INSERT INTO TrailsAnalyticsDaily (tenant_id, owner_user_id, day, content_type, content_id, event_name, event_count, visitor_count) VALUES (?, ?, ?, ?, ?, ?, 1, ?) ON DUPLICATE KEY UPDATE event_count = event_count + 1, visitor_count = visitor_count + VALUES(visitor_count)', { replacements: [owner.tenantId, ownerUserId, day, event.contentType, event.contentId, event.eventName, uniqueContentVisitor], transaction });
      if (event.eventName === 'page-view' || event.eventName === 'content-view') await this.connection.query('INSERT INTO TrailsAnalyticsAudienceDaily (tenant_id, owner_user_id, day, acquisition_channel, device_class, page_views) VALUES (?, ?, ?, ?, ?, 1) ON DUPLICATE KEY UPDATE page_views = page_views + 1', { replacements: [owner.tenantId, ownerUserId, day, event.acquisitionChannel, event.deviceClass], transaction });
      const retention = new Date(this.now().getTime() - 31 * 86400000).toISOString().slice(0, 10);
      await this.connection.query('DELETE FROM TrailsAnalyticsVisitorDay WHERE day < ?', { replacements: [retention], transaction });
      await this.connection.query('DELETE FROM TrailsAnalyticsContentVisitorDay WHERE day < ?', { replacements: [retention], transaction });
    });
  }
  async readWorkspace(actor: Actor, input: { from: string; to: string }): Promise<AnalyticsWorkspaceOverview> {
    const from = date(input.from, 'from'); const to = date(input.to, 'to'); const today = this.now().toISOString().slice(0, 10); if (to < from || to > today || from < new Date(this.now().getTime() - 30 * 86400000).toISOString().slice(0, 10)) throw new TrailsSyncInputError('analytics范围必须在最近31天内'); const owner = this.owner(actor);
    return this.connection.transaction(async transaction => {
      const args = [actor.tenantId, owner, from, to];
      const [summaryResult] = await this.connection.query('SELECT COALESCE(SUM(CASE WHEN event_name IN (\'page-view\', \'content-view\') THEN event_count ELSE 0 END), 0) AS pageViews, COALESCE(SUM(CASE WHEN event_name = \'content-view\' THEN event_count ELSE 0 END), 0) AS contentViews, COALESCE(SUM(CASE WHEN event_name = \'outbound-click\' THEN event_count ELSE 0 END), 0) AS outboundClicks FROM TrailsAnalyticsDaily WHERE tenant_id = ? AND owner_user_id = ? AND day >= ? AND day <= ?', { replacements: args, transaction });
      const [visitorResult] = await this.connection.query('SELECT COUNT(*) AS visitors FROM TrailsAnalyticsVisitorDay WHERE tenant_id = ? AND owner_user_id = ? AND day >= ? AND day <= ?', { replacements: args, transaction });
      const summary = rows(summaryResult)[0] ?? {};
      const [trendResult] = await this.connection.query('SELECT daily.day AS date, SUM(CASE WHEN daily.event_name IN (\'page-view\', \'content-view\') THEN daily.event_count ELSE 0 END) AS pageViews, (SELECT COUNT(*) FROM TrailsAnalyticsVisitorDay visitors WHERE visitors.tenant_id = daily.tenant_id AND visitors.owner_user_id = daily.owner_user_id AND visitors.day = daily.day) AS visitors FROM TrailsAnalyticsDaily daily WHERE daily.tenant_id = ? AND daily.owner_user_id = ? AND daily.day >= ? AND daily.day <= ? GROUP BY daily.day, daily.tenant_id, daily.owner_user_id ORDER BY daily.day ASC', { replacements: args, transaction });
      const [rankingResult] = await this.connection.query('SELECT content_type AS contentType, content_id AS contentId, SUM(CASE WHEN event_name IN (\'page-view\', \'content-view\') THEN event_count ELSE 0 END) AS pageViews, SUM(visitor_count) AS visitors FROM TrailsAnalyticsDaily WHERE tenant_id = ? AND owner_user_id = ? AND day >= ? AND day <= ? AND content_type <> \'site\' GROUP BY content_type, content_id HAVING pageViews > 0 ORDER BY pageViews DESC, contentId ASC LIMIT 8', { replacements: args, transaction });
      const [acquisitionResult] = await this.connection.query('SELECT acquisition_channel AS channel, SUM(page_views) AS pageViews FROM TrailsAnalyticsAudienceDaily WHERE tenant_id = ? AND owner_user_id = ? AND day >= ? AND day <= ? GROUP BY acquisition_channel ORDER BY pageViews DESC', { replacements: args, transaction });
      const [deviceResult] = await this.connection.query('SELECT device_class AS deviceClass, SUM(page_views) AS pageViews FROM TrailsAnalyticsAudienceDaily WHERE tenant_id = ? AND owner_user_id = ? AND day >= ? AND day <= ? GROUP BY device_class ORDER BY pageViews DESC', { replacements: args, transaction });
      const visitors = rows(visitorResult)[0] ?? {};
      return { enabled: true, range: { from, to }, totals: { pageViews: integer(summary.pageViews), visitors: integer(visitors.visitors), contentViews: integer(summary.contentViews), outboundClicks: integer(summary.outboundClicks) }, trend: rows(trendResult).map(row => ({ date: String(row.date).slice(0, 10), pageViews: integer(row.pageViews), visitors: integer(row.visitors) })), topContent: rows(rankingResult).map(row => ({ contentType: row.contentType as 'portfolio' | 'journal' | 'trip' | 'edition' | 'location', contentId: String(row.contentId), pageViews: integer(row.pageViews), visitors: integer(row.visitors) })), acquisition: rows(acquisitionResult).map(row => ({ channel: row.channel as 'direct' | 'external-referral' | 'campaign', pageViews: integer(row.pageViews) })), devices: rows(deviceResult).map(row => ({ deviceClass: row.deviceClass as 'desktop' | 'mobile' | 'tablet' | 'other', pageViews: integer(row.pageViews) })), unavailableDomains: ['trip-registration', 'revenue'] };
    });
  }
  async readContentMetrics(actor: Actor, input: AnalyticsContentMetricsInput): Promise<AnalyticsContentMetrics> {
    const request = contentMetricsInput(input); const today = this.now().toISOString().slice(0, 10);
    if (request.to < request.from || request.to > today || request.from < new Date(this.now().getTime() - 30 * 86400000).toISOString().slice(0, 10)) throw new TrailsSyncInputError('analytics范围必须在最近31天内');
    const owner = this.owner(actor);
    const requested = [
      ...request.content.portfolioIds.map(contentId => ({ contentType: 'portfolio' as const, contentId })),
      ...request.content.journalIds.map(contentId => ({ contentType: 'journal' as const, contentId })),
    ];
    const predicates = requested.map(() => '(content_type = ? AND content_id = ?)').join(' OR ');
    const subjectPredicates = requested.map(() => '(subject_type = ? AND subject_id = ?)').join(' OR ');
    const contentArgs = requested.flatMap(item => [item.contentType, item.contentId]);
    return this.connection.transaction(async transaction => {
      const [pageViewResult] = await this.connection.query(`SELECT content_type AS contentType, content_id AS contentId, COALESCE(SUM(CASE WHEN event_name IN ('page-view', 'content-view') THEN event_count ELSE 0 END), 0) AS pageViews FROM TrailsAnalyticsDaily WHERE tenant_id = ? AND owner_user_id = ? AND day >= ? AND day <= ? AND (${predicates}) GROUP BY content_type, content_id`, { replacements: [actor.tenantId, owner, request.from, request.to, ...contentArgs], transaction });
      const [commentResult] = await this.connection.query(`SELECT subject_type AS contentType, subject_id AS contentId, COUNT(*) AS approvedCommentCount FROM TrailsGuestComment WHERE tenant_id = ? AND owner_user_id = ? AND status = 'approved' AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY) AND (${subjectPredicates}) GROUP BY subject_type, subject_id`, { replacements: [actor.tenantId, owner, request.from, request.to, ...contentArgs], transaction });
      const pageViews = new Map(rows(pageViewResult).map(row => [`${row.contentType}:${row.contentId}`, integer(row.pageViews)]));
      const approvedComments = new Map(rows(commentResult).map(row => [`${row.contentType}:${row.contentId}`, integer(row.approvedCommentCount)]));
      return { range: { from: request.from, to: request.to }, metrics: requested.map(item => ({ contentType: item.contentType, contentId: item.contentId, pageViews: pageViews.get(`${item.contentType}:${item.contentId}`) ?? 0, approvedCommentCount: approvedComments.get(`${item.contentType}:${item.contentId}`) ?? 0 })) };
    });
  }
}
