/**
 * 文件上传微服务工具类
 */

import { Starlight } from 'typings';
import { FILE_EVENTS, ERROR_MESSAGES, VALIDATION_RULES } from '../constants';
import { FileCategory, FileOperation, FileErrorType, FileStatus } from '../types';
import * as crypto from 'crypto';
import * as path from 'path';
import * as mime from 'mime-types';

/**
 * 文件事件处理器
 */
export class FileEventHandler {
  private static instance: FileEventHandler;
  private star?: Starlight;
  private eventQueue: FileEventData[] = [];
  private isProcessing = false;

  private constructor() {}

  static getInstance(): FileEventHandler {
    if (!FileEventHandler.instance) {
      FileEventHandler.instance = new FileEventHandler();
    }
    return FileEventHandler.instance;
  }

  /**
   * 初始化事件处理器
   */
  initialize(star: Starlight) {
    this.star = star;
    this.startEventProcessing();
  }

  /**
   * 发布文件上传事件
   */
  publishFileUploaded(fileId: string, userId: string, fileInfo: any, source: string = 'file-service') {
    const event: FileEventData = {
      fileId,
      userId,
      eventType: FILE_EVENTS.UPLOADED,
      timestamp: new Date(),
      data: fileInfo,
      source,
      metadata: {
        action: 'upload',
        service: 'file',
      },
    };
    this.eventQueue.push(event);
  }

  /**
   * 发布文件删除事件
   */
  publishFileDeleted(fileId: string, userId: string, source: string = 'file-service') {
    const event: FileEventData = {
      fileId,
      userId,
      eventType: FILE_EVENTS.DELETED,
      timestamp: new Date(),
      data: { fileId, userId },
      source,
      metadata: {
        action: 'delete',
        service: 'file',
      },
    };
    this.eventQueue.push(event);
  }

  /**
   * 发布文件处理事件
   */
  publishFileProcessed(fileId: string, userId: string, processInfo: any, source: string = 'file-service') {
    const event: FileEventData = {
      fileId,
      userId,
      eventType: FILE_EVENTS.PROCESSED,
      timestamp: new Date(),
      data: processInfo,
      source,
      metadata: {
        action: 'process',
        service: 'file',
      },
    };
    this.eventQueue.push(event);
  }

  /**
   * 发布文件错误事件
   */
  publishFileError(fileId: string, userId: string, error: any, source: string = 'file-service') {
    const event: FileEventData = {
      fileId,
      userId,
      eventType: FILE_EVENTS.ERROR,
      timestamp: new Date(),
      data: { error: error.message || error },
      source,
      metadata: {
        action: 'error',
        service: 'file',
      },
    };
    this.eventQueue.push(event);
  }

  /**
   * 开始处理事件队列
   */
  private startEventProcessing() {
    if (this.isProcessing) return;
    
    this.isProcessing = true;
    setInterval(() => {
      this.processEventQueue();
    }, 1000); // 每秒处理一次事件队列
  }

  /**
   * 处理事件队列
   */
  private async processEventQueue() {
    if (!this.star || this.eventQueue.length === 0) return;

    const events = this.eventQueue.splice(0, 10); // 每次处理最多10个事件
    
    for (const event of events) {
      try {
        // 发布事件到消息队列
        await this.star.emit(event.eventType, event);
        this.star.logger?.info(`文件事件已发布: ${event.eventType}`, {
          fileId: event.fileId,
          userId: event.userId,
        });
      } catch (error) {
        this.star.logger?.error('发布文件事件失败:', error);
        // 重新加入队列重试
        this.eventQueue.push(event);
      }
    }
  }
}

/**
 * 文件验证工具
 */
export class FileValidationHandler {
  /**
   * 验证文件名安全性
   */
  static validateFilename(filename: string): boolean {
    // 检查文件名是否包含危险字符
    const dangerousChars = /[<>:"/\\|?*\x00-\x1f]/;
    if (dangerousChars.test(filename)) {
      return false;
    }

    // 检查文件名长度
    if (filename.length > 255) {
      return false;
    }

    // 检查是否为保留名称
    const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'];
    const nameWithoutExt = filename.split('.')[0].toUpperCase();
    if (reservedNames.includes(nameWithoutExt)) {
      return false;
    }

    return true;
  }

  /**
   * 生成安全的文件名
   */
  static generateSafeFilename(originalFilename: string): string {
    // 移除危险字符
    let safeName = originalFilename.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    
    // 限制长度
    if (safeName.length > 255) {
      const ext = safeName.split('.').pop();
      const nameWithoutExt = safeName.substring(0, safeName.lastIndexOf('.'));
      safeName = nameWithoutExt.substring(0, 255 - ext!.length - 1) + '.' + ext;
    }

    return safeName;
  }
}

/**
 * 文件事件数据接口
 */
export interface FileEventData {
  fileId: string;
  userId: string;
  eventType: string;
  timestamp: Date;
  data: Record<string, any>;
  source: string;
  metadata?: Record<string, any>;
}



/**
 * 文件工具类
 */
export class FileUtils {
  /**
   * 生成文件哈希值
   */
  static generateFileHash(buffer: Buffer, algorithm: string = 'sha256'): string {
    return crypto.createHash(algorithm).update(buffer).digest('hex');
  }

  /**
   * 获取文件扩展名
   */
  static getFileExtension(filename: string): string {
    return path.extname(filename).toLowerCase().slice(1);
  }

  /**
   * 根据MIME类型获取文件扩展名
   */
  static getExtensionFromMimeType(mimeType: string): string | null {
     const extension = mime.extension(mimeType);
     return extension ? String(extension) : null;
   }

  /**
   * 验证MIME类型
   */
  static validateMimeType(mimeType: string, allowedTypes: string[]): boolean {
    return allowedTypes.includes(mimeType);
  }

  /**
   * 格式化文件大小
   */
  static formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * 生成唯一文件名
   */
  static generateUniqueFilename(originalFilename: string, userId?: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const extension = this.getFileExtension(originalFilename) || 'bin';
    const baseName = path.basename(originalFilename, path.extname(originalFilename));
    const userPrefix = userId ? `${userId}_` : '';
    return `${userPrefix}${baseName}_${timestamp}_${random}.${extension}`;
  }

  /**
   * 检查文件是否为图片
   */
  static isImageFile(mimeType: string): boolean {
    return mimeType.startsWith('image/');
  }

  /**
   * 检查文件是否为文档
   */
  static isDocumentFile(mimeType: string): boolean {
    const documentTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/markdown'
    ];
    return documentTypes.includes(mimeType);
  }

  /**
   * 根据文件类型获取分类
   */
  static getCategoryFromMimeType(mimeType: string): FileCategory {
    if (this.isImageFile(mimeType)) {
      return FileCategory.GENERAL;
    }
    if (this.isDocumentFile(mimeType)) {
      return FileCategory.DOCUMENT;
    }
    return FileCategory.OTHER;
  }
}



/**
 * 性能监控器
 */
export class PerformanceMonitor {
  private metrics: Map<string, number[]> = new Map();
  private counters: Map<string, number> = new Map();

  /**
   * 记录操作耗时
   */
  recordDuration(operation: string, duration: number): void {
    if (!this.metrics.has(operation)) {
      this.metrics.set(operation, []);
    }
    this.metrics.get(operation)!.push(duration);

    // 保持最近100次记录
    const records = this.metrics.get(operation)!;
    if (records.length > 100) {
      records.shift();
    }
  }

  /**
   * 增加计数器
   */
  incrementCounter(name: string, value: number = 1): void {
    const current = this.counters.get(name) || 0;
    this.counters.set(name, current + value);
  }

  /**
   * 获取平均耗时
   */
  getAverageDuration(operation: string): number {
    const records = this.metrics.get(operation);
    if (!records || records.length === 0) return 0;
    return records.reduce((sum, duration) => sum + duration, 0) / records.length;
  }

  /**
   * 获取计数器值
   */
  getCounter(name: string): number {
    return this.counters.get(name) || 0;
  }

  /**
   * 获取所有指标
   */
  getAllMetrics(): Record<string, any> {
    const result: Record<string, any> = {};
    
    // 添加平均耗时
    for (const [operation, records] of this.metrics) {
      result[`${operation}_avg_duration`] = this.getAverageDuration(operation);
      result[`${operation}_total_calls`] = records.length;
    }

    // 添加计数器
    for (const [name, value] of this.counters) {
      result[name] = value;
    }

    return result;
  }

  /**
   * 重置所有指标
   */
  reset(): void {
    this.metrics.clear();
    this.counters.clear();
  }
}

/**
 * 错误处理器
 */
export class ErrorHandler {
  /**
   * 创建标准化错误
   */
  static createError(
    type: FileErrorType,
    message: string,
    operation?: FileOperation,
    fileId?: string,
    details?: Record<string, any>
  ): Error {
    const error = new Error(message);
    (error as any).type = type;
    (error as any).operation = operation;
    (error as any).fileId = fileId;
    (error as any).details = details;
    (error as any).timestamp = new Date();
    return error;
  }

  /**
   * 处理和记录错误
   */
  static handleError(error: any, star?: Starlight): void {
    const errorInfo = {
      type: error.type || FileErrorType.UPLOAD_ERROR,
      message: error.message,
      operation: error.operation,
      fileId: error.fileId,
      details: error.details,
      timestamp: error.timestamp || new Date(),
      stack: error.stack
    };

    star?.logger?.error('文件操作错误:', errorInfo);
  }

  /**
   * 获取用户友好的错误消息
   */
  static getUserFriendlyMessage(error: any): string {
    switch (error.type) {
      case FileErrorType.VALIDATION_ERROR:
        return ERROR_MESSAGES.VALIDATION_FAILED;
      case FileErrorType.UPLOAD_ERROR:
        return ERROR_MESSAGES.UPLOAD_FAILED;
      case FileErrorType.PROCESSING_ERROR:
        return ERROR_MESSAGES.PROCESSING_FAILED;
      case FileErrorType.STORAGE_ERROR:
        return ERROR_MESSAGES.STORAGE_ERROR;
      case FileErrorType.PERMISSION_ERROR:
        return ERROR_MESSAGES.PERMISSION_DENIED;
      case FileErrorType.NOT_FOUND_ERROR:
        return ERROR_MESSAGES.FILE_NOT_FOUND;
      default:
        return error.message || '未知错误';
    }
  }
}

// 创建全局实例
export const performanceMonitor = new PerformanceMonitor();

/**
 * 文件元数据接口（保持向后兼容）
 */
export interface FileMetadata {
  originalName: string;
  mimeType: string;
  size: number;
  uploadedAt: Date;
  userId: string;
  category: string;
  status: FileStatus;
  processingInfo?: {
    compressed?: boolean;
    thumbnailGenerated?: boolean;
    formatConverted?: boolean;
  };
}