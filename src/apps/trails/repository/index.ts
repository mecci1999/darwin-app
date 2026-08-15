import {
  FinanceEntry,
  GearItem,
  Hike,
  Journal,
  MapPlace,
  PackingPlan,
  Portfolio,
  PortfolioCategory,
  TrailsRepository,
  Lifecycle,
  Visibility,
  Actor,
  GuestComment,
  PublicOwnerProfile,
  GuidedTripPlan,
  GuidedTripRegistration,
  SyncChange,
  SyncMutation,
  SyncPushResult,
  SyncResource,
  SyncResourceType,
  SyncScope,
  ShootSession,
  PublishingPackage,
  TrailsShareGrant,
} from '../types';
import { actorCanManageCreatorSpace, creatorSpaceOwnerId } from '../utils/actor';

type TenantOwnerFilter = { tenantId?: string; ownerUserId?: string };
type PortfolioFilter = TenantOwnerFilter & { visibility?: Visibility; lifecycle?: Lifecycle; categoryId?: string };
type PublicFilter = TenantOwnerFilter & { visibility?: Visibility; lifecycle?: Lifecycle };
type PortfolioCategoryFilter = TenantOwnerFilter & { visibility?: Visibility; status?: PortfolioCategory['status'] };
type GuidedTripPlanFilter = TenantOwnerFilter & { visibility?: Visibility; lifecycle?: Lifecycle; planStatus?: GuidedTripPlan['planStatus'] };
type GuidedTripRegistrationFilter = { tenantId?: string; tripPlanId?: string; participantUserId?: string; status?: GuidedTripRegistration['status'] };
type GuestCommentFilter = Partial<Pick<GuestComment, 'tenantId' | 'ownerUserId' | 'subjectType' | 'subjectId' | 'status'>>;
type ShootSessionFilter = TenantOwnerFilter & { status?: ShootSession['status'] };
type PublishingPackageFilter = TenantOwnerFilter & { portfolioId?: string; platform?: PublishingPackage['platform']; status?: PublishingPackage['status'] };
type TrailsShareGrantFilter = Partial<Pick<TrailsShareGrant, 'tenantId' | 'ownerUserId' | 'recipientUserId' | 'resourceType' | 'resourceId'>>;

/** Development/demo catalog only; production owners create and manage their own categories. */
const developmentPortfolioCategories: PortfolioCategory[] = [
  { id: 'portfolio-category-demo-mountains', tenantId: 'development-demo', ownerUserId: 'development-demo', slug: 'mountains', nameZh: '山岳', description: '开发演示用：山地、山谷与高海拔风景摄影。', sortOrder: 10, visibility: 'public', status: 'active', lifecycle: 'published', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', resourceVersion: 1 },
  { id: 'portfolio-category-demo-coast', tenantId: 'development-demo', ownerUserId: 'development-demo', slug: 'coast', nameZh: '海岸', description: '开发演示用：海岸线、潮汐与滨海风景摄影。', sortOrder: 20, visibility: 'public', status: 'active', lifecycle: 'published', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', resourceVersion: 1 },
  { id: 'portfolio-category-demo-wilderness', tenantId: 'development-demo', ownerUserId: 'development-demo', slug: 'wilderness', nameZh: '旷野', description: '开发演示用：荒野、森林与广阔地貌摄影。', sortOrder: 30, visibility: 'public', status: 'active', lifecycle: 'published', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', resourceVersion: 1 },
  { id: 'portfolio-category-demo-night-sky', tenantId: 'development-demo', ownerUserId: 'development-demo', slug: 'night-sky', nameZh: '星空', description: '开发演示用：夜空、银河与低光环境摄影。', sortOrder: 40, visibility: 'public', status: 'active', lifecycle: 'published', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', resourceVersion: 1 },
  { id: 'portfolio-category-demo-people-and-travel', tenantId: 'development-demo', ownerUserId: 'development-demo', slug: 'people-and-travel', nameZh: '人与行旅', description: '开发演示用：人物、旅途与在地生活摄影。', sortOrder: 50, visibility: 'public', status: 'active', lifecycle: 'published', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', resourceVersion: 1 },
];
type PublicOwnerProfileRecord = PublicOwnerProfile & { tenantId: string; ownerUserId: string };
const developmentPublicOwnerProfiles: PublicOwnerProfileRecord[] = [
  { tenantId: 'development-demo', ownerUserId: 'development-demo', displayName: 'StarLight', biography: 'Photography portfolio and journal.', contactLinks: [{ kind: 'website', href: 'https://example.com' }] },
];

const matches = <T extends object>(record: T, filter: Partial<T>) =>
  Object.entries(filter).every(([key, value]) => value === undefined || record[key] === value);

const clone = <T>(value: T): T => structuredClone(value);
const resourceTypeFor = (resource: SyncResource): SyncResourceType => {
  if ('slug' in resource) return 'portfolio-category';
  if ('summary' in resource) return 'portfolio';
  if ('excerpt' in resource) return 'journal';
  if ('latitude' in resource) return 'map-place';
  if ('route' in resource) return 'hike';
  if ('weightGrams' in resource) return 'gear-item';
  if ('gearItemIds' in resource) return 'packing-plan';
  return 'finance-entry';
};
const isFinance = (type: SyncResourceType) => type === 'finance-entry';

/** Development-only adapter. It intentionally does not provide durable persistence. */
export class InMemoryTrailsRepository implements TrailsRepository {
  private readonly portfolios = new Map<string, Portfolio>();
  private readonly publishingPackages = new Map<string, PublishingPackage>();
  private readonly portfolioCategories = new Map<string, PortfolioCategory>(
    developmentPortfolioCategories.map((category) => [category.id, category]),
  );
  private readonly journals = new Map<string, Journal>();
  private readonly guestComments = new Map<string, GuestComment>();
  private readonly mapPlaces = new Map<string, MapPlace>();
  private readonly hikes = new Map<string, Hike>();
  private readonly gear = new Map<string, GearItem>();
  private readonly packingPlans = new Map<string, PackingPlan>();
  private readonly financeEntries = new Map<string, FinanceEntry>();
  private readonly shootSessions = new Map<string, ShootSession>();
  private readonly guidedTripPlans = new Map<string, GuidedTripPlan>();
  private readonly guidedTripRegistrations = new Map<string, GuidedTripRegistration>();
  private readonly shareGrants = new Map<string, TrailsShareGrant>();
  private readonly changes: SyncChange[] = [];
  private readonly mutationResults = new Map<string, { fingerprint: string; result: SyncPushResult }>();
  private cursor = 0;

  listPortfolios(filter: PortfolioFilter): Portfolio[] { return [...this.portfolios.values()].filter((item) => matches(item, filter)); }
  getPortfolio(id: string): Portfolio | undefined { const item = this.portfolios.get(id); return item && clone(item); }
  savePortfolio(portfolio: Portfolio): Portfolio { return this.save(this.portfolios, portfolio); }
  listPublishingPackages(filter: PublishingPackageFilter): PublishingPackage[] {
    return [...this.publishingPackages.values()].filter((item) => matches(item, filter)).sort((left, right) => left.createdAt.localeCompare(right.createdAt)).map(clone);
  }
  getPublishingPackage(id: string): PublishingPackage | undefined { const item = this.publishingPackages.get(id); return item && clone(item); }
  /** Publishing records are excluded from broad sync until a durable audit policy exists. */
  savePublishingPackage(publishingPackage: PublishingPackage): PublishingPackage { return this.savePrivate(this.publishingPackages, publishingPackage); }
  listPortfolioCategories(filter: PortfolioCategoryFilter): PortfolioCategory[] {
    return [...this.portfolioCategories.values()]
      .filter((item) => matches(item, filter))
      .sort((left, right) => left.sortOrder - right.sortOrder || left.slug.localeCompare(right.slug));
  }
  getPortfolioCategory(id: string): PortfolioCategory | undefined { const item = this.portfolioCategories.get(id); return item && clone(item); }
  getPortfolioCategoryBySlug(filter: Pick<PortfolioCategory, 'tenantId' | 'ownerUserId' | 'slug'>): PortfolioCategory | undefined {
    const category = [...this.portfolioCategories.values()].find((category) =>
      category.tenantId === filter.tenantId && category.ownerUserId === filter.ownerUserId && category.slug === filter.slug,
    );
    return category && clone(category);
  }
  savePortfolioCategory(category: PortfolioCategory): PortfolioCategory {
    return this.save(this.portfolioCategories, category);
  }
  listJournals(filter: PublicFilter): Journal[] { return [...this.journals.values()].filter((item) => matches(item, filter)); }
  getJournal(id: string): Journal | undefined { const item = this.journals.get(id); return item && clone(item); }
  saveJournal(journal: Journal): Journal { return this.save(this.journals, journal); }
  getPublicOwnerProfile(owner: { tenantId: string; ownerUserId: string }): PublicOwnerProfile | undefined {
    const profile = developmentPublicOwnerProfiles.find((item) => item.tenantId === owner.tenantId && item.ownerUserId === owner.ownerUserId);
    if (!profile) return undefined;
    const { tenantId: _tenantId, ownerUserId: _ownerUserId, ...publicProfile } = profile;
    return clone(publicProfile);
  }
  listGuestComments(filter: GuestCommentFilter): GuestComment[] {
    return [...this.guestComments.values()].filter((item) => matches(item, filter)).sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)).map(clone);
  }
  getGuestComment(id: string): GuestComment | undefined { const item = this.guestComments.get(id); return item && clone(item); }
  saveGuestComment(comment: GuestComment): GuestComment { return this.saveComment(this.guestComments, comment); }
  listMapPlaces(filter: PublicFilter): MapPlace[] { return [...this.mapPlaces.values()].filter((item) => matches(item, filter)); }
  saveMapPlace(place: MapPlace): MapPlace { return this.save(this.mapPlaces, place); }
  listHikes(filter: TenantOwnerFilter): Hike[] { return [...this.hikes.values()].filter((item) => matches(item, filter)); }
  getHike(id: string): Hike | undefined { const item = this.hikes.get(id); return item && clone(item); }
  saveHike(hike: Hike): Hike { return this.save(this.hikes, hike); }
  listGear(filter: TenantOwnerFilter): GearItem[] { return [...this.gear.values()].filter((item) => matches(item, filter)); }
  saveGear(item: GearItem): GearItem { return this.save(this.gear, item); }
  listPackingPlans(filter: TenantOwnerFilter): PackingPlan[] { return [...this.packingPlans.values()].filter((item) => matches(item, filter)); }
  savePackingPlan(plan: PackingPlan): PackingPlan { return this.save(this.packingPlans, plan); }
  listFinanceEntries(filter: TenantOwnerFilter): FinanceEntry[] { return [...this.financeEntries.values()].filter((item) => matches(item, filter)); }
  saveFinanceEntry(entry: FinanceEntry): FinanceEntry { return this.save(this.financeEntries, entry); }
  /** Sessions are intentionally excluded from generic and finance sync until a durable audited writer exists. */
  listShootSessions(filter: ShootSessionFilter): ShootSession[] {
    return [...this.shootSessions.values()].filter((item) => matches(item, filter)).sort((left, right) => left.createdAt.localeCompare(right.createdAt)).map(clone);
  }
  getShootSession(id: string): ShootSession | undefined { const item = this.shootSessions.get(id); return item && clone(item); }
  saveShootSession(session: ShootSession): ShootSession { return this.savePrivate(this.shootSessions, session); }
  listGuidedTripPlans(filter: GuidedTripPlanFilter): GuidedTripPlan[] {
    return [...this.guidedTripPlans.values()].filter((item) => matches(item, filter)).sort((left, right) => left.startsOn.localeCompare(right.startsOn));
  }
  getGuidedTripPlan(id: string): GuidedTripPlan | undefined { const item = this.guidedTripPlans.get(id); return item && clone(item); }
  saveGuidedTripPlan(plan: GuidedTripPlan): GuidedTripPlan { return this.saveTrip(this.guidedTripPlans, plan); }
  listGuidedTripRegistrations(filter: GuidedTripRegistrationFilter): GuidedTripRegistration[] {
    return [...this.guidedTripRegistrations.values()].filter((item) => matches(item, filter)).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }
  getGuidedTripRegistration(id: string): GuidedTripRegistration | undefined { const item = this.guidedTripRegistrations.get(id); return item && clone(item); }
  getGuidedTripRegistrationForParticipant(filter: Pick<GuidedTripRegistration, 'tenantId' | 'tripPlanId' | 'participantUserId'>): GuidedTripRegistration | undefined {
    const registration = [...this.guidedTripRegistrations.values()].find((item) => matches(item, filter));
    return registration && clone(registration);
  }
  saveGuidedTripRegistration(registration: GuidedTripRegistration): GuidedTripRegistration { return this.saveTrip(this.guidedTripRegistrations, registration); }
  getShareGrant(id: string): TrailsShareGrant | undefined { const grant = this.shareGrants.get(id); return grant && clone(grant); }
  /** Share grants remain outside sync and do not generate a shared cross-user change feed. */
  saveShareGrant(grant: TrailsShareGrant): TrailsShareGrant { this.shareGrants.set(grant.id, clone(grant)); return clone(grant); }
  listShareGrants(filter: TrailsShareGrantFilter): TrailsShareGrant[] {
    return [...this.shareGrants.values()].filter((grant) => matches(grant, filter)).sort((left, right) => left.createdAt.localeCompare(right.createdAt)).map(clone);
  }

  pullChanges(actor: Actor, cursor: string | undefined, scope: SyncScope): { changes: SyncChange[]; nextCursor: string } {
    const after = cursor === undefined ? 0 : Number(cursor);
    if (!Number.isSafeInteger(after) || after < 0) throw new Error('cursor必须是非负整数');
    const changes = this.changes.filter((change) =>
      Number(change.cursor) > after
      && change.resource.tenantId === actor.tenantId
      && change.resource.ownerUserId === actor.userId
      && (scope === 'owner-finance' ? isFinance(change.resourceType) : !isFinance(change.resourceType)),
    ).map(clone);
    return { changes, nextCursor: String(this.cursor) };
  }

  pushMutation(actor: Actor, mutation: SyncMutation): SyncPushResult {
    const ownerUserId = creatorSpaceOwnerId(actor);
    if (!ownerUserId) throw new Error('当前账号没有创作空间管理权限');
    const cacheKey = `${actor.tenantId}:${actor.userId}:${mutation.mutationId}`;
    const cached = this.mutationResults.get(cacheKey);
    const fingerprint = JSON.stringify({ resourceType: mutation.resourceType, resourceId: mutation.resourceId, operation: mutation.operation, baseVersion: mutation.baseVersion, payload: mutation.payload });
    if (cached) {
      if (cached.fingerprint !== fingerprint) throw new Error('mutationId不能用于不同的同步变更');
      return cached.result.kind === 'conflict' ? clone(cached.result) : { ...clone(cached.result), kind: 'duplicate' };
    }
    const current = this.getResource(mutation.resourceType, mutation.resourceId);
    if (current && !actorCanManageCreatorSpace(actor, current)) throw new Error('同步资源不属于当前创作空间');
    if (current && mutation.baseVersion !== current.resourceVersion) {
      const conflict: SyncPushResult = { kind: 'conflict', mutationId: mutation.mutationId, code: 'STALE_VERSION', resourceType: mutation.resourceType, resourceId: mutation.resourceId, baseVersion: mutation.baseVersion, current };
      this.mutationResults.set(cacheKey, { fingerprint, result: clone(conflict) });
      return conflict;
    }
    if (!current && mutation.baseVersion !== null) throw new Error('新资源必须使用空的baseVersion');
    const timestamp = new Date().toISOString();
    const payload = mutation.payload;
    const category = current as PortfolioCategory | undefined;
    const resource: PortfolioCategory = category
      ? { ...category, slug: typeof payload.slug === 'string' ? payload.slug : category.slug, nameZh: typeof payload.nameZh === 'string' ? payload.nameZh : category.nameZh, description: typeof payload.description === 'string' ? payload.description : category.description, sortOrder: typeof payload.sortOrder === 'number' ? payload.sortOrder : category.sortOrder, visibility: payload.visibility === 'public' || payload.visibility === 'private' || payload.visibility === 'unlisted' ? payload.visibility : category.visibility, updatedAt: timestamp }
      : { id: mutation.resourceId, tenantId: actor.tenantId, ownerUserId, slug: typeof payload.slug === 'string' ? payload.slug : '', nameZh: typeof payload.nameZh === 'string' ? payload.nameZh : '', description: typeof payload.description === 'string' ? payload.description : '', sortOrder: typeof payload.sortOrder === 'number' ? payload.sortOrder : 0, visibility: payload.visibility === 'public' || payload.visibility === 'private' || payload.visibility === 'unlisted' ? payload.visibility : 'private', status: 'active', lifecycle: 'draft', createdAt: timestamp, updatedAt: timestamp, resourceVersion: 0 };
    const existingCategory = this.getPortfolioCategoryBySlug({ tenantId: actor.tenantId, ownerUserId: resource.ownerUserId, slug: resource.slug });
    if (existingCategory && existingCategory.id !== resource.id) throw new Error('slug已被当前所有者使用');
    const applied: SyncPushResult = { kind: 'applied', mutationId: mutation.mutationId, resource: this.savePortfolioCategory(resource) };
    this.mutationResults.set(cacheKey, { fingerprint, result: clone(applied) });
    return applied;
  }

  private save<T extends SyncResource>(store: Map<string, T>, resource: T): T {
    const previous = store.get(resource.id);
    const saved = { ...clone(resource), resourceVersion: (previous?.resourceVersion ?? 0) + 1 } as T;
    store.set(saved.id, saved);
    this.cursor += 1;
    this.changes.push({ cursor: String(this.cursor), resourceType: resourceTypeFor(saved), resourceId: saved.id, operation: 'upsert', updatedAt: saved.updatedAt, resource: clone(saved) });
    return clone(saved);
  }

  /** Trips are deliberately excluded from the broad sync feed until their transition rules have an auditable durable implementation. */
  private saveTrip<T extends { id: string; resourceVersion: number }>(store: Map<string, T>, resource: T): T {
    const previous = store.get(resource.id);
    const saved = { ...clone(resource), resourceVersion: (previous?.resourceVersion ?? 0) + 1 };
    store.set(saved.id, saved);
    return clone(saved);
  }

  /** Guest comments are intentionally excluded from owner sync and its broad change feed. */
  private saveComment<T extends { id: string; resourceVersion: number }>(store: Map<string, T>, resource: T): T {
    const previous = store.get(resource.id);
    const saved = { ...clone(resource), resourceVersion: (previous?.resourceVersion ?? 0) + 1 };
    store.set(saved.id, saved);
    return clone(saved);
  }

  /** Shoot sessions contain exact locations and finance references, so never enter a sync feed. */
  private savePrivate<T extends { id: string; resourceVersion: number }>(store: Map<string, T>, resource: T): T {
    const previous = store.get(resource.id);
    const saved = { ...clone(resource), resourceVersion: (previous?.resourceVersion ?? 0) + 1 };
    store.set(saved.id, saved);
    return clone(saved);
  }

  private getResource(type: SyncResourceType, id: string): SyncResource | undefined {
    const stores: Record<SyncResourceType, Map<string, SyncResource>> = { portfolio: this.portfolios, 'portfolio-category': this.portfolioCategories, journal: this.journals, 'map-place': this.mapPlaces, hike: this.hikes, 'gear-item': this.gear, 'packing-plan': this.packingPlans, 'finance-entry': this.financeEntries };
    const resource = stores[type].get(id);
    return resource && clone(resource);
  }
}
