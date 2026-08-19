import { Context } from 'node-universe';
import { createHash, randomBytes } from 'crypto';
import { HttpResponseItem, HttpStatusCode, Starlight } from 'typings';
import { instrumentServiceActions } from '../../starlight/metrics/utils/action-metrics';
import { Actor, DEFAULT_PUBLIC_SITE_CHROME, DurablePortfolioCategoryMutation, DurableMediaAssetVariantName, DurablePublishingPackageStatus, DurableGuestComment, DurableRichDocument, EffectivePublicSiteContent, GuestComment, GuidedTripItineraryItem, GuidedTripMaterialReference, GuidedTripPlan, GuidedTripPlanStatus, GuidedTripRegistration, GuidedTripRegistrationStatus, Hike, Journal, PhotoTechnicalMetadata, Portfolio, PortfolioCategory, PortfolioCategorySyncPayload, PublicAnalyticsEvent, PublicChromeTarget, PublishingMeasurementEvent, PublishingPackage, PublishingPackageStatus, RichDocumentSubjectType, SharedGearProjection, SharedPackingGearProjection, SharedResourceProjection, ShootSession, ShootSessionStatus, ShareableResourceType, SyncMutation, SyncScope, TrailsShareGrant, TrailsState, Visibility, WeatherForecastRequest } from '../types';
import { TrailsSyncDuplicateSlugError, TrailsSyncInputError } from '../repository/mysqlPortfolioCategorySync';
import { TrailsDurablePortfolioStaleVersionError } from '../repository/mysqlDurablePortfolio';
import { TrailsDurableExhibitionThemeStaleVersionError } from '../repository/mysqlDurableExhibitionTheme';
import { TrailsDurableJournalStaleVersionError } from '../repository/mysqlDurableJournal';
import { richDocumentTextProjection, validateRichDocument } from '../repository/mysqlRichDocument';
import { TrailsDurableGearStaleVersionError } from '../repository/mysqlDurableGear';
import { TrailsDurablePackingPlanStaleVersionError } from '../repository/mysqlDurablePackingPlan';
import { TrailsDurableFinanceStaleVersionError } from '../repository/mysqlDurableFinance';
import { TrailsDurableMediaCommerceStaleVersionError } from '../repository/mysqlDurableMediaCommerce';
import { TrailsMediaAssetRegistryStaleVersionError } from '../repository/mysqlMediaAssetRegistry';
import { TrailsDurablePublishingPackageStaleVersionError } from '../repository/mysqlDurablePublishingPackage';
import { TrailsPublicSiteContentStaleVersionError } from '../repository/mysqlPublicSiteContent';
import { TrailsGuestCommentStaleVersionError } from '../repository/mysqlGuestComment';
import { TrailsDurableGuidedTripStaleVersionError } from '../repository/mysqlDurableGuidedTrip';
import { TrailsDurableExternalVideoReferenceStaleVersionError } from '../repository/mysqlDurableExternalVideoReference';
import { TrailsDurableLocationCardStaleVersionError } from '../repository/mysqlDurableLocationCard';
import { TrailsShootingLocationStaleVersionError } from '../repository/mysqlShootingLocation';
import { actorCanManageCreatorSpace, actorCanReadPrivate, capabilitySnapshot, creatorSpaceOwnerId, resolveActor } from '../utils/actor';
import { createPublicOwnerResolver } from '../utils/public-owner';
import { PublicResponseCache, publicResponseCacheKey } from '../utils/public-response-cache';
import { failure, success } from '../utils/responses';
import { Input, coordinate, exhibitionPresentation, guestAvatarId, guestCommentBody, guestCommentSubject, guestDisplayName, normalizedEmail, opaqueIdArray, optionalNumber, optionalOpaqueId, optionalSlug, optionalString, photoTechnicalMetadata, plainTextArray, publishingApprovals, publishingClaims, publishingContentOrigin, publishingExportVariants, publishingLocationPolicy, publishingPath, publishingPlatform, publishingRights, publishingUtmUrl, requiredNonNegativeInteger, requiredSlug, requiredString, stringArray, visibility } from '../validators';
import { TencentCosTrustedPhotoshopPackageTransfer } from '../utils/tencent-cos-trusted-photoshop-package-transfer';
import { TencentCosTrustedPhotoshopIngestionPrivateStorage } from '../utils/tencent-cos-trusted-photoshop-ingestion-private-storage';
import { ingestTrustedPhotoshopPublication } from '../utils/trusted-photoshop-publication-ingestion-coordinator';
import { TrustedPhotoshopPublicationIngestionCoordinatorError } from '../utils/trusted-photoshop-publication-ingestion-coordinator';

// A Photoshop import performs Sharp conversion plus ten private COS writes. Keep
// that CPU and I/O work outside the interactive micro-app RPC while preserving a
// single writer on the two-core production host.
let trustedPhotoshopIngestionQueue: Promise<void> = Promise.resolve();
const enqueueTrustedPhotoshopIngestion = (operationId: string, work: () => Promise<void>): void => {
  trustedPhotoshopIngestionQueue = trustedPhotoshopIngestionQueue
    .then(work, work)
    .catch((error: unknown) => {
      const stage = error instanceof TrustedPhotoshopPublicationIngestionCoordinatorError ? error.stage : 'internal';
      console.error(`Trails Photoshop ingestion failed: ${operationId} stage=${stage}`);
    });
};

const params = (ctx: Context): Input => {
  const value: unknown = ctx.params;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value));
};
const analyticsEvent = (input: Input): PublicAnalyticsEvent => {
  input = Object.fromEntries(
    Object.entries(input).filter(([key]) => !['routeService', 'service', 'version', 'action', 'meta'].includes(key)),
  );
  const allowed = ['eventId', 'eventName', 'contentType', 'contentId', 'occurredAt', 'visitorId', 'acquisitionChannel', 'deviceClass'];
  if (!Object.keys(input).every(key => allowed.includes(key))) throw new TrailsSyncInputError('analytics请求包含不允许字段');
  const eventName = input.eventName;
  const contentType = input.contentType;
  if ((eventName !== 'page-view' && eventName !== 'content-view' && eventName !== 'outbound-click') || (contentType !== 'site' && contentType !== 'portfolio' && contentType !== 'journal' && contentType !== 'trip' && contentType !== 'edition' && contentType !== 'location')) throw new TrailsSyncInputError('analytics事件无效');
  if (input.acquisitionChannel !== undefined && input.acquisitionChannel !== 'direct' && input.acquisitionChannel !== 'external-referral' && input.acquisitionChannel !== 'campaign') throw new TrailsSyncInputError('acquisitionChannel无效');
  if (input.deviceClass !== undefined && input.deviceClass !== 'desktop' && input.deviceClass !== 'mobile' && input.deviceClass !== 'tablet' && input.deviceClass !== 'other') throw new TrailsSyncInputError('deviceClass无效');
  return { eventId: requiredString(input, 'eventId', 'eventId'), eventName, contentType, ...(input.contentId === undefined ? {} : { contentId: requiredString(input, 'contentId', 'contentId') }), occurredAt: requiredString(input, 'occurredAt', 'occurredAt'), ...(input.visitorId === undefined ? {} : { visitorId: requiredString(input, 'visitorId', 'visitorId') }), ...(input.acquisitionChannel === undefined ? {} : { acquisitionChannel: input.acquisitionChannel }), ...(input.deviceClass === undefined ? {} : { deviceClass: input.deviceClass }) };
};
const analyticsRange = (input: Input) => {
  if (!Object.keys(input).every(key => key === 'from' || key === 'to')) throw new TrailsSyncInputError('analytics范围包含不允许字段');
  const from = requiredString(input, 'from', 'from'); const to = requiredString(input, 'to', 'to');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new TrailsSyncInputError('analytics范围必须是ISO日期');
  return { from, to };
};
const analyticsContentMetrics = (input: Input) => {
  if (Object.keys(input).length !== 3 || !Object.keys(input).every(key => key === 'from' || key === 'to' || key === 'content') || !input.content || typeof input.content !== 'object' || Array.isArray(input.content)) throw new TrailsSyncInputError('content metrics请求包含不允许字段');
  const content = input.content as Input;
  if (Object.keys(content).length !== 2 || !Object.keys(content).every(key => key === 'portfolioIds' || key === 'journalIds')) throw new TrailsSyncInputError('content无效');
  const ids = (value: unknown, label: string) => { if (!Array.isArray(value) || value.length > 100) throw new TrailsSyncInputError(`${label}必须是最多100项数组`); const values = value.map(item => { if (typeof item !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(item)) throw new TrailsSyncInputError(`${label}无效`); return item; }); if (new Set(values).size !== values.length) throw new TrailsSyncInputError(`${label}不能重复`); return values; };
  const portfolioIds = ids(content.portfolioIds, 'portfolioIds'); const journalIds = ids(content.journalIds, 'journalIds');
  if (!portfolioIds.length && !journalIds.length) throw new TrailsSyncInputError('content至少需要一个内容编号');
  return { ...analyticsRange({ from: input.from, to: input.to }), content: { portfolioIds, journalIds } };
};
const durableTripRegistrationSubmit = (input: Input) => {
  const allowed = ['mutationId', 'tripId', 'requiredAcknowledgement', 'releaseAccepted', 'releaseVersion'];
  if (Object.keys(input).length !== allowed.length || !Object.keys(input).every(key => allowed.includes(key))) throw new TrailsSyncInputError('报名请求包含不允许字段');
  if (input.requiredAcknowledgement !== true || input.releaseAccepted !== true) throw new TrailsSyncInputError('必须确认必要说明并接受发布版本声明');
  return { mutationId: requiredString(input, 'mutationId', 'mutationId'), tripId: requiredString(input, 'tripId', 'tripId'), requiredAcknowledgement: true as const, releaseAccepted: true as const, releaseVersion: requiredString(input, 'releaseVersion', 'releaseVersion') };
};
const durableTripRegistrationRead = (input: Input) => { if (Object.keys(input).length !== 1 || typeof input.id !== 'string') throw new TrailsSyncInputError('报名读取请求包含不允许字段'); return { id: input.id }; };
const durableTripRegistrationCancel = (input: Input) => { const allowed = ['id', 'resourceVersion', 'mutationId']; if (Object.keys(input).length !== allowed.length || !Object.keys(input).every(key => allowed.includes(key))) throw new TrailsSyncInputError('报名取消请求包含不允许字段'); return { id: requiredString(input, 'id', '报名编号'), resourceVersion: canonicalDecimalString(input.resourceVersion, 'resourceVersion'), mutationId: requiredString(input, 'mutationId', 'mutationId') }; };
const durableTripRegistrationTransition = (input: Input) => { const allowed = ['id', 'resourceVersion', 'mutationId', 'status']; if (Object.keys(input).length !== allowed.length || !Object.keys(input).every(key => allowed.includes(key))) throw new TrailsSyncInputError('报名状态请求包含不允许字段'); const status = input.status; if (status !== 'waitlisted' && status !== 'rejected' && status !== 'cancelled') throw new TrailsSyncInputError('报名状态无效'); return { id: requiredString(input, 'id', '报名编号'), resourceVersion: canonicalDecimalString(input.resourceVersion, 'resourceVersion'), mutationId: requiredString(input, 'mutationId', 'mutationId'), status: status as 'waitlisted' | 'rejected' | 'cancelled' }; };
const durableTripRegistrationSummary = (input: Input) => { if (Object.keys(input).length !== 1 || typeof input.tripId !== 'string') throw new TrailsSyncInputError('报名摘要请求包含不允许字段'); return { tripId: input.tripId }; };
const durableTripCapacity = (input: Input) => { const allowed = ['tripId', 'capacity', 'mutationId']; if (Object.keys(input).length !== allowed.length || !Object.keys(input).every(key => allowed.includes(key)) || typeof input.capacity !== 'number') throw new TrailsSyncInputError('名额配置请求包含不允许字段'); return { tripId: requiredString(input, 'tripId', 'tripId'), capacity: input.capacity, mutationId: requiredString(input, 'mutationId', 'mutationId') }; };
const durableTripPaymentTerms = (input: Input) => { const allowed = ['tripId', 'currency', 'depositMinor', 'balanceMinor', 'depositDueHours', 'balanceDueDays', 'refundPolicySummary', 'expectedResourceVersion', 'mutationId']; if (Object.keys(input).length !== allowed.length || !Object.keys(input).every(key => allowed.includes(key))) throw new TrailsSyncInputError('摄影团付款条款请求包含不允许字段'); if (input.expectedResourceVersion !== null && typeof input.expectedResourceVersion !== 'string') throw new TrailsSyncInputError('expectedResourceVersion无效'); return { tripId: requiredString(input, 'tripId', 'tripId'), currency: requiredString(input, 'currency', 'currency'), depositMinor: requiredNonNegativeInteger(input, 'depositMinor'), balanceMinor: requiredNonNegativeInteger(input, 'balanceMinor'), depositDueHours: requiredNonNegativeInteger(input, 'depositDueHours'), balanceDueDays: requiredNonNegativeInteger(input, 'balanceDueDays'), refundPolicySummary: requiredString(input, 'refundPolicySummary', 'refundPolicySummary'), expectedResourceVersion: input.expectedResourceVersion === null ? null : canonicalDecimalString(input.expectedResourceVersion, 'expectedResourceVersion'), mutationId: requiredString(input, 'mutationId', 'mutationId') }; };
const durableTripPaymentApprove = (input: Input) => { const allowed = ['registrationId', 'expectedResourceVersion', 'mutationId']; if (Object.keys(input).length !== allowed.length || !Object.keys(input).every(key => allowed.includes(key))) throw new TrailsSyncInputError('摄影团定金审核请求包含不允许字段'); return { registrationId: requiredString(input, 'registrationId', 'registrationId'), expectedResourceVersion: canonicalDecimalString(input.expectedResourceVersion, 'expectedResourceVersion'), mutationId: requiredString(input, 'mutationId', 'mutationId') }; };
const durableTripPaymentTransition = (input: Input) => { const allowed = ['id', 'status', 'expectedResourceVersion', 'mutationId']; if (Object.keys(input).length !== allowed.length || !Object.keys(input).every(key => allowed.includes(key))) throw new TrailsSyncInputError('摄影团付款状态请求包含不允许字段'); if (!['confirmed', 'cancelled', 'refund-pending', 'refunded'].includes(String(input.status))) throw new TrailsSyncInputError('摄影团付款状态无效'); return { id: requiredString(input, 'id', 'paymentId'), status: input.status as 'confirmed' | 'cancelled' | 'refund-pending' | 'refunded', expectedResourceVersion: canonicalDecimalString(input.expectedResourceVersion, 'expectedResourceVersion'), mutationId: requiredString(input, 'mutationId', 'mutationId') }; };
const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const publicFilter: Pick<Portfolio, 'visibility' | 'lifecycle'> = { visibility: 'public', lifecycle: 'published' };
type PublicOwner = Pick<PortfolioCategory, 'tenantId' | 'ownerUserId'>;
const developmentDemoOwner: PublicOwner = { tenantId: 'development-demo', ownerUserId: 'development-demo' };

const requireActor = (ctx: Context) => resolveActor(ctx);
const creatorManaged = <T extends { tenantId: string; ownerUserId: string }>(actor: Actor | undefined, record: T | undefined) =>
  Boolean(actor && record && actorCanManageCreatorSpace(actor, record));
const creatorOwner = (actor: Actor): string | undefined => creatorSpaceOwnerId(actor);
const publicOwner = (ctx: Context): PublicOwner => {
  const actor = resolveActor(ctx);
  return actor ? { tenantId: actor.tenantId, ownerUserId: actor.userId } : developmentDemoOwner;
};
const categoryOwnedBy = (category: PortfolioCategory | undefined, actor: Actor): category is PortfolioCategory =>
  Boolean(category && actorCanManageCreatorSpace(actor, category));
const categoryOwnedByFor = (actor: Actor) => (category: PortfolioCategory | undefined): category is PortfolioCategory =>
  categoryOwnedBy(category, actor);
const hasDuplicateValues = (values: string[]) => new Set(values).size !== values.length;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const syncVisibility = (value: unknown): Visibility | undefined =>
  value === 'public' || value === 'private' || value === 'unlisted' ? value : undefined;
const portfolioCategoryPayload = (value: Record<string, unknown>): PortfolioCategorySyncPayload => {
  const payload: PortfolioCategorySyncPayload = {};
  if (value.slug !== undefined) {
    if (typeof value.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug)) throw new TrailsSyncInputError('payload.slug必须是小写连字符 slug');
    payload.slug = value.slug;
  }
  if (value.nameZh !== undefined) {
    if (typeof value.nameZh !== 'string' || !value.nameZh.trim()) throw new TrailsSyncInputError('payload.nameZh必须是非空字符串');
    payload.nameZh = value.nameZh.trim();
  }
  if (value.description !== undefined) {
    if (typeof value.description !== 'string') throw new TrailsSyncInputError('payload.description必须是字符串');
    payload.description = value.description;
  }
  if (value.sortOrder !== undefined) {
    if (typeof value.sortOrder !== 'number' || !Number.isInteger(value.sortOrder) || value.sortOrder < 0) throw new TrailsSyncInputError('payload.sortOrder必须是非负整数');
    payload.sortOrder = value.sortOrder;
  }
  if (value.visibility !== undefined) {
    const parsed = syncVisibility(value.visibility);
    if (!parsed) throw new TrailsSyncInputError('payload.visibility无效');
    payload.visibility = parsed;
  }
  return payload;
};
const syncMutation = (input: Input): SyncMutation => {
  const payload = input.payload;
  const resourceType = input.resourceType;
  if (resourceType !== 'portfolio-category') throw new Error('当前开发期同步写入仅支持portfolio-category；其他资源仍可通过拉取协议读取');
  if (!isRecord(payload)) throw new Error('payload必须是对象');
  const baseVersion = input.baseVersion;
  if (baseVersion !== null && (!Number.isInteger(baseVersion) || (baseVersion as number) < 1)) throw new Error('baseVersion必须是正整数或null');
  return { mutationId: requiredString(input, 'mutationId', '同步变更编号'), deviceId: requiredString(input, 'deviceId', '设备编号'), resourceType, resourceId: requiredString(input, 'resourceId', '资源编号'), operation: 'upsert', baseVersion: baseVersion as number | null, payload: portfolioCategoryPayload(payload) };
};
const canonicalDecimalString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw new TrailsSyncInputError(`${label}必须是规范十进制非负整数字符串`);
  return value;
};
const trustedPhotoshopUploadRequest = (input: Input): void => {
  if (Object.keys(input).length !== 0) throw new TrailsSyncInputError('Photoshop上传会话请求包含不允许字段');
};
const trustedPhotoshopUploadCompletion = (input: Input): string => {
  if (Object.keys(input).length !== 1 || typeof input.uploadSession !== 'string' || input.uploadSession.length < 64 || input.uploadSession.length > 2048) throw new TrailsSyncInputError('Photoshop上传完成请求无效');
  return input.uploadSession;
};
const durableCategoryMutation = (input: Input): DurablePortfolioCategoryMutation => {
  if (!isRecord(input.payload)) throw new TrailsSyncInputError('payload必须是对象');
  const baseVersion = input.baseVersion;
  if (baseVersion !== null && (baseVersion === undefined || typeof baseVersion !== 'string')) throw new TrailsSyncInputError('baseVersion必须是null或规范十进制非负整数字符串');
  return {
    mutationId: requiredString(input, 'mutationId', '同步变更编号'),
    resourceId: requiredString(input, 'resourceId', '资源编号'),
    baseVersion: baseVersion === null ? null : canonicalDecimalString(baseVersion, 'baseVersion'),
    payload: portfolioCategoryPayload(input.payload),
  };
};
const durableCursor = (input: Input): string | undefined => {
  if (input.cursor === undefined) return undefined;
  return canonicalDecimalString(input.cursor, 'cursor');
};
const durableCategoryWrite = (input: Input, resourceId: string, baseVersion: string | null): DurablePortfolioCategoryMutation => {
  return { mutationId: id('v2-category-mutation'), resourceId, baseVersion, payload: portfolioCategoryPayload(input) };
};
const durableCategoryVersion = (input: Input): string => canonicalDecimalString(input.resourceVersion, 'resourceVersion');
const durableReorderMutations = (input: Input): DurablePortfolioCategoryMutation[] => {
  if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 100) throw new TrailsSyncInputError('items必须是1至100项数组');
  const batchMutationId = requiredString(input, 'mutationId', '重排序变更编号');
  if (batchMutationId.length > 157) throw new TrailsSyncInputError('重排序变更编号不能超过157字符');
  const ids = new Set<string>();
  return input.items.map((item, index) => {
    if (!isRecord(item)) throw new TrailsSyncInputError(`items[${index}]必须是对象`);
    const resourceId = requiredString(item, 'id', `items[${index}].id`);
    if (ids.has(resourceId)) throw new TrailsSyncInputError('items不能包含重复分类');
    ids.add(resourceId);
    return { mutationId: `${batchMutationId}:${index}`, resourceId, baseVersion: canonicalDecimalString(item.resourceVersion, `items[${index}].resourceVersion`), payload: { sortOrder: index } };
  });
};
const durableCategoryFailure = (error: unknown): HttpResponseItem => {
  if (error instanceof TrailsSyncInputError) return failure(error.message, HttpStatusCode.BAD_REQUEST);
  if (error instanceof TrailsSyncDuplicateSlugError) return failure('分类slug已存在', HttpStatusCode.CONFLICT);
  return failure('耐久分类当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
};
const durablePortfolioFailure = (error: unknown): HttpResponseItem =>
  error instanceof TrailsDurablePortfolioStaleVersionError
    ? failure('作品集已被更新；请基于current重试', HttpStatusCode.CONFLICT)
    : error instanceof TrailsSyncInputError
    ? failure(error.message, HttpStatusCode.BAD_REQUEST)
    : failure('耐久作品集当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
const durableExhibitionThemeFailure = (error: unknown): HttpResponseItem =>
  error instanceof TrailsDurableExhibitionThemeStaleVersionError
    ? failure('展览主题已被更新；请重新载入后再提交', HttpStatusCode.CONFLICT)
    : error instanceof TrailsSyncInputError
    ? failure(error.message, HttpStatusCode.BAD_REQUEST)
    : failure('耐久展览主题当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
const durableJournalFailure = (error: unknown): HttpResponseItem =>
  error instanceof TrailsDurableJournalStaleVersionError
    ? failure('日记已被更新；请基于current重试', HttpStatusCode.CONFLICT)
    : error instanceof TrailsSyncInputError
    ? failure(error.message, HttpStatusCode.BAD_REQUEST)
    : failure('耐久日记当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
const durableRichDocumentFailure = (error: unknown): HttpResponseItem =>
  error instanceof TrailsSyncInputError ? failure(error.message, HttpStatusCode.BAD_REQUEST) : failure('耐久富文档当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
const durableHikeFailure = (error: unknown): HttpResponseItem =>
  error instanceof TrailsSyncInputError
    ? failure(error.message, HttpStatusCode.BAD_REQUEST)
    : failure('耐久徒步记录当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
const durableGearFailure = (error: unknown): HttpResponseItem =>
  error instanceof TrailsDurableGearStaleVersionError
    ? failure('装备已被更新；请基于current重试', HttpStatusCode.CONFLICT)
    : error instanceof TrailsSyncInputError
    ? failure(error.message, HttpStatusCode.BAD_REQUEST)
    : failure('耐久装备当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
const durablePackingPlanFailure = (error: unknown): HttpResponseItem =>
  error instanceof TrailsDurablePackingPlanStaleVersionError
    ? failure('装包方案已被更新；请基于current重试', HttpStatusCode.CONFLICT)
    : error instanceof TrailsSyncInputError
    ? failure(error.message, HttpStatusCode.BAD_REQUEST)
    : failure('耐久装包方案当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
const durableFinanceFailure = (error: unknown): HttpResponseItem =>
  error instanceof TrailsDurableFinanceStaleVersionError
    ? failure('账目已被更新；请基于current重试', HttpStatusCode.CONFLICT)
    : error instanceof TrailsSyncInputError
    ? failure(error.message, HttpStatusCode.BAD_REQUEST)
    : failure('耐久财务账本当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
const durableCommerceFailure = (error: unknown): HttpResponseItem =>
  error instanceof TrailsDurableMediaCommerceStaleVersionError ? failure('耐久商业资源已被更新；请基于current重试', HttpStatusCode.CONFLICT)
    : error instanceof TrailsSyncInputError ? failure(error.message, HttpStatusCode.BAD_REQUEST)
       : failure('耐久媒体商业当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
const durableMediaRegistryFailure = (error: unknown): HttpResponseItem =>
  error instanceof TrailsMediaAssetRegistryStaleVersionError ? failure('媒体资产已被更新；请基于current重试', HttpStatusCode.CONFLICT)
    : error instanceof TrailsSyncInputError ? failure(error.message, HttpStatusCode.BAD_REQUEST)
      : failure('耐久媒体资产注册表当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
const durablePublishingFailure = (error: unknown): HttpResponseItem =>
  error instanceof TrailsDurablePublishingPackageStaleVersionError ? failure('发布包已被更新；请基于current重试', HttpStatusCode.CONFLICT)
    : error instanceof TrailsSyncInputError ? failure(error.message, HttpStatusCode.BAD_REQUEST)
       : failure('耐久发布包当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
const durablePublicSiteContentFailure = (error: unknown): HttpResponseItem => error instanceof TrailsPublicSiteContentStaleVersionError ? failure('公开内容已被更新；请基于current重试', HttpStatusCode.CONFLICT) : error instanceof TrailsSyncInputError ? failure(error.message, HttpStatusCode.BAD_REQUEST) : failure('耐久公开内容当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
const durableGuestCommentFailure = (error: unknown): HttpResponseItem => error instanceof TrailsGuestCommentStaleVersionError ? failure('留言状态已变更；请刷新后重试', HttpStatusCode.CONFLICT) : error instanceof TrailsSyncInputError ? failure(error.message, HttpStatusCode.BAD_REQUEST) : failure('耐久留言当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
const durableGuidedTripFailure = (error: unknown): HttpResponseItem => error instanceof TrailsDurableGuidedTripStaleVersionError ? failure('行摄计划已被更新；请基于current重试', HttpStatusCode.CONFLICT, { current: workspaceGuidedTripProjection(error.current) }) : error instanceof TrailsSyncInputError ? failure(error.message, HttpStatusCode.BAD_REQUEST) : failure('耐久行摄计划当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
const durableExternalVideoReferenceFailure = (error: unknown): HttpResponseItem => error instanceof TrailsDurableExternalVideoReferenceStaleVersionError ? failure('外部视频引用已被更新；请基于current重试', HttpStatusCode.CONFLICT, { current: workspaceExternalVideoReferenceProjection(error.current) }) : error instanceof TrailsSyncInputError ? failure(error.message, HttpStatusCode.BAD_REQUEST) : failure('耐久外部视频引用当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
const durableLocationCardFailure = (error: unknown): HttpResponseItem => error instanceof TrailsDurableLocationCardStaleVersionError ? failure('地点卡片已被更新；请基于current重试', HttpStatusCode.CONFLICT, { current: workspaceLocationCardProjection(error.current) }) : error instanceof TrailsSyncInputError ? failure(error.message, HttpStatusCode.BAD_REQUEST) : failure('耐久地点卡片当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
const shootingLocationFailure = (error: unknown): HttpResponseItem => error instanceof TrailsShootingLocationStaleVersionError ? failure('拍摄地点已被更新；请基于current重试', HttpStatusCode.CONFLICT, { current: workspaceShootingLocationProjection(error.current) }) : error instanceof TrailsSyncInputError ? failure(error.message, HttpStatusCode.BAD_REQUEST) : failure('耐久拍摄地点当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
const safePublicText = (value: unknown, label: string, maximum: number): string => { if (typeof value !== 'string') throw new TrailsSyncInputError(`${label}无效`); const normalized = value.trim(); if (!normalized || normalized.length > maximum || /[<>]|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized)) throw new TrailsSyncInputError(`${label}无效`); return normalized; };
const publicIcpFilingNumber = (value: unknown, label: string): string => { if (typeof value !== 'string') throw new TrailsSyncInputError(`${label}无效`); const normalized = value.trim(); if (normalized.length > 32 || /[<>]|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]|\s/.test(normalized) || !/^[\u4E00-\u9FFF]{1,3}ICP备\d{4,12}号(?:-\d{1,3})?$/.test(normalized)) throw new TrailsSyncInputError(`${label}无效`); return normalized; };
const isIpv4Host = (host: string) => /^(?:25[0-5]|2[0-4][0-9]|1?[0-9]{1,2})(?:\.(?:25[0-5]|2[0-4][0-9]|1?[0-9]{1,2})){3}$/.test(host);
const isDnsHost = (host: string) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(host) && host.toLowerCase() !== 'localhost' && !isIpv4Host(host);
type SiteContactKind = EffectivePublicSiteContent['contactLinks'][number]['kind'];
const publicEmailContact = (value: string): string | undefined => { const address = value.startsWith('mailto:') ? value.slice(7) : ''; return address.length <= 254 && /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i.test(address) ? `mailto:${address}` : undefined; };
const publicWechatContact = (value: string): string | undefined => /^wechat:[A-Za-z][A-Za-z0-9_-]{5,19}$/.test(value) ? value : undefined;
const publicHttpsContact = (value: string, kind: Exclude<SiteContactKind, 'email' | 'wechat'>): string | undefined => {
  try {
    const url = new URL(value); const host = url.hostname.toLowerCase(); const authority = value.slice('https://'.length).split(/[/?#]/, 1)[0];
    if (url.protocol !== 'https:' || !isDnsHost(host) || authority.includes(':') || url.username || url.password || url.port || url.search || url.hash) return undefined;
    if (kind === 'website' && url.pathname !== '/') return undefined;
    if (kind === 'instagram' && !((host === 'instagram.com' || host === 'www.instagram.com') && /^\/[A-Za-z0-9._]{1,30}\/?$/.test(url.pathname))) return undefined;
    if (kind === 'linkedin' && !((host === 'linkedin.com' || host === 'www.linkedin.com') && /^\/(?:in|company)\/[A-Za-z0-9_-]{2,100}\/?$/.test(url.pathname))) return undefined;
    if (kind === 'bilibili' && !(host === 'space.bilibili.com' && /^\/[1-9][0-9]{0,19}\/?$/.test(url.pathname))) return undefined;
    if (kind === 'xiaohongshu' && !((host === 'xiaohongshu.com' || host === 'www.xiaohongshu.com') && /^\/user\/profile\/[A-Za-z0-9_-]{6,64}\/?$/.test(url.pathname))) return undefined;
    return url.toString();
  } catch { return undefined; }
};
const publicContactHref = (value: string, kind: SiteContactKind): string | undefined => kind === 'email' ? publicEmailContact(value) : kind === 'wechat' ? publicWechatContact(value) : publicHttpsContact(value, kind);
const ownExactObject = (value: unknown, allowed: readonly string[], label: string): Record<string, unknown> => {
  if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TrailsSyncInputError(`${label}必须是普通对象`);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== allowed.length || !keys.every(key => typeof key === 'string' && allowed.includes(key))) throw new TrailsSyncInputError(`${label}包含不允许字段`);
  for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new TrailsSyncInputError(`${label}字段无效`); }
  return value;
};
const siteContentDocument = (value: unknown, includeResourceVersion: boolean): Record<string, unknown> => {
  if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TrailsSyncInputError('公开站点内容请求必须是普通对象');
  const required = ['displayName', 'biography', 'contactLinks', 'licensingCopy', 'seo', 'chrome', ...(includeResourceVersion ? ['resourceVersion'] : [])];
  const allowed = [...required, 'aboutProfile', 'aboutPortraitMediaId'];
  const keys = Reflect.ownKeys(value);
  if (!required.every(key => key in value) || !keys.every(key => typeof key === 'string' && allowed.includes(key)) || keys.length !== required.length + Number(value.aboutProfile !== undefined) + Number(value.aboutPortraitMediaId !== undefined)) throw new TrailsSyncInputError('公开站点内容请求包含不允许字段');
  for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new TrailsSyncInputError('公开站点内容请求字段无效'); }
  return value;
};
const optionalSiteOpaqueId = (document: Record<string, unknown>, key: string): string | undefined => document[key] === undefined ? undefined : (() => { const value = document[key]; if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw new TrailsSyncInputError(`${key}无效`); return value; })();
const cloneDefaultPublicSiteChrome = () => ({ navigation: DEFAULT_PUBLIC_SITE_CHROME.navigation.map(link => ({ ...link })), footer: { links: DEFAULT_PUBLIC_SITE_CHROME.footer.links.map(link => ({ ...link })), copyright: DEFAULT_PUBLIC_SITE_CHROME.footer.copyright } });
const publicChromeTarget = (value: unknown, label: string): PublicChromeTarget => {
  if (value === 'home' || value === 'editions' || value === 'stories' || value === 'trips' || value === 'locations' || value === 'about' || value === 'guestbook') return value;
  throw new TrailsSyncInputError(`${label}无效`);
};
const publicChromeLinks = (value: unknown, label: string, minimum: number, maximum: number) => {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) throw new TrailsSyncInputError(`${label}必须是${minimum}至${maximum}项数组`);
  const links = value.map((entry, index) => { const link = ownExactObject(entry, ['label', 'target'], `${label}[${index}]`); return { label: safePublicText(link.label, `${label}[${index}].label`, 80), target: publicChromeTarget(link.target, `${label}[${index}].target`) }; });
  if (new Set(links.map(link => link.target)).size !== links.length) throw new TrailsSyncInputError(`${label}不能包含重复目标`);
  return links;
};
const aboutProfileForbiddenFields = ['href', 'url', 'email', 'phone', 'location', 'region', 'address', 'coordinates', 'route', 'directions', 'access', 'meeting', 'media', 'reference', 'identity', 'privateLocation'];
const safeAboutProfileText = (value: unknown, label: string, maximum: number): string => {
  const normalized = safePublicText(value, label, maximum);
  if (/(?:\w+:\/\/|\bwww\.)/i.test(normalized) || /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(normalized) || /(?:\+?\d[\d .()\-]{6,}\d)/.test(normalized) || /[-+]?\d{1,2}\.\d{3,}\s*,\s*[-+]?\d{1,3}\.\d{3,}/.test(normalized)) throw new TrailsSyncInputError(`${label}无效`);
  return normalized;
};
const publicAboutProfile = (value: unknown) => {
  const profile = ownExactObject(value, ['professionalIdentity', 'practiceStatement', 'collaborationDirections', 'selectedCredentials', 'selectedProjects'], 'aboutProfile');
  const identity = ownExactObject(profile.professionalIdentity, ['headline', 'disciplines'], 'aboutProfile.professionalIdentity');
  const arrays = (raw: unknown, label: string, maximumItems: number, maximumText: number) => {
    if (!Array.isArray(raw) || raw.length > maximumItems) throw new TrailsSyncInputError(`${label}无效`);
    return raw.map((item, index) => safeAboutProfileText(item, `${label}[${index}]`, maximumText));
  };
  if (aboutProfileForbiddenFields.some(key => key in profile || key in identity)) throw new TrailsSyncInputError('aboutProfile包含不允许字段');
  const selectedProjects = profile.selectedProjects;
  if (!Array.isArray(selectedProjects) || selectedProjects.length > 6) throw new TrailsSyncInputError('aboutProfile.selectedProjects无效');
  return {
    professionalIdentity: { headline: safeAboutProfileText(identity.headline, 'aboutProfile.professionalIdentity.headline', 120), disciplines: arrays(identity.disciplines, 'aboutProfile.professionalIdentity.disciplines', 8, 60) },
    practiceStatement: safeAboutProfileText(profile.practiceStatement, 'aboutProfile.practiceStatement', 2000),
    collaborationDirections: arrays(profile.collaborationDirections, 'aboutProfile.collaborationDirections', 6, 240),
    selectedCredentials: arrays(profile.selectedCredentials, 'aboutProfile.selectedCredentials', 8, 240),
    selectedProjects: selectedProjects.map((entry, index) => { const project = ownExactObject(entry, ['title', 'summary'], `aboutProfile.selectedProjects[${index}]`); if (aboutProfileForbiddenFields.some(key => key in project)) throw new TrailsSyncInputError('aboutProfile.selectedProjects包含不允许字段'); return { title: safeAboutProfileText(project.title, `aboutProfile.selectedProjects[${index}].title`, 120), summary: safeAboutProfileText(project.summary, `aboutProfile.selectedProjects[${index}].summary`, 600) }; }),
  };
};
const publicSiteContent = (input: unknown): EffectivePublicSiteContent => {
  const document = siteContentDocument(input, true);
  const biography = ownExactObject(document.biography, ['plainText'], 'biography');
  const seo = ownExactObject(document.seo, ['title', 'description'], 'seo');
  const chrome = ownExactObject(document.chrome, ['navigation', 'footer'], 'chrome');
  const footer = chrome.footer;
  if (!isRecord(footer) || Object.getPrototypeOf(footer) !== Object.prototype) throw new TrailsSyncInputError('chrome.footer必须是普通对象');
  const footerKeys = Reflect.ownKeys(footer);
  if (!['links', 'copyright'].every(key => key in footer) || !footerKeys.every(key => typeof key === 'string' && ['links', 'copyright', 'icpFilingNumber'].includes(key)) || ![2, 3].includes(footerKeys.length)) throw new TrailsSyncInputError('chrome.footer包含不允许字段');
  for (const key of footerKeys) { const descriptor = Object.getOwnPropertyDescriptor(footer, key); if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new TrailsSyncInputError('chrome.footer字段无效'); }
  const links = document.contactLinks;
  if (!Array.isArray(links) || links.length > 10) throw new TrailsSyncInputError('contactLinks无效');
  const contactLinks: EffectivePublicSiteContent['contactLinks'] = links.map((entry, index) => {
    const link = ownExactObject(entry, ['kind', 'href'], `contactLinks[${index}]`);
    if ((link.kind !== 'website' && link.kind !== 'instagram' && link.kind !== 'linkedin' && link.kind !== 'bilibili' && link.kind !== 'xiaohongshu' && link.kind !== 'email' && link.kind !== 'wechat') || typeof link.href !== 'string') throw new TrailsSyncInputError('contactLinks无效');
    const href = publicContactHref(link.href, link.kind); if (!href) throw new TrailsSyncInputError('contactLinks无效'); return { kind: link.kind, href };
  });
  const aboutPortraitMediaId = optionalSiteOpaqueId(document, 'aboutPortraitMediaId');
  return { displayName: safePublicText(document.displayName, 'displayName', 120), biography: { plainText: safePublicText(biography.plainText, 'biography', 50000) }, contactLinks, licensingCopy: safePublicText(document.licensingCopy, 'licensingCopy', 10000), seo: { title: safePublicText(seo.title, 'seo.title', 160), description: safePublicText(seo.description, 'seo.description', 320) }, ...(document.aboutProfile === undefined ? {} : { aboutProfile: publicAboutProfile(document.aboutProfile) }), ...(aboutPortraitMediaId === undefined ? {} : { aboutPortraitMediaId }), chrome: { navigation: publicChromeLinks(chrome.navigation, 'chrome.navigation', 1, 7), footer: { links: publicChromeLinks(footer.links, 'chrome.footer.links', 0, 7), copyright: safePublicText(footer.copyright, 'chrome.footer.copyright', 160), ...(footer.icpFilingNumber === undefined ? {} : { icpFilingNumber: publicIcpFilingNumber(footer.icpFilingNumber, 'chrome.footer.icpFilingNumber') }) } } };
};
const originalSiteContentDraft = (ctx: Context) => {
  const raw: unknown = ctx.params;
  const document = siteContentDocument(raw, true);
  return { content: publicSiteContent(document), resourceVersion: document.resourceVersion === null ? null : canonicalDecimalString(document.resourceVersion, 'resourceVersion') };
};
/** Persisted chrome targets stay valid while these public tabs are temporarily absent from all visible chrome. */
const temporarilyHiddenPublicChromeTargets = new Set<PublicChromeTarget>(['editions', 'locations']);
const visiblePublicChromeLinks = (links: import('../types').PublicChromeLink[]) => links.filter(link => !temporarilyHiddenPublicChromeTargets.has(link.target));
const publicSiteProjection = (value: EffectivePublicSiteContent) => ({ displayName: value.displayName, biography: value.biography.plainText, contactLinks: value.contactLinks, licensingCopy: value.licensingCopy, seo: value.seo, ...(value.aboutProfile ? { aboutProfile: value.aboutProfile } : {}), ...(value.aboutPortraitMediaId ? { aboutPortraitMediaId: value.aboutPortraitMediaId } : {}), chrome: { navigation: visiblePublicChromeLinks(value.chrome.navigation), footer: { ...value.chrome.footer, links: visiblePublicChromeLinks(value.chrome.footer.links) } } });
const workspaceSiteProjection = (value: import('../types').DurablePublicSiteContent | undefined) => value ? ({ displayName: value.displayName, biography: value.biography, contactLinks: value.contactLinks, licensingCopy: value.licensingCopy, seo: value.seo, ...(value.aboutProfile ? { aboutProfile: value.aboutProfile } : {}), ...(value.aboutPortraitMediaId ? { aboutPortraitMediaId: value.aboutPortraitMediaId } : {}), chrome: value.chrome, status: value.status, resourceVersion: value.resourceVersion }) : null;
const workspaceGuidedTripProjection = (value: import('../types').DurableGuidedTrip) => ({ id: value.id, title: value.title, summary: value.summary, locationLabel: value.locationLabel, startsOn: value.startsOn, endsOn: value.endsOn, itinerary: value.itinerary, checklist: value.checklist, materialReferences: value.materialReferences, ...(value.publicContingencyMessage ? { publicContingencyMessage: value.publicContingencyMessage } : {}), status: value.status, resourceVersion: value.resourceVersion });
const publicGuidedTripProjection = (value: import('../types').DurableGuidedTrip) => ({ id: value.id, title: value.title, summary: value.summary, locationLabel: value.locationLabel, startsOn: value.startsOn, endsOn: value.endsOn, itinerary: value.itinerary, checklist: value.checklist, materialReferences: value.materialReferences, ...(value.publicContingencyMessage ? { publicContingencyMessage: value.publicContingencyMessage } : {}) });
const workspaceExternalVideoReferenceProjection = (value: import('../types').DurableExternalVideoReference) => ({ id: value.id, portfolioId: value.portfolioId, title: value.title, summary: value.summary, canonicalUrl: value.canonicalUrl, sortOrder: value.sortOrder, status: value.status, resourceVersion: value.resourceVersion });
const publicExternalVideoReferenceProjection = (value: import('../types').DurableExternalVideoReference) => ({ id: value.id, portfolioId: value.portfolioId, title: value.title, summary: value.summary, canonicalUrl: value.canonicalUrl, sortOrder: value.sortOrder });
const workspaceLocationCardProjection = (value: import('../types').DurableLocationCard) => ({ id: value.id, name: value.name, regionLabel: value.regionLabel, ...(value.summary ? { summary: value.summary } : {}), status: value.status, resourceVersion: value.resourceVersion });
const publicLocationCardProjection = (value: import('../types').DurableLocationCard) => ({ id: value.id, name: value.name, regionLabel: value.regionLabel, ...(value.summary ? { summary: value.summary } : {}) });
const workspaceShootingLocationProjection = (value: import('../types').ShootingLocation) => ({ id: value.id, name: value.name, latitude: value.latitude, longitude: value.longitude, ...(value.notes ? { notes: value.notes } : {}), status: value.status, resourceVersion: value.resourceVersion, createdAt: value.createdAt, updatedAt: value.updatedAt, ...(value.archivedAt ? { archivedAt: value.archivedAt } : {}) });
const shootingLocationWrite = (ctx: Context, update: boolean) => {
  const raw: unknown = ctx.params;
  const allowed = ['id', 'name', 'latitude', 'longitude', 'notes', 'mutationId', 'expectedResourceVersion'];
  if (!isRecord(raw) || Object.getPrototypeOf(raw) !== Object.prototype || !Reflect.ownKeys(raw).every(key => typeof key === 'string' && allowed.includes(key))) throw new TrailsSyncInputError('拍摄地点请求包含不允许字段');
  const value = raw as Input;
  if (update && value.expectedResourceVersion === null) throw new TrailsSyncInputError('更新拍摄地点必须使用当前资源版本');
  return { id: requiredString(value, 'id', '拍摄地点编号'), name: value.name, latitude: value.latitude, longitude: value.longitude, ...(value.notes === undefined ? {} : { notes: value.notes }), mutationId: requiredString(value, 'mutationId', '变更编号'), expectedResourceVersion: value.expectedResourceVersion === null ? null : canonicalDecimalString(value.expectedResourceVersion, 'expectedResourceVersion') };
};
const shootingLocationTransition = (ctx: Context) => {
  const raw: unknown = ctx.params;
  if (!isRecord(raw) || Object.getPrototypeOf(raw) !== Object.prototype || !Reflect.ownKeys(raw).every(key => typeof key === 'string' && ['id', 'mutationId', 'expectedResourceVersion'].includes(key))) throw new TrailsSyncInputError('拍摄地点请求包含不允许字段');
  const value = raw as Input;
  return { id: requiredString(value, 'id', '拍摄地点编号'), mutationId: requiredString(value, 'mutationId', '变更编号'), expectedResourceVersion: canonicalDecimalString(value.expectedResourceVersion, 'expectedResourceVersion') };
};
const locationCardWriteInput = (input: Input, update: boolean) => {
  const allowed = new Set(['id', 'name', 'regionLabel', 'summary', 'mutationId', 'expectedResourceVersion']);
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.has(key)) throw new TrailsSyncInputError(`地点卡片不允许字段:${key}`);
    if (value !== null && typeof value === 'object') throw new TrailsSyncInputError(`地点卡片字段必须是纯文本:${key}`);
  }
  if (input.expectedResourceVersion === null && update) throw new TrailsSyncInputError('更新地点卡片必须使用当前资源版本');
  return { id: requiredString(input, 'id', '地点卡片编号'), name: input.name as string, regionLabel: input.regionLabel as string, ...(input.summary === undefined ? {} : { summary: input.summary as string }), mutationId: requiredString(input, 'mutationId', '变更编号'), expectedResourceVersion: input.expectedResourceVersion === null ? null : canonicalDecimalString(input.expectedResourceVersion, 'expectedResourceVersion') };
};
const originalLocationCardWriteInput = (ctx: Context, update: boolean) => {
  const value: unknown = ctx.params;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TrailsSyncInputError('地点卡片请求必须是对象');
  const allowed = new Set(['id', 'name', 'regionLabel', 'summary', 'mutationId', 'expectedResourceVersion']);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.has(key)) throw new TrailsSyncInputError('地点卡片请求包含不允许字段');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new TrailsSyncInputError(`地点卡片请求字段无效:${key}`);
    if (descriptor.value !== null && typeof descriptor.value === 'object') throw new TrailsSyncInputError(`地点卡片字段必须是纯文本:${key}`);
  }
  return locationCardWriteInput(params(ctx), update);
};
const durablePublicComment = (value: DurableGuestComment) => ({ id: value.id, subjectType: value.subjectType, ...(value.subjectId ? { subjectId: value.subjectId } : {}), displayName: value.displayName, avatarId: value.avatarId, body: value.body, createdAt: value.createdAt });
const durableModerationComment = (value: DurableGuestComment) => ({ ...durablePublicComment(value), resourceVersion: value.resourceVersion });
const publicCommentInput = (input: Input) => {
  try { return { displayName: guestDisplayName(input), avatarId: guestAvatarId(input), body: guestCommentBody(input), email: normalizedEmail(input) }; }
  catch (error: unknown) { throw new TrailsSyncInputError(error instanceof Error ? error.message : '留言输入无效'); }
};
const durableCommentSubject = (input: Input) => {
  try { return guestCommentSubject(input); }
  catch (error: unknown) { throw new TrailsSyncInputError(error instanceof Error ? error.message : '留言主题无效'); }
};
const commerceMutation = (input: Input) => ({ mutationId: requiredString(input, 'mutationId', '变更编号'), expectedResourceVersion: input.expectedResourceVersion === null ? null : canonicalDecimalString(input.expectedResourceVersion, 'expectedResourceVersion') });
const commerceId = (input: Input, label: string) => requiredString(input, 'id', label);
const commerceCreatedId = (prefix: string, mutationId: string) => `${prefix}_${createHash('sha256').update(mutationId).digest('hex')}`;
const catalogMediaProjection = (value: import('../types').DurableMedia) => ({ id: value.id, title: value.title, summary: value.summary, status: value.status, derivatives: value.publicDerivativeReferences.map(derivative => ({ reference: derivative.reference, ...(derivative.width === undefined ? {} : { width: derivative.width }), ...(derivative.height === undefined ? {} : { height: derivative.height }) })), resourceVersion: value.resourceVersion });
const catalogEditionProjection = (value: import('../types').PrintEdition) => ({ id: value.id, mediaId: value.mediaId, title: value.title, description: value.description, status: value.status, resourceVersion: value.resourceVersion });
const workspaceCatalogProjection = (value: Awaited<ReturnType<import('../types').DurableMediaCommerceStore['listOwner']>>) => ({ media: value.media.map(catalogMediaProjection), editions: value.editions.map(catalogEditionProjection) });
const catalogInput = (ctx: Context, allowed: readonly string[]): Input => { const raw: unknown = ctx.params; if (!isRecord(raw) || !Reflect.ownKeys(raw).every(key => typeof key === 'string' && allowed.includes(key))) throw new TrailsSyncInputError('目录请求包含不允许字段'); return params(ctx); };
const salesConfigurationProjection = (value: import('../types').SalesConfiguration) => ({ salesMode: value.salesMode, currency: value.currency, reservationHours: value.reservationHours, resourceVersion: value.resourceVersion });
const salesProductProjection = (value: import('../types').SalesProduct) => ({ id: value.id, ...(value.mediaId ? { mediaId: value.mediaId } : {}), productType: value.productType, title: value.title, description: value.description, productionLeadDays: value.productionLeadDays, ...(value.editionSize ? { editionSize: value.editionSize } : {}), certificateIncluded: value.certificateIncluded, status: value.status, skus: value.skus.map(sku => ({ id: sku.id, label: sku.label, priceMinor: sku.priceMinor, inventoryMode: sku.inventoryMode, ...(sku.stockQuantity === undefined ? {} : { stockQuantity: sku.stockQuantity }) })), resourceVersion: value.resourceVersion });
const manualSalesOrderProjection = (value: import('../types').ManualSalesOrder) => ({ id: value.id, productId: value.productId, skuId: value.skuId, quantity: value.quantity, title: value.titleSnapshot, skuLabel: value.skuLabelSnapshot, currency: value.currencySnapshot, unitPriceMinor: value.unitPriceMinorSnapshot, totalPriceMinor: value.totalPriceMinorSnapshot, reservationExpiresAt: value.reservationExpiresAt, status: value.status, ...(value.shippedAt ? { shippedAt: value.shippedAt } : {}), ...(value.trackingReference ? { trackingReference: value.trackingReference } : {}), resourceVersion: value.resourceVersion, createdAt: value.createdAt, updatedAt: value.updatedAt });
const salesWorkspaceProjection = (value: Awaited<ReturnType<import('../types').DurableMediaCommerceStore['readSalesWorkspace']>>) => ({ configuration: salesConfigurationProjection(value.configuration), products: value.products.map(salesProductProjection), orders: value.orders.map(manualSalesOrderProjection) });
const salesInput = (ctx: Context, allowed: readonly string[]): Input => { const raw: unknown = ctx.params; if (!isRecord(raw) || !Reflect.ownKeys(raw).every(key => typeof key === 'string' && allowed.includes(key))) throw new TrailsSyncInputError('销售请求包含不允许字段'); return params(ctx); };
const privateMasterLocatorForArtifact = (artifactId: unknown): string => {
  if (typeof artifactId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(artifactId)) throw new TrailsSyncInputError('privateMasterArtifact无效');
  const configured = process.env.TRAILS_MEDIA_PRIVATE_MASTER_LOCATORS;
  if (!configured) throw new TrailsSyncInputError('私有主文件部署工件未配置');
  let locators: unknown;
  try { locators = JSON.parse(configured); } catch { throw new TrailsSyncInputError('私有主文件部署工件配置无效'); }
  if (!isRecord(locators) || typeof locators[artifactId] !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(locators[artifactId])) throw new TrailsSyncInputError('私有主文件部署工件不可用');
  return locators[artifactId];
};
const commercePublic = (value: { media: Array<{ id: string; title: string; summary: string; publicDerivativeReferences: unknown }>; editions: Array<{ id: string; mediaId: string; title: string; description: string }> }) => ({ media: value.media.map(item => ({ id: item.id, title: item.title, summary: item.summary, derivatives: item.publicDerivativeReferences })), editions: value.editions.map(item => ({ id: item.id, mediaId: item.mediaId, title: item.title, description: item.description })) });
const commerceBuyer = (value: Awaited<ReturnType<NonNullable<TrailsState['durableMediaCommerceStore']>['listBuyer']>>) => ({ inquiries: value.inquiries.map(x => ({ id: x.id, mediaId: x.mediaId, message: x.message, status: x.status, resourceVersion: x.resourceVersion, createdAt: x.createdAt })), requests: value.requests.map(x => ({ id: x.id, mediaId: x.mediaId, status: x.status, entitlementId: x.entitlementId, resourceVersion: x.resourceVersion, createdAt: x.createdAt })), entitlements: value.entitlements.map(x => ({ id: x.id, mediaId: x.mediaId, requestId: x.requestId, status: x.status, resourceVersion: x.resourceVersion })), orders: value.orders.map(x => ({ id: x.id, editionId: x.editionId, title: x.titleSnapshot, currency: x.currencySnapshot, priceMinor: x.priceMinorSnapshot, status: x.status, refundedMinor: x.refundedMinor, resourceVersion: x.resourceVersion })) });
const durablePortfolioDraft = (input: Input, resourceId: string) => ({
  id: resourceId,
  title: requiredString(input, 'title', '作品集标题'),
  summary: requiredString(input, 'summary', '作品集简介'),
  categoryId: optionalOpaqueId(input, 'categoryId'),
  coverMediaId: optionalOpaqueId(input, 'coverMediaId'),
  mediaIds: opaqueIdArray(input, 'mediaIds'),
  locationLabel: optionalString(input, 'locationLabel'),
  photoTechnicalMetadata: photoTechnicalMetadata(input),
  exhibitionPresentation: exhibitionPresentation(input),
  visibility: visibility(input),
});
const durablePortfolioUpdate = (input: Input) => ({ ...durablePortfolioDraft(input, requiredString(input, 'id', '作品集编号')), resourceVersion: canonicalDecimalString(input.resourceVersion, 'resourceVersion') });
const durableExhibitionThemeMutation = (input: Input) => {
  const operation = input.operation;
  if (operation !== 'create' && operation !== 'update' && operation !== 'publish' && operation !== 'unpublish' && operation !== 'archive') throw new TrailsSyncInputError('展览主题操作无效');
  const allowed = operation === 'create' ? ['operation', 'draft'] : ['operation', 'id', 'resourceVersion', ...(operation === 'update' ? ['draft'] : [])];
  if (!Object.keys(input).every(key => allowed.includes(key))) throw new TrailsSyncInputError('展览主题请求包含不允许字段');
  const makeDraft = (value: Input, idValue: string) => {
    const fields = ['slug', 'title', 'introduction', 'closingNote', 'layoutId', 'portfolioIds', 'coverMediaId'];
    if (!Object.keys(value).every(key => fields.includes(key) || (operation === 'create' && key === 'id'))) throw new TrailsSyncInputError('展览主题草稿包含不允许字段');
    return { id: idValue, slug: requiredString(value, 'slug', 'slug'), title: requiredString(value, 'title', '展览主题标题'), introduction: requiredString(value, 'introduction', '展览主题序言'), ...(value.closingNote === undefined ? {} : { closingNote: optionalString(value, 'closingNote') }), layoutId: requiredString(value, 'layoutId', '布局编号') as import('../types').ExhibitionLayoutId, portfolioIds: opaqueIdArray(value, 'portfolioIds'), ...(value.coverMediaId === undefined ? {} : { coverMediaId: optionalOpaqueId(value, 'coverMediaId') }) };
  };
  if (operation === 'create') { if (!isRecord(input.draft)) throw new TrailsSyncInputError('展览主题草稿无效'); return { operation, draft: makeDraft(input.draft, requiredString(input.draft, 'id', '展览主题编号')) }; }
  const base = { operation, id: requiredString(input, 'id', '展览主题编号'), resourceVersion: canonicalDecimalString(input.resourceVersion, 'resourceVersion') };
  if (operation !== 'update') return base;
  if (!isRecord(input.draft)) throw new TrailsSyncInputError('展览主题草稿无效');
  return { ...base, draft: makeDraft(input.draft, base.id) };
};
const publicExhibitionTheme = (theme: import('../types').DurableExhibitionTheme) => ({ id: theme.id, slug: theme.slug, title: theme.title, introduction: theme.introduction, ...(theme.closingNote ? { closingNote: theme.closingNote } : {}), layoutId: theme.layoutId, portfolioIds: theme.portfolioIds, ...(theme.coverMediaId ? { coverMediaId: theme.coverMediaId } : {}), publishedAt: theme.publishedAt || theme.updatedAt });
/** The workspace is authenticated but still receives a deliberately narrow DTO. */
const workspaceExhibitionTheme = (theme: import('../types').DurableExhibitionTheme) => ({
  id: theme.id,
  slug: theme.slug,
  title: theme.title,
  introduction: theme.introduction,
  ...(theme.closingNote ? { closingNote: theme.closingNote } : {}),
  layoutId: theme.layoutId,
  portfolioIds: theme.portfolioIds,
  ...(theme.coverMediaId ? { coverMediaId: theme.coverMediaId } : {}),
  status: theme.status,
  resourceVersion: theme.resourceVersion,
  ...(theme.publishedAt ? { publishedAt: theme.publishedAt } : {}),
  createdAt: theme.createdAt,
  updatedAt: theme.updatedAt,
});
const publicDurablePortfolio = (portfolio: { id: string; title: string; summary: string; categoryId?: string; coverMediaId?: string; mediaIds: string[]; locationLabel?: string; photoTechnicalMetadata?: PhotoTechnicalMetadata; exhibitionPresentation?: import('../types').ExhibitionPresentation; createdAt: string; updatedAt: string }) => {
  const photoMetadata = publicPhotoTechnicalMetadata(portfolio.photoTechnicalMetadata);
  return {
    id: portfolio.id, title: portfolio.title, summary: portfolio.summary,
    ...(portfolio.categoryId ? { categoryId: portfolio.categoryId } : {}),
    ...(portfolio.coverMediaId ? { coverMediaId: portfolio.coverMediaId } : {}),
    mediaIds: portfolio.mediaIds,
    ...(portfolio.locationLabel ? { locationLabel: portfolio.locationLabel } : {}),
    ...(photoMetadata ? { photoTechnicalMetadata: photoMetadata } : {}),
    ...(portfolio.exhibitionPresentation ? { exhibitionPresentation: portfolio.exhibitionPresentation } : {}),
    publishedAt: portfolio.updatedAt,
  };
};
const durableJournalDraft = (input: Input, resourceId: string) => {
  const excerpt = requiredString(input, 'excerpt', '日记摘要');
  const rawBody = input.body;
  let body = '';
  if (rawBody !== undefined) {
    if (typeof rawBody !== 'string') throw new Error('日记正文必须是字符串');
    body = rawBody.trim();
  }
  return { id: resourceId, title: requiredString(input, 'title', '日记标题'), excerpt, body, coverMediaId: optionalOpaqueId(input, 'coverMediaId'), visibility: visibility(input) };
};
const durableJournalUpdate = (input: Input) => ({ ...durableJournalDraft(input, requiredString(input, 'id', '日记编号')), resourceVersion: canonicalDecimalString(input.resourceVersion, 'resourceVersion') });
const publicDurableJournal = (journal: { id: string; title: string; excerpt: string; isPinned: boolean; coverMediaId?: string; publishedAt?: string }) => ({ id: journal.id, title: journal.title, excerpt: journal.excerpt, isPinned: journal.isPinned, ...(journal.coverMediaId ? { coverMediaId: journal.coverMediaId } : {}), ...(journal.publishedAt ? { publishedAt: journal.publishedAt } : {}) });
const publicRichContent = (document: ReturnType<typeof validateRichDocument> | undefined) => document ? { richDocument: document, plainText: richDocumentTextProjection(document) } : {};
const publicJournalId = (input: Input): string | undefined => {
  const value = input.id;
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value) ? value : undefined;
};
const richDocumentSubject = (input: Input, subjectType: RichDocumentSubjectType) => ({ subjectType, subjectId: requiredString(input, 'id', subjectType === 'portfolio' ? '作品集编号' : '日记编号') });
const richDocumentSave = (input: Input, subjectType: RichDocumentSubjectType) => ({ ...richDocumentSubject(input, subjectType), baseRevision: canonicalDecimalString(input.baseRevision, 'baseRevision'), document: validateRichDocument(input.document) });
const richDocumentPreview = (input: Input, subjectType: RichDocumentSubjectType) => ({ ...richDocumentSubject(input, subjectType), document: validateRichDocument(input.document) });
const richDocumentMediaIds = (document: ReturnType<typeof validateRichDocument>): string[] => { const ids = new Set<string>(); const walk = (nodes: typeof document.content): void => nodes?.forEach(node => { if (node.type === 'photo' && typeof node.attrs?.mediaId === 'string') ids.add(node.attrs.mediaId); if (node.type === 'gallery' && Array.isArray(node.attrs?.mediaIds)) node.attrs.mediaIds.forEach(id => { if (typeof id === 'string') ids.add(id); }); walk(node.content); }); walk(document.content); return [...ids]; };
const authorizeRichDocumentMedia = async (actor: Actor, document: ReturnType<typeof validateRichDocument>, registry: TrailsState['durableMediaAssetRegistryStore']): Promise<void> => { const ids = richDocumentMediaIds(document); if (!ids.length) return; if (!registry) throw new TrailsSyncInputError('富文档媒体授权当前不可用'); const authorized = new Set((await registry.listWorkspacePicker(actor)).map(asset => asset.id)); if (ids.some(id => !authorized.has(id))) throw new TrailsSyncInputError('富文档媒体必须属于当前创作空间且已发布就绪'); };
const authorizeAboutPortraitMedia = async (actor: Actor, mediaId: string | undefined, registry: TrailsState['durableMediaAssetRegistryStore']): Promise<void> => { if (!mediaId) return; if (!registry) throw new TrailsSyncInputError('关于页肖像媒体授权当前不可用'); if (!(await registry.listWorkspacePicker(actor)).some(asset => asset.id === mediaId)) throw new TrailsSyncInputError('关于页肖像媒体必须属于当前创作空间且已发布就绪'); };
const emptyRichDocumentShell = (subjectType: RichDocumentSubjectType, subjectId: string): DurableRichDocument => {
  const now = new Date().toISOString();
  return { subjectType, subjectId, document: { type: 'doc', content: [{ type: 'paragraph' }] }, revision: '0', resourceVersion: '0', createdAt: now, updatedAt: now };
};
const workspaceHikeProjection = (hike: import('../types').DurableHike) => ({
  id: hike.id,
  title: hike.title,
  startedAt: hike.startedAt,
  ...(hike.distanceKm === undefined ? {} : { distanceKm: hike.distanceKm }),
  ...(hike.elevationGainM === undefined ? {} : { elevationGainM: hike.elevationGainM }),
  routeLabel: hike.route.label,
  resourceVersion: hike.resourceVersion,
  createdAt: hike.createdAt,
  updatedAt: hike.updatedAt,
});
const workspaceGearProjection = (gear: import('../types').DurableGearItem): import('../types').WorkspaceGear => ({
  id: gear.id,
  name: gear.name,
  weightGrams: gear.weightGrams,
  quantity: gear.quantity,
  active: gear.active,
  resourceVersion: gear.resourceVersion,
  createdAt: gear.createdAt,
  updatedAt: gear.updatedAt,
});
const workspacePackingPlanProjection = (plan: import('../types').DurablePackingPlan): import('../types').WorkspacePackingPlan => ({
  id: plan.id,
  name: plan.name,
  items: plan.items.map(({ gearId, snapshotWeightGrams, sortOrder }) => ({ gearId, snapshotWeightGrams, sortOrder })),
  snapshotWeightGrams: plan.snapshotWeightGrams,
  resourceVersion: plan.resourceVersion,
  createdAt: plan.createdAt,
  updatedAt: plan.updatedAt,
});
const workspaceFinanceEntryProjection = (entry: import('../types').DurableFinanceEntry): import('../types').WorkspaceFinanceEntry => {
  if (entry.occurredOn === undefined || entry.category === undefined || entry.amountCents === undefined || entry.currency === undefined) throw new TrailsSyncInputError('财务账目当前不可用于工作台');
  return { id: entry.id, occurredOn: entry.occurredOn, category: entry.category, amountCents: entry.amountCents, currency: entry.currency, resourceVersion: entry.resourceVersion, createdAt: entry.createdAt, updatedAt: entry.updatedAt };
};
const workspaceFinanceBalanceProjection = (balance: import('../types').DurableFinanceBalanceSnapshot): import('../types').WorkspaceFinanceBalance => {
  if (balance.observedAt === undefined || balance.balanceCents === undefined || balance.currency === undefined) throw new TrailsSyncInputError('财务余额快照当前不可用于工作台');
  return { id: balance.id, observedAt: balance.observedAt, balanceCents: balance.balanceCents, currency: balance.currency, resourceVersion: balance.resourceVersion, createdAt: balance.createdAt };
};
const durableHikeCreate = (ctx: Context, resourceId: string) => {
  const raw: unknown = ctx.params;
  if (!isRecord(raw) || Object.getPrototypeOf(raw) !== Object.prototype || !Reflect.ownKeys(raw).every(key => typeof key === 'string' && ['title', 'startedAt', 'distanceKm', 'elevationGainM', 'routeLabel'].includes(key))) throw new TrailsSyncInputError('徒步记录请求包含不允许字段');
  const input = raw;
  const startedAt = requiredString(input, 'startedAt', '开始时间');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(startedAt) || Number.isNaN(new Date(startedAt).getTime()) || new Date(startedAt).toISOString() !== startedAt) throw new TrailsSyncInputError('startedAt必须是规范UTC ISO时间');
  const distanceKm = optionalNumber(input, 'distanceKm');
  const elevationGainM = optionalNumber(input, 'elevationGainM');
  if ((distanceKm !== undefined && (!Number.isFinite(distanceKm) || distanceKm < 0 || distanceKm > 10000000)) || (elevationGainM !== undefined && (!Number.isFinite(elevationGainM) || elevationGainM < 0 || elevationGainM > 10000000))) throw new TrailsSyncInputError('距离和爬升必须是有限的非负数字');
  const routeLabel = requiredString(input, 'routeLabel', '路线标签');
  if (routeLabel.length > 240) throw new TrailsSyncInputError('路线标签长度无效');
  return { id: resourceId, title: requiredString(input, 'title', '徒步标题'), startedAt, ...(distanceKm === undefined ? {} : { distanceKm }), ...(elevationGainM === undefined ? {} : { elevationGainM }), route: { provider: 'manual', externalId: resourceId, label: routeLabel } };
};
const durableGearFields = (input: Input) => {
  const name = input.name;
  const weightGrams = input.weightGrams;
  const quantity = input.quantity;
  if (typeof name !== 'string' || !name.trim() || name.length > 160) throw new TrailsSyncInputError('name无效');
  if (typeof weightGrams !== 'number' || !Number.isSafeInteger(weightGrams) || weightGrams < 0 || weightGrams > 10000000) throw new TrailsSyncInputError('weightGrams必须是合理的非负整数');
  if (typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000) throw new TrailsSyncInputError('quantity必须是1至1000000的整数');
  return { name: name.trim(), weightGrams, quantity };
};
const durableGearRequest = (ctx: Context, allowed: readonly string[]): Input => ownExactObject(ctx.params, allowed, '装备请求');
const durableGearCreate = (ctx: Context, resourceId: string) => ({ id: resourceId, ...durableGearFields(durableGearRequest(ctx, ['name', 'weightGrams', 'quantity'])) });
const durableGearUpdate = (ctx: Context) => {
  const input = durableGearRequest(ctx, ['id', 'resourceVersion', 'name', 'weightGrams', 'quantity']);
  return { id: requiredString(input, 'id', '装备编号'), resourceVersion: canonicalDecimalString(input.resourceVersion, 'resourceVersion'), ...durableGearFields(input) };
};
const durableGearDeactivate = (ctx: Context) => {
  const input = durableGearRequest(ctx, ['id', 'resourceVersion']);
  return { id: requiredString(input, 'id', '装备编号'), resourceVersion: canonicalDecimalString(input.resourceVersion, 'resourceVersion') };
};
const durablePackingPlanFields = (input: Input) => {
  const name = input.name;
  if (typeof name !== 'string' || !name.trim() || name.length > 160) throw new TrailsSyncInputError('name无效');
  if (!Array.isArray(input.gearIds) || input.gearIds.length === 0 || input.gearIds.length > 100) throw new TrailsSyncInputError('gearIds必须是1至100项数组');
  const gearIds = input.gearIds.map((item, index) => { if (typeof item !== 'string' || !item.trim() || item.length > 160) throw new TrailsSyncInputError(`gearIds[${index}]无效`); return item.trim(); });
  if (new Set(gearIds).size !== gearIds.length) throw new TrailsSyncInputError('gearIds不能包含重复装备');
  return { name: name.trim(), gearIds };
};
const durablePackingPlanRequest = (ctx: Context, allowed: readonly string[]): Input => ownExactObject(ctx.params, allowed, '装包方案请求');
const durablePackingPlanCreate = (ctx: Context, resourceId: string) => ({ id: resourceId, ...durablePackingPlanFields(durablePackingPlanRequest(ctx, ['name', 'gearIds'])) });
const durablePackingPlanUpdate = (ctx: Context) => {
  const input = durablePackingPlanRequest(ctx, ['id', 'resourceVersion', 'name', 'gearIds']);
  return { id: requiredString(input, 'id', '装包方案编号'), resourceVersion: canonicalDecimalString(input.resourceVersion, 'resourceVersion'), ...durablePackingPlanFields(input) };
};
const durableFinanceFields = (input: Input) => {
  const occurredOn = requiredString(input, 'occurredOn', '发生日期');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn) || new Date(`${occurredOn}T00:00:00.000Z`).toISOString().slice(0, 10) !== occurredOn) throw new TrailsSyncInputError('occurredOn必须是有效ISO日期');
  const category = requiredString(input, 'category', '分类');
  const amountCents = input.amountCents;
  const currency = input.currency;
  if (category.length > 160) throw new TrailsSyncInputError('category无效');
  if (typeof amountCents !== 'number' || !Number.isSafeInteger(amountCents)) throw new TrailsSyncInputError('amountCents必须是安全整数的最小货币单位');
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) throw new TrailsSyncInputError('currency必须是3位大写ISO货币代码');
  return { occurredOn, category, amountCents, currency };
};
const durableFinanceRequest = (ctx: Context, allowed: readonly string[]): Input => ownExactObject(ctx.params, allowed, '财务请求');
const durableFinanceCreate = (ctx: Context, resourceId: string) => ({ id: resourceId, ...durableFinanceFields(durableFinanceRequest(ctx, ['occurredOn', 'category', 'amountCents', 'currency'])) });
const durableFinanceUpdate = (ctx: Context) => { const input = durableFinanceRequest(ctx, ['id', 'resourceVersion', 'occurredOn', 'category', 'amountCents', 'currency']); return { id: requiredString(input, 'id', '账目编号'), resourceVersion: canonicalDecimalString(input.resourceVersion, 'resourceVersion'), ...durableFinanceFields(input) }; };
const durableFinanceBalanceRecord = (ctx: Context, resourceId: string) => {
  const input = durableFinanceRequest(ctx, ['balanceCents', 'currency']);
  const balanceCents = input.balanceCents; const currency = input.currency;
  if (typeof balanceCents !== 'number' || !Number.isSafeInteger(balanceCents)) throw new TrailsSyncInputError('balanceCents必须是安全整数的最小货币单位');
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) throw new TrailsSyncInputError('currency必须是3位大写ISO货币代码');
  return { id: resourceId, balanceCents, currency };
};
const durableFinanceBalanceCurrency = (ctx: Context): string | undefined => {
  const input = durableFinanceRequest(ctx, ctx.params && isRecord(ctx.params) && Object.prototype.hasOwnProperty.call(ctx.params, 'currency') ? ['currency'] : []);
  if (input.currency === undefined) return undefined;
  if (typeof input.currency !== 'string' || !/^[A-Z]{3}$/.test(input.currency)) throw new TrailsSyncInputError('currency必须是3位大写ISO货币代码');
  return input.currency;
};
const weatherForecastRequest = (input: Input): WeatherForecastRequest => ({
  latitude: coordinate(input, 'latitude', -90, 90),
  longitude: coordinate(input, 'longitude', -180, 180),
  ...(input.forecastFor === undefined ? {} : { forecastFor: requiredString(input, 'forecastFor', 'forecastFor') }),
});
const shareableResourceType = (value: unknown): ShareableResourceType => {
  if (value === 'hike' || value === 'gear-item' || value === 'packing-plan') return value;
  throw new Error('仅可共享路线、装备规范或装包方案');
};
const sharedGearProjection = (shareId: string, gear: { name: string; weightGrams: number; quantity: number }): SharedGearProjection =>
  ({ shareId, name: gear.name, weightGrams: gear.weightGrams, quantity: gear.quantity });
const sharedPackingGearProjection = (gear: { name: string; weightGrams: number; quantity: number }): SharedPackingGearProjection =>
  ({ name: gear.name, weightGrams: gear.weightGrams, quantity: gear.quantity });
const sharedResourceProjection = (repository: TrailsState['repository'], grant: TrailsShareGrant): SharedResourceProjection | undefined => {
  if (grant.resourceType === 'hike') {
    const hike = repository.getHike(grant.resourceId);
    if (!hike || hike.tenantId !== grant.tenantId || hike.ownerUserId !== grant.ownerUserId) return undefined;
    return { shareId: grant.id, title: hike.title, occurredOn: hike.startedAt.slice(0, 10), routeLabel: hike.route.label, ...(hike.distanceKm === undefined ? {} : { distanceKm: hike.distanceKm }), ...(hike.elevationGainM === undefined ? {} : { elevationGainM: hike.elevationGainM }) };
  }
  if (grant.resourceType === 'gear-item') {
    const gear = repository.listGear({ tenantId: grant.tenantId, ownerUserId: grant.ownerUserId }).find((item) => item.id === grant.resourceId);
    return gear ? sharedGearProjection(grant.id, gear) : undefined;
  }
  const plan = repository.listPackingPlans({ tenantId: grant.tenantId, ownerUserId: grant.ownerUserId }).find((item) => item.id === grant.resourceId);
  if (!plan) return undefined;
  const ownedGear = new Map(repository.listGear({ tenantId: grant.tenantId, ownerUserId: grant.ownerUserId }).map((item) => [item.id, item]));
  return { shareId: grant.id, name: plan.name, snapshotWeightGrams: plan.snapshotWeightGrams, gear: plan.gearItemIds.flatMap((gearId) => {
    const gear = ownedGear.get(gearId);
    return gear ? [sharedPackingGearProjection(gear)] : [];
  }) };
};
const isActiveShare = (grant: TrailsShareGrant, timestamp: string) => !grant.revokedAt && (!grant.expiresAt || grant.expiresAt > timestamp);
const shareOwnedByActor = (repository: TrailsState['repository'], actor: Actor, resourceType: ShareableResourceType, resourceId: string): boolean => {
  if (resourceType === 'hike') return actorCanReadPrivate(actor, repository.getHike(resourceId) || { tenantId: '', ownerUserId: '' });
  if (resourceType === 'gear-item') return repository.listGear({ tenantId: actor.tenantId, ownerUserId: actor.userId }).some((item) => item.id === resourceId);
  return repository.listPackingPlans({ tenantId: actor.tenantId, ownerUserId: actor.userId }).some((item) => item.id === resourceId);
};

const publicPhotoTechnicalMetadata = (metadata: PhotoTechnicalMetadata | undefined) => {
  if (!metadata) return undefined;
  const visible: Record<string, unknown> = {};
  if (metadata.visibility.captureSettings) Object.assign(visible, { camera: metadata.camera, lens: metadata.lens, focalLengthMm: metadata.focalLengthMm, aperture: metadata.aperture, shutterSpeed: metadata.shutterSpeed, iso: metadata.iso, captureDate: metadata.captureDate });
  if (metadata.visibility.locationLabel && metadata.calibratedLocationLabel) visible.calibratedLocationLabel = metadata.calibratedLocationLabel;
  if (metadata.visibility.technicalTags) Object.assign(visible, { technicalTags: metadata.technicalTags, ownerCustomLabels: metadata.ownerCustomLabels });
  if (metadata.visibility.creationNote && metadata.creationNote) visible.creationNote = metadata.creationNote;
  return Object.keys(visible).length > 0 ? visible : undefined;
};
const publicPortfolio = (portfolio: Portfolio) => {
  const photoMetadata = publicPhotoTechnicalMetadata(portfolio.photoTechnicalMetadata);
  return {
    id: portfolio.id, title: portfolio.title, summary: portfolio.summary, coverMediaId: portfolio.coverMediaId,
    mediaIds: portfolio.mediaIds, locationLabel: portfolio.locationLabel, categoryId: portfolio.categoryId, publishedAt: portfolio.updatedAt,
    ...(photoMetadata ? { photoTechnicalMetadata: photoMetadata } : {}),
    ...(portfolio.exhibitionPresentation ? { exhibitionPresentation: portfolio.exhibitionPresentation } : {}),
  };
};
const publicCategory = (category: PortfolioCategory) => ({
  id: category.id, slug: category.slug, nameZh: category.nameZh, description: category.description, sortOrder: category.sortOrder,
});
const publicJournal = (journal: Journal) => ({
  id: journal.id, title: journal.title, excerpt: journal.excerpt, coverMediaId: journal.coverMediaId, publishedAt: journal.publishedAt,
});
const publicGuestComment = (comment: GuestComment) => ({
  id: comment.id, subjectType: comment.subjectType, subjectId: comment.subjectId, displayName: comment.displayName,
  avatarId: comment.avatarId, body: comment.body, createdAt: comment.createdAt,
});
const publicCommentSubject = (repository: TrailsState['repository'], subjectType: GuestComment['subjectType'], subjectId: string | undefined, owner: PublicOwner): { tenantId: string; ownerUserId: string } | undefined => {
  if (subjectType === 'guestbook') return owner;
  const record = subjectType === 'portfolio' ? repository.getPortfolio(subjectId || '') : repository.getJournal(subjectId || '');
  return record && record.visibility === 'public' && record.lifecycle === 'published'
    ? { tenantId: record.tenantId, ownerUserId: record.ownerUserId }
    : undefined;
};
const commentManagedBy = (actor: Actor, comment: GuestComment) => actorCanManageCreatorSpace(actor, comment);
const tripPlanStatus = (value: unknown): GuidedTripPlanStatus => {
  if (value === 'draft' || value === 'open' || value === 'closed' || value === 'cancelled' || value === 'completed') return value;
  throw new Error('planStatus无效');
};
const registrationStatus = (value: unknown): GuidedTripRegistrationStatus => {
  if (value === 'submitted' || value === 'waitlisted' || value === 'approved-awaiting-payment' || value === 'confirmed' || value === 'rejected' || value === 'cancelled') return value;
  throw new Error('registrationStatus无效');
};
const itinerary = (value: unknown): GuidedTripItineraryItem[] => {
  if (!Array.isArray(value) || value.length === 0) throw new Error('publicItinerary必须是非空数组');
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`publicItinerary[${index}]必须是对象`);
    return { dayLabel: requiredString(item, 'dayLabel', `publicItinerary[${index}].dayLabel`), summary: requiredString(item, 'summary', `publicItinerary[${index}].summary`) };
  });
};
const materialReferences = (value: unknown): GuidedTripMaterialReference[] => {
  if (!Array.isArray(value)) throw new Error('publicMaterialReferences必须是数组');
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`publicMaterialReferences[${index}]必须是对象`);
    return { label: requiredString(item, 'label', `publicMaterialReferences[${index}].label`), reference: requiredString(item, 'reference', `publicMaterialReferences[${index}].reference`) };
  });
};
const reservedStatuses: GuidedTripRegistrationStatus[] = ['approved-awaiting-payment', 'confirmed'];
const allowedRegistrationTransitions: Record<GuidedTripRegistrationStatus, GuidedTripRegistrationStatus[]> = {
  submitted: ['waitlisted', 'approved-awaiting-payment', 'rejected', 'cancelled'],
  waitlisted: ['approved-awaiting-payment', 'rejected', 'cancelled'],
  'approved-awaiting-payment': ['confirmed', 'cancelled'],
  confirmed: ['cancelled'],
  rejected: [],
  cancelled: [],
};
/** Terminal plan statuses have no outgoing transitions. */
const allowedTripPlanTransitions: Record<GuidedTripPlanStatus, GuidedTripPlanStatus[]> = {
  draft: ['open', 'cancelled'],
  open: ['closed', 'cancelled', 'completed'],
  closed: ['open', 'cancelled', 'completed'],
  cancelled: [],
  completed: [],
};
const terminalTripPlanStatuses: GuidedTripPlanStatus[] = ['cancelled', 'completed'];
/** Session publication is an internal workflow state, never a public-visibility grant. */
const allowedShootSessionTransitions: Record<ShootSessionStatus, ShootSessionStatus[]> = {
  planned: ['in_field'],
  in_field: ['processing'],
  processing: ['published'],
  published: ['archived'],
  archived: [],
};
const shootSessionStatus = (value: unknown): ShootSessionStatus => {
  if (value === 'planned' || value === 'in_field' || value === 'processing' || value === 'published' || value === 'archived') return value;
  throw new Error('shootSession状态无效');
};
const optionalOpaqueIdArray = (input: Input, key: string): string[] => input[key] === undefined ? [] : opaqueIdArray(input, key);
const optionalPlainTextArray = (input: Input, key: string, maximumItems: number, maximumLength: number): string[] => input[key] === undefined ? [] : plainTextArray(input, key, maximumItems, maximumLength);
const reservedCapacity = (registrations: GuidedTripRegistration[]) => registrations.filter((registration) => reservedStatuses.includes(registration.status)).length;
const publicTrip = (trip: GuidedTripPlan) => ({
  id: trip.id, title: trip.title, summary: trip.summary, publicLocationLabel: trip.publicLocationLabel,
  startsOn: trip.startsOn, endsOn: trip.endsOn, capacity: trip.capacity, planStatus: trip.planStatus,
  contingencyStatus: trip.contingencyStatus, publicContingencyMessage: trip.publicContingencyMessage,
  publicItinerary: trip.publicItinerary, checklist: trip.checklist, publicMaterialReferences: trip.publicMaterialReferences,
});
const publicTripVisible = (trip: GuidedTripPlan | undefined): trip is GuidedTripPlan => Boolean(trip && trip.visibility === 'public' && trip.lifecycle === 'published' && trip.planStatus !== 'draft');
const registrationForActor = (registration: GuidedTripRegistration | undefined, actor: Actor): registration is GuidedTripRegistration => Boolean(registration && registration.tenantId === actor.tenantId && registration.participantUserId === actor.userId);
const tripLifecycleForStatus = (status: GuidedTripPlanStatus) =>
  status === 'open' ? 'published' : status === 'completed' ? 'archived' : 'draft';
const allowedPublishingTransitions: Record<PublishingPackageStatus, PublishingPackageStatus[]> = {
  draft: ['prepared'], prepared: ['reviewed'], reviewed: ['approved'], approved: ['ready_manual_publish', 'scheduled'],
  ready_manual_publish: ['published'], scheduled: ['published'], published: ['measured'], measured: ['learned'], learned: [],
};
const publishingStatus = (value: unknown): PublishingPackageStatus => {
  if (value === 'draft' || value === 'prepared' || value === 'reviewed' || value === 'approved' || value === 'ready_manual_publish' || value === 'scheduled' || value === 'published' || value === 'measured' || value === 'learned') return value;
  throw new Error('发布包状态无效');
};
const isIsoInstant = (value: string) => !Number.isNaN(new Date(value).getTime()) && new Date(value).toISOString() === value;
const approvalBlocks = (item: PublishingPackage): string | undefined => {
  if (item.locationPolicy === 'withheld' && item.containsGpsOrRouteHints) return '已隐去地点的发布包不能包含GPS或路线提示';
  if (item.rightsStatus === 'restricted' && !item.rightsDisclosure) return '受限权利必须在发布包中披露';
  if (item.factualClaims.some((claim) => claim.verification === 'unverified')) return '未核验事实声明不能批准';
  if (!Object.values(item.approvals).every(Boolean)) return '必须完成文案、媒体、权利、地点隐私和事实声明五项人工批准';
  return undefined;
};
const manualPublishingPackage = (item: PublishingPackage) => item.publishingPath === 'manual_handoff';
const measurementEvents = (value: unknown): PublishingMeasurementEvent[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) throw new Error('measurementEvents必须是1至100项数组');
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`measurementEvents[${index}]必须是对象`);
    if (entry.metric !== 'impressions' && entry.metric !== 'reach' && entry.metric !== 'engagements' && entry.metric !== 'profile_visits' && entry.metric !== 'link_clicks' && entry.metric !== 'qualified_inquiries') throw new Error(`measurementEvents[${index}].metric无效`);
    const occurredAt = requiredString(entry, 'occurredAt', `measurementEvents[${index}].occurredAt`);
    if (!isIsoInstant(occurredAt)) throw new Error(`measurementEvents[${index}].occurredAt必须是ISO UTC时间`);
    if (typeof entry.value !== 'number' || !Number.isFinite(entry.value) || entry.value < 0) throw new Error(`measurementEvents[${index}].value必须是非负数字`);
    return { occurredAt, metric: entry.metric, value: entry.value };
  });
};
const prohibitedDurablePublishingFields = new Set(['tenantId', 'ownerUserId', 'destinationUrl', 'utmUrl', 'official_api_candidate', 'publishingPath', 'scheduledFor', 'scheduled', 'publicUrl', 'postUrl', 'accountId', 'account', 'token', 'tokens', 'oauth', 'accessToken', 'refreshToken', 'mediaLocator', 'mediaLocators', 'objectKey', 'objectKeys', 'buffer', 'downloadUrl', 'deliveryConfig']);
const rejectProhibitedDurablePublishingFields = (input: Input) => { for (const key of Object.keys(input)) if (prohibitedDurablePublishingFields.has(key)) throw new TrailsSyncInputError(`不允许字段:${key}`); };
const durablePublishingStatus = (value: unknown): DurablePublishingPackageStatus => { if (value === 'draft' || value === 'prepared' || value === 'reviewed' || value === 'approved' || value === 'ready_manual_handoff' || value === 'manually_published' || value === 'measured' || value === 'learned') return value; throw new TrailsSyncInputError('发布包状态无效'); };
const durablePublishingMutation = (input: Input) => ({ mutationId: requiredString(input, 'mutationId', '变更编号'), expectedResourceVersion: input.expectedResourceVersion === null ? null : canonicalDecimalString(input.expectedResourceVersion, 'expectedResourceVersion') });
const durablePublishingCreate = (input: Input, resourceId: string) => {
  rejectProhibitedDurablePublishingFields(input);
  const exports = publishingExportVariants(input);
  return { ...durablePublishingMutation(input), id: resourceId, sourceWorkId: requiredString(input, 'sourceWorkId', '来源作品编号'), platform: requiredString(input, 'platform', '平台标签'), copy: requiredString(input, 'copy', '发布文案'), contentOrigin: publishingContentOrigin(input), exportVariants: exports, ...publishingLocationPolicy(input), ...publishingRights(input), factualClaims: publishingClaims(input), approvals: publishingApprovals(input) };
};
const durablePublishingMeasurement = (input: Input) => { rejectProhibitedDurablePublishingFields(input); return { ...durablePublishingMutation(input), id: requiredString(input, 'id', '发布包编号'), measurementEvents: measurementEvents(input.measurementEvents) }; };
const durablePublishingLearning = (input: Input) => { rejectProhibitedDurablePublishingFields(input); const confidence = input.confidence; if (confidence !== 'low' && confidence !== 'medium' && confidence !== 'high') throw new TrailsSyncInputError('confidence必须是low、medium或high'); return { ...durablePublishingMutation(input), id: requiredString(input, 'id', '发布包编号'), learning: { summary: requiredString(input, 'summary', '学习结论'), confidence: confidence as 'low' | 'medium' | 'high' } }; };

export default function trailsActions(star: Starlight, state: TrailsState) {
  const repository = state.repository;
  const antiAbuse = state.antiAbuse;
  const publicResponseCache = new PublicResponseCache();
  const publicOwnerResolver = state.publicOwnerResolver || createPublicOwnerResolver();
  const cachedPublic = (ctx: Context, resource: string, parameters: string, load: (owner: PublicOwner | undefined) => Promise<HttpResponseItem>) => {
    if (resolveActor(ctx)) return load(publicOwnerResolver.resolve());
    const owner = publicOwnerResolver.resolve();
    if (!owner) return load(undefined);
    return publicResponseCache.getOrLoad(publicResponseCacheKey(owner.tenantId, owner.ownerUserId, resource, parameters), () => load(owner));
  };
  const invalidatePublic = (actor: Actor, resources: readonly string[]) => {
    const configuredOwner = publicOwnerResolver.resolve();
    const ownerUserId = creatorOwner(actor);
    if (!configuredOwner || ownerUserId !== configuredOwner.ownerUserId || actor.tenantId !== configuredOwner.tenantId) return;
    for (const resource of resources) publicResponseCache.invalidate(publicResponseCacheKey(configuredOwner.tenantId, configuredOwner.ownerUserId, resource));
  };
  const actions = {
    'v1.overview': {
      metadata: { auth: false },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        return success({
          publishedPortfolioCount: repository.listPortfolios(publicFilter).length,
          publishedJournalCount: repository.listJournals(publicFilter).length,
          publishedMapPlaceCount: repository.listMapPlaces(publicFilter).length,
        }, '星迹公开概览');
      },
    },
    'v2.analytics.ingest': { metadata: { auth: false }, async handler(ctx: Context): Promise<HttpResponseItem> { const analytics = state.durableAnalyticsStore; if (!analytics) return failure('公开站分析尚未启用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const owner = (state.publicOwnerResolver || createPublicOwnerResolver()).resolve(); if (!owner) return failure('未找到公开站点', HttpStatusCode.NOT_FOUND); await analytics.ingest({ tenantId: owner.tenantId, userId: owner.ownerUserId }, analyticsEvent(params(ctx))); return success({ accepted: true }, '分析事件已接收'); } catch (error: unknown) { return error instanceof TrailsSyncInputError ? failure(error.message, HttpStatusCode.BAD_REQUEST) : failure('分析事件当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); } } },
    'v2.analytics.workspace': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN); const analytics = state.durableAnalyticsStore; if (!analytics) return failure('真实访问分析尚未启用', HttpStatusCode.SERVICE_UNAVAILABLE); try { return success(await analytics.readWorkspace(actor, analyticsRange(params(ctx))), '摄影站访问分析'); } catch (error: unknown) { return error instanceof TrailsSyncInputError ? failure(error.message, HttpStatusCode.BAD_REQUEST) : failure('访问分析当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); } } },
    'v2.analytics.content-metrics': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN); const analytics = state.durableAnalyticsStore; if (!analytics) return failure('真实访问分析尚未启用', HttpStatusCode.SERVICE_UNAVAILABLE); try { return success(await analytics.readContentMetrics(actor, analyticsContentMetrics(params(ctx))), '内容库指标'); } catch (error: unknown) { return error instanceof TrailsSyncInputError ? failure(error.message, HttpStatusCode.BAD_REQUEST) : failure('内容指标当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); } } },
    'v2.trip-registrations.submit': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); const store = state.durableTripRegistrationStore; if (!store) return failure('耐久报名当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { return success(await store.submit(actor, durableTripRegistrationSubmit(params(ctx))), '报名申请已提交', HttpStatusCode.CREATED); } catch (error: unknown) { return error instanceof TrailsSyncInputError ? failure(error.message, HttpStatusCode.BAD_REQUEST) : failure('耐久报名当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); } } },
    'v2.trip-registrations.mine': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); const store = state.durableTripRegistrationStore; if (!store) return failure('耐久报名当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const registration = await store.readMine(actor, durableTripRegistrationRead(params(ctx))); return registration ? success(registration, '当前账号报名') : failure('未找到当前账号报名', HttpStatusCode.NOT_FOUND); } catch (error: unknown) { return error instanceof TrailsSyncInputError ? failure(error.message, HttpStatusCode.BAD_REQUEST) : failure('耐久报名当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); } } },
    'v2.trip-registrations.cancel-mine': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); const store = state.durableTripRegistrationStore; if (!store) return failure('耐久报名当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { return success(await store.cancelMine(actor, durableTripRegistrationCancel(params(ctx))), '报名已取消'); } catch (error: unknown) { return error instanceof TrailsSyncInputError ? failure(error.message, HttpStatusCode.BAD_REQUEST) : failure('耐久报名当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); } } },
    'v2.trip-registrations.transition': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); const store = state.durableTripRegistrationStore; if (!store) return failure('耐久报名当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { return success(await store.transition(actor, durableTripRegistrationTransition(params(ctx))), '报名状态已更新'); } catch (error: unknown) { return error instanceof TrailsSyncInputError ? failure(error.message, HttpStatusCode.BAD_REQUEST) : failure('耐久报名当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); } } },
    'v2.trip-registrations.capacity': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); const store = state.durableTripRegistrationStore; if (!store) return failure('耐久报名当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { return success(await store.configureCapacity(actor, durableTripCapacity(params(ctx))), '行摄名额已配置'); } catch (error: unknown) { return error instanceof TrailsSyncInputError ? failure(error.message, HttpStatusCode.BAD_REQUEST) : failure('耐久报名当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); } } },
    'v2.trip-registrations.summary': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); const store = state.durableTripRegistrationStore; if (!store) return failure('耐久报名当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { return success(await store.summary(actor, durableTripRegistrationSummary(params(ctx))), '行摄报名运营摘要'); } catch (error: unknown) { return error instanceof TrailsSyncInputError ? failure(error.message, HttpStatusCode.BAD_REQUEST) : failure('耐久报名当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); } } },
    /** Private payment operations; public trip routes never receive these terms or records. */
    'v2.trip-payments.workspace': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN); const store = state.durableTripPaymentStore; if (!store) return failure('摄影团付款当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { if (Object.keys(params(ctx)).length) throw new TrailsSyncInputError('摄影团付款工作台请求包含不允许字段'); return success(await store.workspace(actor), '摄影团付款工作台'); } catch (error: unknown) { return error instanceof TrailsSyncInputError ? failure(error.message, HttpStatusCode.BAD_REQUEST) : failure('摄影团付款当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); } } },
    'v2.trip-payments.terms.save': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN); const store = state.durableTripPaymentStore; if (!store) return failure('摄影团付款当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { return success(await store.saveTerms(actor, durableTripPaymentTerms(params(ctx))), '摄影团付款条款已保存'); } catch (error: unknown) { return error instanceof TrailsSyncInputError ? failure(error.message, HttpStatusCode.BAD_REQUEST) : failure('摄影团付款当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); } } },
    'v2.trip-payments.deposit.approve': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN); const store = state.durableTripPaymentStore; if (!store) return failure('摄影团付款当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { return success(await store.approveDeposit(actor, durableTripPaymentApprove(params(ctx))), '报名已锁位，等待定金核验'); } catch (error: unknown) { return error instanceof TrailsSyncInputError ? failure(error.message, HttpStatusCode.BAD_REQUEST) : failure('摄影团付款当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); } } },
    'v2.trip-payments.transition': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN); const store = state.durableTripPaymentStore; if (!store) return failure('摄影团付款当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { return success(await store.transitionPayment(actor, durableTripPaymentTransition(params(ctx))), '摄影团付款状态已更新'); } catch (error: unknown) { return error instanceof TrailsSyncInputError ? failure(error.message, HttpStatusCode.BAD_REQUEST) : failure('摄影团付款当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); } } },
    'v1.profile.public': {
      metadata: { auth: false },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const profile = repository.getPublicOwnerProfile(publicOwner(ctx));
        return profile ? success(profile, '公开个人资料') : failure('未找到公开个人资料', HttpStatusCode.NOT_FOUND);
      },
    },
    'v1.comments.public': {
      metadata: { auth: false },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const subject = guestCommentSubject(params(ctx));
          const owner = publicCommentSubject(repository, subject.subjectType, subject.subjectId, publicOwner(ctx));
          if (!owner) return failure('未找到可公开留言的内容', HttpStatusCode.NOT_FOUND);
          return success(repository.listGuestComments({ ...owner, ...subject, status: 'approved' }).map(publicGuestComment), '公开留言');
        } catch (error: unknown) { return failure(error instanceof Error ? error.message : '查询公开留言失败'); }
      },
    },
    'v1.comments.submit': {
      metadata: { auth: false },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const input = params(ctx);
          const subject = guestCommentSubject(input);
          const owner = publicCommentSubject(repository, subject.subjectType, subject.subjectId, publicOwner(ctx));
          if (!owner) return failure('未找到可公开留言的内容', HttpStatusCode.NOT_FOUND);
          if (!antiAbuse) return failure('留言保护服务当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
          const assessment = await antiAbuse.assessSubmission(subject);
          if (!assessment.allowed) return failure('留言请求暂不能处理', HttpStatusCode.TOO_MANY_REQUESTS);
          const timestamp = now();
          const comment: GuestComment = {
            id: id('guest-comment'), ...owner, ...subject, displayName: guestDisplayName(input), avatarId: guestAvatarId(input),
            body: guestCommentBody(input), normalizedEmail: normalizedEmail(input), status: 'pending-email-verification',
            developmentVerificationTokenReference: id('development-verification-reference'), createdAt: timestamp, updatedAt: timestamp, resourceVersion: 0,
          };
          const saved = repository.saveGuestComment(comment);
          return success({ id: saved.id, status: saved.status }, '留言已提交，请完成邮箱验证后等待审核', HttpStatusCode.CREATED);
        } catch (error: unknown) { return failure(error instanceof Error ? error.message : '提交留言失败'); }
      },
    },
    'v1.comments.verify': {
      metadata: { auth: false },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const tokenReference = requiredString(params(ctx), 'verificationTokenReference', '验证令牌引用');
          const comment = repository.listGuestComments({}).find((item) => item.developmentVerificationTokenReference === tokenReference);
          if (!comment || comment.status !== 'pending-email-verification') return failure('验证链接无效或已失效', HttpStatusCode.NOT_FOUND);
          const timestamp = now();
          comment.status = 'pending-approval'; comment.emailVerifiedAt = timestamp; comment.updatedAt = timestamp;
          repository.saveGuestComment(comment);
          return success({ id: comment.id, status: comment.status }, '邮箱已验证，留言等待审核');
        } catch (error: unknown) { return failure(error instanceof Error ? error.message : '验证留言失败'); }
      },
    },
    'v1.comments.moderation-queue': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        const queue = repository.listGuestComments({ tenantId: actor.tenantId, status: 'pending-approval' }).filter((comment) => commentManagedBy(actor, comment));
        return success(queue, '留言审核队列');
      },
    },
    'v1.comments.moderate': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        try {
          const input = params(ctx);
          const comment = repository.getGuestComment(requiredString(input, 'id', '留言编号'));
          if (!comment) return failure('未找到留言', HttpStatusCode.NOT_FOUND);
          if (!commentManagedBy(actor, comment)) return failure('无权审核该留言', HttpStatusCode.FORBIDDEN);
          if (comment.status !== 'pending-approval') throw new Error('只有待审核留言可以审核');
          if (input.status !== 'approved' && input.status !== 'rejected') throw new Error('审核状态必须是approved或rejected');
          comment.status = input.status; comment.moderatedAt = now(); comment.moderatedByUserId = actor.userId; comment.updatedAt = comment.moderatedAt;
          return success(repository.saveGuestComment(comment), input.status === 'approved' ? '留言已通过审核' : '留言已拒绝');
        } catch (error: unknown) { return failure(error instanceof Error ? error.message : '审核留言失败'); }
      },
    },
    'v1.portfolio.public': {
      metadata: { auth: false },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const owner = publicOwner(ctx);
          const categorySlug = optionalSlug(params(ctx), 'categorySlug');
          const category = categorySlug === undefined ? undefined : repository.getPortfolioCategoryBySlug({ ...owner, slug: categorySlug });
          if (categorySlug !== undefined && (!category || category.visibility !== 'public' || category.status !== 'active')) return failure('未找到公开作品分类', HttpStatusCode.NOT_FOUND);
          return success(repository.listPortfolios({ ...publicFilter, tenantId: owner.tenantId, ownerUserId: owner.ownerUserId, categoryId: category?.id }).map(publicPortfolio), '公开摄影作品集');
        } catch (error: unknown) { return failure(error instanceof Error ? error.message : '查询公开作品集失败'); }
      },
    },
    'v1.categories.public': {
      metadata: { auth: false },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const owner = publicOwner(ctx);
        return success(repository.listPortfolioCategories({ tenantId: owner.tenantId, ownerUserId: owner.ownerUserId, visibility: 'public', status: 'active' }).map(publicCategory), '公开作品分类');
      },
    },
    'v1.stories.public': {
      metadata: { auth: false },
      async handler(_ctx: Context): Promise<HttpResponseItem> {
        return success(repository.listJournals(publicFilter).map(publicJournal), '公开行旅故事');
      },
    },
    'v1.workspace': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        return success({
          portfolios: creatorOwner(actor) ? repository.listPortfolios({ tenantId: actor.tenantId, ownerUserId: creatorOwner(actor) }) : [],
          journals: creatorOwner(actor) ? repository.listJournals({ tenantId: actor.tenantId, ownerUserId: creatorOwner(actor) }) : [],
          hikes: repository.listHikes({ tenantId: actor.tenantId, ownerUserId: actor.userId }),
          packingPlans: repository.listPackingPlans({ tenantId: actor.tenantId, ownerUserId: actor.userId }),
          shootSessions: repository.listShootSessions({ tenantId: actor.tenantId, ownerUserId: actor.userId }),
        }, '个人工作台');
      },
    },
    'v1.capabilities': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        return actor ? success(capabilitySnapshot(actor), '服务端能力快照') : failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
      },
    },
    'v1.weather.forecast': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        if (!state.weather) return failure('天气服务当前未配置', HttpStatusCode.SERVICE_UNAVAILABLE);
        try {
          return success(await state.weather.getForecast(actor, weatherForecastRequest(params(ctx))), '拍摄天气预报');
        } catch (error: unknown) { return failure(error instanceof Error ? error.message : '查询天气预报失败'); }
      },
    },
    'v1.publishing-packages.workspace': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        const ownerUserId = creatorOwner(actor);
        return success(ownerUserId ? repository.listPublishingPackages({ tenantId: actor.tenantId, ownerUserId }) : [], '发布包工作台');
      },
    },
    'v1.publishing-packages.create': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        try {
          const input = params(ctx); const ownerUserId = creatorOwner(actor);
          if (!ownerUserId) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
          const portfolio = repository.getPortfolio(requiredString(input, 'portfolioId', '作品集编号'));
          if (!portfolio || !creatorManaged(actor, portfolio)) return failure('无权为该作品集创建发布包', HttpStatusCode.FORBIDDEN);
          if (portfolio.visibility !== 'public' || portfolio.lifecycle !== 'published') throw new Error('发布包只能关联已发布的公开作品集');
          const platform = publishingPlatform(input); const timestamp = now();
          const publishingPackage: PublishingPackage = {
            id: id('publishing-package'), tenantId: actor.tenantId, ownerUserId, portfolioId: portfolio.id, platform,
            publishingPath: publishingPath(input, platform), status: 'draft', copy: requiredString(input, 'copy', '发布文案'), contentOrigin: publishingContentOrigin(input),
            exportVariants: publishingExportVariants(input), ...publishingLocationPolicy(input), ...publishingRights(input), factualClaims: publishingClaims(input), approvals: publishingApprovals(input),
            ...publishingUtmUrl(input, platform, state.publishingAllowedOrigins || []), measurementEvents: [], createdAt: timestamp, updatedAt: timestamp, resourceVersion: 0,
          };
          return success(repository.savePublishingPackage(publishingPackage), '发布包草稿已创建；未执行任何平台发布', HttpStatusCode.CREATED);
        } catch (error: unknown) { return failure(error instanceof Error ? error.message : '创建发布包失败'); }
      },
    },
    'v1.publishing-packages.transition': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        try {
          const item = repository.getPublishingPackage(requiredString(params(ctx), 'id', '发布包编号'));
          if (!item) return failure('未找到发布包', HttpStatusCode.NOT_FOUND);
          if (!creatorManaged(actor, item)) return failure('无权管理该发布包', HttpStatusCode.FORBIDDEN);
          const next = publishingStatus(params(ctx).status);
          if (!allowedPublishingTransitions[item.status].includes(next)) throw new Error('当前发布包状态不允许该转换');
          if (next === 'approved') { const block = approvalBlocks(item); if (block) throw new Error(block); }
          if (next === 'ready_manual_publish' || next === 'scheduled') {
            if (!manualPublishingPackage(item)) throw new Error('official_api_candidate尚未具备OAuth和平台政策能力，不能进入发布流程');
            if (next === 'scheduled') { const scheduledFor = requiredString(params(ctx), 'scheduledFor', 'scheduledFor'); if (!isIsoInstant(scheduledFor)) throw new Error('scheduledFor必须是ISO UTC时间'); item.scheduledFor = scheduledFor; }
          }
          if (next === 'published') {
            if (!manualPublishingPackage(item)) throw new Error('official_api_candidate不能在缺少未来OAuth和平台政策能力时发布');
            if (params(ctx).manualConfirmation !== true) throw new Error('手动发布必须由人工确认');
          }
          item.status = next; item.updatedAt = now();
          return success(repository.savePublishingPackage(item), next === 'scheduled' ? '已记录人工交接排期意图；未创建真实排程' : '发布包状态已更新');
        } catch (error: unknown) { return failure(error instanceof Error ? error.message : '更新发布包状态失败'); }
      },
    },
    'v1.publishing-packages.measure': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        try {
          const input = params(ctx); const item = repository.getPublishingPackage(requiredString(input, 'id', '发布包编号'));
          if (!item) return failure('未找到发布包', HttpStatusCode.NOT_FOUND);
          if (!creatorManaged(actor, item)) return failure('无权记录该发布包衡量数据', HttpStatusCode.FORBIDDEN);
          if (item.status !== 'published') throw new Error('只有已人工发布的发布包可以记录衡量数据');
          item.measurementEvents = measurementEvents(input.measurementEvents); item.status = 'measured'; item.updatedAt = now();
          return success(repository.savePublishingPackage(item), '发布包衡量数据已记录');
        } catch (error: unknown) { return failure(error instanceof Error ? error.message : '记录衡量数据失败'); }
      },
    },
    'v1.publishing-packages.learn': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        try {
          const input = params(ctx); const item = repository.getPublishingPackage(requiredString(input, 'id', '发布包编号'));
          if (!item) return failure('未找到发布包', HttpStatusCode.NOT_FOUND);
          if (!creatorManaged(actor, item)) return failure('无权记录该发布包学习结论', HttpStatusCode.FORBIDDEN);
          if (item.status !== 'measured') throw new Error('只有已衡量的发布包可以记录学习结论');
          const confidence = input.confidence;
          if (confidence !== 'low' && confidence !== 'medium' && confidence !== 'high') throw new Error('confidence必须是low、medium或high');
          item.learning = { summary: requiredString(input, 'summary', '学习结论'), confidence }; item.status = 'learned'; item.updatedAt = now();
          return success(repository.savePublishingPackage(item), '发布包学习结论已记录');
        } catch (error: unknown) { return failure(error instanceof Error ? error.message : '记录学习结论失败'); }
      },
    },
    'v2.publishing-packages.workspace': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        if (!state.durablePublishingPackageStore) return failure('耐久发布包当前未配置', HttpStatusCode.SERVICE_UNAVAILABLE);
        if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
        try { return success(await state.durablePublishingPackageStore.listWorkspace(actor), '耐久发布包工作台'); } catch (error: unknown) { return durablePublishingFailure(error); }
      },
    },
    'v2.publishing-packages.create': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        if (!state.durablePublishingPackageStore) return failure('耐久发布包当前未配置', HttpStatusCode.SERVICE_UNAVAILABLE);
        if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
        try { const input = params(ctx); const mutationId = requiredString(input, 'mutationId', '变更编号'); const idScope = JSON.stringify(['trails:durable-publishing-package:create:v2', actor.tenantId, actor.userId, mutationId]); const result = await state.durablePublishingPackageStore.create(actor, durablePublishingCreate(input, `durable-publishing-package_${createHash('sha256').update(idScope).digest('hex')}`)); return success(result, '耐久发布包草稿已创建；未执行任何平台发布', HttpStatusCode.CREATED); } catch (error: unknown) { return durablePublishingFailure(error); }
      },
    },
    'v2.publishing-packages.transition': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        if (!state.durablePublishingPackageStore) return failure('耐久发布包当前未配置', HttpStatusCode.SERVICE_UNAVAILABLE);
        if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
        try { const input = params(ctx); rejectProhibitedDurablePublishingFields(input); return success(await state.durablePublishingPackageStore.transition(actor, { ...durablePublishingMutation(input), id: requiredString(input, 'id', '发布包编号'), status: durablePublishingStatus(input.status), ...(input.manualConfirmation === undefined ? {} : { manualConfirmation: input.manualConfirmation === true }) }), '耐久发布包状态已更新'); } catch (error: unknown) { return durablePublishingFailure(error); }
      },
    },
    'v2.publishing-packages.measure': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        if (!state.durablePublishingPackageStore) return failure('耐久发布包当前未配置', HttpStatusCode.SERVICE_UNAVAILABLE);
        if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
        try { return success(await state.durablePublishingPackageStore.measure(actor, durablePublishingMeasurement(params(ctx))), '耐久发布包衡量数据已记录'); } catch (error: unknown) { return durablePublishingFailure(error); }
      },
    },
    'v2.publishing-packages.learn': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        if (!state.durablePublishingPackageStore) return failure('耐久发布包当前未配置', HttpStatusCode.SERVICE_UNAVAILABLE);
        if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
        try { return success(await state.durablePublishingPackageStore.learn(actor, durablePublishingLearning(params(ctx))), '耐久发布包学习结论已记录'); } catch (error: unknown) { return durablePublishingFailure(error); }
      },
    },
    'v1.shoot-sessions.workspace': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        return success(repository.listShootSessions({ tenantId: actor.tenantId, ownerUserId: actor.userId }), '拍摄项目工作台');
      },
    },
    'v1.shoot-sessions.create': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        try {
          const input = params(ctx); const timestamp = now();
          const session: ShootSession = {
            id: id('shoot-session'), tenantId: actor.tenantId, ownerUserId: actor.userId, visibility: 'private', status: 'planned',
            title: requiredString(input, 'title', '拍摄项目标题'), plannedFor: optionalString(input, 'plannedFor'),
            location: {
              latitude: coordinate(input, 'latitude', -90, 90), longitude: coordinate(input, 'longitude', -180, 180),
              publicLabel: optionalString(input, 'publicLabel'), accessNotes: optionalString(input, 'accessNotes'),
            },
            fieldObservations: optionalPlainTextArray(input, 'fieldObservations', 100, 1000), checklist: optionalPlainTextArray(input, 'checklist', 100, 240), shotIntent: optionalString(input, 'shotIntent'),
            hikeId: optionalOpaqueId(input, 'hikeId'), gearItemIds: optionalOpaqueIdArray(input, 'gearItemIds'), workIds: optionalOpaqueIdArray(input, 'workIds'), ledgerEntryIds: optionalOpaqueIdArray(input, 'ledgerEntryIds'),
            createdAt: timestamp, updatedAt: timestamp, resourceVersion: 0,
          };
          return success(repository.saveShootSession(session), '拍摄项目已创建', HttpStatusCode.CREATED);
        } catch (error: unknown) { return failure(error instanceof Error ? error.message : '创建拍摄项目失败'); }
      },
    },
    'v1.shoot-sessions.transition': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        try {
          const input = params(ctx); const session = repository.getShootSession(requiredString(input, 'id', '拍摄项目编号'));
          if (!session) return failure('未找到拍摄项目', HttpStatusCode.NOT_FOUND);
          if (!actorCanReadPrivate(actor, session)) return failure('无权管理该拍摄项目', HttpStatusCode.FORBIDDEN);
          const nextStatus = shootSessionStatus(input.status);
          if (!allowedShootSessionTransitions[session.status].includes(nextStatus)) throw new Error('当前拍摄项目状态不允许该转换');
          session.status = nextStatus; session.updatedAt = now();
          return success(repository.saveShootSession(session), '拍摄项目状态已更新');
        } catch (error: unknown) { return failure(error instanceof Error ? error.message : '更新拍摄项目状态失败'); }
      },
    },
    'v1.categories.workspace': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        const ownerUserId = creatorOwner(actor);
        return success(ownerUserId ? repository.listPortfolioCategories({ tenantId: actor.tenantId, ownerUserId }) : [], '作品分类工作台');
      },
    },
    'v1.categories.create': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        try {
          const input = params(ctx);
          const ownerUserId = creatorOwner(actor);
          if (!ownerUserId) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
          const slug = requiredSlug(input, 'slug');
          if (repository.getPortfolioCategoryBySlug({ tenantId: actor.tenantId, ownerUserId, slug })) throw new Error('slug已被当前创作空间使用');
          const timestamp = now();
          const category: PortfolioCategory = {
            id: id('portfolio-category'), tenantId: actor.tenantId, ownerUserId, slug,
            nameZh: requiredString(input, 'nameZh', '分类名称'), description: requiredString(input, 'description', '分类描述'),
            sortOrder: requiredNonNegativeInteger(input, 'sortOrder'), visibility: visibility(input), status: 'active', lifecycle: 'published',
            createdAt: timestamp, updatedAt: timestamp, resourceVersion: 0,
          };
          return success(repository.savePortfolioCategory(category), '作品分类已创建', HttpStatusCode.CREATED);
        } catch (error: unknown) { return failure(error instanceof Error ? error.message : '创建作品分类失败'); }
      },
    },
    'v1.categories.update': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        try {
          const input = params(ctx);
          const category = repository.getPortfolioCategory(requiredString(input, 'id', '分类编号'));
          if (!category) return failure('未找到作品分类', HttpStatusCode.NOT_FOUND);
          if (!categoryOwnedBy(category, actor)) return failure('无权修改该作品分类', HttpStatusCode.FORBIDDEN);
          const slug = requiredSlug(input, 'slug');
          const existing = repository.getPortfolioCategoryBySlug({ tenantId: category.tenantId, ownerUserId: category.ownerUserId, slug });
          if (existing && existing.id !== category.id) throw new Error('slug已被当前所有者使用');
          category.slug = slug;
          category.nameZh = requiredString(input, 'nameZh', '分类名称');
          category.description = requiredString(input, 'description', '分类描述');
          category.visibility = visibility(input);
          category.sortOrder = requiredNonNegativeInteger(input, 'sortOrder');
          category.updatedAt = now();
          return success(repository.savePortfolioCategory(category), '作品分类已更新');
        } catch (error: unknown) { return failure(error instanceof Error ? error.message : '更新作品分类失败'); }
      },
    },
    'v1.categories.archive': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        try {
          const category = repository.getPortfolioCategory(requiredString(params(ctx), 'id', '分类编号'));
          if (!category) return failure('未找到作品分类', HttpStatusCode.NOT_FOUND);
          if (!categoryOwnedBy(category, actor)) return failure('无权归档该作品分类', HttpStatusCode.FORBIDDEN);
          category.status = 'archived';
          category.updatedAt = now();
          return success(repository.savePortfolioCategory(category), '作品分类已归档；已有作品保留其历史分类关联');
        } catch (error: unknown) { return failure(error instanceof Error ? error.message : '归档作品分类失败'); }
      },
    },
    'v1.categories.reorder': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        try {
          const categoryIds = stringArray(params(ctx), 'categoryIds');
          if (hasDuplicateValues(categoryIds)) throw new Error('categoryIds不能包含重复分类');
          const categories = categoryIds.map((categoryId) => repository.getPortfolioCategory(categoryId));
          if (categories.some((category) => !categoryOwnedBy(category, actor) || category.status !== 'active')) throw new Error('categoryIds必须全部为当前所有者的活跃分类');
          const timestamp = now();
          const reordered = categories.filter(categoryOwnedByFor(actor)).map((category, index) => {
            category.sortOrder = index;
            category.updatedAt = timestamp;
            return repository.savePortfolioCategory(category);
          });
          return success(reordered, '作品分类排序已更新');
        } catch (error: unknown) { return failure(error instanceof Error ? error.message : '更新作品分类排序失败'); }
      },
    },
    'v1.portfolio.draft': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        try {
          const input = params(ctx);
          const ownerUserId = creatorOwner(actor);
          if (!ownerUserId) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
          const timestamp = now();
          const categoryId = optionalString(input, 'categoryId');
          const category = categoryId === undefined ? undefined : repository.getPortfolioCategory(categoryId);
          if (categoryId !== undefined && (!categoryOwnedBy(category, actor) || category.status !== 'active')) throw new Error('categoryId必须是当前所有者的活跃作品分类');
          const portfolio: Portfolio = {
            id: id('portfolio'), tenantId: actor.tenantId, ownerUserId, lifecycle: 'draft', visibility: visibility(input),
            title: requiredString(input, 'title', '作品集标题'), summary: requiredString(input, 'summary', '作品集简介'),
            categoryId, mediaIds: stringArray(input, 'mediaIds'), coverMediaId: optionalString(input, 'coverMediaId'), locationLabel: optionalString(input, 'locationLabel'), photoTechnicalMetadata: photoTechnicalMetadata(input), exhibitionPresentation: exhibitionPresentation(input),
            createdAt: timestamp, updatedAt: timestamp, resourceVersion: 0,
          };
          return success(repository.savePortfolio(portfolio), '作品集草稿已保存', HttpStatusCode.CREATED);
        } catch (error: unknown) { return failure(error instanceof Error ? error.message : '保存作品集草稿失败'); }
      },
    },
    'v1.portfolio.publish': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        const portfolio = repository.getPortfolio(String(params(ctx).id || ''));
        if (!portfolio) return failure('未找到作品集', HttpStatusCode.NOT_FOUND);
        if (!creatorManaged(actor, portfolio)) return failure('无权发布该作品集', HttpStatusCode.FORBIDDEN);
        portfolio.lifecycle = 'published'; portfolio.updatedAt = now();
        return success(repository.savePortfolio(portfolio), '作品集已发布');
      },
    },
    'v1.portfolio.metadata.workspace': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        try {
          const portfolio = repository.getPortfolio(requiredString(params(ctx), 'id', '作品集编号'));
          if (!portfolio) return failure('未找到作品集', HttpStatusCode.NOT_FOUND);
          if (!creatorManaged(actor, portfolio)) return failure('无权查看该作品集技术信息', HttpStatusCode.FORBIDDEN);
          return success({ id: portfolio.id, photoTechnicalMetadata: portfolio.photoTechnicalMetadata }, '作品集技术信息工作台');
        } catch (error: unknown) { return failure(error instanceof Error ? error.message : '查询作品集技术信息失败'); }
      },
    },
    'v1.portfolio.metadata.update': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        try {
          const input = params(ctx);
          const portfolio = repository.getPortfolio(requiredString(input, 'id', '作品集编号'));
          if (!portfolio) return failure('未找到作品集', HttpStatusCode.NOT_FOUND);
          if (!creatorManaged(actor, portfolio)) return failure('无权编辑该作品集技术信息', HttpStatusCode.FORBIDDEN);
          const metadata = photoTechnicalMetadata(input);
          if (!metadata) throw new Error('photoTechnicalMetadata不能为空');
          portfolio.photoTechnicalMetadata = metadata;
          portfolio.updatedAt = now();
          return success(repository.savePortfolio(portfolio), '作品集技术信息已更新');
        } catch (error: unknown) { return failure(error instanceof Error ? error.message : '更新作品集技术信息失败'); }
      },
    },
    'v1.journal.draft': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        try {
          const input = params(ctx); const timestamp = now();
          const ownerUserId = creatorOwner(actor);
          if (!ownerUserId) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
          const journal: Journal = {
            id: id('journal'), tenantId: actor.tenantId, ownerUserId, lifecycle: 'draft', visibility: visibility(input), isPinned: false,
            title: requiredString(input, 'title', '日记标题'), excerpt: requiredString(input, 'excerpt', '日记摘要'), body: requiredString(input, 'body', '日记正文'),
            coverMediaId: optionalString(input, 'coverMediaId'), createdAt: timestamp, updatedAt: timestamp, resourceVersion: 0,
          };
          return success(repository.saveJournal(journal), '日记草稿已保存', HttpStatusCode.CREATED);
        } catch (error: unknown) { return failure(error instanceof Error ? error.message : '保存日记草稿失败'); }
      },
    },
    'v1.journal.publish': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        const journal = repository.getJournal(String(params(ctx).id || ''));
        if (!journal) return failure('未找到日记', HttpStatusCode.NOT_FOUND);
        if (!creatorManaged(actor, journal)) return failure('无权发布该日记', HttpStatusCode.FORBIDDEN);
        journal.lifecycle = 'published'; journal.publishedAt = now(); journal.updatedAt = journal.publishedAt;
        return success(repository.saveJournal(journal), '日记已发布');
      },
    },
    'v1.hikes': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        try {
          const input = params(ctx); const timestamp = now();
          const provider = requiredString(input, 'routeProvider', '路线来源');
          const externalId = requiredString(input, 'routeId', '路线编号');
          const hike: Hike = {
            id: id('hike'), tenantId: actor.tenantId, ownerUserId: actor.userId, lifecycle: 'draft', visibility: visibility(input),
            title: requiredString(input, 'title', '徒步标题'), startedAt: requiredString(input, 'startedAt', '开始时间'),
            distanceKm: optionalNumber(input, 'distanceKm'), elevationGainM: optionalNumber(input, 'elevationGainM'),
            route: { provider, externalId, label: optionalString(input, 'routeLabel') || externalId }, privateGeometry: optionalString(input, 'privateGeometry'),
            createdAt: timestamp, updatedAt: timestamp, resourceVersion: 0,
          };
          return success(repository.saveHike(hike), '徒步记录已保存', HttpStatusCode.CREATED);
        } catch (error: unknown) { return failure(error instanceof Error ? error.message : '保存徒步记录失败'); }
      },
    },
    'v1.gear.packing-summary': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        const gear = repository.listGear({ tenantId: actor.tenantId, ownerUserId: actor.userId }).filter((item) => item.active);
        const plans = repository.listPackingPlans({ tenantId: actor.tenantId, ownerUserId: actor.userId });
        return success({ inventoryWeightGrams: gear.reduce((sum, item) => sum + item.weightGrams * item.quantity, 0), plans }, '装备与打包重量汇总');
      },
    },
    'v1.finance.overview': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        const entries = repository.listFinanceEntries({ tenantId: actor.tenantId, ownerUserId: actor.userId });
        const totalsByCurrency = entries.reduce<Record<string, number>>((totals, entry) => {
          totals[entry.currency] = (totals[entry.currency] || 0) + entry.amountCents;
          return totals;
        }, {});
        return success({ entryCount: entries.length, totalsByCurrency }, '私有财务概览');
      },
    },
    'v1.shares.create': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        try {
          if (!state.recipientDirectory) return failure('共享接收者目录当前未配置', HttpStatusCode.SERVICE_UNAVAILABLE);
          const input = params(ctx); const resourceType = shareableResourceType(input.resourceType); const resourceId = requiredString(input, 'resourceId', '共享资源编号');
          if (!shareOwnedByActor(repository, actor, resourceType, resourceId)) return failure('无权共享该资源', HttpStatusCode.FORBIDDEN);
          const recipientUserId = requiredString(input, 'recipientUserId', '接收用户编号');
          if (recipientUserId === actor.userId) throw new Error('不能向自己创建共享授权');
          if (!await state.recipientDirectory.isAuthenticatedMember({ tenantId: actor.tenantId, userId: recipientUserId })) return failure('接收用户不存在或不属于当前租户', HttpStatusCode.NOT_FOUND);
          const expiresAt = optionalString(input, 'expiresAt');
          if (expiresAt !== undefined && !isIsoInstant(expiresAt)) throw new Error('expiresAt必须是ISO UTC时间');
          if (expiresAt !== undefined && expiresAt <= now()) throw new Error('expiresAt必须晚于当前时间');
          const duplicate = repository.listShareGrants({ tenantId: actor.tenantId, ownerUserId: actor.userId, recipientUserId, resourceType, resourceId }).find((grant) => isActiveShare(grant, now()));
          if (duplicate) return success({ id: duplicate.id }, '该用户已拥有有效共享授权');
          const grant: TrailsShareGrant = { id: id('trails-share'), tenantId: actor.tenantId, ownerUserId: actor.userId, recipientUserId, resourceType, resourceId, expiresAt, createdAt: now() };
          return success(repository.saveShareGrant(grant), '共享授权已创建', HttpStatusCode.CREATED);
        } catch (error: unknown) { return failure(error instanceof Error ? error.message : '创建共享授权失败'); }
      },
    },
    'v1.shares.revoke': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        try {
          const grant = repository.getShareGrant(requiredString(params(ctx), 'id', '共享授权编号'));
          if (!grant) return failure('未找到共享授权', HttpStatusCode.NOT_FOUND);
          if (grant.tenantId !== actor.tenantId || grant.ownerUserId !== actor.userId) return failure('无权撤销该共享授权', HttpStatusCode.FORBIDDEN);
          if (!grant.revokedAt) grant.revokedAt = now();
          repository.saveShareGrant(grant);
          return success({ id: grant.id, revokedAt: grant.revokedAt }, '共享授权已撤销');
        } catch (error: unknown) { return failure(error instanceof Error ? error.message : '撤销共享授权失败'); }
      },
    },
    'v1.shares.inbox': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        const timestamp = now();
        const shared = repository.listShareGrants({ tenantId: actor.tenantId, recipientUserId: actor.userId })
          .filter((grant) => isActiveShare(grant, timestamp)).flatMap((grant) => {
            const projection = sharedResourceProjection(repository, grant);
            return projection ? [projection] : [];
          });
        return success(shared, '已授权的路线与装备内容');
      },
    },
    'v1.trips.public': {
      metadata: { auth: false },
      async handler(): Promise<HttpResponseItem> {
        return success(repository.listGuidedTripPlans({ visibility: 'public', lifecycle: 'published' }).filter(publicTripVisible).map(publicTrip), '公开带队拍摄行程');
      },
    },
    'v1.trips.public-detail': {
      metadata: { auth: false },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const trip = repository.getGuidedTripPlan(requiredString(params(ctx), 'id', '行程编号'));
          return publicTripVisible(trip) ? success(publicTrip(trip), '公开带队拍摄行程详情') : failure('未找到公开行程', HttpStatusCode.NOT_FOUND);
        } catch (error: unknown) { return failure(error instanceof Error ? error.message : '查询公开行程失败'); }
      },
    },
    'v1.trips.create': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
          const actor = requireActor(ctx);
          if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
          try {
          const ownerUserId = creatorOwner(actor);
          if (!ownerUserId) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
          const input = params(ctx); const timestamp = now(); const planStatus = tripPlanStatus(input.planStatus);
          const plan: GuidedTripPlan = {
            id: id('guided-trip'), tenantId: actor.tenantId, ownerUserId, title: requiredString(input, 'title', '行程标题'), summary: requiredString(input, 'summary', '行程简介'), publicLocationLabel: requiredString(input, 'publicLocationLabel', '公开地点'), startsOn: requiredString(input, 'startsOn', '开始日期'), endsOn: requiredString(input, 'endsOn', '结束日期'), capacity: requiredNonNegativeInteger(input, 'capacity'), planStatus,
            contingencyStatus: 'normal', publicItinerary: itinerary(input.publicItinerary), checklist: stringArray(input, 'checklist'), publicMaterialReferences: materialReferences(input.publicMaterialReferences), privateOperationalNotes: optionalString(input, 'privateOperationalNotes'), visibility: visibility(input), lifecycle: planStatus === 'open' ? 'published' : 'draft', createdAt: timestamp, updatedAt: timestamp, resourceVersion: 0,
          };
          return success(repository.saveGuidedTripPlan(plan), '带队拍摄计划已创建', HttpStatusCode.CREATED);
        } catch (error: unknown) { return failure(error instanceof Error ? error.message : '创建带队拍摄计划失败'); }
      },
    },
    'v1.trips.update-status': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        try {
          const input = params(ctx); const trip = repository.getGuidedTripPlan(requiredString(input, 'id', '行程编号'));
          if (!trip) return failure('未找到行程', HttpStatusCode.NOT_FOUND);
          if (!creatorManaged(actor, trip)) return failure('无权管理该行程', HttpStatusCode.FORBIDDEN);
          const nextStatus = tripPlanStatus(input.planStatus);
          if (!allowedTripPlanTransitions[trip.planStatus].includes(nextStatus)) throw new Error('当前行程状态不允许该转换');
          if (trip.contingencyStatus === 'cancelled') throw new Error('已取消的应急状态不能重新开放行程');
          trip.planStatus = nextStatus; trip.lifecycle = tripLifecycleForStatus(nextStatus); trip.updatedAt = now();
          return success(repository.saveGuidedTripPlan(trip), '行程状态已更新');
        } catch (error: unknown) { return failure(error instanceof Error ? error.message : '更新行程状态失败'); }
      },
    },
    'v1.trips.update-contingency': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        try {
          const input = params(ctx); const trip = repository.getGuidedTripPlan(requiredString(input, 'id', '行程编号'));
          if (!trip) return failure('未找到行程', HttpStatusCode.NOT_FOUND);
          if (!creatorManaged(actor, trip)) return failure('无权管理该行程', HttpStatusCode.FORBIDDEN);
          if (terminalTripPlanStatuses.includes(trip.planStatus)) throw new Error('终态行程不能更新应急状态');
          if (input.contingencyStatus !== 'normal' && input.contingencyStatus !== 'weather-watch' && input.contingencyStatus !== 'weather-contingency' && input.contingencyStatus !== 'cancelled') throw new Error('contingencyStatus无效');
          trip.contingencyStatus = input.contingencyStatus; trip.publicContingencyMessage = optionalString(input, 'publicContingencyMessage');
          if (trip.contingencyStatus === 'cancelled') {
            trip.planStatus = 'cancelled';
            trip.lifecycle = tripLifecycleForStatus('cancelled');
          }
          trip.updatedAt = now();
          return success(repository.saveGuidedTripPlan(trip), '行程天气/取消状态已更新');
        } catch (error: unknown) { return failure(error instanceof Error ? error.message : '更新行程状态失败'); }
      },
    },
    'v1.trips.register': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        try {
          const input = params(ctx); const trip = repository.getGuidedTripPlan(requiredString(input, 'tripPlanId', '行程编号'));
          if (!publicTripVisible(trip) || trip.planStatus !== 'open' || trip.contingencyStatus === 'cancelled') return failure('该行程当前不接受报名', HttpStatusCode.NOT_FOUND);
          if (repository.getGuidedTripRegistrationForParticipant({ tenantId: actor.tenantId, tripPlanId: trip.id, participantUserId: actor.userId })) return failure('当前账号已报名该行程', HttpStatusCode.CONFLICT);
          if (input.requiredAcknowledgement !== true || input.releaseAccepted !== true) throw new Error('必须确认必要说明并接受发布版本声明');
          const timestamp = now(); const full = reservedCapacity(repository.listGuidedTripRegistrations({ tenantId: actor.tenantId, tripPlanId: trip.id })) >= trip.capacity;
          const registration: GuidedTripRegistration = { id: id('guided-trip-registration'), tenantId: actor.tenantId, tripPlanId: trip.id, participantUserId: actor.userId, status: full ? 'waitlisted' : 'submitted', contactPreference: optionalString(input, 'contactPreference'), requiredAcknowledgementAcceptedAt: timestamp, releaseAcceptedAt: timestamp, releaseVersion: requiredString(input, 'releaseVersion', '声明版本'), createdAt: timestamp, updatedAt: timestamp, resourceVersion: 0 };
          return success(repository.saveGuidedTripRegistration(registration), full ? '行程已满，已加入候补名单' : '报名申请已提交', HttpStatusCode.CREATED);
        } catch (error: unknown) { return failure(error instanceof Error ? error.message : '提交报名失败'); }
      },
    },
    'v1.trips.registration-status': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        try {
          const input = params(ctx); const registration = repository.getGuidedTripRegistration(requiredString(input, 'registrationId', '报名编号'));
          if (!registration) return failure('未找到报名', HttpStatusCode.NOT_FOUND);
          const trip = repository.getGuidedTripPlan(registration.tripPlanId);
            if (!trip || !creatorManaged(actor, trip)) return failure('无权管理该报名', HttpStatusCode.FORBIDDEN);
           if (terminalTripPlanStatuses.includes(trip.planStatus)) throw new Error('终态行程不能更新报名状态');
           const nextStatus = registrationStatus(input.status);
          if (!allowedRegistrationTransitions[registration.status].includes(nextStatus)) throw new Error('当前报名状态不允许该转换');
          if ((nextStatus === 'approved-awaiting-payment' || nextStatus === 'confirmed') && reservedCapacity(repository.listGuidedTripRegistrations({ tenantId: registration.tenantId, tripPlanId: registration.tripPlanId })) >= trip.capacity && !reservedStatuses.includes(registration.status)) return failure('行程容量已满，不能确认或批准更多参与者', HttpStatusCode.CONFLICT);
          registration.status = nextStatus; registration.updatedAt = now();
          return success(repository.saveGuidedTripRegistration(registration), '报名状态已更新');
        } catch (error: unknown) { return failure(error instanceof Error ? error.message : '更新报名状态失败'); }
      },
    },
    'v1.trips.my-registration': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        try {
          const registration = repository.getGuidedTripRegistration(requiredString(params(ctx), 'registrationId', '报名编号'));
          if (!registrationForActor(registration, actor)) return failure('未找到当前账号的报名', HttpStatusCode.NOT_FOUND);
          return success(registration, '当前账号报名状态');
        } catch (error: unknown) { return failure(error instanceof Error ? error.message : '查询报名失败'); }
      },
    },
    'v1.trips.owner-summary': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        try {
          const trip = repository.getGuidedTripPlan(requiredString(params(ctx), 'tripPlanId', '行程编号'));
          if (!trip) return failure('未找到行程', HttpStatusCode.NOT_FOUND);
          if (!creatorManaged(actor, trip)) return failure('无权查看该行程运营摘要', HttpStatusCode.FORBIDDEN);
          const registrations = repository.listGuidedTripRegistrations({ tenantId: trip.tenantId, tripPlanId: trip.id });
          const statuses: GuidedTripRegistrationStatus[] = ['submitted', 'waitlisted', 'approved-awaiting-payment', 'confirmed', 'rejected', 'cancelled'];
          const registrationCounts = statuses.reduce<Record<GuidedTripRegistrationStatus, number>>((counts, status) => ({ ...counts, [status]: registrations.filter((registration) => registration.status === status).length }), {} as Record<GuidedTripRegistrationStatus, number>);
          const reserved = reservedCapacity(registrations);
          return success({ trip, registrationCounts, reservedCapacity: reserved, remainingCapacity: Math.max(0, trip.capacity - reserved) }, '所有者行程运营摘要');
        } catch (error: unknown) { return failure(error instanceof Error ? error.message : '查询行程运营摘要失败'); }
      },
    },
    'v1.sync.pull': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        try {
          const input = params(ctx);
          const scope: SyncScope = input.scope === 'owner-finance' ? 'owner-finance' : 'owner';
          const cursor = optionalString(input, 'cursor');
          return success({ contractVersion: 1, scope, ...repository.pullChanges(actor, cursor, scope) }, '所有者同步变更');
        } catch (error: unknown) { return failure(error instanceof Error ? error.message : '拉取同步变更失败'); }
      },
    },
    'v1.sync.push': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        try {
          if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
          const mutation = syncMutation(params(ctx));
          if (mutation.baseVersion === null && (mutation.payload.slug === undefined || mutation.payload.nameZh === undefined)) throw new Error('新分类同步变更必须包含payload.slug和payload.nameZh');
          const result = repository.pushMutation(actor, mutation);
          return result.kind === 'conflict'
            ? failure('资源已在另一设备更新；请基于current手动解决冲突', HttpStatusCode.CONFLICT, result)
            : success(result, result.kind === 'duplicate' ? '重复同步变更已安全重放' : '同步变更已应用');
        } catch (error: unknown) { return failure(error instanceof Error ? error.message : '提交同步变更失败'); }
      },
    },
    /**
     * v2 is a category-only durable wire contract. It uses decimal-string BIGINT versions/cursors
     * and never dual-writes to, reads from, or falls back to the v1 in-memory repository.
     */
    'v2.category-sync.pull': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
        const durablePortfolioCategorySync = state.durablePortfolioCategorySync;
        if (!durablePortfolioCategorySync) return failure('耐久分类同步当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try {
          return success(await durablePortfolioCategorySync.pull(actor, durableCursor(params(ctx))), '耐久作品分类同步变更');
        } catch (error: unknown) { return durableCategoryFailure(error); }
      },
    },
    'v2.category-sync.push': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
        const durablePortfolioCategorySync = state.durablePortfolioCategorySync;
        if (!durablePortfolioCategorySync) return failure('耐久分类同步当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try {
          const mutation = durableCategoryMutation(params(ctx));
          if (mutation.baseVersion === null && (mutation.payload.slug === undefined || mutation.payload.nameZh === undefined)) throw new TrailsSyncInputError('新分类同步变更必须包含payload.slug和payload.nameZh');
          const result = await durablePortfolioCategorySync.push(actor, mutation);
          return result.kind === 'conflict'
            ? failure('资源已在另一设备更新；请基于current手动解决冲突', HttpStatusCode.CONFLICT, result)
            : success(result, result.kind === 'duplicate' ? '重复耐久同步变更已安全重放' : '耐久同步变更已应用');
        } catch (error: unknown) { return durableCategoryFailure(error); }
      },
    },
    /** Durable category management is intentionally parallel to, and never backed by, v1 memory. */
    'v2.categories.workspace': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
        const durable = state.durablePortfolioCategorySync;
        if (!durable) return failure('耐久分类当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try { return success(await durable.listWorkspace(actor), '耐久作品分类工作台'); } catch (error: unknown) { return durableCategoryFailure(error); }
      },
    },
    'v2.categories.public': {
      metadata: { auth: false },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const durable = state.durablePortfolioCategorySync;
        if (!durable) return failure('耐久分类当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try {
          const owner = publicOwnerResolver.resolve();
          if (!owner) return failure('未找到公开站点', HttpStatusCode.NOT_FOUND);
          return success((await durable.listPublic({ tenantId: owner.tenantId, userId: owner.ownerUserId })).filter((category) => category.visibility === 'public' && category.status === 'active' && category.lifecycle === 'published').map((category) => ({ id: category.id, slug: category.slug, nameZh: category.nameZh, description: category.description, sortOrder: category.sortOrder })), '公开耐久作品分类');
        } catch (error: unknown) { return durableCategoryFailure(error); }
      },
    },
    'v2.categories.create': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
        const durable = state.durablePortfolioCategorySync;
        if (!durable) return failure('耐久分类当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try {
          const input = params(ctx); const resourceId = id('portfolio-category');
          const result = await durable.create(actor, durableCategoryWrite(input, resourceId, null));
          invalidatePublic(actor, ['categories', 'portfolios']);
          return success(result, '耐久作品分类已创建', HttpStatusCode.CREATED);
        } catch (error: unknown) { return durableCategoryFailure(error); }
      },
    },
    'v2.categories.update': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
        const durable = state.durablePortfolioCategorySync;
        if (!durable) return failure('耐久分类当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try {
          const input = params(ctx); const result = await durable.push(actor, durableCategoryWrite(input, requiredString(input, 'id', '分类编号'), durableCategoryVersion(input)));
          if (result.kind === 'conflict') return failure('分类已被更新；请基于current重试', HttpStatusCode.CONFLICT, result);
          invalidatePublic(actor, ['categories', 'portfolios']);
          return success(result, '耐久作品分类已更新');
        } catch (error: unknown) { return durableCategoryFailure(error); }
      },
    },
    'v2.categories.archive': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
        const durable = state.durablePortfolioCategorySync;
        if (!durable) return failure('耐久分类当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try {
          const input = params(ctx); const result = await durable.archive(actor, durableCategoryWrite(input, requiredString(input, 'id', '分类编号'), durableCategoryVersion(input)));
          if (result.kind === 'conflict') return failure('分类已被更新；请基于current重试', HttpStatusCode.CONFLICT, result);
          invalidatePublic(actor, ['categories', 'portfolios']);
          return success(result, '耐久作品分类已归档');
        } catch (error: unknown) { return durableCategoryFailure(error); }
      },
    },
    'v2.categories.reorder': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
        const durable = state.durablePortfolioCategorySync;
        if (!durable) return failure('耐久分类当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try {
          const result = await durable.reorder(actor, durableReorderMutations(params(ctx)));
          const conflict = result.find((entry) => entry.kind === 'conflict');
          if (conflict) return failure('分类已被更新；请基于current重试', HttpStatusCode.CONFLICT, conflict);
          invalidatePublic(actor, ['categories', 'portfolios']);
          return success(result, '耐久作品分类已重排序');
        } catch (error: unknown) { return durableCategoryFailure(error); }
      },
    },
    /** Durable portfolio v2 is intentionally separate from v1 and has a server-owned lifecycle. */
    'v2.media-assets.workspace-picker': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
        const durable = state.durableMediaAssetRegistryStore;
        if (!durable) return failure('耐久媒体资产注册表当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try { return success(await durable.listWorkspacePicker(actor), '耐久媒体资产选择器'); } catch (error: unknown) { return durableMediaRegistryFailure(error); }
      },
    },
    /** Browser uploads can only target a short-lived, server-derived COS staging session. */
    'v2.media-ingestion.upload-session': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
        try {
          trustedPhotoshopUploadRequest(params(ctx));
          return success(new TencentCosTrustedPhotoshopPackageTransfer().createUploadSession(actor), 'Photoshop发布包上传会话已创建');
        } catch (error: unknown) {
          return error instanceof TrailsSyncInputError
            ? failure(error.message, HttpStatusCode.BAD_REQUEST)
            : failure('媒体上传当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        }
      },
    },
    'v2.media-ingestion.complete-upload': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
        const operations = state.trustedPhotoshopIngestionOperationStore;
        const registry = state.durableMediaAssetRegistryStore;
        const publicationJobs = state.publicDerivativePublicationJobStore;
        if (!operations || !registry || !publicationJobs) return failure('媒体导入当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try {
          const uploadSession = trustedPhotoshopUploadCompletion(params(ctx));
          const transfer = new TencentCosTrustedPhotoshopPackageTransfer();
          const uploaded = await transfer.completeUpload(actor, uploadSession);
          enqueueTrustedPhotoshopIngestion(uploaded.operationId, async () => {
            await ingestTrustedPhotoshopPublication({
              actor, operationId: uploaded.operationId, ownerUserId: uploaded.ownerUserId, assetId: uploaded.assetId,
              workerId: `photoshop-ingestion-${process.pid}`, leaseMs: 120_000, entries: uploaded.entries,
            }, operations, new TencentCosTrustedPhotoshopIngestionPrivateStorage(), registry, publicationJobs);
            await transfer.removeCompletedUpload(uploadSession);
          });
          // Keep the established bridge DTO for already-installed workspace
          // versions. The message carries the asynchronous processing state.
          return success({ operationId: uploaded.operationId, assetId: uploaded.assetId, phase: 'completed', assetStatus: 'draft' }, 'Photoshop发布包已验证，正在后台生成衍生图并进入公开交付队列', HttpStatusCode.CREATED);
        } catch (error: unknown) {
          return error instanceof TrailsSyncInputError
            ? failure(error.message, HttpStatusCode.BAD_REQUEST)
            : failure('媒体导入当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        }
      },
    },
    'v2.media-ingestion.workspace': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        const ownerUserId = creatorOwner(actor);
        if (!ownerUserId) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
        const operations = state.trustedPhotoshopIngestionOperationStore;
        if (!operations) return failure('媒体导入状态当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try {
          const items = await operations.listRecent({ tenantId: actor.tenantId, ownerUserId, limit: 12 });
          return success(items.map(item => ({ operationId: item.operationId, assetId: item.assetId, phase: item.phase, ...(item.failureClass ? { failureClass: item.failureClass } : {}), createdAt: item.createdAt, updatedAt: item.updatedAt })), 'Photoshop导入任务');
        } catch { return failure('媒体导入状态当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); }
      },
    },
    'v2.media-assets.public': {
      metadata: { auth: false },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const durable = state.durableMediaAssetRegistryStore;
        if (!durable) return failure('耐久媒体资产注册表当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        const owner = publicOwnerResolver.resolve();
        if (!owner) return failure('未找到公开站点', HttpStatusCode.NOT_FOUND);
        try {
          return success((await durable.listPublic({ tenantId: owner.tenantId, userId: owner.ownerUserId })).map(asset => ({
            id: asset.id,
            renditions: asset.renditions.map(({ reference, width, height }) => ({ reference, width, height })),
          })), '公开媒体资产');
        } catch (error: unknown) { return durableMediaRegistryFailure(error); }
      },
    },
    'v2.portfolios.workspace': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
        const durable = state.durablePortfolioStore;
        if (!durable) return failure('耐久作品集当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try { return success(await durable.listWorkspace(actor), '耐久作品集工作台'); } catch (error: unknown) { return durablePortfolioFailure(error); }
      },
    },
    'v2.portfolios.draft': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
        const durable = state.durablePortfolioStore;
        if (!durable) return failure('耐久作品集当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try { return success(await durable.createDraft(actor, durablePortfolioDraft(params(ctx), id('portfolio'))), '耐久作品集草稿已保存', HttpStatusCode.CREATED); } catch (error: unknown) { return durablePortfolioFailure(error); }
      },
    },
    'v2.portfolios.publish': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
        const durable = state.durablePortfolioStore;
        if (!durable) return failure('耐久作品集当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try { const input = params(ctx); return success(await durable.publish(actor, { id: requiredString(input, 'id', '作品集编号'), resourceVersion: canonicalDecimalString(input.resourceVersion, 'resourceVersion') }), '耐久作品集已发布'); } catch (error: unknown) { return durablePortfolioFailure(error); }
      },
    },
    'v2.portfolios.update': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
        const durable = state.durablePortfolioStore; if (!durable) return failure('耐久作品集当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try { return success(await durable.update(actor, durablePortfolioUpdate(params(ctx))), '耐久作品集已更新'); } catch (error: unknown) { return durablePortfolioFailure(error); }
      },
    },
    'v2.portfolios.unpublish': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
        const durable = state.durablePortfolioStore; if (!durable) return failure('耐久作品集当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try { const input = params(ctx); return success(await durable.unpublish(actor, { id: requiredString(input, 'id', '作品集编号'), resourceVersion: canonicalDecimalString(input.resourceVersion, 'resourceVersion') }), '耐久作品集已取消发布'); } catch (error: unknown) { return durablePortfolioFailure(error); }
      },
    },
    'v2.portfolios.public': {
      metadata: { auth: false },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const durable = state.durablePortfolioStore;
        if (!durable) return failure('耐久作品集当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try {
          const owner = publicOwnerResolver.resolve();
          if (!owner) return failure('未找到公开站点', HttpStatusCode.NOT_FOUND);
          const categorySlug = optionalSlug(params(ctx), 'categorySlug');
          const categories = state.durablePortfolioCategorySync;
          if (categorySlug !== undefined && !categories) return failure('耐久分类当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
          if (categorySlug === undefined) {
            const portfolios = await durable.listPublic({ tenantId: owner.tenantId, userId: owner.ownerUserId });
            const publicPortfolios = portfolios.filter((portfolio) => portfolio.visibility === 'public' && portfolio.lifecycle === 'published');
            const documents = state.durableRichDocumentStore;
            return success(await Promise.all(publicPortfolios.map(async portfolio => ({ ...publicDurablePortfolio(portfolio), ...publicRichContent((await documents?.readPublic({ tenantId: owner.tenantId, userId: owner.ownerUserId }, { subjectType: 'portfolio', subjectId: portfolio.id }))?.document) }))), '公开耐久作品集');
          }
          if (!categories) return failure('耐久分类当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
          const category = await categories.resolvePublic({ tenantId: owner.tenantId, userId: owner.ownerUserId }, categorySlug);
          if (!category) return failure('未找到公开作品分类', HttpStatusCode.NOT_FOUND);
          const portfolios = await durable.listPublic({ tenantId: owner.tenantId, userId: owner.ownerUserId }, category.id);
          const publicPortfolios = portfolios.filter((portfolio) => portfolio.visibility === 'public' && portfolio.lifecycle === 'published');
          const documents = state.durableRichDocumentStore;
          return success(await Promise.all(publicPortfolios.map(async portfolio => ({ ...publicDurablePortfolio(portfolio), ...publicRichContent((await documents?.readPublic({ tenantId: owner.tenantId, userId: owner.ownerUserId }, { subjectType: 'portfolio', subjectId: portfolio.id }))?.document) }))), '公开耐久作品集');
        } catch (error: unknown) { return durablePortfolioFailure(error); }
      },
    },
    'v2.exhibitions.workspace': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
        const durable = state.durableExhibitionThemeStore; if (!durable) return failure('耐久展览主题当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try { return success((await durable.listWorkspace(actor)).map(workspaceExhibitionTheme), '耐久展览主题工作台'); } catch (error: unknown) { return durableExhibitionThemeFailure(error); }
      },
    },
    'v2.exhibitions.workspace.mutate': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
        const durable = state.durableExhibitionThemeStore; if (!durable) return failure('耐久展览主题当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try { const mutation = durableExhibitionThemeMutation(params(ctx)) as import('../types').DurableExhibitionThemeMutation; return success(workspaceExhibitionTheme(await durable.mutate(actor, mutation)), mutation.operation === 'create' ? '耐久展览主题草稿已保存' : '耐久展览主题已更新', mutation.operation === 'create' ? HttpStatusCode.CREATED : HttpStatusCode.OK); } catch (error: unknown) { return durableExhibitionThemeFailure(error); }
      },
    },
    'v2.exhibitions.public': {
      metadata: { auth: false },
      async handler(): Promise<HttpResponseItem> {
        const durable = state.durableExhibitionThemeStore; if (!durable) return failure('耐久展览主题当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        const owner = publicOwnerResolver.resolve(); if (!owner) return failure('未找到公开站点', HttpStatusCode.NOT_FOUND);
        try { return success((await durable.listPublic({ tenantId: owner.tenantId, userId: owner.ownerUserId })).map(publicExhibitionTheme), '公开展览主题'); } catch (error: unknown) { return durableExhibitionThemeFailure(error); }
      },
    },
    'v2.portfolios.rich-document.read': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
        const durable = state.durableRichDocumentStore; if (!durable) return failure('耐久富文档当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try {
          const subject = richDocumentSubject(params(ctx), 'portfolio');
          const document = await durable.read(actor, subject);
          return success(document ?? emptyRichDocumentShell(subject.subjectType, subject.subjectId), '耐久作品集富文档');
        } catch (error: unknown) { return durableRichDocumentFailure(error); }
      },
    },
    'v2.portfolios.rich-document.save': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
        const durable = state.durableRichDocumentStore; if (!durable) return failure('耐久富文档当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try { const input = richDocumentSave(params(ctx), 'portfolio'); await authorizeRichDocumentMedia(actor, input.document, state.durableMediaAssetRegistryStore); const result = await durable.save(actor, input); return result.kind === 'conflict' ? failure('富文档已被更新；请基于current重试', HttpStatusCode.CONFLICT, result.current) : success(result.document, '耐久作品集富文档已保存'); } catch (error: unknown) { return durableRichDocumentFailure(error); }
      },
    },
    'v2.portfolios.rich-document.preview': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
        const durable = state.durableRichDocumentStore; if (!durable) return failure('耐久富文档当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try { const input = richDocumentPreview(params(ctx), 'portfolio'); await authorizeRichDocumentMedia(actor, input.document, state.durableMediaAssetRegistryStore); return success(await durable.preview(actor, input), '耐久作品集富文档预览'); } catch (error: unknown) { return durableRichDocumentFailure(error); }
      },
    },
    /** Durable journal v2 is intentionally separate from v1 and has a server-owned lifecycle. */
    'v2.journals.workspace': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
        const durable = state.durableJournalStore;
        if (!durable) return failure('耐久日记当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try { return success(await durable.listWorkspace(actor), '耐久日记工作台'); } catch (error: unknown) { return durableJournalFailure(error); }
      },
    },
    'v2.journals.draft': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
        const durable = state.durableJournalStore;
        if (!durable) return failure('耐久日记当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try { return success(await durable.createDraft(actor, durableJournalDraft(params(ctx), id('journal'))), '耐久日记草稿已保存', HttpStatusCode.CREATED); } catch (error: unknown) { return durableJournalFailure(error); }
      },
    },
    'v2.journals.publish': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
        const durable = state.durableJournalStore;
        if (!durable) return failure('耐久日记当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try { const input = params(ctx); return success(await durable.publish(actor, { id: requiredString(input, 'id', '日记编号'), resourceVersion: canonicalDecimalString(input.resourceVersion, 'resourceVersion') }), '耐久日记已发布'); } catch (error: unknown) { return durableJournalFailure(error); }
      },
    },
    'v2.journals.update': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
        const durable = state.durableJournalStore; if (!durable) return failure('耐久日记当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try { return success(await durable.update(actor, durableJournalUpdate(params(ctx))), '耐久日记已更新'); } catch (error: unknown) { return durableJournalFailure(error); }
      },
    },
    'v2.journals.unpublish': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
        const durable = state.durableJournalStore; if (!durable) return failure('耐久日记当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try { const input = params(ctx); return success(await durable.unpublish(actor, { id: requiredString(input, 'id', '日记编号'), resourceVersion: canonicalDecimalString(input.resourceVersion, 'resourceVersion') }), '耐久日记已取消发布'); } catch (error: unknown) { return durableJournalFailure(error); }
      },
    },
    'v2.journals.pin': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
        const durable = state.durableJournalStore; if (!durable) return failure('耐久日记当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try { const input = params(ctx); const keys = Object.keys(input); if (keys.length !== 3 || !keys.every(key => key === 'id' || key === 'resourceVersion' || key === 'isPinned')) return failure('置顶请求包含不允许字段', HttpStatusCode.BAD_REQUEST); if (typeof input.isPinned !== 'boolean') return failure('isPinned无效', HttpStatusCode.BAD_REQUEST); return success(await durable.setPinned(actor, { id: requiredString(input, 'id', '日记编号'), resourceVersion: canonicalDecimalString(input.resourceVersion, 'resourceVersion'), isPinned: input.isPinned }), input.isPinned ? '耐久日记已置顶' : '耐久日记已取消置顶'); } catch (error: unknown) { return durableJournalFailure(error); }
      },
    },
    'v2.journals.public': {
      metadata: { auth: false },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const durable = state.durableJournalStore;
        if (!durable) return failure('耐久日记当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try { const owner = (state.publicOwnerResolver || createPublicOwnerResolver()).resolve(); if (!owner) return failure('未找到公开站点', HttpStatusCode.NOT_FOUND); const journals = (await durable.listPublic({ tenantId: owner.tenantId, userId: owner.ownerUserId })).filter((journal) => journal.visibility === 'public' && journal.lifecycle === 'published'); const documents = state.durableRichDocumentStore; return success(await Promise.all(journals.map(async journal => ({ ...publicDurableJournal(journal), ...publicRichContent((await documents?.readPublic({ tenantId: owner.tenantId, userId: owner.ownerUserId }, { subjectType: 'journal', subjectId: journal.id }))?.document) }))), '公开耐久日记'); } catch (error: unknown) { return durableJournalFailure(error); }
      },
    },
    'v2.journals.public-detail': {
      metadata: { auth: false },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const durable = state.durableJournalStore;
        if (!durable) return failure('耐久日记当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        const journalId = publicJournalId(params(ctx));
        if (!journalId) return failure('未找到公开日记', HttpStatusCode.NOT_FOUND);
        try {
          const owner = (state.publicOwnerResolver || createPublicOwnerResolver()).resolve();
          if (!owner) return failure('未找到公开日记', HttpStatusCode.NOT_FOUND);
          const journal = (await durable.listPublic({ tenantId: owner.tenantId, userId: owner.ownerUserId }))
            .find((item) => item.id === journalId && item.tenantId === owner.tenantId && item.ownerUserId === owner.ownerUserId && item.visibility === 'public' && item.lifecycle === 'published');
          if (!journal) return failure('未找到公开日记', HttpStatusCode.NOT_FOUND);
          const document = await state.durableRichDocumentStore?.readPublic({ tenantId: owner.tenantId, userId: owner.ownerUserId }, { subjectType: 'journal', subjectId: journal.id });
          return success({ ...publicDurableJournal(journal), ...publicRichContent(document?.document) }, '公开耐久日记详情');
        } catch (error: unknown) { return durableJournalFailure(error); }
      },
    },
    'v2.journals.rich-document.read': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
        const durable = state.durableRichDocumentStore; if (!durable) return failure('耐久富文档当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try {
          const subject = richDocumentSubject(params(ctx), 'journal');
          const document = await durable.read(actor, subject);
          return success(document ?? emptyRichDocumentShell(subject.subjectType, subject.subjectId), '耐久日记富文档');
        } catch (error: unknown) { return durableRichDocumentFailure(error); }
      },
    },
    'v2.journals.rich-document.save': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
        const durable = state.durableRichDocumentStore; if (!durable) return failure('耐久富文档当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try { const input = richDocumentSave(params(ctx), 'journal'); await authorizeRichDocumentMedia(actor, input.document, state.durableMediaAssetRegistryStore); const result = await durable.save(actor, input); return result.kind === 'conflict' ? failure('富文档已被更新；请基于current重试', HttpStatusCode.CONFLICT, result.current) : success(result.document, '耐久日记富文档已保存'); } catch (error: unknown) { return durableRichDocumentFailure(error); }
      },
    },
    'v2.journals.rich-document.preview': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
        const durable = state.durableRichDocumentStore; if (!durable) return failure('耐久富文档当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try { const input = richDocumentPreview(params(ctx), 'journal'); await authorizeRichDocumentMedia(actor, input.document, state.durableMediaAssetRegistryStore); return success(await durable.preview(actor, input), '耐久日记富文档预览'); } catch (error: unknown) { return durableRichDocumentFailure(error); }
      },
    },
    /** Actor-owned field records are permanently private and never compose with v1 sharing. */
    'v2.hikes.workspace': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        const durable = state.durableHikeStore;
        if (!durable) return failure('耐久徒步记录当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try { return success((await durable.listWorkspace(actor)).map(workspaceHikeProjection), '耐久徒步记录工作台'); } catch (error: unknown) { return durableHikeFailure(error); }
      },
    },
    'v2.hikes.create': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        const durable = state.durableHikeStore;
        if (!durable) return failure('耐久徒步记录当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try { return success(workspaceHikeProjection(await durable.create(actor, durableHikeCreate(ctx, id('hike')))), '耐久徒步记录已保存', HttpStatusCode.CREATED); } catch (error: unknown) { return durableHikeFailure(error); }
      },
    },
    /** Actor-owned inventory is permanently private and does not use creator-space privileges. */
    'v2.gear.workspace': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        const durable = state.durableGearStore;
        if (!durable) return failure('耐久装备当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try { durableGearRequest(ctx, []); return success((await durable.listWorkspace(actor)).map(workspaceGearProjection), '耐久装备工作台'); } catch (error: unknown) { return durableGearFailure(error); }
      },
    },
    'v2.gear.create': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        const durable = state.durableGearStore;
        if (!durable) return failure('耐久装备当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try { return success(workspaceGearProjection(await durable.create(actor, durableGearCreate(ctx, id('gear')))), '耐久装备已保存', HttpStatusCode.CREATED); } catch (error: unknown) { return durableGearFailure(error); }
      },
    },
    'v2.gear.update': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        const durable = state.durableGearStore;
        if (!durable) return failure('耐久装备当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try { return success(workspaceGearProjection(await durable.update(actor, durableGearUpdate(ctx))), '耐久装备已更新'); } catch (error: unknown) { return durableGearFailure(error); }
      },
    },
    'v2.gear.deactivate': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        const durable = state.durableGearStore;
        if (!durable) return failure('耐久装备当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try { return success(workspaceGearProjection(await durable.deactivate(actor, durableGearDeactivate(ctx))), '耐久装备已停用'); } catch (error: unknown) { return durableGearFailure(error); }
      },
    },
    /** Actor-owned plans are permanently private and intentionally have no v1/share projection. */
    'v2.packing-plans.workspace': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        const durable = state.durablePackingPlanStore;
        if (!durable) return failure('耐久装包方案当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try { durablePackingPlanRequest(ctx, []); return success((await durable.listWorkspace(actor)).map(workspacePackingPlanProjection), '耐久装包方案工作台'); } catch (error: unknown) { return durablePackingPlanFailure(error); }
      },
    },
    'v2.packing-plans.create': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        const durable = state.durablePackingPlanStore;
        if (!durable) return failure('耐久装包方案当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try { return success(workspacePackingPlanProjection(await durable.create(actor, durablePackingPlanCreate(ctx, id('packing-plan')))), '耐久装包方案已保存', HttpStatusCode.CREATED); } catch (error: unknown) { return durablePackingPlanFailure(error); }
      },
    },
    'v2.packing-plans.update': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        const durable = state.durablePackingPlanStore;
        if (!durable) return failure('耐久装包方案当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try { return success(workspacePackingPlanProjection(await durable.update(actor, durablePackingPlanUpdate(ctx))), '耐久装包方案已更新'); } catch (error: unknown) { return durablePackingPlanFailure(error); }
      },
    },
    /** Private finance v2 has a dedicated store and no public, sync, receipt, session, or v1 path. */
    'v2.finance.workspace': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        const durable = state.durableFinanceStore;
        if (!durable) return failure('耐久财务账本当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try { durableFinanceRequest(ctx, []); return success((await durable.listWorkspace(actor)).map(workspaceFinanceEntryProjection), '耐久财务账本工作台'); } catch (error: unknown) { return durableFinanceFailure(error); }
      },
    },
    'v2.finance.create': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        const durable = state.durableFinanceStore;
        if (!durable) return failure('耐久财务账本当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try { return success(workspaceFinanceEntryProjection(await durable.create(actor, durableFinanceCreate(ctx, id('finance')))), '耐久财务账目已保存', HttpStatusCode.CREATED); } catch (error: unknown) { return durableFinanceFailure(error); }
      },
    },
    'v2.finance.update': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        const durable = state.durableFinanceStore;
        if (!durable) return failure('耐久财务账本当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try { return success(workspaceFinanceEntryProjection(await durable.update(actor, durableFinanceUpdate(ctx))), '耐久财务账目已更新'); } catch (error: unknown) { return durableFinanceFailure(error); }
      },
    },
    'v2.finance.balance.record': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        const durable = state.durableFinanceStore;
        if (!durable) return failure('耐久财务账本当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try { return success(workspaceFinanceBalanceProjection(await durable.recordBalance(actor, durableFinanceBalanceRecord(ctx, id('finance-balance')))), '耐久当前余额快照已保存', HttpStatusCode.CREATED); } catch (error: unknown) { return durableFinanceFailure(error); }
      },
    },
    'v2.finance.balance.current': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const actor = requireActor(ctx);
        if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED);
        const durable = state.durableFinanceStore;
        if (!durable) return failure('耐久财务账本当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
        try { return success((await durable.currentBalances(actor, durableFinanceBalanceCurrency(ctx))).map(workspaceFinanceBalanceProjection), '耐久当前余额快照'); } catch (error: unknown) { return durableFinanceFailure(error); }
      },
    },
    /** Vendor-disabled v2 commerce: all effects are durable manual facts, never provider calls. */
    'v2.commerce.public': { metadata: { auth: false }, async handler(): Promise<HttpResponseItem> { const durable = state.durableMediaCommerceStore; if (!durable) return failure('耐久媒体商业当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); const owner = (state.publicOwnerResolver || createPublicOwnerResolver()).resolve(); if (!owner) return failure('未找到公开站点', HttpStatusCode.NOT_FOUND); try { return success(commercePublic(await durable.listPublic({ tenantId: owner.tenantId, userId: owner.ownerUserId })), '公开媒体和可售版次'); } catch (error: unknown) { return durableCommerceFailure(error); } } },
    'v2.commerce.catalog.workspace': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN); const durable = state.durableMediaCommerceStore; if (!durable) return failure('耐久媒体商业当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { catalogInput(ctx, []); return success(workspaceCatalogProjection(await durable.listOwner(actor)), '媒体目录工作台'); } catch (error: unknown) { return durableCommerceFailure(error); } } },
    'v2.commerce.catalog.media.create': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN); const durable = state.durableMediaCommerceStore; const registry = state.durableMediaAssetRegistryStore; if (!durable || !registry) return failure('耐久媒体商业当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = catalogInput(ctx, ['assetId', 'title', 'summary', 'mutationId', 'expectedResourceVersion']); const mutation = commerceMutation(input); const assetId = requiredString(input, 'assetId', '媒体资产编号'); const asset = (await registry.listWorkspacePicker(actor)).find(item => item.id === assetId); if (!asset) throw new TrailsSyncInputError('媒体资产不存在或尚未准备就绪'); const media = await durable.createMedia(actor, { ...mutation, id: commerceCreatedId('commerce-media', mutation.mutationId), title: requiredString(input, 'title', '标题'), summary: requiredString(input, 'summary', '简介'), derivativeReferences: asset.renditions.map(rendition => ({ reference: rendition.reference, width: rendition.width, height: rendition.height })) }); return success(catalogMediaProjection(media), '媒体草稿已保存', HttpStatusCode.CREATED); } catch (error: unknown) { return durableCommerceFailure(error); } } },
    'v2.commerce.catalog.media.update': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN); const durable = state.durableMediaCommerceStore; if (!durable) return failure('耐久媒体商业当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = catalogInput(ctx, ['id', 'title', 'summary', 'mutationId', 'expectedResourceVersion']); const media = await durable.updateMedia(actor, { ...commerceMutation(input), id: commerceId(input, '媒体编号'), title: requiredString(input, 'title', '标题'), summary: requiredString(input, 'summary', '简介') }); return success(catalogMediaProjection(media), '媒体元数据已更新'); } catch (error: unknown) { return durableCommerceFailure(error); } } },
    'v2.commerce.catalog.media.transition': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN); const durable = state.durableMediaCommerceStore; if (!durable) return failure('耐久媒体商业当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = catalogInput(ctx, ['id', 'status', 'mutationId', 'expectedResourceVersion']); if (input.status !== 'published' && input.status !== 'withdrawn') throw new TrailsSyncInputError('媒体状态无效'); return success(catalogMediaProjection(await durable.transitionMedia(actor, { ...commerceMutation(input), id: commerceId(input, '媒体编号'), status: input.status })), '媒体状态已更新'); } catch (error: unknown) { return durableCommerceFailure(error); } } },
    'v2.commerce.catalog.editions.create': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN); const durable = state.durableMediaCommerceStore; if (!durable) return failure('耐久媒体商业当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = catalogInput(ctx, ['mediaId', 'title', 'description', 'mutationId', 'expectedResourceVersion']); const mutation = commerceMutation(input); const edition = await durable.createEdition(actor, { ...mutation, id: commerceCreatedId('print-edition', mutation.mutationId), mediaId: requiredString(input, 'mediaId', '媒体编号'), title: requiredString(input, 'title', '标题'), description: requiredString(input, 'description', '说明'), currency: 'USD', priceMinor: 0 }); return success(catalogEditionProjection(edition), '印刷版次草稿已保存', HttpStatusCode.CREATED); } catch (error: unknown) { return durableCommerceFailure(error); } } },
    'v2.commerce.catalog.editions.transition': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN); const durable = state.durableMediaCommerceStore; if (!durable) return failure('耐久媒体商业当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = catalogInput(ctx, ['id', 'status', 'mutationId', 'expectedResourceVersion']); if (input.status !== 'sellable' && input.status !== 'withdrawn') throw new TrailsSyncInputError('版次状态无效'); return success(catalogEditionProjection(await durable.transitionEdition(actor, { ...commerceMutation(input), id: commerceId(input, '版次编号'), status: input.status })), '印刷版次状态已更新'); } catch (error: unknown) { return durableCommerceFailure(error); } } },
    'v2.commerce.sales.workspace': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有销售管理权限', HttpStatusCode.FORBIDDEN); const durable = state.durableMediaCommerceStore; if (!durable) return failure('耐久销售当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { salesInput(ctx, []); return success(salesWorkspaceProjection(await durable.readSalesWorkspace(actor)), '人工销售准备工作台'); } catch (error: unknown) { return durableCommerceFailure(error); } } },
    'v2.commerce.sales.configuration.save': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有销售管理权限', HttpStatusCode.FORBIDDEN); const durable = state.durableMediaCommerceStore; if (!durable) return failure('耐久销售当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = salesInput(ctx, ['salesMode', 'currency', 'reservationHours', 'mutationId', 'expectedResourceVersion']); if (input.salesMode !== 'disabled' && input.salesMode !== 'manual') throw new TrailsSyncInputError('线上支付尚未完成服务商验收，不能启用'); return success(salesConfigurationProjection(await durable.saveSalesConfiguration(actor, { ...commerceMutation(input), salesMode: input.salesMode, currency: requiredString(input, 'currency', '货币'), reservationHours: input.reservationHours as number })), '销售模式已保存'); } catch (error: unknown) { return durableCommerceFailure(error); } } },
    'v2.commerce.sales.products.create': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有销售管理权限', HttpStatusCode.FORBIDDEN); const durable = state.durableMediaCommerceStore; if (!durable) return failure('耐久销售当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = salesInput(ctx, ['mediaId', 'productType', 'title', 'description', 'productionLeadDays', 'editionSize', 'certificateIncluded', 'skus', 'mutationId', 'expectedResourceVersion']); const mutation = commerceMutation(input); return success(salesProductProjection(await durable.createSalesProduct(actor, { ...mutation, id: commerceCreatedId('sales-product', mutation.mutationId), ...(input.mediaId === undefined ? {} : { mediaId: requiredString(input, 'mediaId', '关联媒体编号') }), productType: input.productType as import('../types').SalesProductType, title: requiredString(input, 'title', '商品标题'), description: requiredString(input, 'description', '商品说明'), productionLeadDays: input.productionLeadDays as number, ...(input.editionSize === undefined ? {} : { editionSize: input.editionSize as number }), certificateIncluded: input.certificateIncluded as boolean, skus: input.skus as import('../types').SalesProductSku[] })), '销售商品草稿已保存', HttpStatusCode.CREATED); } catch (error: unknown) { return durableCommerceFailure(error); } } },
    'v2.commerce.sales.products.update': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有销售管理权限', HttpStatusCode.FORBIDDEN); const durable = state.durableMediaCommerceStore; if (!durable) return failure('耐久销售当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = salesInput(ctx, ['id', 'mediaId', 'productType', 'title', 'description', 'productionLeadDays', 'editionSize', 'certificateIncluded', 'skus', 'mutationId', 'expectedResourceVersion']); return success(salesProductProjection(await durable.updateSalesProduct(actor, { ...commerceMutation(input), id: commerceId(input, '商品编号'), ...(input.mediaId === undefined ? {} : { mediaId: requiredString(input, 'mediaId', '关联媒体编号') }), productType: input.productType as import('../types').SalesProductType, title: requiredString(input, 'title', '商品标题'), description: requiredString(input, 'description', '商品说明'), productionLeadDays: input.productionLeadDays as number, ...(input.editionSize === undefined ? {} : { editionSize: input.editionSize as number }), certificateIncluded: input.certificateIncluded as boolean, skus: input.skus as import('../types').SalesProductSku[] })), '销售商品草稿已更新'); } catch (error: unknown) { return durableCommerceFailure(error); } } },
    'v2.commerce.sales.products.transition': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有销售管理权限', HttpStatusCode.FORBIDDEN); const durable = state.durableMediaCommerceStore; if (!durable) return failure('耐久销售当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = salesInput(ctx, ['id', 'status', 'mutationId', 'expectedResourceVersion']); return success(salesProductProjection(await durable.transitionSalesProduct(actor, { ...commerceMutation(input), id: commerceId(input, '商品编号'), status: input.status as import('../types').SalesProductStatus })), '销售商品状态已更新'); } catch (error: unknown) { return durableCommerceFailure(error); } } },
    'v2.commerce.sales.orders.create': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有销售管理权限', HttpStatusCode.FORBIDDEN); const durable = state.durableMediaCommerceStore; if (!durable) return failure('耐久销售当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = salesInput(ctx, ['productId', 'skuId', 'quantity', 'mutationId', 'expectedResourceVersion']); const mutation = commerceMutation(input); return success(manualSalesOrderProjection(await durable.createManualSalesOrder(actor, { ...mutation, id: commerceCreatedId('manual-sales-order', mutation.mutationId), productId: requiredString(input, 'productId', '商品编号'), skuId: requiredString(input, 'skuId', '规格编号'), quantity: input.quantity as number })), '人工订单已创建并锁定库存', HttpStatusCode.CREATED); } catch (error: unknown) { return durableCommerceFailure(error); } } },
    'v2.commerce.sales.orders.transition': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有销售管理权限', HttpStatusCode.FORBIDDEN); const durable = state.durableMediaCommerceStore; if (!durable) return failure('耐久销售当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = salesInput(ctx, ['id', 'status', 'trackingReference', 'mutationId', 'expectedResourceVersion']); return success(manualSalesOrderProjection(await durable.transitionManualSalesOrder(actor, { ...commerceMutation(input), id: commerceId(input, '订单编号'), status: input.status as import('../types').ManualSalesOrderStatus, ...(input.trackingReference === undefined ? {} : { trackingReference: requiredString(input, 'trackingReference', '配送参考号') }) })), '人工订单状态已更新'); } catch (error: unknown) { return durableCommerceFailure(error); } } },
    'v2.commerce.owner.workspace': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN); const durable = state.durableMediaCommerceStore; if (!durable) return failure('耐久媒体商业当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { return success(await durable.listOwner(actor), '媒体商业创作空间'); } catch (error: unknown) { return durableCommerceFailure(error); } } },
    'v2.commerce.buyer.workspace': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); const durable = state.durableMediaCommerceStore; if (!durable) return failure('耐久媒体商业当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { return success(commerceBuyer(await durable.listBuyer(actor)), '购买者商业记录'); } catch (error: unknown) { return durableCommerceFailure(error); } } },
    'v2.commerce.media.create': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN); const durable = state.durableMediaCommerceStore; if (!durable) return failure('耐久媒体商业当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = params(ctx); const mutation = commerceMutation(input); return success(await durable.createMedia(actor, { ...mutation, id: commerceCreatedId('commerce-media', mutation.mutationId), title: requiredString(input, 'title', '标题'), summary: requiredString(input, 'summary', '简介'), derivativeReferences: Array.isArray(input.derivativeReferences) ? input.derivativeReferences as Array<{ reference: string; width?: number; height?: number }> : [] }), '媒体草稿已保存；未执行存储或交付', HttpStatusCode.CREATED); } catch (error: unknown) { return durableCommerceFailure(error); } } },
    'v2.commerce.media.transition': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); const durable = state.durableMediaCommerceStore; if (!durable) return failure('耐久媒体商业当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = params(ctx); if (input.status !== 'published' && input.status !== 'withdrawn') throw new TrailsSyncInputError('媒体状态无效'); return success(await durable.transitionMedia(actor, { ...commerceMutation(input), id: commerceId(input, '媒体编号'), status: input.status }), '媒体状态已更新'); } catch (error: unknown) { return durableCommerceFailure(error); } } },
    'v2.commerce.edition.create': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); const durable = state.durableMediaCommerceStore; if (!durable) return failure('耐久媒体商业当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = params(ctx); const mutation = commerceMutation(input); return success(await durable.createEdition(actor, { ...mutation, id: commerceCreatedId('print-edition', mutation.mutationId), mediaId: requiredString(input, 'mediaId', '媒体编号'), title: requiredString(input, 'title', '标题'), description: requiredString(input, 'description', '说明'), currency: requiredString(input, 'currency', '货币'), priceMinor: input.priceMinor as number }), '印刷版次草稿已保存', HttpStatusCode.CREATED); } catch (error: unknown) { return durableCommerceFailure(error); } } },
    'v2.commerce.edition.transition': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); const durable = state.durableMediaCommerceStore; if (!durable) return failure('耐久媒体商业当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = params(ctx); if (input.status !== 'sellable' && input.status !== 'withdrawn') throw new TrailsSyncInputError('版次状态无效'); return success(await durable.transitionEdition(actor, { ...commerceMutation(input), id: commerceId(input, '版次编号'), status: input.status }), '印刷版次状态已更新'); } catch (error: unknown) { return durableCommerceFailure(error); } } },
    'v2.commerce.inquiries.create': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); const durable = state.durableMediaCommerceStore; if (!durable) return failure('耐久媒体商业当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = params(ctx); const mutation = commerceMutation(input); return success(await durable.inquireCommercial(actor, { ...mutation, id: commerceCreatedId('license-inquiry', mutation.mutationId), mediaId: requiredString(input, 'mediaId', '媒体编号'), message: requiredString(input, 'message', '咨询内容') }), '商业许可咨询已记录', HttpStatusCode.CREATED); } catch (error: unknown) { return durableCommerceFailure(error); } } },
    'v2.commerce.download-licenses.request': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); const durable = state.durableMediaCommerceStore; if (!durable) return failure('耐久媒体商业当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = params(ctx); const mutation = commerceMutation(input); return success(await durable.requestDownloadLicense(actor, { ...mutation, id: commerceCreatedId('download-license-request', mutation.mutationId), mediaId: requiredString(input, 'mediaId', '媒体编号') }), '下载许可请求已记录；未提供下载链接', HttpStatusCode.CREATED); } catch (error: unknown) { return durableCommerceFailure(error); } } },
    'v2.commerce.download-licenses.decide': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); const durable = state.durableMediaCommerceStore; if (!durable) return failure('耐久媒体商业当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = params(ctx); if (input.status !== 'granted' && input.status !== 'declined' && input.status !== 'revoked') throw new TrailsSyncInputError('许可状态无效'); return success(await durable.decideDownloadLicense(actor, { ...commerceMutation(input), id: commerceId(input, '许可请求编号'), status: input.status }), '下载许可决定已记录；未提供下载链接'); } catch (error: unknown) { return durableCommerceFailure(error); } } },
    'v2.commerce.orders.create': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); const durable = state.durableMediaCommerceStore; if (!durable) return failure('耐久媒体商业当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = params(ctx); const mutation = commerceMutation(input); return success(await durable.createOrder(actor, { ...mutation, id: commerceCreatedId('manual-order', mutation.mutationId), editionId: requiredString(input, 'editionId', '版次编号') }), '人工订单已记录；未创建支付或配送', HttpStatusCode.CREATED); } catch (error: unknown) { return durableCommerceFailure(error); } } },
    'v2.commerce.orders.transition': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); const durable = state.durableMediaCommerceStore; if (!durable) return failure('耐久媒体商业当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = params(ctx); if (input.status !== 'payment-recorded' && input.status !== 'fulfilled' && input.status !== 'refunded' && input.status !== 'cancelled') throw new TrailsSyncInputError('订单状态无效'); return success(await durable.transitionOrder(actor, { ...commerceMutation(input), id: commerceId(input, '订单编号'), status: input.status, ...(input.refundMinor === undefined ? {} : { refundMinor: input.refundMinor as number }) }), '人工订单事实已更新；未调用外部服务'); } catch (error: unknown) { return durableCommerceFailure(error); } } },
    'v2.media-assets.register': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN); const registry = state.durableMediaAssetRegistryStore; if (!registry) return failure('耐久媒体资产注册表当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = params(ctx); const mutation = commerceMutation(input); return success(await registry.register(actor, { ...mutation, id: commerceCreatedId('media-asset', mutation.mutationId), mimeType: requiredString(input, 'mimeType', '图片MIME类型'), privateMasterLocator: privateMasterLocatorForArtifact(input.privateMasterArtifact) }), '私有媒体主文件元数据已注册', HttpStatusCode.CREATED); } catch (error: unknown) { return durableMediaRegistryFailure(error); } } },
    'v2.media-assets.publish': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN); const registry = state.durableMediaAssetRegistryStore; if (!registry) return failure('耐久媒体资产注册表当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = params(ctx); return success(await registry.publish(actor, { ...commerceMutation(input), id: requiredString(input, 'id', '媒体资产编号') }), '媒体资产已发布'); } catch (error: unknown) { return durableMediaRegistryFailure(error); } } },
    'v2.site-content.workspace': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN); const durable = state.durablePublicSiteContentStore; if (!durable) return failure('耐久公开内容当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { return success(workspaceSiteProjection(await durable.readWorkspace(actor)), '公开站点内容草稿'); } catch (error: unknown) { return durablePublicSiteContentFailure(error); } } },
    'v2.site-content.draft': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> {
      const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN);
      const durable = state.durablePublicSiteContentStore; if (!durable) return failure('耐久公开内容当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE);
      try {
        const input = originalSiteContentDraft(ctx);
        await authorizeAboutPortraitMedia(actor, input.content.aboutPortraitMediaId, state.durableMediaAssetRegistryStore);
        const saved = await durable.saveDraft(actor, { ...input.content, resourceVersion: input.resourceVersion });
        return success(workspaceSiteProjection(saved), '公开站点内容草稿已保存', HttpStatusCode.CREATED);
      } catch (error: unknown) { return durablePublicSiteContentFailure(error); }
    } },
    'v2.site-content.publish': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN); const durable = state.durablePublicSiteContentStore; if (!durable) return failure('耐久公开内容当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { return success(workspaceSiteProjection(await durable.publish(actor, { resourceVersion: canonicalDecimalString(params(ctx).resourceVersion, 'resourceVersion') })), '公开站点内容已发布'); } catch (error: unknown) { return durablePublicSiteContentFailure(error); } } },
    'v2.site-content.unpublish': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN); const durable = state.durablePublicSiteContentStore; if (!durable) return failure('耐久公开内容当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { return success(workspaceSiteProjection(await durable.unpublish(actor, { resourceVersion: canonicalDecimalString(params(ctx).resourceVersion, 'resourceVersion') })), '公开站点内容已取消发布'); } catch (error: unknown) { return durablePublicSiteContentFailure(error); } } },
    'v2.site-content.public': { metadata: { auth: false }, async handler(_ctx: Context): Promise<HttpResponseItem> { const durable = state.durablePublicSiteContentStore; if (!durable) return failure('耐久公开内容当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); const owner = (state.publicOwnerResolver || createPublicOwnerResolver()).resolve(); if (!owner) return failure('未找到公开站点', HttpStatusCode.NOT_FOUND); try { const content = await durable.readPublic({ tenantId: owner.tenantId, userId: owner.ownerUserId }); return content ? success(publicSiteProjection(content), '公开站点内容') : failure('未找到公开站点内容', HttpStatusCode.NOT_FOUND); } catch (error: unknown) { return durablePublicSiteContentFailure(error); } } },
    'v2.trips.workspace': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN); const durable = state.durableGuidedTripStore; if (!durable) return failure('耐久行摄计划当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { return success((await durable.listWorkspace(actor)).map(workspaceGuidedTripProjection), '行摄计划工作台'); } catch (error: unknown) { return durableGuidedTripFailure(error); } } },
    'v2.trips.workspace.draft': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN); const durable = state.durableGuidedTripStore; if (!durable) return failure('耐久行摄计划当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = params(ctx); return success(workspaceGuidedTripProjection(await durable.createDraft(actor, { id: requiredString(input, 'id', '行摄计划编号'), mutationId: requiredString(input, 'mutationId', '变更编号'), expectedResourceVersion: input.expectedResourceVersion === null ? null : canonicalDecimalString(input.expectedResourceVersion, 'expectedResourceVersion'), title: input.title as string, summary: input.summary as string, locationLabel: input.locationLabel as string, startsOn: input.startsOn as string, endsOn: input.endsOn as string, itinerary: input.itinerary as [], checklist: input.checklist as [], materialReferences: input.materialReferences as [], ...(input.publicContingencyMessage === undefined ? {} : { publicContingencyMessage: input.publicContingencyMessage as string }) })), '行摄计划草稿已保存', HttpStatusCode.CREATED); } catch (error: unknown) { return durableGuidedTripFailure(error); } } },
    'v2.trips.workspace.update': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN); const durable = state.durableGuidedTripStore; if (!durable) return failure('耐久行摄计划当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = params(ctx); return success(workspaceGuidedTripProjection(await durable.updateDraft(actor, { id: requiredString(input, 'id', '行摄计划编号'), mutationId: requiredString(input, 'mutationId', '变更编号'), expectedResourceVersion: canonicalDecimalString(input.expectedResourceVersion, 'expectedResourceVersion'), title: input.title as string, summary: input.summary as string, locationLabel: input.locationLabel as string, startsOn: input.startsOn as string, endsOn: input.endsOn as string, itinerary: input.itinerary as [], checklist: input.checklist as [], materialReferences: input.materialReferences as [], ...(input.publicContingencyMessage === undefined ? {} : { publicContingencyMessage: input.publicContingencyMessage as string }) })), '行摄计划草稿已更新'); } catch (error: unknown) { return durableGuidedTripFailure(error); } } },
    'v2.trips.workspace.publish': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN); const durable = state.durableGuidedTripStore; if (!durable) return failure('耐久行摄计划当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = params(ctx); return success(workspaceGuidedTripProjection(await durable.publish(actor, { id: requiredString(input, 'id', '行摄计划编号'), mutationId: requiredString(input, 'mutationId', '变更编号'), expectedResourceVersion: canonicalDecimalString(input.expectedResourceVersion, 'expectedResourceVersion') })), '行摄计划已发布'); } catch (error: unknown) { return durableGuidedTripFailure(error); } } },
    'v2.trips.workspace.unpublish': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN); const durable = state.durableGuidedTripStore; if (!durable) return failure('耐久行摄计划当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = params(ctx); return success(workspaceGuidedTripProjection(await durable.unpublish(actor, { id: requiredString(input, 'id', '行摄计划编号'), mutationId: requiredString(input, 'mutationId', '变更编号'), expectedResourceVersion: canonicalDecimalString(input.expectedResourceVersion, 'expectedResourceVersion') })), '行摄计划已取消发布'); } catch (error: unknown) { return durableGuidedTripFailure(error); } } },
    'v2.trips.workspace.cancel': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN); const durable = state.durableGuidedTripStore; if (!durable) return failure('耐久行摄计划当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = params(ctx); return success(workspaceGuidedTripProjection(await durable.cancel(actor, { id: requiredString(input, 'id', '行摄计划编号'), mutationId: requiredString(input, 'mutationId', '变更编号'), expectedResourceVersion: canonicalDecimalString(input.expectedResourceVersion, 'expectedResourceVersion') })), '行摄计划已取消'); } catch (error: unknown) { return durableGuidedTripFailure(error); } } },
    'v2.trips.public': { metadata: { auth: false }, async handler(): Promise<HttpResponseItem> { const durable = state.durableGuidedTripStore; if (!durable) return failure('耐久行摄计划当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); const owner = (state.publicOwnerResolver || createPublicOwnerResolver()).resolve(); if (!owner) return failure('未找到公开站点', HttpStatusCode.NOT_FOUND); try { return success((await durable.listPublic({ tenantId: owner.tenantId, userId: owner.ownerUserId })).map(publicGuidedTripProjection), '公开行摄计划'); } catch (error: unknown) { return durableGuidedTripFailure(error); } } },
    'v2.trips.public-detail': { metadata: { auth: false }, async handler(ctx: Context): Promise<HttpResponseItem> { const durable = state.durableGuidedTripStore; if (!durable) return failure('耐久行摄计划当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); const owner = (state.publicOwnerResolver || createPublicOwnerResolver()).resolve(); if (!owner) return failure('未找到公开站点', HttpStatusCode.NOT_FOUND); try { const trip = await durable.readPublic({ tenantId: owner.tenantId, userId: owner.ownerUserId }, requiredString(params(ctx), 'id', '行摄计划编号')); return trip ? success(publicGuidedTripProjection(trip), '公开行摄计划') : failure('未找到公开行摄计划', HttpStatusCode.NOT_FOUND); } catch (error: unknown) { return durableGuidedTripFailure(error); } } },
    'v2.video-references.workspace': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN); const durable = state.durableExternalVideoReferenceStore; if (!durable) return failure('耐久外部视频引用当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { return success((await durable.listWorkspace(actor)).map(workspaceExternalVideoReferenceProjection), '外部视频引用工作台'); } catch (error: unknown) { return durableExternalVideoReferenceFailure(error); } } },
    'v2.video-references.workspace.draft': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN); const durable = state.durableExternalVideoReferenceStore; if (!durable) return failure('耐久外部视频引用当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = params(ctx); return success(workspaceExternalVideoReferenceProjection(await durable.createDraft(actor, { id: requiredString(input, 'id', '引用编号'), portfolioId: requiredString(input, 'portfolioId', '作品集编号'), title: input.title as string, summary: input.summary as string, canonicalUrl: input.canonicalUrl as string, sortOrder: input.sortOrder as number, mutationId: requiredString(input, 'mutationId', '变更编号'), expectedResourceVersion: input.expectedResourceVersion === null ? null : canonicalDecimalString(input.expectedResourceVersion, 'expectedResourceVersion') })), '外部视频引用草稿已保存', HttpStatusCode.CREATED); } catch (error: unknown) { return durableExternalVideoReferenceFailure(error); } } },
    'v2.video-references.workspace.update': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN); const durable = state.durableExternalVideoReferenceStore; if (!durable) return failure('耐久外部视频引用当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = params(ctx); return success(workspaceExternalVideoReferenceProjection(await durable.updateDraft(actor, { id: requiredString(input, 'id', '引用编号'), portfolioId: requiredString(input, 'portfolioId', '作品集编号'), title: input.title as string, summary: input.summary as string, canonicalUrl: input.canonicalUrl as string, sortOrder: input.sortOrder as number, mutationId: requiredString(input, 'mutationId', '变更编号'), expectedResourceVersion: canonicalDecimalString(input.expectedResourceVersion, 'expectedResourceVersion') })), '外部视频引用草稿已更新'); } catch (error: unknown) { return durableExternalVideoReferenceFailure(error); } } },
    'v2.video-references.workspace.publish': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN); const durable = state.durableExternalVideoReferenceStore; if (!durable) return failure('耐久外部视频引用当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = params(ctx); return success(workspaceExternalVideoReferenceProjection(await durable.publish(actor, { id: requiredString(input, 'id', '引用编号'), mutationId: requiredString(input, 'mutationId', '变更编号'), expectedResourceVersion: canonicalDecimalString(input.expectedResourceVersion, 'expectedResourceVersion') })), '外部视频引用已发布'); } catch (error: unknown) { return durableExternalVideoReferenceFailure(error); } } },
    'v2.video-references.workspace.unpublish': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN); const durable = state.durableExternalVideoReferenceStore; if (!durable) return failure('耐久外部视频引用当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = params(ctx); return success(workspaceExternalVideoReferenceProjection(await durable.unpublish(actor, { id: requiredString(input, 'id', '引用编号'), mutationId: requiredString(input, 'mutationId', '变更编号'), expectedResourceVersion: canonicalDecimalString(input.expectedResourceVersion, 'expectedResourceVersion') })), '外部视频引用已取消发布'); } catch (error: unknown) { return durableExternalVideoReferenceFailure(error); } } },
    'v2.video-references.workspace.archive': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN); const durable = state.durableExternalVideoReferenceStore; if (!durable) return failure('耐久外部视频引用当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = params(ctx); return success(workspaceExternalVideoReferenceProjection(await durable.archive(actor, { id: requiredString(input, 'id', '引用编号'), mutationId: requiredString(input, 'mutationId', '变更编号'), expectedResourceVersion: canonicalDecimalString(input.expectedResourceVersion, 'expectedResourceVersion') })), '外部视频引用已归档'); } catch (error: unknown) { return durableExternalVideoReferenceFailure(error); } } },
    'v2.video-references.public': { metadata: { auth: false }, async handler(): Promise<HttpResponseItem> { const durable = state.durableExternalVideoReferenceStore; if (!durable) return failure('耐久外部视频引用当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); const owner = (state.publicOwnerResolver || createPublicOwnerResolver()).resolve(); if (!owner) return failure('未找到公开站点', HttpStatusCode.NOT_FOUND); try { return success((await durable.listPublic({ tenantId: owner.tenantId, userId: owner.ownerUserId })).map(publicExternalVideoReferenceProjection), '公开外部视频引用'); } catch (error: unknown) { return durableExternalVideoReferenceFailure(error); } } },
    'v2.locations.workspace': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN); const durable = state.durableLocationCardStore; if (!durable) return failure('耐久地点卡片当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { return success((await durable.listWorkspace(actor)).map(workspaceLocationCardProjection), '地点卡片工作台'); } catch (error: unknown) { return durableLocationCardFailure(error); } } },
    'v2.locations.workspace.draft': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN); const durable = state.durableLocationCardStore; if (!durable) return failure('耐久地点卡片当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { return success(workspaceLocationCardProjection(await durable.createDraft(actor, originalLocationCardWriteInput(ctx, false))), '地点卡片草稿已保存', HttpStatusCode.CREATED); } catch (error: unknown) { return durableLocationCardFailure(error); } } },
    'v2.locations.workspace.update': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN); const durable = state.durableLocationCardStore; if (!durable) return failure('耐久地点卡片当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { return success(workspaceLocationCardProjection(await durable.updateDraft(actor, originalLocationCardWriteInput(ctx, true))), '地点卡片草稿已更新'); } catch (error: unknown) { return durableLocationCardFailure(error); } } },
    'v2.locations.workspace.publish': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN); const durable = state.durableLocationCardStore; if (!durable) return failure('耐久地点卡片当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = params(ctx); return success(workspaceLocationCardProjection(await durable.publish(actor, { id: requiredString(input, 'id', '地点卡片编号'), mutationId: requiredString(input, 'mutationId', '变更编号'), expectedResourceVersion: canonicalDecimalString(input.expectedResourceVersion, 'expectedResourceVersion') })), '地点卡片已发布'); } catch (error: unknown) { return durableLocationCardFailure(error); } } },
    'v2.locations.workspace.unpublish': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN); const durable = state.durableLocationCardStore; if (!durable) return failure('耐久地点卡片当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = params(ctx); return success(workspaceLocationCardProjection(await durable.unpublish(actor, { id: requiredString(input, 'id', '地点卡片编号'), mutationId: requiredString(input, 'mutationId', '变更编号'), expectedResourceVersion: canonicalDecimalString(input.expectedResourceVersion, 'expectedResourceVersion') })), '地点卡片已取消发布'); } catch (error: unknown) { return durableLocationCardFailure(error); } } },
    'v2.locations.workspace.archive': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('当前账号没有创作空间管理权限', HttpStatusCode.FORBIDDEN); const durable = state.durableLocationCardStore; if (!durable) return failure('耐久地点卡片当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = params(ctx); return success(workspaceLocationCardProjection(await durable.archive(actor, { id: requiredString(input, 'id', '地点卡片编号'), mutationId: requiredString(input, 'mutationId', '变更编号'), expectedResourceVersion: canonicalDecimalString(input.expectedResourceVersion, 'expectedResourceVersion') })), '地点卡片已归档'); } catch (error: unknown) { return durableLocationCardFailure(error); } } },
    'v2.locations.public': { metadata: { auth: false }, async handler(): Promise<HttpResponseItem> { const durable = state.durableLocationCardStore; if (!durable) return failure('耐久地点卡片当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); const owner = (state.publicOwnerResolver || createPublicOwnerResolver()).resolve(); if (!owner) return failure('未找到公开站点', HttpStatusCode.NOT_FOUND); try { return success((await durable.listPublic({ tenantId: owner.tenantId, userId: owner.ownerUserId })).sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)).map(publicLocationCardProjection), '公开地点卡片'); } catch (error: unknown) { return durableLocationCardFailure(error); } } },
    'v2.shooting-locations.workspace': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (actor.creatorSpaceRole !== 'creator-space-owner') return failure('当前账号没有拍摄地点管理权限', HttpStatusCode.FORBIDDEN); const store = state.shootingLocationStore; if (!store) return failure('耐久拍摄地点当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { return success((await store.listWorkspace(actor)).map(workspaceShootingLocationProjection), '拍摄地点工作台'); } catch (error: unknown) { return shootingLocationFailure(error); } } },
    'v2.shooting-locations.create': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (actor.creatorSpaceRole !== 'creator-space-owner') return failure('当前账号没有拍摄地点管理权限', HttpStatusCode.FORBIDDEN); const store = state.shootingLocationStore; if (!store) return failure('耐久拍摄地点当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { return success(workspaceShootingLocationProjection(await store.create(actor, shootingLocationWrite(ctx, false) as import('../types').ShootingLocationMutation & import('../types').ShootingLocationDraftInput)), '拍摄地点已创建', HttpStatusCode.CREATED); } catch (error: unknown) { return shootingLocationFailure(error); } } },
    'v2.shooting-locations.update': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (actor.creatorSpaceRole !== 'creator-space-owner') return failure('当前账号没有拍摄地点管理权限', HttpStatusCode.FORBIDDEN); const store = state.shootingLocationStore; if (!store) return failure('耐久拍摄地点当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { return success(workspaceShootingLocationProjection(await store.update(actor, shootingLocationWrite(ctx, true) as import('../types').ShootingLocationMutation & import('../types').ShootingLocationDraftInput)), '拍摄地点已更新'); } catch (error: unknown) { return shootingLocationFailure(error); } } },
    'v2.shooting-locations.archive': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (actor.creatorSpaceRole !== 'creator-space-owner') return failure('当前账号没有拍摄地点管理权限', HttpStatusCode.FORBIDDEN); const store = state.shootingLocationStore; if (!store) return failure('耐久拍摄地点当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { return success(workspaceShootingLocationProjection(await store.archive(actor, shootingLocationTransition(ctx))), '拍摄地点已归档'); } catch (error: unknown) { return shootingLocationFailure(error); } } },
    'v2.comments.submit': { metadata: { auth: false }, async handler(ctx: Context): Promise<HttpResponseItem> { const durable = state.durableGuestCommentStore; if (!durable) return failure('耐久留言当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); if (!state.antiAbuse || !state.commentVerificationNotificationDispatcher) return failure('留言保护或通知服务当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = params(ctx); const subject = durableCommentSubject(input); const subjectType = subject.subjectType; const subjectId = subject.subjectId; const owner = (state.publicOwnerResolver || createPublicOwnerResolver()).resolve(); if (!owner) return failure('未找到公开站点', HttpStatusCode.NOT_FOUND); if (subjectType === 'guestbook') { const site = state.durablePublicSiteContentStore; if (!site) return failure('公开站点当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); if (!await site.readPublic({ tenantId: owner.tenantId, userId: owner.ownerUserId })) return failure('未找到可公开留言的内容', HttpStatusCode.NOT_FOUND); } else { const source = subjectType === 'portfolio' ? state.durablePortfolioStore : state.durableJournalStore; if (!source) return failure('公开主题当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); const published = await source.listPublic({ tenantId: owner.tenantId, userId: owner.ownerUserId }); if (!published.some((item: { id: string; visibility: Visibility; lifecycle: 'draft' | 'published' | 'archived' }) => item.id === subjectId && item.visibility === 'public' && item.lifecycle === 'published')) return failure('未找到可公开留言的内容', HttpStatusCode.NOT_FOUND); } const assessment = await state.antiAbuse.assessSubmission(subject); if (!assessment.allowed) return failure('留言请求暂不能处理', HttpStatusCode.TOO_MANY_REQUESTS); const values = publicCommentInput(input); const token = randomBytes(32).toString('base64url'); const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); const commentId = id('guest-comment'); const saved = await durable.submit({ id: commentId, tenantId: owner.tenantId, ownerUserId: owner.ownerUserId, ...subject, ...values, verificationToken: token, verificationExpiresAt: expiresAt }); void durable.dispatchPending(state.commentVerificationNotificationDispatcher, { commentId: saved.id }).catch(() => undefined); return success({ id: saved.id, status: saved.status, notification: 'queued' }, '留言已提交；验证通知已排队', HttpStatusCode.CREATED); } catch (error: unknown) { return durableGuestCommentFailure(error); } } },
    'v2.comments.notifications.retry': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!actor.isAdmin) return failure('无权重试通知', HttpStatusCode.FORBIDDEN); const durable = state.durableGuestCommentStore; if (!durable || !state.commentVerificationNotificationDispatcher) return failure('耐久通知当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const limit = params(ctx).limit; if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 100) throw new TrailsSyncInputError('通知重试参数无效'); return success(await durable.retryNotifications(actor, state.commentVerificationNotificationDispatcher, { limit: limit as number }), '耐久通知重试已执行'); } catch (error: unknown) { return durableGuestCommentFailure(error); } } },
    'v2.comments.verify': { metadata: { auth: false }, async handler(ctx: Context): Promise<HttpResponseItem> { const durable = state.durableGuestCommentStore; if (!durable) return failure('耐久留言当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const comment = await durable.verify({ token: requiredString(params(ctx), 'token', '验证令牌') }); return comment ? success({ id: comment.id, status: comment.status }, '邮箱已验证，留言等待审核') : failure('验证链接无效或已失效', HttpStatusCode.NOT_FOUND); } catch (error: unknown) { return durableGuestCommentFailure(error); } } },
    'v2.comments.moderation-queue': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('无权审核留言', HttpStatusCode.FORBIDDEN); const durable = state.durableGuestCommentStore; if (!durable) return failure('耐久留言当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { return success((await durable.listModeration(actor)).map(durableModerationComment), '耐久留言审核队列'); } catch (error: unknown) { return durableGuestCommentFailure(error); } } },
    'v2.comments.moderate': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('无权审核留言', HttpStatusCode.FORBIDDEN); const durable = state.durableGuestCommentStore; if (!durable) return failure('耐久留言当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = params(ctx); if (input.status !== 'approved' && input.status !== 'rejected') throw new TrailsSyncInputError('审核状态无效'); const comment = await durable.moderate(actor, { id: requiredString(input, 'id', '留言编号'), status: input.status, resourceVersion: canonicalDecimalString(input.resourceVersion, 'resourceVersion') }); return success(durablePublicComment(comment), '留言已审核'); } catch (error: unknown) { return durableGuestCommentFailure(error); } } },
    'v2.comments.public': { metadata: { auth: false }, async handler(ctx: Context): Promise<HttpResponseItem> { const durable = state.durableGuestCommentStore; if (!durable) return failure('耐久留言当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const input = params(ctx); const subject = durableCommentSubject(input); const subjectType = subject.subjectType; const subjectId = subject.subjectId; const owner = (state.publicOwnerResolver || createPublicOwnerResolver()).resolve(); if (!owner) return failure('未找到公开站点', HttpStatusCode.NOT_FOUND); if (subjectType === 'guestbook') { const site = state.durablePublicSiteContentStore; if (!site) return failure('公开站点当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); if (!await site.readPublic({ tenantId: owner.tenantId, userId: owner.ownerUserId })) return failure('未找到可公开留言的内容', HttpStatusCode.NOT_FOUND); } else { const source = subjectType === 'portfolio' ? state.durablePortfolioStore : state.durableJournalStore; if (!source) return failure('公开主题当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); const published = await source.listPublic({ tenantId: owner.tenantId, userId: owner.ownerUserId }); if (!published.some((item: { id: string; visibility: Visibility; lifecycle: 'draft' | 'published' | 'archived' }) => item.id === subjectId && item.visibility === 'public' && item.lifecycle === 'published')) return failure('未找到可公开留言的内容', HttpStatusCode.NOT_FOUND); } return success((await durable.listPublic({ tenantId: owner.tenantId, userId: owner.ownerUserId }, subject)).map(durablePublicComment), '公开留言'); } catch (error: unknown) { return durableGuestCommentFailure(error); } } },
    'v2.comments.redact-retained': { metadata: { auth: true }, async handler(ctx: Context): Promise<HttpResponseItem> { const actor = requireActor(ctx); if (!actor) return failure('未识别到可信登录身份', HttpStatusCode.UNAUTHORIZED); if (!creatorOwner(actor)) return failure('无权处置留言保留数据', HttpStatusCode.FORBIDDEN); const durable = state.durableGuestCommentStore; if (!durable) return failure('耐久留言当前不可用', HttpStatusCode.SERVICE_UNAVAILABLE); try { const before = requiredString(params(ctx), 'before', '保留截止时间'); if (Number.isNaN(new Date(before).getTime()) || new Date(before).toISOString() !== before) throw new TrailsSyncInputError('保留截止时间无效'); return success({ redactedCount: await durable.redactRetained(actor, { before }) }, '留言保留数据已处置'); } catch (error: unknown) { return durableGuestCommentFailure(error); } } },
  };
  const publicResources: Record<string, string> = {
    'v2.categories.public': 'categories',
    'v2.media-assets.public': 'media-assets',
    'v2.portfolios.public': 'portfolios',
    'v2.exhibitions.public': 'exhibitions',
    'v2.journals.public': 'journals',
    'v2.journals.public-detail': 'journals',
    'v2.commerce.public': 'commerce',
    'v2.site-content.public': 'site-content',
    'v2.trips.public': 'trips',
    'v2.trips.public-detail': 'trips',
    'v2.video-references.public': 'video-references',
    'v2.locations.public': 'locations',
    'v2.comments.public': 'comments',
  };
  const mutationInvalidations: Record<string, readonly string[]> = {
    'v2.categories.create': ['categories', 'portfolios'],
    'v2.categories.update': ['categories', 'portfolios'],
    'v2.categories.archive': ['categories', 'portfolios'],
    'v2.categories.reorder': ['categories', 'portfolios'],
    'v2.media-assets.publish': ['media-assets'],
    'v2.portfolios.publish': ['portfolios', 'media-assets', 'video-references', 'comments'],
    'v2.portfolios.update': ['portfolios', 'media-assets', 'video-references', 'comments'],
    'v2.portfolios.unpublish': ['portfolios', 'media-assets', 'video-references', 'comments'],
    'v2.portfolios.rich-document.save': ['portfolios', 'media-assets'],
    'v2.exhibitions.workspace.mutate': ['exhibitions'],
    'v2.journals.publish': ['journals', 'comments'],
    'v2.journals.update': ['journals', 'comments'],
    'v2.journals.unpublish': ['journals', 'comments'],
    'v2.journals.pin': ['journals'],
    'v2.journals.rich-document.save': ['journals'],
    'v2.commerce.catalog.media.transition': ['commerce'],
    'v2.commerce.catalog.editions.transition': ['commerce'],
    'v2.commerce.media.transition': ['commerce'],
    'v2.commerce.edition.transition': ['commerce'],
    'v2.site-content.draft': ['site-content'],
    'v2.site-content.publish': ['site-content', 'comments'],
    'v2.site-content.unpublish': ['site-content', 'comments'],
    'v2.trips.workspace.update': ['trips'],
    'v2.trips.workspace.publish': ['trips'],
    'v2.trips.workspace.unpublish': ['trips'],
    'v2.trips.workspace.cancel': ['trips'],
    'v2.video-references.workspace.update': ['video-references'],
    'v2.video-references.workspace.publish': ['video-references'],
    'v2.video-references.workspace.unpublish': ['video-references'],
    'v2.video-references.workspace.archive': ['video-references'],
    'v2.locations.workspace.draft': ['locations'],
    'v2.locations.workspace.update': ['locations'],
    'v2.locations.workspace.publish': ['locations'],
    'v2.locations.workspace.unpublish': ['locations'],
    'v2.locations.workspace.archive': ['locations'],
    'v2.comments.moderate': ['comments'],
    'v2.comments.redact-retained': ['comments'],
  };
  for (const [actionName, resources] of Object.entries(mutationInvalidations)) {
    const action = actions[actionName as keyof typeof actions];
    const handler = action.handler;
    action.handler = async (ctx: Context): Promise<HttpResponseItem> => {
      const response = await handler(ctx);
      const actor = requireActor(ctx);
      if (response.data.success && actor) invalidatePublic(actor, resources);
      return response;
    };
  }
  for (const [actionName, resource] of Object.entries(publicResources)) {
    const action = actions[actionName as keyof typeof actions];
    const handler = action.handler;
    action.handler = async (ctx: Context): Promise<HttpResponseItem> => {
      let validatedParameters: string;
      try {
        validatedParameters = (() => {
        if (actionName === 'v2.portfolios.public') return optionalSlug(params(ctx), 'categorySlug') || '';
        if (actionName === 'v2.journals.public-detail') return publicJournalId(params(ctx)) || '';
        if (actionName === 'v2.trips.public-detail') return requiredString(params(ctx), 'id', '行摄计划编号');
        if (actionName === 'v2.comments.public') {
          const subject = durableCommentSubject(params(ctx));
          return `${subject.subjectType}:${subject.subjectId || ''}`;
        }
        return '';
        })();
      } catch (_error: unknown) {
        return handler(ctx);
      }
      return cachedPublic(ctx, resource, validatedParameters, () => handler(ctx));
    };
  }
  return instrumentServiceActions(star, 'trails', actions);
}
