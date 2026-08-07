export type Visibility = 'public' | 'private' | 'unlisted';
export type Lifecycle = 'draft' | 'published' | 'archived';
export type CategoryStatus = 'active' | 'archived';

export interface TenantOwnedRecord {
  id: string;
  tenantId: string;
  ownerUserId: string;
  visibility: Visibility;
  lifecycle: Lifecycle;
  createdAt: string;
  updatedAt: string;
  /** Monotonic per-resource revision used for optimistic multi-device writes. */
  resourceVersion: number;
}

export interface PrivateOriginalCapability {
  kind: 'private-original' | 'private-receipt';
  objectKey: string;
  capabilityReference: string;
}

export type DurableMediaAssetVariantName = 'grid-800' | 'cover-1600' | 'preview-2048';
export type DurableMediaAssetArtifactCodec = 'avif' | 'webp' | 'jpeg';
/** Trusted server-only persistence input. It intentionally excludes buffers, URLs, object keys, package provenance, delivery configuration, and credentials. */
export interface DurableMediaAssetArtifactDescriptor { logicalRendition: DurableMediaAssetVariantName; codec: DurableMediaAssetArtifactCodec; privateLocator: string; mimeType: 'image/avif' | 'image/webp' | 'image/jpeg'; width: number; height: number; byteLength: number; sha256: string; }
export interface DurableMediaAsset { id: string; tenantId: string; ownerUserId: string; mimeType: string; status: 'draft' | 'published'; resourceVersion: DurableDecimalString; createdAt: string; updatedAt: string; }
/** Creator-workspace read model for document media references. It deliberately omits owner scope and storage details. */
export interface WorkspaceMediaAssetPickerItem { id: string; lifecycle: 'published'; readiness: 'ready'; mimeType: string; renditions: Array<{ name: DurableMediaAssetVariantName; width: number; height: number; reference: string }>; }
export interface DurableMediaAssetRegistryStore {
  listWorkspacePicker(actor: Actor): Promise<WorkspaceMediaAssetPickerItem[]>;
  listPublic(owner: Pick<Actor, 'tenantId' | 'userId'>): Promise<WorkspaceMediaAssetPickerItem[]>;
  register(actor: Actor, mutation: DurableCommerceMutation & { id: string; mimeType: string; privateMasterLocator: string }): Promise<DurableMediaAsset>;
  registerVariant(actor: Actor, mutation: DurableCommerceMutation & { assetId: string; name: DurableMediaAssetVariantName; publicReference: string; width: number; height: number; state: 'ready' }): Promise<DurableMediaAsset>;
  persistArtifacts(actor: Actor, mutation: DurableCommerceMutation & { assetId: string; artifacts: readonly DurableMediaAssetArtifactDescriptor[] }): Promise<DurableMediaAsset>;
  publish(actor: Actor, mutation: DurableCommerceMutation & { id: string }): Promise<DurableMediaAsset>;
}

/** Stable identifiers only: presentation labels belong to a client-owned taxonomy catalog. */
export const photoTechnicalTagIds = [
  'panorama-stitch', 'sky-ground-blend', 'focus-stack', 'exposure-blend', 'hdr',
  'long-exposure', 'star-trails-composite', 'time-lapse-frame', 'denoise',
] as const;
export type PhotoTechnicalTagId = typeof photoTechnicalTagIds[number];

/** Group visibility is opt-in so capture data stays private unless an owner explicitly publishes it. */
export interface PhotoTechnicalMetadataVisibility {
  captureSettings: boolean;
  locationLabel: boolean;
  technicalTags: boolean;
  creationNote: boolean;
}

/**
 * Owner-private work annotation. It intentionally contains neither coordinates, raw EXIF blobs,
 * original object keys, nor original URLs.
 */
export interface PhotoTechnicalMetadata {
  camera: string;
  lens: string;
  focalLengthMm: number;
  aperture: number;
  shutterSpeed: string;
  iso: number;
  captureDate: string;
  calibratedLocationLabel?: string;
  technicalTags: PhotoTechnicalTagId[];
  ownerCustomLabels: string[];
  creationNote?: string;
  visibility: PhotoTechnicalMetadataVisibility;
}

/** Future ingestion contract: only a trusted server-side extractor may create this prefill. */
export interface PhotoTechnicalMetadataPrefill {
  source: 'server-controlled-exif';
  metadata: Omit<PhotoTechnicalMetadata, 'visibility' | 'technicalTags' | 'ownerCustomLabels' | 'creationNote'>;
}

export interface Portfolio extends TenantOwnedRecord {
  title: string;
  summary: string;
  categoryId?: string;
  coverMediaId?: string;
  mediaIds: string[];
  locationLabel?: string;
  photoTechnicalMetadata?: PhotoTechnicalMetadata;
}

export type PublishingPlatform = 'instagram' | 'xiaohongshu';
export type PublishingPath = 'manual_handoff' | 'official_api_candidate';
export type PublishingPackageStatus = 'draft' | 'prepared' | 'reviewed' | 'approved' | 'ready_manual_publish' | 'scheduled' | 'published' | 'measured' | 'learned';
export type PublishingLocationPolicy = 'withheld' | 'generalized';
export type PublishingRightsStatus = 'cleared' | 'restricted';
export type PublishingContentOrigin = 'human' | 'ai-draft-requires-review';
export type LearningConfidence = 'low' | 'medium' | 'high';

/** Metadata plan only. It neither creates nor requests a media export or crop. */
export interface PublishingExportVariant {
  mediaId: string;
  cropIntent: 'square' | 'portrait' | 'landscape' | 'original';
  intendedUse: string;
}

export interface PublishingApprovalChecklist {
  copyApproved: boolean;
  mediaSelectionApproved: boolean;
  rightsApproved: boolean;
  locationPrivacyApproved: boolean;
  factualClaimsApproved: boolean;
}

export interface PublishingFactualClaim {
  text: string;
  verification: 'verified' | 'unverified';
}

export interface PublishingMeasurementEvent {
  occurredAt: string;
  metric: 'impressions' | 'reach' | 'engagements' | 'profile_visits' | 'link_clicks' | 'qualified_inquiries';
  value: number;
}

export interface PublishingLearning {
  summary: string;
  confidence: LearningConfidence;
}

/**
 * Creator-space internal publishing preparation record. It stores neither platform
 * credentials nor post IDs and never performs media processing or platform publication.
 */
export interface PublishingPackage {
  id: string;
  tenantId: string;
  ownerUserId: string;
  portfolioId: string;
  platform: PublishingPlatform;
  publishingPath: PublishingPath;
  status: PublishingPackageStatus;
  copy: string;
  contentOrigin: PublishingContentOrigin;
  exportVariants: PublishingExportVariant[];
  locationPolicy: PublishingLocationPolicy;
  containsGpsOrRouteHints: boolean;
  rightsStatus: PublishingRightsStatus;
  rightsDisclosure?: string;
  factualClaims: PublishingFactualClaim[];
  approvals: PublishingApprovalChecklist;
  destinationUrl: string;
  utmUrl: string;
  scheduledFor?: string;
  measurementEvents: PublishingMeasurementEvent[];
  learning?: PublishingLearning;
  createdAt: string;
  updatedAt: string;
  resourceVersion: number;
}


/** Owner-scoped catalog data; category authority never originates from callers. */
export interface PortfolioCategory extends TenantOwnedRecord {
  slug: string;
  nameZh: string;
  description: string;
  sortOrder: number;
  status: CategoryStatus;
}

export interface Journal extends TenantOwnedRecord {
  title: string;
  excerpt: string;
  body: string;
  coverMediaId?: string;
  publishedAt?: string;
  isPinned: boolean;
}

export type PublicContactLinkKind = 'website' | 'instagram' | 'linkedin' | 'email';

/** Public-safe projection only. Private owner data and credentials never belong here. */
export interface PublicOwnerProfile {
  displayName: string;
  biography: string;
  contactLinks: Array<{ kind: PublicContactLinkKind; href: string }>;
}

interface PublicOwnerProfileRecord extends PublicOwnerProfile {
  tenantId: string;
  ownerUserId: string;
}

export const guestAvatarIds = ['amber-fox', 'blue-heron', 'cedar-owl', 'golden-bee', 'moss-deer', 'violet-cat'] as const;
export type GuestAvatarId = typeof guestAvatarIds[number];
export type GuestCommentSubjectType = 'guestbook' | 'portfolio' | 'journal';
export type GuestCommentStatus = 'pending-email-verification' | 'pending-approval' | 'approved' | 'rejected';

/** Private record: never return email or verification references from public actions. */
export interface GuestComment {
  id: string;
  tenantId: string;
  ownerUserId: string;
  subjectType: GuestCommentSubjectType;
  subjectId?: string;
  displayName: string;
  avatarId: GuestAvatarId;
  body: string;
  normalizedEmail: string;
  status: GuestCommentStatus;
  /** Development-only opaque capability reference; production must persist a TTL-bound token hash instead. */
  developmentVerificationTokenReference: string;
  emailVerifiedAt?: string;
  moderatedAt?: string;
  moderatedByUserId?: string;
  createdAt: string;
  updatedAt: string;
  resourceVersion: number;
}

export interface CommentSubmissionAssessment {
  allowed: boolean;
  reason?: string;
}

/** Integration seam for gateway/cache-backed throttling, CAPTCHA, and abuse policy. */
export interface CommentAntiAbuseService {
  assessSubmission(input: { subjectType: GuestCommentSubjectType; subjectId?: string }): Promise<CommentSubmissionAssessment>;
}

/**
 * Provider-neutral, authenticated private-field-tool weather contract. Coordinates are rounded before
 * provider dispatch and never become a public projection or a ShootSession data field.
 */
export type WeatherProviderId = 'open-meteo' | 'met-no' | 'windy' | 'custom';
export interface WeatherForecastRequest {
  latitude: number;
  longitude: number;
  forecastFor?: string;
}
export interface WeatherForecastPoint {
  at: string;
  cloudCoverPercent?: number;
  precipitationProbabilityPercent?: number;
  precipitationMm?: number;
  windSpeedKph?: number;
  windGustKph?: number;
  visibilityKm?: number;
}
export interface WeatherProviderForecast {
  fetchedAt: string;
  validUntil: string;
  points: WeatherForecastPoint[];
}
/** Trusted deployment configuration, never adapter-provided provenance. */
export interface WeatherProviderDescriptor {
  provider: WeatherProviderId;
  sourceLabel: string;
}
export interface WeatherProviderResponse extends WeatherProviderForecast {}
export interface WeatherForecast extends WeatherProviderForecast {
  provider: WeatherProviderId;
  sourceLabel: string;
  /** Coarsened location actually sent to the configured provider. */
  location: { latitude: number; longitude: number; precision: '0.01-degree' };
  cacheStatus: 'fresh' | 'cached';
}
export interface WeatherProvider {
  getForecast(request: WeatherForecastRequest): Promise<WeatherProviderResponse>;
}
export interface WeatherService {
  getForecast(actor: Actor, request: WeatherForecastRequest): Promise<WeatherForecast>;
}

export interface MapPlace extends TenantOwnedRecord {
  name: string;
  latitude: number;
  longitude: number;
  precision: 'exact' | 'approximate';
}

export interface RouteReference {
  provider: string;
  externalId: string;
  label: string;
}

export interface Hike extends TenantOwnedRecord {
  title: string;
  startedAt: string;
  distanceKm?: number;
  elevationGainM?: number;
  route: RouteReference;
  privateGeometry?: string;
}

export interface GearItem {
  id: string;
  tenantId: string;
  ownerUserId: string;
  name: string;
  weightGrams: number;
  quantity: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  resourceVersion: number;
}

export interface PackingPlan extends TenantOwnedRecord {
  name: string;
  gearItemIds: string[];
  snapshotWeightGrams: number;
}

/** Explicit recipient grant; it is not a public visibility flag and never enters sync. */
export type ShareableResourceType = 'hike' | 'gear-item' | 'packing-plan';
export interface TrailsShareGrant {
  id: string;
  tenantId: string;
  ownerUserId: string;
  recipientUserId: string;
  resourceType: ShareableResourceType;
  resourceId: string;
  expiresAt?: string;
  revokedAt?: string;
  createdAt: string;
}
/** Intentionally allowlisted; it excludes private geometry, provider IDs, and exact timestamps. */
export interface SharedHikeProjection {
  shareId: string;
  title: string;
  occurredOn: string;
  routeLabel: string;
  distanceKm?: number;
  elevationGainM?: number;
}
/** Intentionally allowlisted equipment specification, not an inventory record. */
export interface SharedGearProjection {
  shareId: string;
  name: string;
  weightGrams: number;
  quantity: number;
}
export interface SharedPackingGearProjection {
  name: string;
  weightGrams: number;
  quantity: number;
}
/** Nested gear entries are server-projected rather than exposing gearItemIds. */
export interface SharedPackingPlanProjection {
  shareId: string;
  name: string;
  snapshotWeightGrams: number;
  gear: SharedPackingGearProjection[];
}
export type SharedResourceProjection = SharedHikeProjection | SharedGearProjection | SharedPackingPlanProjection;
/** Trusted Darwin membership lookup; action bodies never decide recipient tenancy or existence. */
export interface TrailsRecipientDirectory {
  isAuthenticatedMember(input: { tenantId: string; userId: string }): Promise<boolean>;
}

export interface FinanceEntry {
  id: string;
  tenantId: string;
  ownerUserId: string;
  occurredOn: string;
  category: string;
  amountCents: number;
  currency: string;
  receipt?: PrivateOriginalCapability;
  createdAt: string;
  updatedAt: string;
  resourceVersion: number;
}

/** A private operational spine that references existing domains by opaque development IDs. */
export type ShootSessionStatus = 'planned' | 'in_field' | 'processing' | 'published' | 'archived';

export interface ShootSessionLocation {
  /** Owner-only precise coordinates; never eligible for a public projection. */
  latitude: number;
  longitude: number;
  /** Owner-controlled, generalized label. This foundation still does not expose sessions publicly. */
  publicLabel?: string;
  /** Owner-only route, parking, access, and operational notes. */
  accessNotes?: string;
}

export interface ShootSession extends Omit<TenantOwnedRecord, 'lifecycle'> {
  status: ShootSessionStatus;
  title: string;
  /** Intended date/time is private, including future dates. */
  plannedFor?: string;
  location: ShootSessionLocation;
  fieldObservations: string[];
  checklist: string[];
  shotIntent?: string;
  /** Opaque development references only; durable foreign keys are a later migration concern. */
  hikeId?: string;
  gearItemIds: string[];
  workIds: string[];
  ledgerEntryIds: string[];
}

export type GuidedTripPlanStatus = 'draft' | 'open' | 'closed' | 'cancelled' | 'completed';
export type GuidedTripContingencyStatus = 'normal' | 'weather-watch' | 'weather-contingency' | 'cancelled';
export type GuidedTripRegistrationStatus = 'submitted' | 'waitlisted' | 'approved-awaiting-payment' | 'confirmed' | 'rejected' | 'cancelled';

/** This is intentionally limited to public-safe itinerary information. */
export interface GuidedTripItineraryItem {
  dayLabel: string;
  summary: string;
}

/** References identify future public materials; they do not grant storage access. */
export interface GuidedTripMaterialReference {
  label: string;
  reference: string;
}

export interface GuidedTripPlan extends TenantOwnedRecord {
  title: string;
  summary: string;
  publicLocationLabel: string;
  startsOn: string;
  endsOn: string;
  capacity: number;
  planStatus: GuidedTripPlanStatus;
  contingencyStatus: GuidedTripContingencyStatus;
  publicContingencyMessage?: string;
  publicItinerary: GuidedTripItineraryItem[];
  checklist: string[];
  publicMaterialReferences: GuidedTripMaterialReference[];
  /** Owner/admin only; never included in a public or participant projection. */
  privateOperationalNotes?: string;
}

/**
 * Participant records are private. This foundation deliberately excludes medical,
 * emergency-contact, payment, insurance, identity-document, and signature fields.
 */
export interface GuidedTripRegistration {
  id: string;
  tenantId: string;
  tripPlanId: string;
  participantUserId: string;
  status: GuidedTripRegistrationStatus;
  contactPreference?: string;
  requiredAcknowledgementAcceptedAt: string;
  releaseAcceptedAt: string;
  releaseVersion: string;
  createdAt: string;
  updatedAt: string;
  resourceVersion: number;
}

export interface GuidedTripOwnerSummary {
  trip: GuidedTripPlan;
  registrationCounts: Record<GuidedTripRegistrationStatus, number>;
  reservedCapacity: number;
  remainingCapacity: number;
}

export type SyncResourceType = 'portfolio' | 'portfolio-category' | 'journal' | 'map-place' | 'hike' | 'gear-item' | 'packing-plan' | 'finance-entry';
export type SyncScope = 'owner' | 'owner-finance';
export type SyncOperation = 'upsert';
export type SyncResource = Portfolio | PortfolioCategory | Journal | MapPlace | Hike | GearItem | PackingPlan | FinanceEntry;
export type SyncWritableResourceType = 'portfolio-category';

/** Caller-controlled fields only; ownership, timestamps, lifecycle, status and revision are server-authoritative. */
export interface PortfolioCategorySyncPayload {
  slug?: string;
  nameZh?: string;
  description?: string;
  sortOrder?: number;
  visibility?: Visibility;
}

/** A device ID labels an installation for diagnostics; it is never an authorization credential. */
export interface SyncMutation {
  mutationId: string;
  deviceId: string;
  resourceType: SyncWritableResourceType;
  resourceId: string;
  operation: SyncOperation;
  baseVersion: number | null;
  payload: PortfolioCategorySyncPayload;
}

export interface SyncChange {
  cursor: string;
  resourceType: SyncResourceType;
  resourceId: string;
  operation: SyncOperation;
  updatedAt: string;
  resource: SyncResource;
}

export interface SyncPushApplied {
  kind: 'applied' | 'duplicate';
  mutationId: string;
  resource: SyncResource;
}

export interface SyncPushConflict {
  kind: 'conflict';
  mutationId: string;
  code: 'STALE_VERSION';
  resourceType: SyncResourceType;
  resourceId: string;
  baseVersion: number | null;
  current: SyncResource;
}

export type SyncPushResult = SyncPushApplied | SyncPushConflict;

export interface SyncPullResult {
  contractVersion: 1;
  scope: SyncScope;
  changes: SyncChange[];
  nextCursor: string;
}

/**
 * The v2 wire contract keeps MySQL BIGINT values as canonical decimal strings.
 * It is intentionally separate from the synchronous development-only v1 repository.
 */
export type DurableDecimalString = string;
export interface DurablePortfolioCategoryMutation {
  mutationId: string;
  resourceId: string;
  baseVersion: DurableDecimalString | null;
  payload: PortfolioCategorySyncPayload;
}
export interface DurablePortfolioCategory extends Omit<PortfolioCategory, 'resourceVersion'> {
  resourceVersion: DurableDecimalString;
}
export interface DurablePortfolioCategoryPushApplied {
  kind: 'applied' | 'duplicate';
  mutationId: string;
  resource: DurablePortfolioCategory;
}
export interface DurablePortfolioCategoryPushConflict {
  kind: 'conflict';
  mutationId: string;
  code: 'STALE_VERSION';
  resourceId: string;
  baseVersion: DurableDecimalString | null;
  current: DurablePortfolioCategory;
}
export type DurablePortfolioCategoryPushResult = DurablePortfolioCategoryPushApplied | DurablePortfolioCategoryPushConflict;
export interface DurablePortfolioCategoryChange {
  cursor: DurableDecimalString;
  resourceId: string;
  updatedAt: string;
  resource: DurablePortfolioCategory;
}
export interface DurablePortfolioCategoryPullResult {
  changes: DurablePortfolioCategoryChange[];
  nextCursor: DurableDecimalString;
}
/** Narrow durable boundary: v2 never falls through to TrailsRepository. */
export interface DurablePortfolioCategorySync {
  push(actor: Actor, mutation: DurablePortfolioCategoryMutation): Promise<DurablePortfolioCategoryPushResult>;
  create(actor: Actor, mutation: DurablePortfolioCategoryMutation): Promise<DurablePortfolioCategoryPushResult>;
  archive(actor: Actor, mutation: DurablePortfolioCategoryMutation): Promise<DurablePortfolioCategoryPushResult>;
  pull(actor: Actor, cursor?: DurableDecimalString): Promise<DurablePortfolioCategoryPullResult>;
  listWorkspace(actor: Actor): Promise<DurablePortfolioCategory[]>;
  listPublic(owner: Pick<Actor, 'tenantId' | 'userId'>): Promise<DurablePortfolioCategory[]>;
  resolvePublic(owner: Pick<Actor, 'tenantId' | 'userId'>, slug: string): Promise<DurablePortfolioCategory | undefined>;
  reorder(actor: Actor, mutations: DurablePortfolioCategoryMutation[]): Promise<DurablePortfolioCategoryPushResult[]>;
}

export interface DurablePortfolio extends Omit<Portfolio, 'resourceVersion'> {
  resourceVersion: DurableDecimalString;
}
export interface DurablePortfolioDraftInput {
  id: string;
  title: string;
  summary: string;
  categoryId?: string;
  coverMediaId?: string;
  mediaIds: string[];
  locationLabel?: string;
  photoTechnicalMetadata?: PhotoTechnicalMetadata;
  visibility: Visibility;
}
export interface DurablePortfolioTransitionInput { id: string; resourceVersion: DurableDecimalString; }
export interface DurablePortfolioUpdateInput extends DurablePortfolioDraftInput { resourceVersion: DurableDecimalString; }
/** Dedicated v2 portfolio boundary. It never reads or writes the v1 repository. */
export interface DurablePortfolioStore {
  createDraft(actor: Actor, input: DurablePortfolioDraftInput): Promise<DurablePortfolio>;
  update(actor: Actor, input: DurablePortfolioUpdateInput): Promise<DurablePortfolio>;
  publish(actor: Actor, input: DurablePortfolioTransitionInput): Promise<DurablePortfolio>;
  unpublish(actor: Actor, input: DurablePortfolioTransitionInput): Promise<DurablePortfolio>;
  listWorkspace(actor: Actor): Promise<DurablePortfolio[]>;
  listPublic(owner: Pick<Actor, 'tenantId' | 'userId'>, categoryId?: string): Promise<DurablePortfolio[]>;
}

/** Trusted deployment configuration; public requests never choose this owner. */
export interface PublicOwnerResolver {
  resolve(): { tenantId: string; ownerUserId: string } | undefined;
}

export interface DurableJournal extends Omit<Journal, 'resourceVersion'> {
  resourceVersion: DurableDecimalString;
}
export interface DurableJournalDraftInput {
  id: string;
  title: string;
  excerpt: string;
  body: string;
  coverMediaId?: string;
  visibility: Visibility;
}
export interface DurableJournalTransitionInput { id: string; resourceVersion: DurableDecimalString; }
export interface DurableJournalPinInput extends DurableJournalTransitionInput { isPinned: boolean; }
export interface DurableJournalUpdateInput extends DurableJournalDraftInput { resourceVersion: DurableDecimalString; }
/** Dedicated v2 journal boundary. It never reads or writes the v1 repository. */
export interface DurableJournalStore {
  createDraft(actor: Actor, input: DurableJournalDraftInput): Promise<DurableJournal>;
  update(actor: Actor, input: DurableJournalUpdateInput): Promise<DurableJournal>;
  publish(actor: Actor, input: DurableJournalTransitionInput): Promise<DurableJournal>;
  unpublish(actor: Actor, input: DurableJournalTransitionInput): Promise<DurableJournal>;
  setPinned(actor: Actor, input: DurableJournalPinInput): Promise<DurableJournal>;
  listWorkspace(actor: Actor): Promise<DurableJournal[]>;
  listPublic(owner: Pick<Actor, 'tenantId' | 'userId'>): Promise<DurableJournal[]>;
}

export type RichDocumentSubjectType = 'portfolio' | 'journal';
export type RichDocumentJson = { type: 'doc'; content?: RichDocumentNode[] };
export interface RichDocumentNode { type: string; attrs?: Record<string, unknown>; text?: string; marks?: RichDocumentMark[]; content?: RichDocumentNode[]; }
export type RichDocumentMark = { type: 'bold' | 'italic' | 'strike' } | { type: 'link'; attrs: { href: string } };
export interface DurableRichDocument { subjectType: RichDocumentSubjectType; subjectId: string; document: RichDocumentJson; revision: DurableDecimalString; resourceVersion: DurableDecimalString; createdAt: string; updatedAt: string; }
export interface DurableRichDocumentRevision extends DurableRichDocument { createdByUserId: string; }
export interface DurableRichDocumentConflict { kind: 'conflict'; current: DurableRichDocument; }
export interface DurableRichDocumentSaved { kind: 'saved'; document: DurableRichDocument; }
export type DurableRichDocumentSaveResult = DurableRichDocumentConflict | DurableRichDocumentSaved;
/** Creator-space scoped document boundary. It accepts neither tenant nor owner input. */
export interface DurableRichDocumentStore {
  read(actor: Actor, input: { subjectType: RichDocumentSubjectType; subjectId: string }): Promise<DurableRichDocument | undefined>;
  readPublic(owner: Pick<Actor, 'tenantId' | 'userId'>, input: { subjectType: RichDocumentSubjectType; subjectId: string }): Promise<DurableRichDocument | undefined>;
  save(actor: Actor, input: { subjectType: RichDocumentSubjectType; subjectId: string; baseRevision: DurableDecimalString; document: RichDocumentJson }): Promise<DurableRichDocumentSaveResult>;
  preview(actor: Actor, input: { subjectType: RichDocumentSubjectType; subjectId: string; document: RichDocumentJson }): Promise<{ document: RichDocumentJson; text: string }>;
}

/** Actor-owned private field record. It has no public or sharing projection. */
export interface DurableHike extends Omit<Hike, 'resourceVersion'> {
  resourceVersion: DurableDecimalString;
}
export interface DurableHikeCreateInput {
  id: string;
  title: string;
  startedAt: string;
  distanceKm?: number;
  elevationGainM?: number;
  route: RouteReference;
  privateGeometry?: string;
}
/** Closed same-actor workspace projection. It omits ownership, route identity, geometry, and lifecycle internals. */
export interface WorkspaceHike {
  id: string;
  title: string;
  startedAt: string;
  distanceKm?: number;
  elevationGainM?: number;
  routeLabel: string;
  resourceVersion: DurableDecimalString;
  createdAt: string;
  updatedAt: string;
}
/** Dedicated v2 private boundary. Actor ownership is direct and never creator-space scoped. */
export interface DurableHikeStore {
  create(actor: Actor, input: DurableHikeCreateInput): Promise<DurableHike>;
  listWorkspace(actor: Actor): Promise<DurableHike[]>;
}

/** Actor-owned inventory record. It is permanently private, draft-scoped, and excluded from v1 sharing. */
export interface DurableGearItem {
  id: string;
  tenantId: string;
  ownerUserId: string;
  name: string;
  weightGrams: number;
  quantity: number;
  active: boolean;
  visibility: 'private';
  lifecycle: 'draft';
  resourceVersion: DurableDecimalString;
  createdAt: string;
  updatedAt: string;
}
export interface DurableGearCreateInput { id: string; name: string; weightGrams: number; quantity: number; }
export interface DurableGearUpdateInput { id: string; resourceVersion: DurableDecimalString; name: string; weightGrams: number; quantity: number; }
export interface DurableGearDeactivateInput { id: string; resourceVersion: DurableDecimalString; }
/** Closed same-actor workspace projection. It omits identity, visibility, and lifecycle internals. */
export interface WorkspaceGear {
  id: string;
  name: string;
  weightGrams: number;
  quantity: number;
  active: boolean;
  resourceVersion: DurableDecimalString;
  createdAt: string;
  updatedAt: string;
}
/** Dedicated v2 inventory boundary. It never reads or writes GearItem v1 records. */
export interface DurableGearStore {
  create(actor: Actor, input: DurableGearCreateInput): Promise<DurableGearItem>;
  update(actor: Actor, input: DurableGearUpdateInput): Promise<DurableGearItem>;
  deactivate(actor: Actor, input: DurableGearDeactivateInput): Promise<DurableGearItem>;
  listWorkspace(actor: Actor): Promise<DurableGearItem[]>;
}

/** Actor-owned private plan whose selected gear weights are immutable item snapshots. */
export interface DurablePackingPlanItem { gearId: string; snapshotWeightGrams: number; sortOrder: number; }
export interface DurablePackingPlan {
  id: string;
  tenantId: string;
  ownerUserId: string;
  name: string;
  visibility: 'private';
  lifecycle: 'draft';
  resourceVersion: DurableDecimalString;
  createdAt: string;
  updatedAt: string;
  items: DurablePackingPlanItem[];
  snapshotWeightGrams: number;
}
export interface DurablePackingPlanCreateInput { id: string; name: string; gearIds: string[]; }
export interface DurablePackingPlanUpdateInput { id: string; resourceVersion: DurableDecimalString; name: string; gearIds: string[]; }
/** Closed same-actor workspace projection. Gear identifiers support only a separately authorized local display join. */
export interface WorkspacePackingPlanItem { gearId: string; snapshotWeightGrams: number; sortOrder: number; }
export interface WorkspacePackingPlan {
  id: string;
  name: string;
  items: WorkspacePackingPlanItem[];
  snapshotWeightGrams: number;
  resourceVersion: DurableDecimalString;
  createdAt: string;
  updatedAt: string;
}
/** Dedicated v2 private packing boundary. It never reads or writes v1 plans or sharing data. */
export interface DurablePackingPlanStore {
  create(actor: Actor, input: DurablePackingPlanCreateInput): Promise<DurablePackingPlan>;
  update(actor: Actor, input: DurablePackingPlanUpdateInput): Promise<DurablePackingPlan>;
  listWorkspace(actor: Actor): Promise<DurablePackingPlan[]>;
}

/** Private v2 finance record. Disposal removes every financial payload field from this projection. */
export interface DurableFinanceEntry {
  id: string;
  tenantId: string;
  ownerUserId: string;
  occurredOn?: string;
  category?: string;
  amountCents?: number;
  currency?: string;
  calendarFinancialYear: number;
  retentionExpiresAt: string;
  disposedAt?: string;
  visibility: 'private';
  lifecycle: 'draft';
  resourceVersion: DurableDecimalString;
  createdAt: string;
  updatedAt: string;
}
export interface DurableFinanceCreateInput { id: string; occurredOn: string; category: string; amountCents: number; currency: string; }
export interface DurableFinanceUpdateInput { id: string; resourceVersion: DurableDecimalString; occurredOn: string; category: string; amountCents: number; currency: string; }
/** Immutable owner-private, manually recorded balance point; it is never ledger-derived. */
export interface DurableFinanceBalanceSnapshot {
  id: string;
  tenantId: string;
  ownerUserId: string;
  observedAt?: string;
  balanceCents?: number;
  currency?: string;
  calendarFinancialYear: number;
  retentionExpiresAt: string;
  disposedAt?: string;
  visibility: 'private';
  lifecycle: 'draft';
  resourceVersion: DurableDecimalString;
  createdAt: string;
  updatedAt: string;
}
export interface DurableFinanceBalanceRecordInput { id: string; balanceCents: number; currency: string; }
export interface DurableFinanceDisposalResult { outcome: 'disposed' | 'nothing-eligible'; eligibleAt: string; executedAt: string; disposedCount: number; }
/** Closed same-actor finance projection. Retention, lifecycle, identity, and audit details remain outside the workspace boundary. */
export interface WorkspaceFinanceEntry {
  id: string;
  occurredOn: string;
  category: string;
  amountCents: number;
  currency: string;
  resourceVersion: DurableDecimalString;
  createdAt: string;
  updatedAt: string;
}
/** Closed manual snapshot projection. It is an observed balance, never a ledger-derived total. */
export interface WorkspaceFinanceBalance {
  id: string;
  observedAt: string;
  balanceCents: number;
  currency: string;
  resourceVersion: DurableDecimalString;
  createdAt: string;
}
/** Dedicated v2 private finance boundary. It has no receipt, attachment, session, sync, sharing, or v1 fallback surface. */
export interface DurableFinanceStore {
  create(actor: Actor, input: DurableFinanceCreateInput): Promise<DurableFinanceEntry>;
  update(actor: Actor, input: DurableFinanceUpdateInput): Promise<DurableFinanceEntry>;
  listWorkspace(actor: Actor): Promise<DurableFinanceEntry[]>;
  recordBalance(actor: Actor, input: DurableFinanceBalanceRecordInput): Promise<DurableFinanceBalanceSnapshot>;
  currentBalances(actor: Actor, currency?: string): Promise<DurableFinanceBalanceSnapshot[]>;
  disposeEligible(actor: Actor): Promise<DurableFinanceDisposalResult>;
}

/** Vendor-disabled media commerce. Derivatives are references, never object keys or delivery links. */
export type DurableMediaStatus = 'draft' | 'published' | 'withdrawn';
export type PrintEditionStatus = 'draft' | 'sellable' | 'withdrawn';
export type CommercialInquiryStatus = 'submitted' | 'reviewing' | 'closed';
export type DownloadLicenseRequestStatus = 'requested' | 'granted' | 'declined' | 'revoked';
export type ManualOrderStatus = 'submitted' | 'payment-recorded' | 'fulfilled' | 'refunded' | 'cancelled';
export interface DurableCommerceBase { id: string; tenantId: string; ownerUserId: string; resourceVersion: DurableDecimalString; createdAt: string; updatedAt: string; }
export interface DurableMedia extends DurableCommerceBase { title: string; summary: string; status: DurableMediaStatus; publicDerivativeReferences: Array<{ reference: string; width?: number; height?: number }>; }
export interface PrintEdition extends DurableCommerceBase { mediaId: string; title: string; description: string; currency: string; priceMinor: number; status: PrintEditionStatus; }
export interface CommercialLicenseInquiry extends DurableCommerceBase { mediaId: string; buyerUserId: string; message: string; status: CommercialInquiryStatus; }
export interface DownloadLicenseRequest extends DurableCommerceBase { mediaId: string; buyerUserId: string; status: DownloadLicenseRequestStatus; entitlementId?: string; }
/** Authorization record only: it never contains a download URL or delivery capability. */
export interface DownloadEntitlement extends DurableCommerceBase { mediaId: string; buyerUserId: string; requestId: string; status: 'active' | 'revoked'; }
export interface ManualOrder extends DurableCommerceBase { buyerUserId: string; editionId: string; titleSnapshot: string; currencySnapshot: string; priceMinorSnapshot: number; status: ManualOrderStatus; paidMinor: number; refundedMinor: number; }
export interface DurableCommerceMutation { mutationId: string; expectedResourceVersion: DurableDecimalString | null; }
export interface DurableMediaCommerceStore {
  createMedia(actor: Actor, mutation: DurableCommerceMutation & { id: string; title: string; summary: string; derivativeReferences: Array<{ reference: string; width?: number; height?: number }> }): Promise<DurableMedia>;
  transitionMedia(actor: Actor, mutation: DurableCommerceMutation & { id: string; status: DurableMediaStatus }): Promise<DurableMedia>;
  createEdition(actor: Actor, mutation: DurableCommerceMutation & { id: string; mediaId: string; title: string; description: string; currency: string; priceMinor: number }): Promise<PrintEdition>;
  transitionEdition(actor: Actor, mutation: DurableCommerceMutation & { id: string; status: PrintEditionStatus }): Promise<PrintEdition>;
  inquireCommercial(actor: Actor, mutation: DurableCommerceMutation & { id: string; mediaId: string; message: string }): Promise<CommercialLicenseInquiry>;
  requestDownloadLicense(actor: Actor, mutation: DurableCommerceMutation & { id: string; mediaId: string }): Promise<DownloadLicenseRequest>;
  decideDownloadLicense(actor: Actor, mutation: DurableCommerceMutation & { id: string; status: 'granted' | 'declined' | 'revoked' }): Promise<DownloadLicenseRequest>;
  createOrder(actor: Actor, mutation: DurableCommerceMutation & { id: string; editionId: string }): Promise<ManualOrder>;
  transitionOrder(actor: Actor, mutation: DurableCommerceMutation & { id: string; status: ManualOrderStatus; refundMinor?: number }): Promise<ManualOrder>;
  listPublic(owner: Pick<Actor, 'tenantId' | 'userId'>): Promise<{ media: DurableMedia[]; editions: PrintEdition[] }>;
  listBuyer(actor: Actor): Promise<{ inquiries: CommercialLicenseInquiry[]; requests: DownloadLicenseRequest[]; entitlements: DownloadEntitlement[]; orders: ManualOrder[] }>;
  listOwner(actor: Actor): Promise<{ media: DurableMedia[]; editions: PrintEdition[]; inquiries: CommercialLicenseInquiry[]; requests: DownloadLicenseRequest[]; entitlements: DownloadEntitlement[]; orders: ManualOrder[] }>;
}

/** Private v2 manual-handoff contract. It deliberately has no URL, platform account, OAuth, post, media locator, delivery, or scheduling field. */
export type DurablePublishingPackageStatus = 'draft' | 'prepared' | 'reviewed' | 'approved' | 'ready_manual_handoff' | 'manually_published' | 'measured' | 'learned';
export interface DurablePublishingExportVariant { mediaId: string; cropIntent: 'square' | 'portrait' | 'landscape' | 'original'; intendedUse: string; }
export interface DurablePublishingApprovalChecklist { copyApproved: boolean; mediaSelectionApproved: boolean; rightsApproved: boolean; locationPrivacyApproved: boolean; factualClaimsApproved: boolean; }
export interface DurablePublishingFactualClaim { text: string; verification: 'verified' | 'unverified'; }
export interface DurablePublishingMeasurementEvent { occurredAt: string; metric: 'impressions' | 'reach' | 'engagements' | 'profile_visits' | 'link_clicks' | 'qualified_inquiries'; value: number; }
export interface DurablePublishingLearning { summary: string; confidence: LearningConfidence; }
export interface DurablePublishingPackage { id: string; tenantId: string; ownerUserId: string; sourceWorkId: string; platform: string; copy: string; contentOrigin: 'human' | 'ai-draft-requires-review'; exportVariants: DurablePublishingExportVariant[]; locationPolicy: 'withheld' | 'generalized'; containsGpsOrRouteHints: boolean; rightsStatus: 'cleared' | 'restricted'; rightsDisclosure?: string; factualClaims: DurablePublishingFactualClaim[]; approvals: DurablePublishingApprovalChecklist; status: DurablePublishingPackageStatus; manuallyPublishedByUserId?: string; manuallyPublishedAt?: string; measurementEvents: DurablePublishingMeasurementEvent[]; learning?: DurablePublishingLearning; resourceVersion: DurableDecimalString; createdAt: string; updatedAt: string; }
export interface DurablePublishingMutation { mutationId: string; expectedResourceVersion: DurableDecimalString | null; }
export interface DurablePublishingPackageStore {
  create(actor: Actor, input: DurablePublishingMutation & Omit<DurablePublishingPackage, 'tenantId' | 'ownerUserId' | 'status' | 'manuallyPublishedByUserId' | 'manuallyPublishedAt' | 'measurementEvents' | 'learning' | 'resourceVersion' | 'createdAt' | 'updatedAt'>): Promise<DurablePublishingPackage>;
  transition(actor: Actor, input: DurablePublishingMutation & { id: string; status: DurablePublishingPackageStatus; manualConfirmation?: boolean }): Promise<DurablePublishingPackage>;
  measure(actor: Actor, input: DurablePublishingMutation & { id: string; measurementEvents: DurablePublishingMeasurementEvent[] }): Promise<DurablePublishingPackage>;
  learn(actor: Actor, input: DurablePublishingMutation & { id: string; learning: DurablePublishingLearning }): Promise<DurablePublishingPackage>;
  listWorkspace(actor: Actor): Promise<DurablePublishingPackage[]>;
}

export type DurableGuidedTripStatus = 'draft' | 'published' | 'cancelled';
export interface DurableGuidedTripItineraryItem { dayLabel: string; summary: string; }
export interface DurableGuidedTripMaterialReference { label: string; reference: string; }
export interface DurableGuidedTripDraftInput { id: string; title: string; summary: string; locationLabel: string; startsOn: string; endsOn: string; itinerary: DurableGuidedTripItineraryItem[]; checklist: string[]; materialReferences: DurableGuidedTripMaterialReference[]; publicContingencyMessage?: string; }
export interface DurableGuidedTrip extends DurableGuidedTripDraftInput { tenantId: string; ownerUserId: string; status: DurableGuidedTripStatus; resourceVersion: DurableDecimalString; createdAt: string; updatedAt: string; publishedAt?: string; cancelledAt?: string; }
export interface DurableGuidedTripMutation { mutationId: string; expectedResourceVersion: DurableDecimalString | null; }
export interface DurableGuidedTripStore { createDraft(actor: Actor, input: DurableGuidedTripMutation & DurableGuidedTripDraftInput): Promise<DurableGuidedTrip>; updateDraft(actor: Actor, input: DurableGuidedTripMutation & DurableGuidedTripDraftInput): Promise<DurableGuidedTrip>; publish(actor: Actor, input: DurableGuidedTripMutation & { id: string }): Promise<DurableGuidedTrip>; unpublish(actor: Actor, input: DurableGuidedTripMutation & { id: string }): Promise<DurableGuidedTrip>; cancel(actor: Actor, input: DurableGuidedTripMutation & { id: string }): Promise<DurableGuidedTrip>; listWorkspace(actor: Actor): Promise<DurableGuidedTrip[]>; listPublic(owner: Pick<Actor, 'tenantId' | 'userId'>): Promise<DurableGuidedTrip[]>; readPublic(owner: Pick<Actor, 'tenantId' | 'userId'>, id: string): Promise<DurableGuidedTrip | undefined>; }

/** Private operational record. It deliberately excludes contact, health, identity-document, and payment data. */
export type DurableTripRegistrationStatus = 'submitted' | 'waitlisted' | 'confirmed' | 'rejected' | 'cancelled';
export interface DurableTripRegistration { id: string; tripId: string; status: DurableTripRegistrationStatus; requiredAcknowledgementAcceptedAt: string; releaseAcceptedAt: string; releaseVersion: string; resourceVersion: DurableDecimalString; createdAt: string; updatedAt: string; }
export interface DurableTripRegistrationStore {
  submit(actor: Actor, input: { mutationId: string; tripId: string; requiredAcknowledgement: true; releaseAccepted: true; releaseVersion: string }): Promise<DurableTripRegistration>;
  readMine(actor: Actor, input: { id: string }): Promise<DurableTripRegistration | undefined>;
  cancelMine(actor: Actor, input: { id: string; resourceVersion: DurableDecimalString; mutationId: string }): Promise<DurableTripRegistration>;
  transition(actor: Actor, input: { id: string; status: Exclude<DurableTripRegistrationStatus, 'submitted'>; resourceVersion: DurableDecimalString; mutationId: string }): Promise<DurableTripRegistration>;
  configureCapacity(actor: Actor, input: { tripId: string; capacity: number; mutationId: string }): Promise<{ tripId: string; capacity: number }>;
  summary(actor: Actor, input: { tripId: string }): Promise<{ tripId: string; capacity: number; confirmed: number; remaining: number; counts: Record<DurableTripRegistrationStatus, number> }>;
}

/** Metadata-only Bilibili reference. No media, player, embed, provider, or remote content belongs to this boundary. */
export type DurableExternalVideoReferenceStatus = 'draft' | 'published' | 'archived';
export interface DurableExternalVideoReferenceDraftInput { id: string; portfolioId: string; title: string; summary: string; canonicalUrl: string; sortOrder: number; }
export interface DurableExternalVideoReference extends DurableExternalVideoReferenceDraftInput { tenantId: string; ownerUserId: string; status: DurableExternalVideoReferenceStatus; resourceVersion: DurableDecimalString; createdAt: string; updatedAt: string; publishedAt?: string; archivedAt?: string; }
export interface DurableExternalVideoReferenceMutation { mutationId: string; expectedResourceVersion: DurableDecimalString | null; }
export interface DurableExternalVideoReferenceStore { createDraft(actor: Actor, input: DurableExternalVideoReferenceMutation & DurableExternalVideoReferenceDraftInput): Promise<DurableExternalVideoReference>; updateDraft(actor: Actor, input: DurableExternalVideoReferenceMutation & DurableExternalVideoReferenceDraftInput): Promise<DurableExternalVideoReference>; publish(actor: Actor, input: DurableExternalVideoReferenceMutation & { id: string }): Promise<DurableExternalVideoReference>; unpublish(actor: Actor, input: DurableExternalVideoReferenceMutation & { id: string }): Promise<DurableExternalVideoReference>; archive(actor: Actor, input: DurableExternalVideoReferenceMutation & { id: string }): Promise<DurableExternalVideoReference>; listWorkspace(actor: Actor): Promise<DurableExternalVideoReference[]>; listPublic(owner: Pick<Actor, 'tenantId' | 'userId'>): Promise<DurableExternalVideoReference[]>; }

/** Deliberately closed editorial card. It contains no coordinates, routes, logistics, media, or operational data. */
export type DurableLocationCardStatus = 'draft' | 'published' | 'archived';
export interface DurableLocationCardDraftInput { id: string; name: string; regionLabel: string; summary?: string; }
export interface DurableLocationCard extends DurableLocationCardDraftInput { tenantId: string; ownerUserId: string; status: DurableLocationCardStatus; resourceVersion: DurableDecimalString; createdAt: string; updatedAt: string; publishedAt?: string; archivedAt?: string; }
export interface DurableLocationCardMutation { mutationId: string; expectedResourceVersion: DurableDecimalString | null; }
export interface DurableLocationCardStore { createDraft(actor: Actor, input: DurableLocationCardMutation & DurableLocationCardDraftInput): Promise<DurableLocationCard>; updateDraft(actor: Actor, input: DurableLocationCardMutation & DurableLocationCardDraftInput): Promise<DurableLocationCard>; publish(actor: Actor, input: DurableLocationCardMutation & { id: string }): Promise<DurableLocationCard>; unpublish(actor: Actor, input: DurableLocationCardMutation & { id: string }): Promise<DurableLocationCard>; archive(actor: Actor, input: DurableLocationCardMutation & { id: string }): Promise<DurableLocationCard>; listWorkspace(actor: Actor): Promise<DurableLocationCard[]>; listPublic(owner: Pick<Actor, 'tenantId' | 'userId'>): Promise<DurableLocationCard[]>; }

/** Owner-only operational location. It is never eligible for public, analytics, sync, or sharing projections. */
export type ShootingLocationStatus = 'active' | 'archived';
export interface ShootingLocationDraftInput { id: string; name: string; latitude: number; longitude: number; notes?: string; }
export interface ShootingLocation extends ShootingLocationDraftInput { tenantId: string; ownerUserId: string; status: ShootingLocationStatus; resourceVersion: DurableDecimalString; createdAt: string; updatedAt: string; archivedAt?: string; }
export interface ShootingLocationMutation { mutationId: string; expectedResourceVersion: DurableDecimalString | null; }
/** Isolated v2 boundary. Only the trusted owner may read or mutate precise coordinates and private notes. */
export interface ShootingLocationStore { create(actor: Actor, input: ShootingLocationMutation & ShootingLocationDraftInput): Promise<ShootingLocation>; update(actor: Actor, input: ShootingLocationMutation & ShootingLocationDraftInput): Promise<ShootingLocation>; archive(actor: Actor, input: ShootingLocationMutation & { id: string }): Promise<ShootingLocation>; listWorkspace(actor: Actor): Promise<ShootingLocation[]>; }

export type DurablePublicSiteContentStatus = 'draft' | 'published';
export interface PublicSiteContactLink { kind: 'website' | 'instagram' | 'linkedin'; href: string; }
/** Sanitized structured rich text, never HTML. */
export interface PublicSiteBiography { plainText: string; richText?: RichDocumentJson; }
export const publicChromeTargets = ['home', 'editions', 'stories', 'trips', 'locations', 'about', 'guestbook'] as const;
export type PublicChromeTarget = typeof publicChromeTargets[number];
export interface PublicChromeLink { label: string; target: PublicChromeTarget; }
export interface PublicSiteChrome { navigation: PublicChromeLink[]; footer: { links: PublicChromeLink[]; copyright: string; icpFilingNumber?: string; }; }
/** Closed editorial-only About extension. It deliberately has no links, media, identity, or location fields. */
export interface PublicAboutProfile {
  professionalIdentity: { headline: string; disciplines: string[] };
  practiceStatement: string;
  collaborationDirections: string[];
  selectedCredentials: string[];
  selectedProjects: Array<{ title: string; summary: string }>;
}
/** Server-owned legacy fallback. Editorial input may alter labels and target order, not paths or markup. */
export const DEFAULT_PUBLIC_SITE_CHROME: PublicSiteChrome = {
  navigation: [
    { label: '影像', target: 'home' }, { label: '手记', target: 'stories' },
    { label: '摄影计划', target: 'trips' }, { label: '关于', target: 'about' }, { label: '留言', target: 'guestbook' },
  ],
  footer: { links: [{ label: '关于', target: 'about' }, { label: '留言', target: 'guestbook' }], copyright: '© 星迹 / PHOTOGRAPHY PORTFOLIO' },
};
/** `chrome` remains optional only while hydrating legacy content_json rows. */
export interface PublicSiteContent { displayName: string; biography: PublicSiteBiography; contactLinks: PublicSiteContactLink[]; licensingCopy: string; seo: { title: string; description: string }; aboutProfile?: PublicAboutProfile; aboutPortraitMediaId?: string; chrome?: PublicSiteChrome; }
export interface EffectivePublicSiteContent extends Omit<PublicSiteContent, 'chrome'> { chrome: PublicSiteChrome; }
export interface DurablePublicSiteContent extends EffectivePublicSiteContent { tenantId: string; ownerUserId: string; status: DurablePublicSiteContentStatus; resourceVersion: DurableDecimalString; createdAt: string; updatedAt: string; publishedAt?: string; }
export interface DurablePublicSiteContentStore {
  readWorkspace(actor: Actor): Promise<DurablePublicSiteContent | undefined>;
  saveDraft(actor: Actor, input: EffectivePublicSiteContent & { resourceVersion: DurableDecimalString | null }): Promise<DurablePublicSiteContent>;
  publish(actor: Actor, input: { resourceVersion: DurableDecimalString }): Promise<DurablePublicSiteContent>;
  unpublish(actor: Actor, input: { resourceVersion: DurableDecimalString }): Promise<DurablePublicSiteContent>;
  readPublic(owner: Pick<Actor, 'tenantId' | 'userId'>): Promise<DurablePublicSiteContent | undefined>;
}

export type DurableGuestCommentSubjectType = 'guestbook' | 'portfolio' | 'journal';
export type DurableGuestCommentStatus = 'pending-verification' | 'pending-moderation' | 'approved' | 'rejected' | 'redacted';
export interface DurableGuestComment { id: string; tenantId: string; ownerUserId: string; subjectType: DurableGuestCommentSubjectType; subjectId?: string; displayName: string; avatarId: GuestAvatarId; body: string; verificationTokenHash?: string; verificationExpiresAt?: string; status: DurableGuestCommentStatus; resourceVersion: DurableDecimalString; verifiedAt?: string; moderatedAt?: string; moderatedByUserId?: string; redactedAt?: string; createdAt: string; updatedAt: string; }
export interface DurableGuestCommentSubmission extends Omit<DurableGuestComment, 'verificationTokenHash' | 'verificationExpiresAt' | 'status' | 'resourceVersion' | 'verifiedAt' | 'moderatedAt' | 'moderatedByUserId' | 'redactedAt' | 'createdAt' | 'updatedAt'> { email: string; verificationToken: string; verificationExpiresAt: string; }
export interface DurableGuestCommentAudit { eventId: string; commentId: string; operation: 'submitted' | 'verified' | 'moderated' | 'redacted'; fromStatus?: DurableGuestCommentStatus; toStatus: DurableGuestCommentStatus; actorUserId?: string; resourceVersion: DurableDecimalString; occurredAt: string; }
/** `deliveryId` is a stable provider-facing idempotency key for at-least-once outbox delivery. */
export interface CommentVerificationNotificationDispatcher { dispatchVerification(input: { deliveryId: string; email: string; commentId: string; verificationToken: string; expiresAt: string }): Promise<void>; }
export interface DurableGuestCommentStore {
  submit(input: DurableGuestCommentSubmission): Promise<DurableGuestComment>;
  verify(input: { token: string }): Promise<DurableGuestComment | undefined>;
  listModeration(actor: Actor): Promise<DurableGuestComment[]>;
  moderate(actor: Actor, input: { id: string; status: 'approved' | 'rejected'; resourceVersion: DurableDecimalString }): Promise<DurableGuestComment>;
  listPublic(owner: Pick<Actor, 'tenantId' | 'userId'>, input: { subjectType: DurableGuestCommentSubjectType; subjectId?: string }): Promise<DurableGuestComment[]>;
  redactRetained(actor: Actor, input: { before: string }): Promise<number>;
  dispatchPending(dispatcher: CommentVerificationNotificationDispatcher, input: { commentId: string }): Promise<{ outcome: 'sent' | 'retryable-failure' | 'failed' | 'nothing-due' }>;
  retryNotifications(actor: Actor, dispatcher: CommentVerificationNotificationDispatcher, input: { limit: number }): Promise<{ attempted: number; sent: number; retryableFailures: number }>;
}

export interface TrailsOverview {
  publishedPortfolioCount: number;
  publishedJournalCount: number;
  publishedMapPlaceCount: number;
}

/** Aggregate-only public-site measurement. It never accepts identity, IP, URL, referrer, or device data. */
export type PublicAnalyticsContentType = 'site' | 'portfolio' | 'journal' | 'trip' | 'edition' | 'location';
export type PublicAnalyticsEventName = 'page-view' | 'content-view' | 'outbound-click';
export type PublicAnalyticsAcquisitionChannel = 'direct' | 'external-referral' | 'campaign';
export type PublicAnalyticsDeviceClass = 'desktop' | 'mobile' | 'tablet' | 'other';
export interface PublicAnalyticsEvent {
  eventId: string;
  eventName: PublicAnalyticsEventName;
  contentType: PublicAnalyticsContentType;
  contentId?: string;
  occurredAt: string;
  /** Short-lived first-party random value. The server stores only a keyed daily digest. */
  visitorId?: string;
  acquisitionChannel?: PublicAnalyticsAcquisitionChannel;
  deviceClass?: PublicAnalyticsDeviceClass;
}
export interface AnalyticsTrendPoint { date: string; pageViews: number; visitors: number; }
export interface AnalyticsContentRanking { contentType: Exclude<PublicAnalyticsContentType, 'site'>; contentId: string; pageViews: number; visitors: number; }
export interface AnalyticsWorkspaceOverview { enabled: boolean; range: { from: string; to: string }; totals: { pageViews: number; visitors: number; contentViews: number; outboundClicks: number }; trend: AnalyticsTrendPoint[]; topContent: AnalyticsContentRanking[]; acquisition: Array<{ channel: PublicAnalyticsAcquisitionChannel; pageViews: number }>; devices: Array<{ deviceClass: PublicAnalyticsDeviceClass; pageViews: number }>; unavailableDomains: Array<'trip-registration' | 'revenue'>; }
/** Private library display aggregate. It intentionally excludes visitors, events, and comment content. */
export interface AnalyticsContentMetrics { range: { from: string; to: string }; metrics: Array<{ contentType: 'portfolio' | 'journal'; contentId: string; pageViews: number; approvedCommentCount: number }>; }
export interface AnalyticsContentMetricsInput { from: string; to: string; content: { portfolioIds: string[]; journalIds: string[] }; }
export interface DurableAnalyticsStore {
  ingest(owner: Pick<Actor, 'tenantId' | 'userId'>, event: PublicAnalyticsEvent): Promise<void>;
  readWorkspace(actor: Actor, input: { from: string; to: string }): Promise<AnalyticsWorkspaceOverview>;
  readContentMetrics(actor: Actor, input: AnalyticsContentMetricsInput): Promise<AnalyticsContentMetrics>;
}

export interface Actor {
  userId: string;
  tenantId: string;
  isAdmin: boolean;
  /** Server-resolved creator-space membership. It is never read from an action payload. */
  creatorSpaceRole?: CreatorSpaceRole;
  /** The creator-space owner this actor may edit for; required for scoped editors. */
  creatorSpaceOwnerUserId?: string;
}

export type CreatorSpaceRole = 'creator-space-owner' | 'creator-space-editor' | 'participant';

/**
 * A UX projection of authorization calculated by Trails from trusted context and server-owned
 * creator-space membership. Clients may hide unavailable controls, but this is not a grant.
 */
export interface TrailsCapabilitySnapshot {
  privateFieldTools: true;
  creatorContent: boolean;
  creatorTrips: boolean;
  creatorSpaceRole: CreatorSpaceRole;
}

export interface TrailsState {
  repository: TrailsRepository;
  /** Feature-gated v2-only persistence adapter; absence is a 503, never a v1 fallback. */
  durablePortfolioCategorySync?: DurablePortfolioCategorySync;
  durablePortfolioStore?: DurablePortfolioStore;
  durableJournalStore?: DurableJournalStore;
  durableRichDocumentStore?: DurableRichDocumentStore;
  durableHikeStore?: DurableHikeStore;
  durableGearStore?: DurableGearStore;
  durablePackingPlanStore?: DurablePackingPlanStore;
  durableFinanceStore?: DurableFinanceStore;
  durableMediaCommerceStore?: DurableMediaCommerceStore;
  durableMediaAssetRegistryStore?: DurableMediaAssetRegistryStore;
  durablePublishingPackageStore?: DurablePublishingPackageStore;
  durablePublicSiteContentStore?: DurablePublicSiteContentStore;
  durableGuidedTripStore?: DurableGuidedTripStore;
  durableExternalVideoReferenceStore?: DurableExternalVideoReferenceStore;
  durableLocationCardStore?: DurableLocationCardStore;
  shootingLocationStore?: ShootingLocationStore;
  durableGuestCommentStore?: DurableGuestCommentStore;
  durableAnalyticsStore?: DurableAnalyticsStore;
  durableTripRegistrationStore?: DurableTripRegistrationStore;
  /** Optional only for tests; production composition uses the server-owned default resolver. */
  publicOwnerResolver?: PublicOwnerResolver;
  /** Optional deployment-provided anti-abuse assessment; absence denies submissions. */
  antiAbuse?: CommentAntiAbuseService;
  /** Required for comment submission; absent notification configuration fails closed. */
  commentVerificationNotificationDispatcher?: CommentVerificationNotificationDispatcher;
  /** Required to create recipient grants; omitted deployments fail closed. */
  recipientDirectory?: TrailsRecipientDirectory;
  /** Optional deployment-provided integration. No provider is enabled by default. */
  weather?: WeatherService;
  /** Exact HTTPS origins approved for publishing-package attribution destinations. */
  publishingAllowedOrigins?: string[];
}

export interface TrailsRepository {
  listPortfolios(filter: Partial<Pick<Portfolio, 'tenantId' | 'ownerUserId' | 'visibility' | 'lifecycle' | 'categoryId'>>): Portfolio[];
  getPortfolio(id: string): Portfolio | undefined;
  savePortfolio(portfolio: Portfolio): Portfolio;
  listPublishingPackages(filter: Partial<Pick<PublishingPackage, 'tenantId' | 'ownerUserId' | 'portfolioId' | 'platform' | 'status'>>): PublishingPackage[];
  getPublishingPackage(id: string): PublishingPackage | undefined;
  savePublishingPackage(publishingPackage: PublishingPackage): PublishingPackage;
  listPortfolioCategories(filter: Partial<Pick<PortfolioCategory, 'tenantId' | 'ownerUserId' | 'visibility' | 'status'>>): PortfolioCategory[];
  getPortfolioCategory(id: string): PortfolioCategory | undefined;
  getPortfolioCategoryBySlug(filter: Pick<PortfolioCategory, 'tenantId' | 'ownerUserId' | 'slug'>): PortfolioCategory | undefined;
  savePortfolioCategory(category: PortfolioCategory): PortfolioCategory;
  listJournals(filter: Partial<Pick<Journal, 'tenantId' | 'ownerUserId' | 'visibility' | 'lifecycle'>>): Journal[];
  getJournal(id: string): Journal | undefined;
  saveJournal(journal: Journal): Journal;
  getPublicOwnerProfile(owner: Pick<PublicOwnerProfileRecord, 'tenantId' | 'ownerUserId'>): PublicOwnerProfile | undefined;
  listGuestComments(filter: Partial<Pick<GuestComment, 'tenantId' | 'ownerUserId' | 'subjectType' | 'subjectId' | 'status'>>): GuestComment[];
  getGuestComment(id: string): GuestComment | undefined;
  saveGuestComment(comment: GuestComment): GuestComment;
  listMapPlaces(filter: Partial<Pick<MapPlace, 'tenantId' | 'ownerUserId' | 'visibility' | 'lifecycle'>>): MapPlace[];
  saveMapPlace(place: MapPlace): MapPlace;
  listHikes(filter: Partial<Pick<Hike, 'tenantId' | 'ownerUserId'>>): Hike[];
  getHike(id: string): Hike | undefined;
  saveHike(hike: Hike): Hike;
  listGear(filter: Partial<Pick<GearItem, 'tenantId' | 'ownerUserId'>>): GearItem[];
  saveGear(item: GearItem): GearItem;
  listPackingPlans(filter: Partial<Pick<PackingPlan, 'tenantId' | 'ownerUserId'>>): PackingPlan[];
  savePackingPlan(plan: PackingPlan): PackingPlan;
  listFinanceEntries(filter: Partial<Pick<FinanceEntry, 'tenantId' | 'ownerUserId'>>): FinanceEntry[];
  saveFinanceEntry(entry: FinanceEntry): FinanceEntry;
  listShootSessions(filter: Partial<Pick<ShootSession, 'tenantId' | 'ownerUserId' | 'status'>>): ShootSession[];
  getShootSession(id: string): ShootSession | undefined;
  saveShootSession(session: ShootSession): ShootSession;
  listGuidedTripPlans(filter: Partial<Pick<GuidedTripPlan, 'tenantId' | 'ownerUserId' | 'visibility' | 'lifecycle' | 'planStatus'>>): GuidedTripPlan[];
  getGuidedTripPlan(id: string): GuidedTripPlan | undefined;
  saveGuidedTripPlan(plan: GuidedTripPlan): GuidedTripPlan;
  listGuidedTripRegistrations(filter: Partial<Pick<GuidedTripRegistration, 'tenantId' | 'tripPlanId' | 'participantUserId' | 'status'>>): GuidedTripRegistration[];
  getGuidedTripRegistration(id: string): GuidedTripRegistration | undefined;
  getGuidedTripRegistrationForParticipant(filter: Pick<GuidedTripRegistration, 'tenantId' | 'tripPlanId' | 'participantUserId'>): GuidedTripRegistration | undefined;
  saveGuidedTripRegistration(registration: GuidedTripRegistration): GuidedTripRegistration;
  getShareGrant(id: string): TrailsShareGrant | undefined;
  saveShareGrant(grant: TrailsShareGrant): TrailsShareGrant;
  listShareGrants(filter: Partial<Pick<TrailsShareGrant, 'tenantId' | 'ownerUserId' | 'recipientUserId' | 'resourceType' | 'resourceId'>>): TrailsShareGrant[];
  pullChanges(actor: Actor, cursor: string | undefined, scope: SyncScope): { changes: SyncChange[]; nextCursor: string };
  pushMutation(actor: Actor, mutation: SyncMutation): SyncPushResult;
}
