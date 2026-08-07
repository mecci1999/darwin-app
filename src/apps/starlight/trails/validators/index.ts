import { GuestAvatarId, GuestCommentSubjectType, PhotoTechnicalMetadata, PhotoTechnicalMetadataVisibility, PhotoTechnicalTagId, PublishingApprovalChecklist, PublishingContentOrigin, PublishingExportVariant, PublishingFactualClaim, PublishingLocationPolicy, PublishingPath, PublishingPlatform, PublishingRightsStatus, Visibility, guestAvatarIds, photoTechnicalTagIds } from '../types';

export type Input = Record<string, unknown>;

export const requiredString = (params: Input, key: string, label: string): string => {
  const value = params[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}不能为空`);
  return value.trim();
};

export const optionalString = (params: Input, key: string): string | undefined => {
  const value = params[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`${key}必须是字符串`);
  return value.trim() || undefined;
};

export const optionalSlug = (params: Input, key: string): string | undefined => {
  const value = optionalString(params, key);
  if (value === undefined) return undefined;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) throw new Error(`${key}必须是小写连字符 slug`);
  return value;
};

export const visibility = (params: Input): Visibility => {
  const value = params.visibility;
  if (value === undefined) return 'private';
  if (value === 'public' || value === 'private' || value === 'unlisted') return value;
  throw new Error('可见性必须是 public、private 或 unlisted');
};

export const requiredSlug = (params: Input, key: string): string => {
  const value = requiredString(params, key, key);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) throw new Error(`${key}必须是小写连字符 slug`);
  return value;
};

export const optionalNumber = (params: Input, key: string): number | undefined => {
  const value = params[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${key}必须是有效数字`);
  return value;
};

export const requiredNonNegativeInteger = (params: Input, key: string): number => {
  const value = params[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new Error(`${key}必须是非负整数`);
  return value;
};

export const stringArray = (params: Input, key: string): string[] => {
  const value = params[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) throw new Error(`${key}必须是非空字符串数组`);
  return value.map((item) => item.trim());
};

/** Opaque relations have format validation only during development; no foreign-key existence lookup occurs. */
export const optionalOpaqueId = (params: Input, key: string): string | undefined => {
  const value = optionalString(params, key);
  if (value !== undefined && (value.length > 160 || !/^[A-Za-z0-9_-]+$/.test(value))) throw new Error(`${key}必须是有效的不透明ID`);
  return value;
};

export const opaqueIdArray = (params: Input, key: string): string[] => {
  const values = stringArray(params, key);
  if (values.some((value) => value.length > 160 || !/^[A-Za-z0-9_-]+$/.test(value))) throw new Error(`${key}必须是有效的不透明ID数组`);
  if (new Set(values).size !== values.length) throw new Error(`${key}不能包含重复ID`);
  return values;
};

export const plainTextArray = (params: Input, key: string, maximumItems: number, maximumLength: number): string[] => {
  const value = params[key];
  if (!Array.isArray(value) || value.length > maximumItems) throw new Error(`${key}必须是至多${maximumItems}项的纯文本数组`);
  const values = value.map((item, index) => plainText(item, `${key}[${index}]`, maximumLength, true) as string);
  if (new Set(values).size !== values.length) throw new Error(`${key}不能包含重复项`);
  return values;
};

export const coordinate = (params: Input, key: string, minimum: number, maximum: number): number => {
  const value = params[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`${key}超出有效坐标范围`);
  return value;
};

const hasUnsafeText = (value: string) => /[<>]|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value);

const plainText = (value: unknown, key: string, maximumLength: number, required = false): string | undefined => {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || (required && !value.trim())) throw new Error(`${key}必须是${required ? '非空' : ''}纯文本`);
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > maximumLength || hasUnsafeText(normalized)) throw new Error(`${key}必须是${maximumLength}字以内的纯文本，且不能包含HTML`);
  return normalized;
};

const record = (value: unknown, key: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${key}必须是对象`);
  return value as Record<string, unknown>;
};

const requiredBoolean = (value: unknown, key: string): boolean => {
  if (typeof value !== 'boolean') throw new Error(`${key}必须是布尔值`);
  return value;
};

export const publishingPlatform = (params: Input): PublishingPlatform => {
  if (params.platform === 'instagram' || params.platform === 'xiaohongshu') return params.platform;
  throw new Error('platform必须是instagram或xiaohongshu');
};

export const publishingPath = (params: Input, platform: PublishingPlatform): PublishingPath => {
  const value = params.publishingPath === undefined ? 'manual_handoff' : params.publishingPath;
  if (value === 'manual_handoff') return value;
  if (value === 'official_api_candidate' && platform === 'instagram') return value;
  throw new Error('Xiaohongshu仅支持manual_handoff；official_api_candidate仅适用于Instagram');
};

export const publishingContentOrigin = (params: Input): PublishingContentOrigin => {
  if (params.contentOrigin === undefined || params.contentOrigin === 'human') return 'human';
  if (params.contentOrigin === 'ai-draft-requires-review') return params.contentOrigin;
  throw new Error('contentOrigin无效');
};

export const publishingExportVariants = (params: Input): PublishingExportVariant[] => {
  const value = params.exportVariants;
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) throw new Error('exportVariants必须是1至20项元数据计划');
  return value.map((item, index) => {
    const input = record(item, `exportVariants[${index}]`);
    const mediaId = plainText(input.mediaId, `exportVariants[${index}].mediaId`, 160, true) as string;
    if (!/^[A-Za-z0-9_-]+$/.test(mediaId)) throw new Error(`exportVariants[${index}].mediaId格式无效`);
    const cropIntent = input.cropIntent;
    if (cropIntent !== 'square' && cropIntent !== 'portrait' && cropIntent !== 'landscape' && cropIntent !== 'original') throw new Error(`exportVariants[${index}].cropIntent无效`);
    return { mediaId, cropIntent, intendedUse: plainText(input.intendedUse, `exportVariants[${index}].intendedUse`, 240, true) as string };
  });
};

export const publishingLocationPolicy = (params: Input): { locationPolicy: PublishingLocationPolicy; containsGpsOrRouteHints: boolean } => {
  const locationPolicy = params.locationPolicy;
  if (locationPolicy !== 'withheld' && locationPolicy !== 'generalized') throw new Error('locationPolicy必须是withheld或generalized');
  return { locationPolicy, containsGpsOrRouteHints: requiredBoolean(params.containsGpsOrRouteHints, 'containsGpsOrRouteHints') };
};

export const publishingRights = (params: Input): { rightsStatus: PublishingRightsStatus; rightsDisclosure?: string } => {
  const rightsStatus = params.rightsStatus;
  if (rightsStatus !== 'cleared' && rightsStatus !== 'restricted') throw new Error('rightsStatus必须是cleared或restricted');
  const rightsDisclosure = plainText(params.rightsDisclosure, 'rightsDisclosure', 1000);
  if (rightsStatus === 'restricted' && !rightsDisclosure) throw new Error('受限权利必须提供rightsDisclosure');
  return { rightsStatus, rightsDisclosure };
};

export const publishingClaims = (params: Input): PublishingFactualClaim[] => {
  const value = params.factualClaims;
  if (!Array.isArray(value) || value.length > 20) throw new Error('factualClaims必须是至多20项数组');
  return value.map((item, index) => {
    const input = record(item, `factualClaims[${index}]`);
    if (input.verification !== 'verified' && input.verification !== 'unverified') throw new Error(`factualClaims[${index}].verification无效`);
    return { text: plainText(input.text, `factualClaims[${index}].text`, 600, true) as string, verification: input.verification };
  });
};

export const publishingApprovals = (params: Input): PublishingApprovalChecklist => {
  const input = record(params.approvals, 'approvals');
  return {
    copyApproved: requiredBoolean(input.copyApproved, 'approvals.copyApproved'),
    mediaSelectionApproved: requiredBoolean(input.mediaSelectionApproved, 'approvals.mediaSelectionApproved'),
    rightsApproved: requiredBoolean(input.rightsApproved, 'approvals.rightsApproved'),
    locationPrivacyApproved: requiredBoolean(input.locationPrivacyApproved, 'approvals.locationPrivacyApproved'),
    factualClaimsApproved: requiredBoolean(input.factualClaimsApproved, 'approvals.factualClaimsApproved'),
  };
};

/** Builds attribution only for an exact configured HTTPS origin; never follows redirect targets. */
export const publishingUtmUrl = (params: Input, platform: PublishingPlatform, allowedOrigins: readonly string[]): { destinationUrl: string; utmUrl: string } => {
  const raw = requiredString(params, 'destinationUrl', 'destinationUrl');
  let destination: URL;
  try { destination = new URL(raw); } catch { throw new Error('destinationUrl必须是有效HTTPS URL'); }
  if (destination.protocol !== 'https:' || destination.username || destination.password || !allowedOrigins.includes(destination.origin)) throw new Error('destinationUrl必须使用配置的HTTPS来源，且不允许开放重定向');
  const redirectParameter = ['next', 'redirect', 'redirect_uri', 'return', 'return_to', 'url'].some((key) => destination.searchParams.has(key));
  if (/\/(?:redirect|out|go)(?:\/|$)/i.test(destination.pathname) || redirectParameter) throw new Error('destinationUrl不能是重定向端点或包含重定向参数');
  destination.hash = '';
  destination.searchParams.set('utm_source', platform);
  destination.searchParams.set('utm_medium', 'social');
  return { destinationUrl: raw, utmUrl: destination.toString() };
};

const positiveNumber = (value: unknown, key: string, maximum: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > maximum) throw new Error(`${key}必须是大于0且不超过${maximum}的有效数字`);
  return value;
};

const captureDate = (value: unknown): string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('captureDate必须是YYYY-MM-DD日期');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error('captureDate必须是有效日期');
  return value;
};

const metadataVisibility = (value: unknown): PhotoTechnicalMetadataVisibility => {
  const input = value === undefined ? {} : record(value, 'photoTechnicalMetadata.visibility');
  const keys: Array<keyof PhotoTechnicalMetadataVisibility> = ['captureSettings', 'locationLabel', 'technicalTags', 'creationNote'];
  return keys.reduce<PhotoTechnicalMetadataVisibility>((result, key) => {
    const enabled = input[key];
    if (enabled !== undefined && typeof enabled !== 'boolean') throw new Error(`photoTechnicalMetadata.visibility.${key}必须是布尔值`);
    result[key] = enabled === true;
    return result;
  }, { captureSettings: false, locationLabel: false, technicalTags: false, creationNote: false });
};

export const photoTechnicalMetadata = (params: Input, key = 'photoTechnicalMetadata'): PhotoTechnicalMetadata | undefined => {
  const value = params[key];
  if (value === undefined) return undefined;
  const input = record(value, key);
  const tags = input.technicalTags;
  if (!Array.isArray(tags) || tags.length > 16 || tags.some((tag) => !(photoTechnicalTagIds as readonly unknown[]).includes(tag))) throw new Error('photoTechnicalMetadata.technicalTags必须是至多16个受控技术标签');
  const technicalTags = tags as PhotoTechnicalTagId[];
  if (new Set(technicalTags).size !== technicalTags.length) throw new Error('photoTechnicalMetadata.technicalTags不能重复');
  const labels = input.ownerCustomLabels;
  if (!Array.isArray(labels) || labels.length > 12) throw new Error('photoTechnicalMetadata.ownerCustomLabels必须是至多12个自定义标签');
  const ownerCustomLabels = labels.map((label, index) => plainText(label, `photoTechnicalMetadata.ownerCustomLabels[${index}]`, 48, true) as string);
  if (new Set(ownerCustomLabels.map((label) => label.toLocaleLowerCase())).size !== ownerCustomLabels.length) throw new Error('photoTechnicalMetadata.ownerCustomLabels不能重复');
  const shutterSpeed = plainText(input.shutterSpeed, 'photoTechnicalMetadata.shutterSpeed', 16, true) as string;
  if (!/^(?:1\/[1-9]\d{0,5}|[1-9]\d*(?:\.\d+)?s)$/.test(shutterSpeed)) throw new Error('photoTechnicalMetadata.shutterSpeed必须是如1/125或0.5s的快门表示');
  return {
    camera: plainText(input.camera, 'photoTechnicalMetadata.camera', 160, true) as string,
    lens: plainText(input.lens, 'photoTechnicalMetadata.lens', 160, true) as string,
    focalLengthMm: positiveNumber(input.focalLengthMm, 'photoTechnicalMetadata.focalLengthMm', 2000),
    aperture: positiveNumber(input.aperture, 'photoTechnicalMetadata.aperture', 128),
    shutterSpeed,
    iso: positiveNumber(input.iso, 'photoTechnicalMetadata.iso', 409600),
    captureDate: captureDate(input.captureDate),
    calibratedLocationLabel: plainText(input.calibratedLocationLabel, 'photoTechnicalMetadata.calibratedLocationLabel', 120),
    technicalTags,
    ownerCustomLabels,
    creationNote: plainText(input.creationNote, 'photoTechnicalMetadata.creationNote', 4000),
    visibility: metadataVisibility(input.visibility),
  };
};

export const guestDisplayName = (params: Input): string => {
  const value = requiredString(params, 'displayName', '显示名称');
  if (value.length > 80 || hasUnsafeText(value)) throw new Error('显示名称必须是80字以内的纯文本');
  return value;
};

export const guestCommentBody = (params: Input): string => {
  const value = requiredString(params, 'body', '留言内容');
  if (value.length > 2000 || hasUnsafeText(value)) throw new Error('留言内容必须是2000字以内的纯文本，且不能包含HTML');
  return value;
};

export const normalizedEmail = (params: Input): string => {
  const value = requiredString(params, 'email', '邮箱地址').toLowerCase();
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error('邮箱地址格式无效');
  return value;
};

export const guestAvatarId = (params: Input): GuestAvatarId => {
  const value = requiredString(params, 'avatarId', '预设头像');
  if (!(guestAvatarIds as readonly string[]).includes(value)) throw new Error('avatarId必须是受控预设头像');
  return value as GuestAvatarId;
};

export const guestCommentSubject = (params: Input): { subjectType: GuestCommentSubjectType; subjectId?: string } => {
  const subjectType = params.subjectType;
  if (subjectType !== 'guestbook' && subjectType !== 'portfolio' && subjectType !== 'journal') throw new Error('subjectType无效');
  const subjectId = optionalString(params, 'subjectId');
  if (subjectType === 'guestbook' && subjectId !== undefined) throw new Error('访客簿留言不能指定subjectId');
  if (subjectType !== 'guestbook' && subjectId === undefined) throw new Error('内容留言必须指定subjectId');
  if (subjectId !== undefined && (subjectId.length > 160 || !/^[A-Za-z0-9_-]+$/.test(subjectId))) throw new Error('subjectId格式无效');
  return { subjectType, subjectId };
};
