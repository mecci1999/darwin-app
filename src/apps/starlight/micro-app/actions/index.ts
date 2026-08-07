import crypto from 'crypto';
import { strFromU8, unzipSync } from 'fflate';
import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, Starlight } from 'typings';
import { instrumentServiceActions } from '../../metrics/utils/action-metrics';
import { resolveTrailsWorkspaceActor } from '../creator-space-resolver';

type MicroAppVisibility = 'public' | 'tenant' | 'allowlist';

type MicroAppManifest = {
  appId: string;
  name: string;
  version: string;
  entry: string;
  description?: string;
  permissions?: Record<string, unknown>;
};

type TrailsWorkspaceOperation =
  | 'categories.workspace'
  | 'categories.create'
  | 'categories.update'
  | 'categories.archive'
  | 'categories.reorder'
  | 'media-assets.workspace-picker'
  | 'catalog.workspace' | 'media.create' | 'media.transition' | 'editions.create' | 'editions.transition'
  | 'portfolios.workspace'
  | 'portfolios.draft'
  | 'portfolios.update'
  | 'portfolios.publish'
  | 'portfolios.unpublish'
  | 'portfolios.rich-document.read'
  | 'portfolios.rich-document.save'
  | 'portfolios.rich-document.preview'
  | 'journals.workspace'
  | 'journals.draft'
  | 'journals.update'
  | 'journals.publish'
  | 'journals.unpublish'
  | 'journals.pin'
  | 'journals.rich-document.read'
  | 'journals.rich-document.save'
  | 'journals.rich-document.preview'
  | 'publishing-packages.workspace'
  | 'publishing-packages.create'
  | 'publishing-packages.transition'
  | 'publishing-packages.measure'
  | 'publishing-packages.learn'
  | 'site-content.workspace' | 'site-content.draft' | 'site-content.publish' | 'site-content.unpublish'
  | 'trips.workspace' | 'trips.draft' | 'trips.update' | 'trips.publish' | 'trips.unpublish' | 'trips.cancel'
  | 'trip-registrations.summary' | 'trip-registrations.capacity'
  | 'video-references.workspace' | 'video-references.draft' | 'video-references.update' | 'video-references.publish' | 'video-references.unpublish' | 'video-references.archive'
  | 'locations.workspace' | 'locations.draft' | 'locations.update' | 'locations.publish' | 'locations.unpublish' | 'locations.archive'
  | 'shooting-locations.workspace' | 'shooting-locations.create' | 'shooting-locations.update' | 'shooting-locations.archive'
  | 'comments.moderation-queue' | 'comments.moderate'
  | 'analytics.workspace'
  | 'analytics.content-metrics'
  | 'hikes.workspace' | 'hikes.create'
  | 'gear.workspace' | 'gear.create' | 'gear.update' | 'gear.deactivate'
  | 'packing-plans.workspace' | 'packing-plans.create' | 'packing-plans.update'
  | 'finance.workspace' | 'finance.create' | 'finance.update' | 'finance.balance.record' | 'finance.balance.current';

type TrailsWorkspaceGrant = {
  appId: string;
  version: string;
  audience: 'darwin:micro-app:trails-workspace';
  scopes: readonly string[];
};

type RuntimeTicketClaims = {
  aud: string;
  exp: number;
  jti: string;
  appId: string;
  version: string;
  scopes: readonly string[];
  userId: string;
  kind?: string;
};

type MicroAppSessionClaims = RuntimeTicketClaims & { kind: 'micro-app-session' };

type AtomicTicketCacher = {
  setIfNotExists?: (key: string, value: string, ttlSeconds: number) => Promise<boolean>;
  client?: { set: (key: string, value: string, ...args: string[]) => Promise<unknown> };
};

const TRAILS_WORKSPACE_GRANTS: readonly TrailsWorkspaceGrant[] = [{
  appId: 'starlight-trails-workspace',
  version: '1.0.0',
  audience: 'darwin:micro-app:trails-workspace',
  scopes: [
    'trails.v2.categories.workspace', 'trails.v2.categories.create', 'trails.v2.categories.update',
    'trails.v2.categories.archive', 'trails.v2.categories.reorder', 'trails.v2.media-assets.workspace-picker',
    'trails.v2.commerce.catalog.workspace', 'trails.v2.commerce.catalog.media.create', 'trails.v2.commerce.catalog.media.transition', 'trails.v2.commerce.catalog.editions.create', 'trails.v2.commerce.catalog.editions.transition',     'trails.v2.portfolios.workspace',
    'trails.v2.portfolios.draft', 'trails.v2.portfolios.update', 'trails.v2.portfolios.publish', 'trails.v2.portfolios.unpublish', 'trails.v2.portfolios.rich-document.read',
    'trails.v2.portfolios.rich-document.save', 'trails.v2.portfolios.rich-document.preview', 'trails.v2.journals.workspace',
    'trails.v2.journals.draft', 'trails.v2.journals.update', 'trails.v2.journals.publish', 'trails.v2.journals.unpublish', 'trails.v2.journals.pin', 'trails.v2.journals.rich-document.read',
    'trails.v2.journals.rich-document.save', 'trails.v2.journals.rich-document.preview', 'trails.v2.publishing-packages.workspace',
    'trails.v2.publishing-packages.create', 'trails.v2.publishing-packages.transition',
    'trails.v2.publishing-packages.measure', 'trails.v2.publishing-packages.learn',
    'trails.v2.site-content.workspace', 'trails.v2.site-content.draft', 'trails.v2.site-content.publish', 'trails.v2.site-content.unpublish',
    'trails.v2.trips.workspace', 'trails.v2.trips.workspace.draft', 'trails.v2.trips.workspace.update', 'trails.v2.trips.workspace.publish', 'trails.v2.trips.workspace.unpublish', 'trails.v2.trips.workspace.cancel',
    'trails.v2.trip-registrations.summary', 'trails.v2.trip-registrations.capacity',
    'trails.v2.video-references.workspace', 'trails.v2.video-references.workspace.draft', 'trails.v2.video-references.workspace.update', 'trails.v2.video-references.workspace.publish', 'trails.v2.video-references.workspace.unpublish', 'trails.v2.video-references.workspace.archive',
    'trails.v2.locations.workspace', 'trails.v2.locations.workspace.draft', 'trails.v2.locations.workspace.update', 'trails.v2.locations.workspace.publish', 'trails.v2.locations.workspace.unpublish', 'trails.v2.locations.workspace.archive',
    'trails.v2.shooting-locations.workspace', 'trails.v2.shooting-locations.create', 'trails.v2.shooting-locations.update', 'trails.v2.shooting-locations.archive',
    'trails.v2.comments.moderation-queue', 'trails.v2.comments.moderate',
    'trails.v2.analytics.workspace',
    'trails.v2.hikes.workspace', 'trails.v2.hikes.create',
    'trails.v2.gear.workspace', 'trails.v2.gear.create', 'trails.v2.gear.update', 'trails.v2.gear.deactivate',
    'trails.v2.packing-plans.workspace', 'trails.v2.packing-plans.create', 'trails.v2.packing-plans.update',
    'trails.v2.finance.workspace', 'trails.v2.finance.create', 'trails.v2.finance.update', 'trails.v2.finance.balance.record', 'trails.v2.finance.balance.current',
  ],
}, {
  appId: 'starlight-trails-workspace',
  version: '1.0.1',
  audience: 'darwin:micro-app:trails-workspace',
  scopes: [
    'trails.v2.categories.workspace', 'trails.v2.categories.create', 'trails.v2.categories.update',
    'trails.v2.categories.archive', 'trails.v2.categories.reorder', 'trails.v2.media-assets.workspace-picker',
    'trails.v2.commerce.catalog.workspace', 'trails.v2.commerce.catalog.media.create', 'trails.v2.commerce.catalog.media.transition', 'trails.v2.commerce.catalog.editions.create', 'trails.v2.commerce.catalog.editions.transition', 'trails.v2.portfolios.workspace',
    'trails.v2.portfolios.draft', 'trails.v2.portfolios.update', 'trails.v2.portfolios.publish', 'trails.v2.portfolios.unpublish', 'trails.v2.portfolios.rich-document.read', 'trails.v2.portfolios.rich-document.save', 'trails.v2.portfolios.rich-document.preview',
    'trails.v2.journals.workspace', 'trails.v2.journals.draft', 'trails.v2.journals.update', 'trails.v2.journals.publish', 'trails.v2.journals.unpublish', 'trails.v2.journals.pin', 'trails.v2.journals.rich-document.read', 'trails.v2.journals.rich-document.save', 'trails.v2.journals.rich-document.preview',
    'trails.v2.publishing-packages.workspace', 'trails.v2.publishing-packages.create', 'trails.v2.publishing-packages.transition', 'trails.v2.publishing-packages.measure', 'trails.v2.publishing-packages.learn',
    'trails.v2.site-content.workspace', 'trails.v2.site-content.draft', 'trails.v2.site-content.publish', 'trails.v2.site-content.unpublish',
    'trails.v2.trips.workspace', 'trails.v2.trips.workspace.draft', 'trails.v2.trips.workspace.update', 'trails.v2.trips.workspace.publish', 'trails.v2.trips.workspace.unpublish', 'trails.v2.trips.workspace.cancel',
    'trails.v2.trip-registrations.summary', 'trails.v2.trip-registrations.capacity',
    'trails.v2.video-references.workspace', 'trails.v2.video-references.workspace.draft', 'trails.v2.video-references.workspace.update', 'trails.v2.video-references.workspace.publish', 'trails.v2.video-references.workspace.unpublish', 'trails.v2.video-references.workspace.archive',
    'trails.v2.locations.workspace', 'trails.v2.locations.workspace.draft', 'trails.v2.locations.workspace.update', 'trails.v2.locations.workspace.publish', 'trails.v2.locations.workspace.unpublish', 'trails.v2.locations.workspace.archive',
    'trails.v2.shooting-locations.workspace', 'trails.v2.shooting-locations.create', 'trails.v2.shooting-locations.update', 'trails.v2.shooting-locations.archive',
    'trails.v2.comments.moderation-queue', 'trails.v2.comments.moderate',
    'trails.v2.analytics.workspace', 'trails.v2.analytics.content-metrics',
    'trails.v2.hikes.workspace', 'trails.v2.hikes.create', 'trails.v2.gear.workspace', 'trails.v2.gear.create', 'trails.v2.gear.update', 'trails.v2.gear.deactivate',
    'trails.v2.packing-plans.workspace', 'trails.v2.packing-plans.create', 'trails.v2.packing-plans.update',
    'trails.v2.finance.workspace', 'trails.v2.finance.create', 'trails.v2.finance.update', 'trails.v2.finance.balance.record', 'trails.v2.finance.balance.current',
  ],
}];

const TRAILS_WORKSPACE_ACTIONS: Readonly<Record<TrailsWorkspaceOperation, { action: string; scope: string }>> = {
  'categories.workspace': { action: 'trails.v2.categories.workspace', scope: 'trails.v2.categories.workspace' },
  'categories.create': { action: 'trails.v2.categories.create', scope: 'trails.v2.categories.create' },
  'categories.update': { action: 'trails.v2.categories.update', scope: 'trails.v2.categories.update' },
  'categories.archive': { action: 'trails.v2.categories.archive', scope: 'trails.v2.categories.archive' },
  'categories.reorder': { action: 'trails.v2.categories.reorder', scope: 'trails.v2.categories.reorder' },
  'media-assets.workspace-picker': { action: 'trails.v2.media-assets.workspace-picker', scope: 'trails.v2.media-assets.workspace-picker' },
  'catalog.workspace': { action: 'trails.v2.commerce.catalog.workspace', scope: 'trails.v2.commerce.catalog.workspace' },
  'media.create': { action: 'trails.v2.commerce.catalog.media.create', scope: 'trails.v2.commerce.catalog.media.create' },
  'media.transition': { action: 'trails.v2.commerce.catalog.media.transition', scope: 'trails.v2.commerce.catalog.media.transition' },
  'editions.create': { action: 'trails.v2.commerce.catalog.editions.create', scope: 'trails.v2.commerce.catalog.editions.create' },
  'editions.transition': { action: 'trails.v2.commerce.catalog.editions.transition', scope: 'trails.v2.commerce.catalog.editions.transition' },
  'portfolios.workspace': { action: 'trails.v2.portfolios.workspace', scope: 'trails.v2.portfolios.workspace' },
  'portfolios.draft': { action: 'trails.v2.portfolios.draft', scope: 'trails.v2.portfolios.draft' },
  'portfolios.update': { action: 'trails.v2.portfolios.update', scope: 'trails.v2.portfolios.update' },
  'portfolios.publish': { action: 'trails.v2.portfolios.publish', scope: 'trails.v2.portfolios.publish' },
  'portfolios.unpublish': { action: 'trails.v2.portfolios.unpublish', scope: 'trails.v2.portfolios.unpublish' },
  'portfolios.rich-document.read': { action: 'trails.v2.portfolios.rich-document.read', scope: 'trails.v2.portfolios.rich-document.read' },
  'portfolios.rich-document.save': { action: 'trails.v2.portfolios.rich-document.save', scope: 'trails.v2.portfolios.rich-document.save' },
  'portfolios.rich-document.preview': { action: 'trails.v2.portfolios.rich-document.preview', scope: 'trails.v2.portfolios.rich-document.preview' },
  'journals.workspace': { action: 'trails.v2.journals.workspace', scope: 'trails.v2.journals.workspace' },
  'journals.draft': { action: 'trails.v2.journals.draft', scope: 'trails.v2.journals.draft' },
  'journals.update': { action: 'trails.v2.journals.update', scope: 'trails.v2.journals.update' },
  'journals.publish': { action: 'trails.v2.journals.publish', scope: 'trails.v2.journals.publish' },
  'journals.unpublish': { action: 'trails.v2.journals.unpublish', scope: 'trails.v2.journals.unpublish' },
  'journals.pin': { action: 'trails.v2.journals.pin', scope: 'trails.v2.journals.pin' },
  'journals.rich-document.read': { action: 'trails.v2.journals.rich-document.read', scope: 'trails.v2.journals.rich-document.read' },
  'journals.rich-document.save': { action: 'trails.v2.journals.rich-document.save', scope: 'trails.v2.journals.rich-document.save' },
  'journals.rich-document.preview': { action: 'trails.v2.journals.rich-document.preview', scope: 'trails.v2.journals.rich-document.preview' },
  'publishing-packages.workspace': { action: 'trails.v2.publishing-packages.workspace', scope: 'trails.v2.publishing-packages.workspace' },
  'publishing-packages.create': { action: 'trails.v2.publishing-packages.create', scope: 'trails.v2.publishing-packages.create' },
  'publishing-packages.transition': { action: 'trails.v2.publishing-packages.transition', scope: 'trails.v2.publishing-packages.transition' },
  'publishing-packages.measure': { action: 'trails.v2.publishing-packages.measure', scope: 'trails.v2.publishing-packages.measure' },
  'publishing-packages.learn': { action: 'trails.v2.publishing-packages.learn', scope: 'trails.v2.publishing-packages.learn' },
  'site-content.workspace': { action: 'trails.v2.site-content.workspace', scope: 'trails.v2.site-content.workspace' },
  'site-content.draft': { action: 'trails.v2.site-content.draft', scope: 'trails.v2.site-content.draft' },
  'site-content.publish': { action: 'trails.v2.site-content.publish', scope: 'trails.v2.site-content.publish' },
  'site-content.unpublish': { action: 'trails.v2.site-content.unpublish', scope: 'trails.v2.site-content.unpublish' },
  'trips.workspace': { action: 'trails.v2.trips.workspace', scope: 'trails.v2.trips.workspace' },
  'trips.draft': { action: 'trails.v2.trips.workspace.draft', scope: 'trails.v2.trips.workspace.draft' },
  'trips.update': { action: 'trails.v2.trips.workspace.update', scope: 'trails.v2.trips.workspace.update' },
  'trips.publish': { action: 'trails.v2.trips.workspace.publish', scope: 'trails.v2.trips.workspace.publish' },
  'trips.unpublish': { action: 'trails.v2.trips.workspace.unpublish', scope: 'trails.v2.trips.workspace.unpublish' },
  'trips.cancel': { action: 'trails.v2.trips.workspace.cancel', scope: 'trails.v2.trips.workspace.cancel' },
  'trip-registrations.summary': { action: 'trails.v2.trip-registrations.summary', scope: 'trails.v2.trip-registrations.summary' },
  'trip-registrations.capacity': { action: 'trails.v2.trip-registrations.capacity', scope: 'trails.v2.trip-registrations.capacity' },
  'video-references.workspace': { action: 'trails.v2.video-references.workspace', scope: 'trails.v2.video-references.workspace' },
  'video-references.draft': { action: 'trails.v2.video-references.workspace.draft', scope: 'trails.v2.video-references.workspace.draft' },
  'video-references.update': { action: 'trails.v2.video-references.workspace.update', scope: 'trails.v2.video-references.workspace.update' },
  'video-references.publish': { action: 'trails.v2.video-references.workspace.publish', scope: 'trails.v2.video-references.workspace.publish' },
  'video-references.unpublish': { action: 'trails.v2.video-references.workspace.unpublish', scope: 'trails.v2.video-references.workspace.unpublish' },
  'video-references.archive': { action: 'trails.v2.video-references.workspace.archive', scope: 'trails.v2.video-references.workspace.archive' },
  'locations.workspace': { action: 'trails.v2.locations.workspace', scope: 'trails.v2.locations.workspace' },
  'locations.draft': { action: 'trails.v2.locations.workspace.draft', scope: 'trails.v2.locations.workspace.draft' },
  'locations.update': { action: 'trails.v2.locations.workspace.update', scope: 'trails.v2.locations.workspace.update' },
  'locations.publish': { action: 'trails.v2.locations.workspace.publish', scope: 'trails.v2.locations.workspace.publish' },
  'locations.unpublish': { action: 'trails.v2.locations.workspace.unpublish', scope: 'trails.v2.locations.workspace.unpublish' },
  'locations.archive': { action: 'trails.v2.locations.workspace.archive', scope: 'trails.v2.locations.workspace.archive' },
  'shooting-locations.workspace': { action: 'trails.v2.shooting-locations.workspace', scope: 'trails.v2.shooting-locations.workspace' },
  'shooting-locations.create': { action: 'trails.v2.shooting-locations.create', scope: 'trails.v2.shooting-locations.create' },
  'shooting-locations.update': { action: 'trails.v2.shooting-locations.update', scope: 'trails.v2.shooting-locations.update' },
  'shooting-locations.archive': { action: 'trails.v2.shooting-locations.archive', scope: 'trails.v2.shooting-locations.archive' },
  'comments.moderation-queue': { action: 'trails.v2.comments.moderation-queue', scope: 'trails.v2.comments.moderation-queue' },
  'comments.moderate': { action: 'trails.v2.comments.moderate', scope: 'trails.v2.comments.moderate' },
  'analytics.workspace': { action: 'trails.v2.analytics.workspace', scope: 'trails.v2.analytics.workspace' },
  'analytics.content-metrics': { action: 'trails.v2.analytics.content-metrics', scope: 'trails.v2.analytics.content-metrics' },
  'hikes.workspace': { action: 'trails.v2.hikes.workspace', scope: 'trails.v2.hikes.workspace' },
  'hikes.create': { action: 'trails.v2.hikes.create', scope: 'trails.v2.hikes.create' },
  'gear.workspace': { action: 'trails.v2.gear.workspace', scope: 'trails.v2.gear.workspace' },
  'gear.create': { action: 'trails.v2.gear.create', scope: 'trails.v2.gear.create' },
  'gear.update': { action: 'trails.v2.gear.update', scope: 'trails.v2.gear.update' },
  'gear.deactivate': { action: 'trails.v2.gear.deactivate', scope: 'trails.v2.gear.deactivate' },
  'packing-plans.workspace': { action: 'trails.v2.packing-plans.workspace', scope: 'trails.v2.packing-plans.workspace' },
  'packing-plans.create': { action: 'trails.v2.packing-plans.create', scope: 'trails.v2.packing-plans.create' },
  'packing-plans.update': { action: 'trails.v2.packing-plans.update', scope: 'trails.v2.packing-plans.update' },
  'finance.workspace': { action: 'trails.v2.finance.workspace', scope: 'trails.v2.finance.workspace' },
  'finance.create': { action: 'trails.v2.finance.create', scope: 'trails.v2.finance.create' },
  'finance.update': { action: 'trails.v2.finance.update', scope: 'trails.v2.finance.update' },
  'finance.balance.record': { action: 'trails.v2.finance.balance.record', scope: 'trails.v2.finance.balance.record' },
  'finance.balance.current': { action: 'trails.v2.finance.balance.current', scope: 'trails.v2.finance.balance.current' },
};

const forbiddenBridgeIdentityFields = new Set(['tenantId', 'ownerUserId', 'userId', 'isAdmin', 'creatorSpaceRole', 'creatorSpaceOwnerUserId', 'creatorRole', 'creatorOwner']);

export const requireMicroAppTicketSecret = () => {
  const secret = process.env.MICRO_APP_TICKET_SECRET?.trim();
  if (!secret) {
    throw new Error('MICRO_APP_TICKET_SECRET is required to issue or verify micro-app runtime tickets');
  }
  return secret;
};
const MAX_MICRO_APP_PACKAGE_BYTES = Number(process.env.MICRO_APP_MAX_PACKAGE_MB || 100) * 1024 * 1024;
const uploadChunkKey = (uploadId: string) => `micro-app:upload:${uploadId}`;
type ChunkUploadState = { total: number; chunks: Record<string, string>; updatedAt: number };

const getChunkUploadState = async (star: Starlight, uploadId: string): Promise<ChunkUploadState | null> => {
  const cached = await star.cacher?.get(uploadChunkKey(uploadId));
  if (!cached) return null;
  if (typeof cached === 'string') return JSON.parse(cached) as ChunkUploadState;
  return cached as ChunkUploadState;
};

const setChunkUploadState = async (star: Starlight, uploadId: string, state: ChunkUploadState) => {
  await star.cacher?.set(uploadChunkKey(uploadId), state, 60 * 60 * 24);
};

const clearChunkUploadState = async (star: Starlight, uploadId: string) => {
  await star.cacher?.delete(uploadChunkKey(uploadId));
};

const ok = (content: any, message = '操作成功'): HttpResponseItem => ({
  status: 200,
  data: { code: HttpResponseCode.Success, content, message, success: true },
});

const fail = (message: string, code = HttpResponseCode.ParamsError, status = 200): HttpResponseItem => ({
  status,
  data: { code, content: null, message, success: false },
});

const parseJsonArray = (value?: string): string[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
};

const normalizeUserList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
};

const safeParseManifest = (raw: unknown): MicroAppManifest | null => {
  const manifest = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!manifest || typeof manifest !== 'object') return null;
  const item = manifest as Partial<MicroAppManifest>;
  if (!item.appId || !item.name || !item.version || !item.entry) return null;
  return {
    appId: String(item.appId),
    name: String(item.name),
    version: String(item.version),
    entry: String(item.entry),
    description: item.description ? String(item.description) : '',
    permissions: item.permissions || {},
  };
};

const normalizeZipPath = (value: string) => value.replace(/^\.\//, '').replace(/^\//, '');

const parseManifestFromZip = (packageBuffer: Buffer): MicroAppManifest => {
  if (packageBuffer.length < 4 || packageBuffer[0] !== 0x50 || packageBuffer[1] !== 0x4b) {
    throw new Error('微应用包必须是 zip 格式');
  }

  const files = unzipSync(new Uint8Array(packageBuffer));
  const manifestPath = Object.keys(files).find((path) => normalizeZipPath(path) === 'manifest.json');
  if (!manifestPath) throw new Error('zip 包根目录必须包含 manifest.json');

  const manifest = safeParseManifest(strFromU8(files[manifestPath]));
  if (!manifest) throw new Error('manifest.json 必须包含 appId/name/version/entry');

  const hasEntry = Object.keys(files).some((path) => normalizeZipPath(path) === normalizeZipPath(manifest.entry));
  if (!hasEntry) throw new Error(`zip 包中找不到入口文件: ${manifest.entry}`);

  return manifest;
};

const createStaticScanReport = (packageBuffer: Buffer) => {
  const files = unzipSync(new Uint8Array(packageBuffer));
  const issues: Array<{ level: 'error' | 'warning'; file: string; message: string }> = [];
  const fileNames = Object.keys(files).map(normalizeZipPath);
  const sensitivePatterns = [/\.env$/i, /private.*key/i, /\.pem$/i, /secret/i];
  const maxFiles = 500;

  if (fileNames.length > maxFiles) {
    issues.push({ level: 'warning', file: '*', message: `文件数量超过建议值 ${maxFiles}` });
  }

  for (const [rawPath, content] of Object.entries(files)) {
    const path = normalizeZipPath(rawPath);
    if (sensitivePatterns.some((pattern) => pattern.test(path))) {
      issues.push({ level: 'error', file: path, message: '包内包含疑似敏感文件' });
    }
    if (!/\.(html|js|css|json)$/i.test(path)) continue;
    const text = strFromU8(content);
    if (/<script[^>]+src=["']https?:\/\//i.test(text)) {
      issues.push({ level: 'warning', file: path, message: '检测到远程脚本引用' });
    }
    if (/\beval\s*\(|new Function\s*\(/.test(text)) {
      issues.push({ level: 'warning', file: path, message: '检测到动态代码执行 API' });
    }
    if (/javascript:/i.test(text)) {
      issues.push({ level: 'warning', file: path, message: '检测到 javascript: 协议' });
    }
  }

  return {
    passed: issues.every((issue) => issue.level !== 'error'),
    scannedAt: new Date().toISOString(),
    fileCount: fileNames.length,
    issues,
  };
};

const currentUser = (ctx: Context) => (ctx.meta as any)?.user || {};
const currentUserId = (ctx: Context) => String(currentUser(ctx)?.userId || currentUser(ctx)?.id || '');
const currentTenantId = (ctx: Context) => String((ctx.meta as any)?.tenantId || currentUser(ctx)?.tenantId || currentUserId(ctx));
const isAdmin = (ctx: Context) => Boolean(currentUser(ctx)?.isAdmin);
const requestIp = (ctx: Context) => String((ctx.meta as any)?.req?.ip || '');
const requestedPackageVersion = (params: any) => String(params?.targetVersion || params?.appVersion || '');

const hashToPercent = (value: string) => parseInt(crypto.createHash('sha256').update(value).digest('hex').slice(0, 8), 16) % 100;

const canAccessApp = (ctx: Context, app: any) => {
  if (isAdmin(ctx)) return true;
  if (!app || app.status === 'disabled') return false;
  const userId = currentUserId(ctx);
  const tenantId = currentTenantId(ctx);
  const rolloutUsers = parseJsonArray(app.rolloutUsers);
  const rolloutTenants = parseJsonArray(app.rolloutTenants);
  const rolloutPercent = typeof app.rolloutPercent === 'number' ? app.rolloutPercent : 100;
  if (rolloutUsers.length > 0 && !rolloutUsers.includes(userId)) return false;
  if (rolloutTenants.length > 0 && !rolloutTenants.includes(tenantId)) return false;
  if (rolloutPercent < 100 && hashToPercent(`${app.appId}:${userId}`) >= rolloutPercent) return false;
  if (app.visibility === 'public') return true;
  if (app.visibility === 'tenant') return !app.tenantId || app.tenantId === tenantId;
  return parseJsonArray(app.allowedUsers).includes(userId);
};

const signPayload = (payload: Record<string, unknown>) => {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', requireMicroAppTicketSecret()).update(body).digest('base64url');
  return `${body}.${signature}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const verifyTicket = (ticket: string): Record<string, unknown> | null => {
  const [body, signature] = ticket.split('.');
  if (!body || !signature) return null;
  const expected = crypto.createHmac('sha256', requireMicroAppTicketSecret()).update(body).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!isRecord(payload) || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
};

const runtimeTicketKey = (jti: string) => `micro-app:runtime-ticket:${jti}`;
const registeredTrailsWorkspaceGrant = (appId: string, version: string): TrailsWorkspaceGrant | undefined =>
  TRAILS_WORKSPACE_GRANTS.find((grant) => grant.appId === appId && grant.version === version);
const isRuntimeTicketClaims = (value: Record<string, unknown>): value is RuntimeTicketClaims =>
  typeof value.aud === 'string' && typeof value.jti === 'string' && typeof value.appId === 'string' && typeof value.version === 'string'
  && typeof value.userId === 'string' && Array.isArray(value.scopes) && value.scopes.every((scope) => typeof scope === 'string');
const isMicroAppSessionClaims = (value: Record<string, unknown>): value is MicroAppSessionClaims =>
  isRuntimeTicketClaims(value) && value.kind === 'micro-app-session';

const consumeRuntimeTicket = async (star: Starlight, claims: RuntimeTicketClaims): Promise<boolean> => {
  const ttlSeconds = Math.max(1, Math.ceil((claims.exp - Date.now()) / 1000));
  const cacher = star.cacher as AtomicTicketCacher | undefined;
  if (!cacher) return false;
  if (cacher.setIfNotExists) return cacher.setIfNotExists(runtimeTicketKey(claims.jti), 'consumed', ttlSeconds);
  if (!cacher.client) return false;
  const result = await cacher.client.set(runtimeTicketKey(claims.jti), 'consumed', 'EX', String(ttlSeconds), 'NX');
  return result === 'OK';
};

const containsForbiddenBridgeIdentityField = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(containsForbiddenBridgeIdentityField);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, nested]) => forbiddenBridgeIdentityFields.has(key) || containsForbiddenBridgeIdentityField(nested));
};
const isPortfolioWorkspacePayload = (operation: TrailsWorkspaceOperation, payload: Record<string, unknown>): boolean => {
  const allowed = operation === 'portfolios.workspace' ? []
    : operation === 'portfolios.draft' ? ['title', 'summary', 'mediaIds', 'visibility', 'categoryId', 'coverMediaId', 'locationLabel', 'photoTechnicalMetadata']
      : operation === 'portfolios.update' ? ['id', 'resourceVersion', 'title', 'summary', 'mediaIds', 'visibility', 'categoryId', 'coverMediaId', 'locationLabel', 'photoTechnicalMetadata']
        : ['id', 'resourceVersion'];
  return Object.keys(payload).every((key) => allowed.includes(key));
};
const isJournalWorkspacePayload = (operation: TrailsWorkspaceOperation, payload: Record<string, unknown>): boolean => {
  const allowed = operation === 'journals.workspace' ? []
    : operation === 'journals.draft' ? ['title', 'excerpt', 'body', 'visibility', 'coverMediaId']
      : operation === 'journals.update' ? ['id', 'resourceVersion', 'title', 'excerpt', 'body', 'visibility', 'coverMediaId']
        : operation === 'journals.pin' ? ['id', 'resourceVersion', 'isPinned'] : ['id', 'resourceVersion'];
  return operation === 'journals.pin'
    ? Object.keys(payload).length === allowed.length && Object.keys(payload).every((key) => allowed.includes(key)) && typeof payload.isPinned === 'boolean'
    : Object.keys(payload).every((key) => allowed.includes(key));
};
const isHikesWorkspacePayload = (operation: TrailsWorkspaceOperation, payload: Record<string, unknown>): boolean => {
  const allowed = operation === 'hikes.workspace' ? [] : ['title', 'startedAt', 'distanceKm', 'elevationGainM', 'routeLabel'];
  return Object.keys(payload).every((key) => allowed.includes(key));
};
const isGearWorkspacePayload = (operation: TrailsWorkspaceOperation, payload: Record<string, unknown>): boolean => {
  const allowed = operation === 'gear.workspace' ? []
    : operation === 'gear.create' ? ['name', 'weightGrams', 'quantity']
      : operation === 'gear.update' ? ['id', 'resourceVersion', 'name', 'weightGrams', 'quantity']
        : ['id', 'resourceVersion'];
  return Object.keys(payload).every((key) => allowed.includes(key));
};
const isPackingPlanWorkspacePayload = (operation: TrailsWorkspaceOperation, payload: Record<string, unknown>): boolean => {
  const allowed = operation === 'packing-plans.workspace' ? []
    : operation === 'packing-plans.create' ? ['name', 'gearIds']
      : ['id', 'resourceVersion', 'name', 'gearIds'];
  return Object.keys(payload).length === allowed.length && Object.keys(payload).every((key) => allowed.includes(key));
};
const isFinanceWorkspacePayload = (operation: TrailsWorkspaceOperation, payload: Record<string, unknown>): boolean => {
  const allowed = operation === 'finance.workspace' ? []
    : operation === 'finance.create' ? ['occurredOn', 'category', 'amountCents', 'currency']
      : operation === 'finance.update' ? ['id', 'resourceVersion', 'occurredOn', 'category', 'amountCents', 'currency']
        : operation === 'finance.balance.record' ? ['balanceCents', 'currency']
          : ['currency'];
  return operation === 'finance.balance.current'
    ? Object.keys(payload).every((key) => allowed.includes(key))
    : Object.keys(payload).length === allowed.length && Object.keys(payload).every((key) => allowed.includes(key));
};
const isAnalyticsWorkspacePayload = (payload: Record<string, unknown>): boolean => Object.keys(payload).length === 2 && typeof payload.from === 'string' && typeof payload.to === 'string';
const isAnalyticsContentMetricsPayload = (payload: Record<string, unknown>): boolean => {
  if (Object.keys(payload).length !== 3 || typeof payload.from !== 'string' || typeof payload.to !== 'string' || !isRecord(payload.content) || Object.keys(payload.content).length !== 2 || !Object.keys(payload.content).every(key => key === 'portfolioIds' || key === 'journalIds')) return false;
  const content = payload.content;
  const ids = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 100 && value.every(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(id)) && new Set(value).size === value.length;
  const portfolioIds = content.portfolioIds; const journalIds = content.journalIds;
  if (!ids(portfolioIds) || !ids(journalIds)) return false;
  return portfolioIds.length > 0 || journalIds.length > 0;
};
const isTripRegistrationSummaryPayload = (payload: Record<string, unknown>): boolean => Object.keys(payload).length === 1 && typeof payload.tripId === 'string';
const isTripRegistrationCapacityPayload = (payload: Record<string, unknown>): boolean => Object.keys(payload).length === 3 && typeof payload.tripId === 'string' && typeof payload.capacity === 'number' && typeof payload.mutationId === 'string';
const isShootingLocationPayload = (operation: TrailsWorkspaceOperation, payload: Record<string, unknown>): boolean => {
  const allowed = operation === 'shooting-locations.workspace' ? [] : operation === 'shooting-locations.archive' ? ['id', 'mutationId', 'expectedResourceVersion'] : ['id', 'name', 'latitude', 'longitude', 'notes', 'mutationId', 'expectedResourceVersion'];
  return Object.keys(payload).length === allowed.length && Object.keys(payload).every(key => allowed.includes(key));
};

const publicVersion = (version: any, includePackage = false) => {
  if (!version) return null;
  const manifest = JSON.parse(version.manifestJson || '{}');
  return {
    appId: version.appId,
    version: version.version,
    manifest,
    packageSha256: version.packageSha256,
    packageSize: version.packageSize,
    status: version.status,
    reviewerUserId: version.reviewerUserId,
    reviewReason: version.reviewReason,
    reviewedAt: version.reviewedAt,
    publishedAt: version.publishedAt,
    signature: version.signature,
    createdBy: version.createdBy,
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
    ...(includePackage ? { packageBase64: version.packageBase64 } : {}),
    scanReport: version.scanReportJson ? JSON.parse(version.scanReportJson) : null,
  };
};

const writeAuditLog = (star: Starlight, ctx: Context, payload: any) =>
  star.db.microApp.createMicroAppAuditLog({
    appId: payload.appId,
    version: payload.version,
    action: payload.action,
    operatorUserId: currentUserId(ctx),
    tenantId: currentTenantId(ctx),
    reason: payload.reason || '',
    beforeStatus: payload.beforeStatus,
    afterStatus: payload.afterStatus,
    ip: requestIp(ctx),
    detailsJson: JSON.stringify(payload.details || {}),
  });

export default function microAppActions(star: Starlight) {
  return instrumentServiceActions(star, 'micro-app', {
    'v1.upload': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const packageBase64 = String((ctx.params as any).packageBase64 || '');
          if (!packageBase64) return fail('微应用包不能为空');

          const packageBuffer = Buffer.from(packageBase64, 'base64');
          if (!packageBuffer.length) return fail('微应用包格式不正确');
          if (packageBuffer.length > MAX_MICRO_APP_PACKAGE_BYTES) {
            return fail(`微应用包不能超过 ${Math.floor(MAX_MICRO_APP_PACKAGE_BYTES / 1024 / 1024)}MB`);
          }
          const manifest = parseManifestFromZip(packageBuffer);
          const scanReport = createStaticScanReport(packageBuffer);
          if (!scanReport.passed) return fail('静态安全扫描未通过，请移除敏感文件后重新上传');

          const packageSha256 = crypto.createHash('sha256').update(packageBuffer).digest('hex');
          const userId = currentUserId(ctx);
          const tenantId = currentTenantId(ctx);

          const app = await star.db.microApp.upsertMicroApp({
            appId: manifest.appId,
            name: manifest.name,
            description: manifest.description,
            ownerUserId: userId,
            tenantId,
            visibility: ((ctx.params as any).visibility as MicroAppVisibility) || 'tenant',
            status: 'active',
            allowedUsers: JSON.stringify(normalizeUserList((ctx.params as any).allowedUsers)),
            rolloutUsers: JSON.stringify(normalizeUserList((ctx.params as any).rolloutUsers)),
            rolloutTenants: JSON.stringify(normalizeUserList((ctx.params as any).rolloutTenants)),
            rolloutPercent: Math.max(0, Math.min(100, Number((ctx.params as any).rolloutPercent ?? 100))),
            releaseChannel: (ctx.params as any).releaseChannel || 'stable',
          });

          const version = await star.db.microApp.upsertMicroAppVersion({
            appId: manifest.appId,
            version: manifest.version,
            manifestJson: JSON.stringify(manifest),
            packageBase64,
            packageSha256,
            packageSize: packageBuffer.length,
            status: 'pending_review',
            scanReportJson: JSON.stringify(scanReport),
            createdBy: userId,
          });

          await writeAuditLog(star, ctx, {
            appId: manifest.appId,
            version: manifest.version,
            action: 'upload',
            afterStatus: 'pending_review',
            details: { packageSha256, scanReport },
          });

          return ok({ app, version: publicVersion(version) }, '微应用包已上传，等待审核');
        } catch (error) {
          star.logger?.error('micro-app upload failed', error);
          return fail(`上传失败: ${error}`, HttpResponseCode.ServiceActionFaild, 500);
        }
      },
    },

    'v1.uploadChunk': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const { uploadId, index, total, chunkBase64 } = ctx.params as any;
        if (!uploadId || typeof index !== 'number' || typeof total !== 'number' || !chunkBase64) return fail('分片上传参数不完整');
        const record = (await getChunkUploadState(star, uploadId)) || { total, chunks: {}, updatedAt: Date.now() };
        record.total = total;
        record.chunks[String(index)] = String(chunkBase64);
        record.updatedAt = Date.now();
        await setChunkUploadState(star, uploadId, record);
        return ok({ uploadId, received: Object.keys(record.chunks).length, total }, '分片已接收');
      },
    },

    'v1.completeUpload': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const { uploadId, visibility } = ctx.params as any;
        const record = await getChunkUploadState(star, uploadId);
        if (!record || Object.keys(record.chunks).length !== record.total) return fail('分片未上传完整');
        const packageBase64 = Array.from({ length: record.total }, (_, index) => record.chunks[String(index)] || '').join('');
        ctx.params = { ...ctx.params, packageBase64, visibility };
        await clearChunkUploadState(star, uploadId);
        return (this as any)['v1.upload'].handler(ctx);
      },
    },

    'v1.list': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const apps = await star.db.microApp.listMicroApps();
        const versions = await star.db.microApp.listMicroAppVersions();
        const visibleApps = apps.filter((app: any) => canAccessApp(ctx, app));
        const content = visibleApps.map((app: any) => {
          const appVersions = versions.filter((version: any) => version.appId === app.appId);
          const latestPublished = appVersions.find((version: any) => version.status === 'published');
          return {
            ...app,
            allowedUsers: parseJsonArray(app.allowedUsers),
            rolloutUsers: parseJsonArray(app.rolloutUsers),
            rolloutTenants: parseJsonArray(app.rolloutTenants),
            rolloutPercent: app.rolloutPercent,
            releaseChannel: app.releaseChannel,
            latestPublished: publicVersion(latestPublished),
            versions: isAdmin(ctx) ? appVersions.map((version: any) => publicVersion(version)) : undefined,
          };
        });
        return ok(content, '获取微应用列表成功');
      },
    },

    'v1.review': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        if (!isAdmin(ctx)) return fail('只有管理员可以审核微应用', HttpResponseCode.NoPermissionError, 403);
        const { appId, decision, reason } = ctx.params as any;
        const version = requestedPackageVersion(ctx.params);
        if (!appId || !version || !['approved', 'rejected'].includes(decision)) return fail('审核参数不完整');
        const before = await star.db.microApp.findMicroAppVersion(appId, version);
        const next = await star.db.microApp.updateMicroAppVersionStatus(appId, version, decision, {
          reviewerUserId: currentUserId(ctx),
          reviewReason: reason || '',
          reviewedAt: new Date(),
        });
        await writeAuditLog(star, ctx, {
          appId,
          version,
          action: 'review',
          reason,
          beforeStatus: before?.status,
          afterStatus: decision,
        });
        return ok(publicVersion(next), decision === 'approved' ? '审核已通过' : '审核已拒绝');
      },
    },

    'v1.publish': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        if (!isAdmin(ctx)) return fail('只有管理员可以发布微应用', HttpResponseCode.NoPermissionError, 403);
        const { appId } = ctx.params as any;
        const version = requestedPackageVersion(ctx.params);
        const record = await star.db.microApp.findMicroAppVersion(appId, version);
        if (!record) return fail('微应用版本不存在');
        if (!['approved', 'published'].includes(record.status)) return fail('只有审核通过的版本可以发布');
        const previous = await star.db.microApp.findLatestPublishedVersion(appId);
        const signature = crypto.createHmac('sha256', requireMicroAppTicketSecret())
          .update(record.packageSha256)
          .digest('hex');
        const next = await star.db.microApp.updateMicroAppVersionStatus(appId, version, 'published', {
          signature,
          publishedAt: new Date(),
          previousPublishedVersion: previous?.version,
        });
        await writeAuditLog(star, ctx, {
          appId,
          version,
          action: 'publish',
          beforeStatus: record.status,
          afterStatus: 'published',
          details: { previousPublishedVersion: previous?.version },
        });
        return ok(publicVersion(next), '微应用已发布');
      },
    },

    'v1.updateAccess': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        if (!isAdmin(ctx)) return fail('只有管理员可以配置权限', HttpResponseCode.NoPermissionError, 403);
        const { appId, visibility } = ctx.params as any;
        if (!appId || !['public', 'tenant', 'allowlist'].includes(visibility)) return fail('权限参数不正确');
        const app = await star.db.microApp.updateMicroAppRollout(appId, {
          visibility,
          allowedUsers: JSON.stringify(normalizeUserList((ctx.params as any).allowedUsers)),
          rolloutUsers: JSON.stringify(normalizeUserList((ctx.params as any).rolloutUsers)),
          rolloutTenants: JSON.stringify(normalizeUserList((ctx.params as any).rolloutTenants)),
          rolloutPercent: Math.max(0, Math.min(100, Number((ctx.params as any).rolloutPercent ?? 100))),
          releaseChannel: (ctx.params as any).releaseChannel || 'stable',
        });
        await writeAuditLog(star, ctx, { appId, action: 'updateAccess', afterStatus: app?.status, details: app });
        return ok(app, '权限与灰度名单已更新');
      },
    },

    'v1.rollback': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        if (!isAdmin(ctx)) return fail('只有管理员可以回滚微应用', HttpResponseCode.NoPermissionError, 403);
        const { appId, targetVersion } = ctx.params as any;
        const target = targetVersion
          ? await star.db.microApp.findMicroAppVersion(appId, targetVersion)
          : await star.db.microApp.findLatestPublishedVersion(appId);
        if (!target) return fail('没有可回滚的目标版本');
        if (!['approved', 'published'].includes(target.status)) return fail('只有审核通过的版本可以回滚发布');
        if (appId === 'starlight-trails-workspace' && !registeredTrailsWorkspaceGrant(appId, target.version)) {
          return fail('该 Trails 工作台版本未获服务端授权', HttpResponseCode.NoPermissionError, 403);
        }
        const next = await star.db.microApp.updateMicroAppVersionStatus(appId, target.version, 'published', {
          publishedAt: new Date(),
        });
        await writeAuditLog(star, ctx, { appId, version: target.version, action: 'rollback', afterStatus: 'published' });
        return ok(publicVersion(next), '微应用已回滚');
      },
    },

    'v1.download': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const { appId } = ctx.params as any;
        const version = requestedPackageVersion(ctx.params);
        const app = await star.db.microApp.findMicroAppByAppId(appId);
        if (!canAccessApp(ctx, app)) return fail('没有该微应用的使用权限', HttpResponseCode.NoPermissionError, 403);
        const record = version
          ? await star.db.microApp.findMicroAppVersion(appId, version)
          : await star.db.microApp.findLatestPublishedVersion(appId);
        if (!record || record.status !== 'published') return fail('该微应用暂无已发布版本');
        await star.db.microApp.upsertMicroAppInstall({
          appId,
          version: record.version,
          userId: currentUserId(ctx),
          tenantId: currentTenantId(ctx),
          status: 'downloaded',
          packageSha256: record.packageSha256,
        });
        return ok(publicVersion(record, true), '微应用包下载成功');
      },
    },

    'v1.previewDownload': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        if (!isAdmin(ctx)) return fail('只有管理员可以预览待审核微应用', HttpResponseCode.NoPermissionError, 403);
        const { appId } = ctx.params as any;
        const version = requestedPackageVersion(ctx.params);
        if (!appId || !version) return fail('预览参数不完整');
        const record = await star.db.microApp.findMicroAppVersion(appId, version);
        if (!record) return fail('微应用版本不存在');
        if (!['pending_review', 'approved', 'published'].includes(record.status)) {
          return fail('当前版本状态不支持预览');
        }
        return ok(publicVersion(record, true), '微应用预览包获取成功');
      },
    },

    'v1.runtime-ticket': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const { appId } = ctx.params as any;
        const version = requestedPackageVersion(ctx.params);
        const app = await star.db.microApp.findMicroAppByAppId(appId);
        if (!canAccessApp(ctx, app)) return fail('没有该微应用的运行权限', HttpResponseCode.NoPermissionError, 403);
        const record = version
          ? await star.db.microApp.findMicroAppVersion(appId, version)
          : await star.db.microApp.findLatestPublishedVersion(appId);
        if (!record || record.status !== 'published') return fail('该微应用暂无可运行版本');
        const grant = registeredTrailsWorkspaceGrant(appId, record.version);
        if (appId === 'starlight-trails-workspace' && !grant) {
          return fail('该 Trails 工作台版本未获服务端授权', HttpResponseCode.NoPermissionError, 403);
        }
        const payload: RuntimeTicketClaims = {
          userId: currentUserId(ctx),
          appId,
          version: record.version,
          jti: crypto.randomUUID(),
          aud: grant?.audience || 'darwin:micro-app:runtime',
          scopes: grant ? grant.scopes : [],
          exp: Date.now() + 2 * 60 * 1000,
        };
        const ticket = signPayload(payload);
        await star.db.microApp.upsertMicroAppInstall({
          appId,
          version: record.version,
          userId: currentUserId(ctx),
          tenantId: currentTenantId(ctx),
          status: 'opened',
          packageSha256: record.packageSha256,
          lastOpenedAt: new Date(),
        });
        return ok({ ticket, expiresIn: 120, app, version: publicVersion(record), user: currentUser(ctx) }, '运行票据已生成');
      },
    },

    'v1.exchange-session': {
      metadata: { auth: false },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const payload = verifyTicket(String((ctx.params as any).ticket || ''));
        if (!payload) return fail('运行票据无效或已过期', HttpResponseCode.ERR_INVALID_TOKEN, 401);
        if (payload.appId === 'starlight-trails-workspace' && (!isRuntimeTicketClaims(payload) || !registeredTrailsWorkspaceGrant(payload.appId, payload.version))) {
          return fail('运行票据应用版本未获服务端授权', HttpResponseCode.ERR_INVALID_TOKEN, 401);
        }
        if (isRuntimeTicketClaims(payload) && registeredTrailsWorkspaceGrant(payload.appId, payload.version)) {
          const grant = registeredTrailsWorkspaceGrant(payload.appId, payload.version);
          if (!grant || payload.aud !== grant.audience || !payload.scopes.every((scope) => grant.scopes.includes(scope))) {
            return fail('运行票据受众或授权无效', HttpResponseCode.ERR_INVALID_TOKEN, 401);
          }
          if (!(await consumeRuntimeTicket(star, payload))) return fail('运行票据已使用或当前不可安全换取', HttpResponseCode.ERR_INVALID_TOKEN, 401);
          const session: MicroAppSessionClaims = { ...payload, kind: 'micro-app-session', exp: Date.now() + 10 * 60 * 1000 };
          return ok({
            sessionToken: signPayload(session),
            user: { userId: payload.userId },
            app: { appId: payload.appId, version: payload.version, scopes: payload.scopes },
            expiresIn: 600,
          }, '微应用会话已换取');
        }
        return ok({
          sessionToken: signPayload({ ...payload, kind: 'micro-app-session', exp: Date.now() + 10 * 60 * 1000 }),
          user: { userId: payload.userId },
          app: { appId: payload.appId, version: payload.version, scopes: payload.scopes },
          expiresIn: 600,
        }, '微应用会话已换取');
      },
    },

    'v1.scoped-api': {
      metadata: { auth: false },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const session = verifyTicket(String((ctx.params as any).sessionToken || ''));
        if (!session || session.kind !== 'micro-app-session') return fail('微应用会话无效', HttpResponseCode.ERR_INVALID_TOKEN, 401);
        if (session.appId === 'starlight-trails-workspace' && (!isMicroAppSessionClaims(session) || !registeredTrailsWorkspaceGrant(session.appId, session.version))) {
          return fail('微应用会话应用版本未获服务端授权', HttpResponseCode.ERR_INVALID_TOKEN, 401);
        }
        if (isMicroAppSessionClaims(session) && registeredTrailsWorkspaceGrant(session.appId, session.version)) {
          const grant = registeredTrailsWorkspaceGrant(session.appId, session.version);
          if (!grant || session.aud !== grant.audience || !session.scopes.every((item) => grant.scopes.includes(item))) {
            return fail('微应用会话受众或授权无效', HttpResponseCode.ERR_INVALID_TOKEN, 401);
          }
          const operationValue: unknown = (ctx.params as Record<string, unknown>).operation;
          if (typeof operationValue !== 'string' || !Object.prototype.hasOwnProperty.call(TRAILS_WORKSPACE_ACTIONS, operationValue)) {
            return fail('不支持的 Trails 工作台操作', HttpResponseCode.NoPermissionError, 403);
          }
          const operation = operationValue as TrailsWorkspaceOperation;
          const target = TRAILS_WORKSPACE_ACTIONS[operation];
          if (!session.scopes.includes(target.scope)) return fail('微应用没有该 API scope 权限', HttpResponseCode.NoPermissionError, 403);
           const payload: unknown = (ctx.params as Record<string, unknown>).payload;
           if (!isRecord(payload)) return fail('请求 payload 必须是对象');
            if (containsForbiddenBridgeIdentityField(payload)) return fail('请求不能包含身份或所有权字段', HttpResponseCode.NoPermissionError, 403);
            if ((operation === 'portfolios.workspace' || operation === 'portfolios.draft' || operation === 'portfolios.update' || operation === 'portfolios.publish' || operation === 'portfolios.unpublish') && !isPortfolioWorkspacePayload(operation, payload)) return fail('作品集请求包含不允许字段', HttpResponseCode.NoPermissionError, 403);
  if ((operation === 'journals.workspace' || operation === 'journals.draft' || operation === 'journals.update' || operation === 'journals.publish' || operation === 'journals.unpublish' || operation === 'journals.pin') && !isJournalWorkspacePayload(operation, payload)) return fail('日志请求包含不允许字段', HttpResponseCode.NoPermissionError, 403);
            if ((operation === 'hikes.workspace' || operation === 'hikes.create') && !isHikesWorkspacePayload(operation, payload)) return fail('徒步记录请求包含不允许字段', HttpResponseCode.NoPermissionError, 403);
             if ((operation === 'gear.workspace' || operation === 'gear.create' || operation === 'gear.update' || operation === 'gear.deactivate') && !isGearWorkspacePayload(operation, payload)) return fail('装备请求包含不允许字段', HttpResponseCode.NoPermissionError, 403);
              if ((operation === 'packing-plans.workspace' || operation === 'packing-plans.create' || operation === 'packing-plans.update') && !isPackingPlanWorkspacePayload(operation, payload)) return fail('装包方案请求包含不允许字段', HttpResponseCode.NoPermissionError, 403);
  if ((operation === 'finance.workspace' || operation === 'finance.create' || operation === 'finance.update' || operation === 'finance.balance.record' || operation === 'finance.balance.current') && !isFinanceWorkspacePayload(operation, payload)) return fail('财务请求包含不允许字段', HttpResponseCode.NoPermissionError, 403);
  if (operation === 'analytics.workspace' && !isAnalyticsWorkspacePayload(payload)) return fail('分析请求包含不允许字段', HttpResponseCode.NoPermissionError, 403);
  if (operation === 'analytics.content-metrics' && !isAnalyticsContentMetricsPayload(payload)) return fail('内容指标请求包含不允许字段', HttpResponseCode.NoPermissionError, 403);
  if (operation === 'trip-registrations.summary' && !isTripRegistrationSummaryPayload(payload)) return fail('报名摘要请求包含不允许字段', HttpResponseCode.NoPermissionError, 403);
  if (operation === 'trip-registrations.capacity' && !isTripRegistrationCapacityPayload(payload)) return fail('行摄名额请求包含不允许字段', HttpResponseCode.NoPermissionError, 403);
  if ((operation === 'shooting-locations.workspace' || operation === 'shooting-locations.create' || operation === 'shooting-locations.update' || operation === 'shooting-locations.archive') && !isShootingLocationPayload(operation, payload)) return fail('拍摄地点请求包含不允许字段', HttpResponseCode.NoPermissionError, 403);
           if (typeof ctx.call !== 'function') return fail('Trails 服务当前不可用', HttpResponseCode.ServiceActionFaild, 503);
          const trustedActor = await resolveTrailsWorkspaceActor(star.db, session.userId);
          if (!trustedActor) return fail('当前用户没有有效的 Trails 创作者空间权限', HttpResponseCode.NoPermissionError, 403);
          return ctx.call(target.action, payload, {
            meta: {
              tenantId: trustedActor.tenantId,
              user: trustedActor.user,
              creatorSpaceRole: trustedActor.creatorSpaceRole,
              ...(trustedActor.creatorSpaceOwnerUserId ? { creatorSpaceOwnerUserId: trustedActor.creatorSpaceOwnerUserId } : {}),
            },
          }) as Promise<HttpResponseItem>;
        }
        const scope = String((ctx.params as any).scope || '');
        const scopes = (session.scopes || {}) as any;
        const allowedScopes = Array.isArray(scopes.starlightApiScopes) ? scopes.starlightApiScopes : [];
        if (scope && !allowedScopes.includes(scope)) return fail('微应用没有该 API scope 权限', HttpResponseCode.NoPermissionError, 403);
        return ok({ allowed: true, scope, appId: session.appId, userId: session.userId }, 'scope 校验通过');
      },
    },

    'v1.auditLogs': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        if (!isAdmin(ctx)) return fail('只有管理员可以查看审核日志', HttpResponseCode.NoPermissionError, 403);
        return ok(await star.db.microApp.listMicroAppAuditLogs((ctx.params as any).appId), '获取审核日志成功');
      },
    },

    'v1.installs': {
      metadata: { auth: true },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        if (!isAdmin(ctx)) return fail('只有管理员可以查看安装记录', HttpResponseCode.NoPermissionError, 403);
        return ok(await star.db.microApp.listMicroAppInstalls((ctx.params as any).appId), '获取安装记录成功');
      },
    },
  });
}
