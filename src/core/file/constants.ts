/**
 * 文件上传微服务常量
 */

import { FileCategory, ProcessingProfile } from './types';

// 微服务名称
export const APP_NAME = 'file';

// 文件存储路径
export const STORAGE_PATHS = {
  UPLOADS: 'uploads',
  AVATARS: 'uploads/avatars',
  BLOG_IMAGES: 'uploads/blog',
  DOCUMENTS: 'uploads/documents',
  GENERAL: 'uploads/general',
  THUMBNAILS: 'uploads/thumbnails',
} as const;

// 文件大小限制（字节）
export const FILE_SIZE_LIMITS = {
  AVATAR: 5 * 1024 * 1024, // 5MB
  BLOG_IMAGE: 10 * 1024 * 1024, // 10MB
  DOCUMENT: 50 * 1024 * 1024, // 50MB
  GENERAL: 100 * 1024 * 1024, // 100MB
} as const;

// 支持的图片格式
export const SUPPORTED_IMAGE_FORMATS = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;

// 支持的文档格式
export const SUPPORTED_DOCUMENT_FORMATS = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
] as const;

// 缩略图配置
export const THUMBNAIL_CONFIG = {
  WIDTH: 200,
  HEIGHT: 200,
  QUALITY: 80,
  FORMAT: 'webp',
} as const;

// 清理配置
export const CLEANUP_CONFIG = {
  TEMP_FILE_TTL: 24 * 60 * 60 * 1000, // 24小时
  ORPHANED_FILE_TTL: 7 * 24 * 60 * 60 * 1000, // 7天
} as const;

// 微服务配置
export const SERVICE_CONFIG = {
  REQUEST_TIMEOUT: 30000, // 30秒
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000, // 1秒
  HEALTH_CHECK_INTERVAL: 30000, // 30秒
  MAX_CONCURRENT_UPLOADS: 10,
  UPLOAD_CHUNK_SIZE: 1024 * 1024, // 1MB
} as const;

// 处理配置文件
export const PROCESSING_PROFILES: Record<FileCategory, ProcessingProfile> = {
  [FileCategory.GENERAL]: {
    maxSize: FILE_SIZE_LIMITS.GENERAL,
    allowedMimeTypes: [...SUPPORTED_IMAGE_FORMATS, ...SUPPORTED_DOCUMENT_FORMATS],
    imageProcessing: {
      resize: { width: 1920, height: 1080, fit: 'inside' },
      quality: 85,
      format: 'webp',
    },
  },
  [FileCategory.AVATAR]: {
    maxSize: FILE_SIZE_LIMITS.AVATAR,
    allowedMimeTypes: [...SUPPORTED_IMAGE_FORMATS],
    imageProcessing: {
      resize: { width: 400, height: 400, fit: 'cover' },
      quality: 90,
      format: 'webp',
    },
  },
  [FileCategory.BLOG_IMAGE]: {
    maxSize: FILE_SIZE_LIMITS.BLOG_IMAGE,
    allowedMimeTypes: [...SUPPORTED_IMAGE_FORMATS],
    imageProcessing: {
      resize: { width: 1200, height: 800, fit: 'inside' },
      quality: 80,
      format: 'webp',
    },
  },
  [FileCategory.DOCUMENT]: {
    maxSize: FILE_SIZE_LIMITS.DOCUMENT,
    allowedMimeTypes: [...SUPPORTED_DOCUMENT_FORMATS],
  },
  [FileCategory.OTHER]: {
    maxSize: FILE_SIZE_LIMITS.GENERAL,
    allowedMimeTypes: ['*/*'],
  },
};

// 错误消息常量
export const ERROR_MESSAGES = {
  FILE_TOO_LARGE: 'File size exceeds maximum limit',
  INVALID_FILE_TYPE: 'File type not supported',
  UPLOAD_FAILED: 'File upload failed',
  FILE_NOT_FOUND: 'File not found',
  PROCESSING_FAILED: 'File processing failed',
  VALIDATION_FAILED: 'File validation failed',
  STORAGE_ERROR: 'Storage operation failed',
  PERMISSION_DENIED: 'Permission denied',
} as const;

// HTTP状态码映射
export const HTTP_STATUS_MAPPING = {
  SUCCESS: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

// 文件验证规则
export const VALIDATION_RULES = {
  FILENAME_MAX_LENGTH: 255,
  FILENAME_MIN_LENGTH: 1,
  ALLOWED_FILENAME_CHARS: /^[a-zA-Z0-9._-]+$/,
  MAX_FILES_PER_REQUEST: 10,
  MIN_FILE_SIZE: 1, // 1 byte
} as const;



// 监控和指标配置
export const METRICS_CONFIG = {
  UPLOAD_SUCCESS_COUNTER: 'file_uploads_success_total',
  UPLOAD_ERROR_COUNTER: 'file_uploads_error_total',
  PROCESSING_DURATION_HISTOGRAM: 'file_processing_duration_seconds',
  STORAGE_USAGE_GAUGE: 'file_storage_usage_bytes',
  ACTIVE_UPLOADS_GAUGE: 'file_active_uploads',
} as const;

// 日志配置
export const LOG_CONFIG = {
  MAX_LOG_SIZE: 10 * 1024 * 1024, // 10MB
  LOG_RETENTION_DAYS: 30,
  LOG_LEVELS: {
    ERROR: 'error',
    WARN: 'warn',
    INFO: 'info',
    DEBUG: 'debug',
  },
} as const;

// 安全配置
export const SECURITY_CONFIG = {
  MAX_UPLOAD_RATE: 100, // 每分钟最大上传次数
  RATE_LIMIT_WINDOW: 60 * 1000, // 1分钟窗口
  VIRUS_SCAN_ENABLED: false, // 病毒扫描开关
  CONTENT_TYPE_VALIDATION: true, // 内容类型验证
  FILENAME_SANITIZATION: true, // 文件名清理
} as const;

// 文件事件类型
export const FILE_EVENTS = {
  UPLOADED: 'file.uploaded',
  DELETED: 'file.deleted',
  PROCESSED: 'file.processed',
  ERROR: 'file.error',
  VALIDATION_FAILED: 'file.validation_failed',
  PROCESSING_STARTED: 'file.processing_started',
  PROCESSING_COMPLETED: 'file.processing_completed',
} as const;
