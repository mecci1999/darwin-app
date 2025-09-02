/**
 * 文件上传相关类型定义
 */

// 文件类别枚举
export enum FileCategory {
  AVATAR = 'avatar',
  BLOG_IMAGE = 'blogImage',
  DOCUMENT = 'document',
  GENERAL = 'general',
  OTHER = 'other'
}

// 文件上传请求接口
export interface FileUploadRequest {
  file: Buffer;
  filename: string;
  mimetype: string;
  category: FileCategory;
  userId?: string;
  metadata?: Record<string, any>;
}

// 文件上传响应接口
export interface FileUploadResponse {
  success: boolean;
  fileId: string;
  filename: string;
  originalName: string;
  size: number;
  mimetype: string;
  category: FileCategory;
  url: string;
  thumbnailUrl?: string;
  metadata?: Record<string, any>;
  uploadedAt: Date;
}

// 处理配置文件接口
export interface ProcessingProfile {
  maxSize: number; // 最大文件大小（字节）
  allowedMimeTypes: string[]; // 允许的MIME类型
  imageProcessing?: {
    resize?: {
      width: number;
      height: number;
      fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
    };
    quality?: number; // 压缩质量 1-100
    format?: 'jpeg' | 'png' | 'webp';
    thumbnail?: {
      width: number;
      height: number;
      quality?: number;
    };
  };
}

// 文件验证结果接口
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

// 存储适配器接口
export interface StorageAdapter {
  save(file: Buffer, filename: string, category?: string, userId?: string): Promise<string>;
  delete(filename: string): Promise<boolean>;
  getUrl(filename: string): string;
  exists(filename: string): Promise<boolean>;
}

// 图片处理器接口
export interface ImageProcessorInterface {
  process(buffer: Buffer, filename: string, profiles: any): Promise<{
    main?: ProcessedImage;
    thumbnail?: ProcessedImage;
  }>;
}

// 文件删除响应接口
export interface FileDeleteResponse {
  filename: string;
  deleted: boolean;
}

// 文件信息响应接口
export interface FileInfoResponse {
  filename: string;
  url: string;
  thumbnailUrl?: string;
  mimetype: string | null;
  exists: boolean;
}

// 图片处理结果接口
export interface ProcessedImage {
  buffer: Buffer;
  info: {
    width: number;
    height: number;
    format: string;
    size: number;
  };
}

// 文件状态枚举
export enum FileStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  DELETED = 'deleted'
}

// 文件操作类型枚举
export enum FileOperation {
  UPLOAD = 'upload',
  DELETE = 'delete',
  PROCESS = 'process',
  VALIDATE = 'validate',
  THUMBNAIL = 'thumbnail'
}

// 错误类型枚举
export enum FileErrorType {
  VALIDATION_ERROR = 'validation_error',
  UPLOAD_ERROR = 'upload_error',
  PROCESSING_ERROR = 'processing_error',
  STORAGE_ERROR = 'storage_error',
  PERMISSION_ERROR = 'permission_error',
  NOT_FOUND_ERROR = 'not_found_error'
}

// 文件元数据接口
export interface FileMetadata {
  id: string;
  filename: string;
  originalName: string;
  size: number;
  mimetype: string;
  category: FileCategory;
  status: FileStatus;
  userId?: string;
  uploadedAt: Date;
  processedAt?: Date;
  url?: string;
  thumbnailUrl?: string;
  checksum?: string;
  tags?: string[];
  customData?: Record<string, any>;
}

// 文件事件接口
export interface FileEvent {
  id: string;
  eventType: string;
  fileId: string;
  userId?: string;
  timestamp: Date;
  data: Record<string, any>;
  source?: string;
  metadata?: Record<string, any>;
}

// 文件错误接口
export interface FileError {
  type: FileErrorType;
  message: string;
  code?: string;
  details?: Record<string, any>;
  timestamp: Date;
  operation?: FileOperation;
  fileId?: string;
}

// 批量上传请求接口
export interface BatchUploadRequest {
  files: FileUploadRequest[];
  userId?: string;
  category?: FileCategory;
  metadata?: Record<string, any>;
}

// 批量上传响应接口
export interface BatchUploadResponse {
  success: boolean;
  results: (FileUploadResponse | FileError)[];
  totalFiles: number;
  successCount: number;
  errorCount: number;
}

// 文件搜索请求接口
export interface FileSearchRequest {
  userId?: string;
  category?: FileCategory;
  mimetype?: string;
  filename?: string;
  tags?: string[];
  dateRange?: {
    from: Date;
    to: Date;
  };
  sizeRange?: {
    min: number;
    max: number;
  };
  status?: FileStatus;
  limit?: number;
  offset?: number;
  sortBy?: 'uploadedAt' | 'size' | 'filename';
  sortOrder?: 'asc' | 'desc';
}

// 文件搜索响应接口
export interface FileSearchResponse {
  files: FileMetadata[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

// 文件统计接口
export interface FileStats {
  totalFiles: number;
  totalSize: number;
  byCategory: Record<FileCategory, {
    count: number;
    size: number;
  }>;
  byMimetype: Record<string, {
    count: number;
    size: number;
  }>;
  byStatus: Record<FileStatus, number>;
  uploadTrend: {
    date: string;
    count: number;
    size: number;
  }[];
}

// 存储配置接口
export interface StorageConfig {
  provider: 'local' | 's3' | 'gcs' | 'azure';
  basePath: string;
  maxFileSize: number;
  allowedMimeTypes: string[];
  enableCompression: boolean;
  enableEncryption: boolean;
  retentionDays?: number;
  backupEnabled?: boolean;
}



// 队列任务接口
export interface QueueTask {
  id: string;
  type: FileOperation;
  fileId: string;
  userId?: string;
  data: Record<string, any>;
  priority: number;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  scheduledAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: FileError;
}

// 微服务健康检查接口
export interface HealthCheck {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: Date;
  version: string;
  uptime: number;
  dependencies: {
    storage: boolean;
    cache: boolean;
    queue: boolean;
    database: boolean;
  };
  metrics: {
    activeUploads: number;
    queueSize: number;
    errorRate: number;
    avgResponseTime: number;
  };
}