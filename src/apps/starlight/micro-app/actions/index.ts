import crypto from 'crypto';
import { strFromU8, unzipSync } from 'fflate';
import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, Starlight } from 'typings';
import { instrumentServiceActions } from '../../metrics/utils/action-metrics';

type MicroAppVisibility = 'public' | 'tenant' | 'allowlist';

type MicroAppManifest = {
  appId: string;
  name: string;
  version: string;
  entry: string;
  description?: string;
  permissions?: Record<string, unknown>;
};

const TICKET_SECRET = process.env.MICRO_APP_TICKET_SECRET || 'starlight-micro-app-ticket-secret';
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
  const signature = crypto.createHmac('sha256', TICKET_SECRET).update(body).digest('base64url');
  return `${body}.${signature}`;
};

const verifyTicket = (ticket: string) => {
  const [body, signature] = ticket.split('.');
  if (!body || !signature) return null;
  const expected = crypto.createHmac('sha256', TICKET_SECRET).update(body).digest('base64url');
  if (expected !== signature) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (!payload?.exp || Number(payload.exp) < Date.now()) return null;
  return payload;
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
        const signature = crypto.createHmac('sha256', TICKET_SECRET).update(record.packageSha256).digest('hex');
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
        const manifest = JSON.parse(record.manifestJson || '{}');
        const payload = {
          userId: currentUserId(ctx),
          tenantId: currentTenantId(ctx),
          appId,
          version: record.version,
          scopes: manifest.permissions || {},
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
        return ok({
          sessionToken: signPayload({ ...payload, kind: 'micro-app-session', exp: Date.now() + 10 * 60 * 1000 }),
          user: { userId: payload.userId, tenantId: payload.tenantId },
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
