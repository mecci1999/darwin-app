/**
 * 文件上传微服务动作
 * 提供文件上传、删除、查询等核心功能
 */

import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, Starlight } from 'typings';
import { FileUploadRequest, FileUploadResponse, FileCategory, ValidationResult, ProcessedImage } from '../types';
import { FileValidator } from '../validators';
import { PROCESSING_PROFILES } from '../constants';
import { ImageProcessor } from '../processors';
import { defaultStorage } from '../storage';
import { FileEventHandler, FileValidationHandler } from '../utils';
import { generateUserId } from '../../../utils';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as mime from 'mime-types';
import { instrumentServiceActions } from '../../../apps/starlight/metrics/utils/action-metrics';

/**
 * 文件上传微服务动作集合
 * 遵循统一的错误处理和响应格式规范
 */
export default function fileActions(star: Starlight) {
  const storage = defaultStorage;
  const eventHandler = FileEventHandler.getInstance();

  /**
   * 创建标准化的成功响应
   */
  const createSuccessResponse = <T>(data: T, message: string = '操作成功'): HttpResponseItem => ({
    status: 200,
    data: {
      content: data,
      message,
      code: HttpResponseCode.Success,
      success: true,
    },
  });

  /**
   * 创建标准化的错误响应
   */
  const createErrorResponse = (status: number, message: string, code: HttpResponseCode): HttpResponseItem => ({
    status,
    data: {
      content: null,
      message,
      code,
      success: false,
    },
  });

  return instrumentServiceActions(star, 'file', {
    'v1.uploadFile': {
      metadata: {
        auth: true,
      },
      params: {
        file: { type: 'string', required: true },
        filename: { type: 'string', required: true },
        mimetype: { type: 'string', required: true },
        category: { type: 'string', optional: true },
        userId: { type: 'string', optional: true },
        metadata: { type: 'object', optional: true },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const startTime = Date.now();
        
        try {
          const params = ctx.params;
          
          // 验证必需参数
          if (!params.file || !params.filename || !params.mimetype) {
            star.logger?.warn('文件上传参数验证失败', { params: Object.keys(params) });
            return createErrorResponse(400, '缺少必需的文件参数', HttpResponseCode.ParamsError);
          }

          // 验证文件名安全性
          if (!FileValidationHandler.validateFilename(params.filename)) {
            return createErrorResponse(400, '文件名包含非法字符', HttpResponseCode.ParamsError);
          }

          // 文件验证
          const fileBuffer = Buffer.from(params.file, 'base64');
          const category = (params.category as FileCategory) || FileCategory.OTHER;
          
          const validationResult = FileValidator.validate(
            fileBuffer,
            params.filename,
            params.mimetype,
            category
          );

          if (!validationResult.isValid) {
            star.logger?.warn('文件验证失败', { 
              filename: params.filename, 
              errors: validationResult.errors 
            });
            return createErrorResponse(400, validationResult.errors.join(', '), HttpResponseCode.ParamsError);
          }

          star.logger?.info('文件验证通过', { 
            filename: params.filename, 
            size: fileBuffer.length,
            category 
          });

          // 构建文件上传请求
          const uploadRequest: FileUploadRequest = {
            file: fileBuffer,
            filename: params.filename,
            mimetype: params.mimetype,
            category,
            userId: params.userId || generateUserId(),
            metadata: params.metadata || {}
          };

          // 生成文件ID
          const fileId = uuidv4();
          let processedFile = uploadRequest.file;
          let finalFilename = uploadRequest.filename;
          let thumbnailFilename: string | undefined;

          // 处理图片（如果是图片文件）
          if (isImageFile(uploadRequest.mimetype)) {
            try {
              star.logger?.info('开始处理图片', { filename: uploadRequest.filename });
              const processed = await ImageProcessor.processImage(
                uploadRequest.file,
                PROCESSING_PROFILES[uploadRequest.category as keyof typeof PROCESSING_PROFILES] || PROCESSING_PROFILES.avatar
              );
              
              if (processed && processed.main) {
                processedFile = processed.main.buffer;
                const ext = 'webp'; // 默认转换为webp格式
                finalFilename = replaceFileExtension(uploadRequest.filename, ext);
                
                star.logger?.info('图片处理完成', { 
                  filename: uploadRequest.filename,
                  originalSize: uploadRequest.file.length,
                  processedSize: processedFile.length,
                  format: ext
                });

                // 处理缩略图
                if (processed.thumbnail) {
                  const thumbnailName = generateThumbnailFilename(finalFilename);
                  try {
                    thumbnailFilename = await storage.save(
                      processed.thumbnail.buffer,
                      thumbnailName
                    );
                    star.logger?.debug('缩略图保存成功', { thumbnailName });
                  } catch (error) {
                    star.logger?.warn('缩略图保存失败', { 
                      error: error instanceof Error ? error.message : String(error) 
                    });
                  }
                }
              }
            } catch (error) {
              star.logger?.error('图片处理失败', { 
                filename: uploadRequest.filename, 
                error: error instanceof Error ? error.message : String(error) 
              });
              // 图片处理失败时使用原始文件
              processedFile = uploadRequest.file;
              finalFilename = uploadRequest.filename;
            }
          }
          
          // 保存主文件
          const savedFilename = await storage.save(
            processedFile,
            finalFilename
          );
          
          if (!savedFilename) {
            throw new Error('Failed to save file');
          }
          
          // 发布文件上传事件
          eventHandler.publishFileUploaded(fileId, uploadRequest.userId || 'anonymous', {
            filename: uploadRequest.filename,
            size: processedFile.length,
            mimetype: uploadRequest.mimetype,
            category: uploadRequest.category,
            url: await storage.getUrl(savedFilename),
            thumbnailUrl: thumbnailFilename ? await storage.getUrl(thumbnailFilename) : null,
          });

          const processingTime = Date.now() - startTime;
          star.logger?.info(`文件上传成功: ${uploadRequest.filename}`, {
            fileId,
            userId: uploadRequest.userId,
            size: processedFile.length,
            processingTime
          });

          return createSuccessResponse({
            fileId,
            filename: savedFilename,
            originalName: uploadRequest.filename,
            size: processedFile.length,
            mimetype: getMimeTypeFromExtension(finalFilename) || uploadRequest.mimetype,
            category: uploadRequest.category,
            url: storage.getUrl(savedFilename),
            thumbnailUrl: thumbnailFilename ? storage.getUrl(thumbnailFilename) : undefined,
            metadata: uploadRequest.metadata,
            uploadedAt: new Date()
          }, '文件上传成功');

        } catch (error) {
          const processingTime = Date.now() - startTime;
          star.logger?.error('文件上传失败', { 
            error: error instanceof Error ? error.message : String(error),
            processingTime
          });
          
          // 发布错误事件
          if (ctx.params.userId) {
            eventHandler.publishFileError('', ctx.params.userId, error);
          }

          return createErrorResponse(500, error instanceof Error ? error.message : '文件上传失败', HttpResponseCode.ServiceActionFaild);
        }
      },
    },

    'v1.deleteFile': {
      metadata: {
        auth: true,
      },
      params: {
        filename: { type: 'string', required: true },
        userId: { type: 'string', optional: true },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { filename, userId } = ctx.params;
          
          if (!filename) {
            return createErrorResponse(400, '缺少必需的参数', HttpResponseCode.ParamsError);
          }

          star.logger?.info('开始删除文件', { filename, userId });

          // 删除主文件
          const deleted = await storage.delete(filename);
          
          // 尝试删除缩略图
          const thumbnailName = generateThumbnailFilename(filename);
          try {
            await storage.delete(thumbnailName);
            star.logger?.debug('缩略图删除成功', { thumbnailName });
          } catch (error) {
            star.logger?.debug('缩略图删除失败或不存在', { thumbnailName });
          }

          if (deleted) {
            // 发布文件删除事件
            eventHandler.publishFileDeleted('', userId || '', filename);
            star.logger?.info('文件删除成功', { filename });
          }

          return createSuccessResponse(
            { filename, deleted },
            deleted ? '文件删除成功' : '文件不存在'
          );

        } catch (error) {
          star.logger?.error('文件删除失败', { 
            filename: ctx.params.filename,
            error: error instanceof Error ? error.message : String(error)
          });

          return createErrorResponse(500, error instanceof Error ? error.message : '文件删除失败', HttpResponseCode.ServiceActionFaild);
        }
      },
    },

    'v1.getFileInfo': {
      metadata: {
        auth: true,
      },
      params: {
        filename: { type: 'string', required: true },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { filename } = ctx.params;
          
          if (!filename) {
            return createErrorResponse(400, '缺少必需的参数', HttpResponseCode.ParamsError);
          }

          // 检查文件是否存在
          const exists = await storage.exists(filename);
          
          if (!exists) {
            return createErrorResponse(404, `文件不存在: ${filename}`, HttpResponseCode.ParamsError);
          }

          // 获取文件URL和元数据
          const url = storage.getUrl(filename);
          const thumbnailName = generateThumbnailFilename(filename);
          const thumbnailExists = await storage.exists(thumbnailName);
          
          const fileInfo = {
            filename,
            url,
            thumbnailUrl: thumbnailExists ? storage.getUrl(thumbnailName) : undefined,
            mimetype: getMimeTypeFromExtension(filename),
            exists: true
          };

          star.logger?.debug('获取文件信息成功', { filename });

          return createSuccessResponse(fileInfo, '获取文件信息成功');

        } catch (error) {
          star.logger?.error('获取文件信息失败', { 
            filename: ctx.params.filename,
            error: error instanceof Error ? error.message : String(error)
          });

          return createErrorResponse(500, error instanceof Error ? error.message : '获取文件信息失败', HttpResponseCode.ServiceActionFaild);
        }
      },
    },
  });
}

/**
 * 辅助函数：检查是否为图片文件
 */
function isImageFile(mimetype: string): boolean {
  return mimetype.startsWith('image/');
}

/**
 * 辅助函数：替换文件扩展名
 */
function replaceFileExtension(filename: string, newExt: string): string {
  const lastDotIndex = filename.lastIndexOf('.');
  if (lastDotIndex === -1) {
    return `${filename}.${newExt}`;
  }
  return `${filename.substring(0, lastDotIndex)}.${newExt}`;
}

/**
 * 辅助函数：生成缩略图文件名
 */
function generateThumbnailFilename(originalFilename: string): string {
  const lastDotIndex = originalFilename.lastIndexOf('.');
  if (lastDotIndex === -1) {
    return `${originalFilename}_thumb`;
  }
  const name = originalFilename.substring(0, lastDotIndex);
  const ext = originalFilename.substring(lastDotIndex);
  return `${name}_thumb${ext}`;
}

/**
 * 辅助函数：根据文件扩展名获取MIME类型
 */
function getMimeTypeFromExtension(filename: string): string | null {
  return mime.lookup(filename) || null;
}
