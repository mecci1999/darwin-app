/**
 * 文件微服务内部方法
 * 提供给其他微服务调用的接口
 */

import { Starlight } from 'typings';
import { 
  FileUploadRequest, 
  FileUploadResponse, 
  FileDeleteResponse, 
  FileInfoResponse,
  FileSearchRequest,
  FileSearchResponse,
  FileStats,
  BatchUploadRequest,
  BatchUploadResponse,
  FileMetadata,
  FileCategory,
  FileStatus,
  FileErrorType,
  FileOperation
} from '../types';
import { FileEventHandler, FileUtils, ErrorHandler, performanceMonitor } from '../utils';
import { defaultStorage } from '../storage';
import { ImageProcessor } from '../processors';
import { FileValidator } from '../validators';
import { ERROR_MESSAGES, METRICS_CONFIG } from '../constants';

/**
 * 文件微服务方法类
 */
export class FileMethods {
  private star: Starlight;
  private eventHandler: FileEventHandler;

  constructor(star: Starlight) {
    this.star = star;
    this.eventHandler = FileEventHandler.getInstance();
    this.eventHandler.initialize(star);
  }

  /**
   * 上传单个文件
   */
  async uploadFile(request: FileUploadRequest): Promise<FileUploadResponse> {
    const startTime = Date.now();
    
    try {
      // 性能监控
      performanceMonitor.incrementCounter(METRICS_CONFIG.UPLOAD_SUCCESS_COUNTER);
      
      // 验证文件
      const validation = FileValidator.validate(request.file, request.filename, request.mimetype, request.category);
      if (!validation.isValid) {
        throw ErrorHandler.createError(
          FileErrorType.VALIDATION_ERROR,
          validation.errors.join(', '),
          FileOperation.UPLOAD,
          undefined,
          { errors: validation.errors }
        );
      }

      // 生成文件ID和安全文件名
      const fileId = FileUtils.generateFileHash(request.file, 'md5');
      const safeFilename = FileUtils.generateUniqueFilename(request.filename, request.userId);
      
      // 保存文件
      const savedFilename = await defaultStorage.save(
        request.file,
        safeFilename,
        request.category,
        request.userId
      );

      if (!savedFilename) {
        throw ErrorHandler.createError(
          FileErrorType.STORAGE_ERROR,
          ERROR_MESSAGES.STORAGE_ERROR,
          FileOperation.UPLOAD,
          fileId
        );
      }

      // 处理图片（如果是图片文件）
      let thumbnailUrl: string | undefined;
      if (FileUtils.isImageFile(request.mimetype)) {
        try {
          const processed = await ImageProcessor.processImage(
            request.file,
            {
              imageProcessing: {
                thumbnail: { width: 200, height: 200, quality: 80 }
              }
            } as any
          );
          
          if (processed.thumbnail) {
            const thumbnailFilename = `thumb_${safeFilename}`;
            await defaultStorage.save(
              processed.thumbnail.buffer,
              thumbnailFilename,
              request.category,
              request.userId
            );
            thumbnailUrl = defaultStorage.getUrl(thumbnailFilename);
          }
        } catch (error) {
          this.star.logger?.warn('缩略图生成失败', { error, fileId });
        }
      }

      // 构建响应
      const response: FileUploadResponse = {
        success: true,
        fileId,
        filename: savedFilename,
        originalName: request.filename,
        size: request.file.length,
        mimetype: request.mimetype,
        category: request.category,
        url: defaultStorage.getUrl(savedFilename),
        thumbnailUrl,
        metadata: request.metadata,
        uploadedAt: new Date()
      };

      // 发布事件
      this.eventHandler.publishFileUploaded(fileId, request.userId || '', response);
      
      // 记录性能指标
      const duration = Date.now() - startTime;
      performanceMonitor.recordDuration('file_upload', duration);
      
      this.star.logger?.info('文件上传成功', { fileId, filename: savedFilename });
      
      return response;
    } catch (error) {
      performanceMonitor.incrementCounter(METRICS_CONFIG.UPLOAD_ERROR_COUNTER);
      ErrorHandler.handleError(error, this.star);
      throw error;
    }
  }

  /**
   * 批量上传文件
   */
  async uploadFiles(request: BatchUploadRequest): Promise<BatchUploadResponse> {
    const results: (FileUploadResponse | any)[] = [];
    let successCount = 0;
    let errorCount = 0;

    for (const fileRequest of request.files) {
      try {
        // 合并批量请求的通用参数
        const mergedRequest: FileUploadRequest = {
          ...fileRequest,
          userId: fileRequest.userId || request.userId,
          category: fileRequest.category || request.category || FileCategory.GENERAL,
          metadata: { ...request.metadata, ...fileRequest.metadata }
        };
        
        const result = await this.uploadFile(mergedRequest);
        results.push(result);
        successCount++;
      } catch (error) {
        results.push(error);
        errorCount++;
      }
    }

    return {
      success: errorCount === 0,
      results,
      totalFiles: request.files.length,
      successCount,
      errorCount
    };
  }

  /**
   * 删除文件
   */
  async deleteFile(filename: string, userId?: string): Promise<FileDeleteResponse> {
    try {
      const deleted = await defaultStorage.delete(filename);
      
      if (deleted) {
        // 尝试删除缩略图
        const thumbnailFilename = `thumb_${filename}`;
        try {
          await defaultStorage.delete(thumbnailFilename);
        } catch (error) {
          this.star.logger?.debug('缩略图删除失败或不存在', { thumbnailFilename });
        }

        // 发布删除事件
        this.eventHandler.publishFileDeleted('', userId || '', filename);
        this.star.logger?.info('文件删除成功', { filename });
      }

      return { filename, deleted };
    } catch (error) {
      ErrorHandler.handleError(error, this.star);
      throw error;
    }
  }

  /**
   * 获取文件信息
   */
  async getFileInfo(filename: string): Promise<FileInfoResponse> {
    try {
      const exists = await defaultStorage.exists(filename);
      
      if (!exists) {
        return {
          filename,
          url: '',
          mimetype: null,
          exists: false
        };
      }

      const url = defaultStorage.getUrl(filename);
      const mimetype = FileUtils.getExtensionFromMimeType(filename);
      
      // 检查是否有缩略图
      const thumbnailFilename = `thumb_${filename}`;
      const thumbnailExists = await defaultStorage.exists(thumbnailFilename);
      const thumbnailUrl = thumbnailExists ? defaultStorage.getUrl(thumbnailFilename) : undefined;

      return {
        filename,
        url,
        thumbnailUrl,
        mimetype,
        exists: true
      };
    } catch (error) {
      ErrorHandler.handleError(error, this.star);
      throw error;
    }
  }

  /**
   * 搜索文件（简化版本）
   */
  async searchFiles(request: FileSearchRequest): Promise<FileSearchResponse> {
    // 这里是一个简化的实现，实际应该连接数据库
    // 目前返回空结果
    return {
      files: [],
      total: 0,
      limit: request.limit || 10,
      offset: request.offset || 0,
      hasMore: false
    };
  }

  /**
   * 获取文件统计信息（简化版本）
   */
  async getFileStats(userId?: string): Promise<FileStats> {
    // 这里是一个简化的实现，实际应该连接数据库
    return {
      totalFiles: 0,
      totalSize: 0,
      byCategory: {} as any,
      byMimetype: {},
      byStatus: {} as any,
      uploadTrend: []
    };
  }

  /**
   * 检查文件是否存在
   */
  async fileExists(filename: string): Promise<boolean> {
    try {
      return await defaultStorage.exists(filename);
    } catch (error) {
      ErrorHandler.handleError(error, this.star);
      return false;
    }
  }

  /**
   * 获取文件URL
   */
  async getFileUrl(filename: string): Promise<string | null> {
    try {
      const exists = await defaultStorage.exists(filename);
      if (!exists) return null;
      
      return defaultStorage.getUrl(filename);
    } catch (error) {
      ErrorHandler.handleError(error, this.star);
      return null;
    }
  }

  /**
   * 验证文件
   */
  validateFile(file: Buffer, filename: string, mimetype: string, category: FileCategory) {
    return FileValidator.validate(file, filename, mimetype, category);
  }

  /**
   * 生成安全文件名
   */
  generateSafeFilename(originalFilename: string, userId?: string): string {
    return FileUtils.generateUniqueFilename(originalFilename, userId);
  }

  /**
   * 获取性能指标
   */
  getPerformanceMetrics() {
    return performanceMonitor.getAllMetrics();
  }

  /**
   * 重置性能指标
   */
  resetPerformanceMetrics() {
    performanceMonitor.reset();
  }
}

/**
 * 创建文件方法实例
 */
export function createFileMethods(star: Starlight): FileMethods {
  return new FileMethods(star);
}

/**
 * 默认导出
 */
export default FileMethods;