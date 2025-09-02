/**
 * 文件微服务事件处理
 * 定义和处理文件相关的事件
 */

import { Starlight } from 'typings';
import { 
  FileEvent, 
  FileMetadata, 
  FileCategory, 
  FileStatus,
  FileOperation,
  FileErrorType
} from '../types';
import { FILE_EVENTS, LOG_CONFIG } from '../constants';
import { performanceMonitor } from '../utils';

/**
 * 事件处理器接口
 */
export interface EventHandler {
  handle(event: FileEvent): Promise<void>;
}

/**
 * 文件上传事件处理器
 */
export class FileUploadEventHandler implements EventHandler {
  private star: Starlight;

  constructor(star: Starlight) {
    this.star = star;
  }

  async handle(event: FileEvent): Promise<void> {
    try {
      const { fileId, userId, data } = event;
      
      // 记录上传事件
      this.star.logger?.info('文件上传事件', {
        fileId,
        userId,
        filename: data.filename,
        size: data.size,
        category: data.category,
        timestamp: event.timestamp
      });

      // 更新性能指标
      performanceMonitor.incrementCounter('file_upload_events');
      
      // 发布到消息队列（如果配置了）
      // if (this.star.broker) {
      //   await this.star.broker.emit('file.uploaded', {
      //     fileId,
      //     userId,
      //     metadata: data,
      //     timestamp: event.timestamp
      //   });
      // }

      // 触发后续处理（如缩略图生成、病毒扫描等）
      await this.triggerPostUploadProcessing(event);
      
    } catch (error) {
      this.star.logger?.error('文件上传事件处理失败', { error, event });
    }
  }

  private async triggerPostUploadProcessing(event: FileEvent): Promise<void> {
    const { fileId, data } = event;
    
    // 如果是图片文件，触发缩略图生成
    if (data.category === FileCategory.BLOG_IMAGE || data.category === FileCategory.AVATAR) {
      // 这里可以发送到处理队列
      this.star.logger?.debug('触发图片处理任务', { fileId, category: data.category });
    }

    // 如果是文档文件，触发内容提取
    if (data.category === FileCategory.DOCUMENT) {
      this.star.logger?.debug('触发文档处理任务', { fileId });
    }
  }
}

/**
 * 文件删除事件处理器
 */
export class FileDeleteEventHandler implements EventHandler {
  private star: Starlight;

  constructor(star: Starlight) {
    this.star = star;
  }

  async handle(event: FileEvent): Promise<void> {
    try {
      const { fileId, userId, data } = event;
      
      // 记录删除事件
      this.star.logger?.info('文件删除事件', {
        fileId,
        userId,
        filename: data.filename,
        timestamp: event.timestamp
      });

      // 更新性能指标
      performanceMonitor.incrementCounter('file_delete_events');
      
      // 发布到消息队列
      // if (this.star.broker) {
      //   await this.star.broker.emit('file.deleted', {
      //     fileId,
      //     userId,
      //     filename: data.filename,
      //     timestamp: event.timestamp
      //   });
      // }

      // 清理相关资源
      await this.cleanupRelatedResources(event);
      
    } catch (error) {
      this.star.logger?.error('文件删除事件处理失败', { error, event });
    }
  }

  private async cleanupRelatedResources(event: FileEvent): Promise<void> {
    const { fileId, data } = event;
    
    // 清理缓存
    this.star.logger?.debug('清理文件相关缓存', { fileId, filename: data.filename });
    
    // 清理数据库记录（如果有）
    // 这里可以调用数据库清理方法
  }
}

/**
 * 文件处理事件处理器
 */
export class FileProcessEventHandler implements EventHandler {
  private star: Starlight;

  constructor(star: Starlight) {
    this.star = star;
  }

  async handle(event: FileEvent): Promise<void> {
    try {
      const { fileId, userId, data } = event;
      
      // 记录处理事件
      this.star.logger?.info('文件处理事件', {
        fileId,
        userId,
        operation: data.operation,
        status: data.status,
        timestamp: event.timestamp
      });

      // 更新性能指标
      performanceMonitor.incrementCounter('file_process_events');
      
      // 发布到消息队列
      // if (this.star.broker) {
      //   await this.star.broker.emit('file.processed', {
      //     fileId,
      //     userId,
      //     operation: data.operation,
      //     status: data.status,
      //     result: data.result,
      //     timestamp: event.timestamp
      //   });
      // }
      
    } catch (error) {
      this.star.logger?.error('文件处理事件处理失败', { error, event });
    }
  }
}

/**
 * 文件错误事件处理器
 */
export class FileErrorEventHandler implements EventHandler {
  private star: Starlight;

  constructor(star: Starlight) {
    this.star = star;
  }

  async handle(event: FileEvent): Promise<void> {
    try {
      const { fileId, userId, data } = event;
      
      // 记录错误事件
      this.star.logger?.error('文件错误事件', {
        fileId,
        userId,
        error: data.error,
        operation: data.operation,
        timestamp: event.timestamp
      });

      // 更新性能指标
      performanceMonitor.incrementCounter('file_error_events');
      
      // 发布到消息队列
      // if (this.star.broker) {
      //   await this.star.broker.emit('file.error', {
      //     fileId,
      //     userId,
      //     error: data.error,
      //     operation: data.operation,
      //     timestamp: event.timestamp
      //   });
      // }

      // 触发错误恢复机制
      await this.triggerErrorRecovery(event);
      
    } catch (error) {
      this.star.logger?.error('文件错误事件处理失败', { error, event });
    }
  }

  private async triggerErrorRecovery(event: FileEvent): Promise<void> {
    const { fileId, data } = event;
    
    // 根据错误类型触发不同的恢复策略
    switch (data.errorType) {
      case FileErrorType.STORAGE_ERROR:
        this.star.logger?.warn('存储错误，尝试重试', { fileId });
        // 可以触发重试机制
        break;
      case FileErrorType.VALIDATION_ERROR:
        this.star.logger?.warn('验证错误，记录用户行为', { fileId });
        // 可以记录用户行为分析
        break;
      case FileErrorType.PROCESSING_ERROR:
        this.star.logger?.warn('处理错误，降级处理', { fileId });
        // 可以触发降级处理
        break;
      default:
        this.star.logger?.warn('未知错误类型', { fileId, errorType: data.errorType });
    }
  }
}

/**
 * 事件分发器
 */
export class EventDispatcher {
  private handlers: Map<string, EventHandler[]> = new Map();
  private star: Starlight;

  constructor(star: Starlight) {
    this.star = star;
    this.initializeHandlers();
  }

  /**
   * 初始化事件处理器
   */
  private initializeHandlers(): void {
    // 注册文件上传事件处理器
    this.registerHandler(FILE_EVENTS.UPLOADED, new FileUploadEventHandler(this.star));
    
    // 注册文件删除事件处理器
    this.registerHandler(FILE_EVENTS.DELETED, new FileDeleteEventHandler(this.star));
    
    // 注册文件处理事件处理器
    this.registerHandler(FILE_EVENTS.PROCESSED, new FileProcessEventHandler(this.star));
    
    // 注册文件错误事件处理器
    this.registerHandler(FILE_EVENTS.ERROR, new FileErrorEventHandler(this.star));
  }

  /**
   * 注册事件处理器
   */
  registerHandler(eventType: string, handler: EventHandler): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType)!.push(handler);
  }

  /**
   * 移除事件处理器
   */
  removeHandler(eventType: string, handler: EventHandler): void {
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * 分发事件
   */
  async dispatch(event: FileEvent): Promise<void> {
    const handlers = this.handlers.get(event.eventType);
    if (!handlers || handlers.length === 0) {
      this.star.logger?.warn('没有找到事件处理器', { eventType: event.eventType });
      return;
    }

    // 并行处理所有处理器
    const promises = handlers.map(handler => 
      handler.handle(event).catch(error => {
        this.star.logger?.error('事件处理器执行失败', { 
          error, 
          eventType: event.eventType,
          handler: handler.constructor.name 
        });
      })
    );

    await Promise.allSettled(promises);
  }

  /**
   * 获取所有注册的事件类型
   */
  getRegisteredEventTypes(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * 获取指定事件类型的处理器数量
   */
  getHandlerCount(eventType: string): number {
    return this.handlers.get(eventType)?.length || 0;
  }
}

/**
 * 事件工厂
 */
export class EventFactory {
  /**
   * 创建文件上传事件
   */
  static createUploadEvent(
    fileId: string,
    userId: string,
    metadata: any,
    source: string = 'file-service'
  ): FileEvent {
    return {
      id: this.generateEventId(),
      fileId,
      userId,
      eventType: FILE_EVENTS.UPLOADED,
      timestamp: new Date(),
      data: metadata,
      source,
      metadata: {
        action: 'upload',
        service: 'file'
      }
    };
  }

  /**
   * 创建文件删除事件
   */
  static createDeleteEvent(
    fileId: string,
    userId: string,
    filename: string,
    source: string = 'file-service'
  ): FileEvent {
    return {
      id: this.generateEventId(),
      fileId,
      userId,
      eventType: FILE_EVENTS.DELETED,
      timestamp: new Date(),
      data: { filename },
      source,
      metadata: {
        action: 'delete',
        service: 'file'
      }
    };
  }

  /**
   * 创建文件处理事件
   */
  static createProcessEvent(
    fileId: string,
    userId: string,
    operation: FileOperation,
    status: FileStatus,
    result?: any,
    source: string = 'file-service'
  ): FileEvent {
    return {
      id: this.generateEventId(),
      fileId,
      userId,
      eventType: FILE_EVENTS.PROCESSED,
      timestamp: new Date(),
      data: {
        operation,
        status,
        result
      },
      source,
      metadata: {
        action: 'process',
        service: 'file'
      }
    };
  }

  /**
   * 创建文件错误事件
   */
  static createErrorEvent(
    fileId: string,
    userId: string,
    error: any,
    operation: FileOperation,
    errorType: FileErrorType,
    source: string = 'file-service'
  ): FileEvent {
    return {
      id: this.generateEventId(),
      fileId,
      userId,
      eventType: FILE_EVENTS.ERROR,
      timestamp: new Date(),
      data: {
        error: error.message || error,
        operation,
        errorType,
        stack: error.stack
      },
      source,
      metadata: {
        action: 'error',
        service: 'file'
      }
    };
  }

  /**
   * 生成事件ID
   */
  private static generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * 创建事件分发器实例
 */
export function createEventDispatcher(star: Starlight): EventDispatcher {
  return new EventDispatcher(star);
}

/**
 * 默认导出
 */
export default {
  EventDispatcher,
  EventFactory,
  FileUploadEventHandler,
  FileDeleteEventHandler,
  FileProcessEventHandler,
  FileErrorEventHandler,
  createEventDispatcher
};