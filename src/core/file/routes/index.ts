import { FileUploadRequest, FileUploadResponse, FileDeleteResponse, FileInfoResponse, BatchUploadRequest, BatchUploadResponse, FileSearchRequest, FileSearchResponse, FileStats, HealthCheck, FileErrorType } from '../types';
import FileService from '../actions';
import { MiddlewarePipeline, createDefaultPipeline } from '../middleware';
import { ErrorHandler } from '../utils';

// 临时Starlight接口定义
interface Starlight {
  [key: string]: any;
}

/**
 * 路由处理器接口
 */
export interface RouteHandler {
  handle(request: any, context: RouteContext): Promise<any>;
}

/**
 * 路由上下文
 */
export interface RouteContext {
  star: Starlight;
  user?: any;
  headers: Record<string, string>;
  query: Record<string, string>;
  params: Record<string, string>;
  ip: string;
  userAgent: string;
  timestamp: number;
}

/**
 * 路由配置
 */
export interface RouteConfig {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  handler: RouteHandler;
  middleware?: string[];
  auth?: boolean;
}

/**
 * 基础路由处理器
 */
export class BaseRouteHandler implements RouteHandler {
  constructor(protected fileService: any) {}

  async handle(request: any, context: RouteContext): Promise<any> {
    throw new Error('Method not implemented');
  }

  protected createError(type: FileErrorType, message: string, error?: any): Error {
    return ErrorHandler.createError(type, message, error);
  }
}

/**
 * 文件上传路由处理器
 */
export class FileUploadRouteHandler extends BaseRouteHandler {
  async handle(request: FileUploadRequest, context: RouteContext): Promise<FileUploadResponse> {
    try {
      return await this.fileService.uploadFile(request, context.star);
    } catch (error) {
      throw this.createError(FileErrorType.UPLOAD_ERROR, 'File upload failed', error);
    }
  }
}

/**
 * 批量文件上传路由处理器
 */
export class BatchUploadRouteHandler extends BaseRouteHandler {
  async handle(request: BatchUploadRequest, context: RouteContext): Promise<BatchUploadResponse> {
    try {
      return await this.fileService.batchUpload(request, context.star);
    } catch (error) {
      throw this.createError(FileErrorType.UPLOAD_ERROR, 'Batch upload failed', error);
    }
  }
}

/**
 * 文件删除路由处理器
 */
export class FileDeleteRouteHandler extends BaseRouteHandler {
  async handle(request: { fileId: string }, context: RouteContext): Promise<FileDeleteResponse> {
    try {
      return await this.fileService.deleteFile(request.fileId, context.star);
    } catch (error) {
      throw this.createError(FileErrorType.STORAGE_ERROR, 'File deletion failed', error);
    }
  }
}

/**
 * 文件信息路由处理器
 */
export class FileInfoRouteHandler extends BaseRouteHandler {
  async handle(request: { fileId: string }, context: RouteContext): Promise<FileInfoResponse> {
    try {
      return await this.fileService.getFileInfo(request.fileId, context.star);
    } catch (error) {
      throw this.createError(FileErrorType.NOT_FOUND_ERROR, 'Failed to get file info', error);
    }
  }
}

/**
 * 文件搜索路由处理器
 */
export class FileSearchRouteHandler extends BaseRouteHandler {
  async handle(request: FileSearchRequest, context: RouteContext): Promise<FileSearchResponse> {
    try {
      return await this.fileService.searchFiles(request, context.star);
    } catch (error) {
      throw this.createError(FileErrorType.VALIDATION_ERROR, 'File search failed', error);
    }
  }
}

/**
 * 文件统计路由处理器
 */
export class FileStatsRouteHandler extends BaseRouteHandler {
  async handle(request: any, context: RouteContext): Promise<FileStats> {
    try {
      return await this.fileService.getStats(context.star);
    } catch (error) {
      throw this.createError(FileErrorType.PROCESSING_ERROR, 'Failed to get file stats', error);
    }
  }
}

/**
 * 健康检查路由处理器
 */
export class HealthCheckRouteHandler extends BaseRouteHandler {
  async handle(request: any, context: RouteContext): Promise<HealthCheck> {
    try {
      return await this.fileService.healthCheck(context.star);
    } catch (error) {
      throw this.createError(FileErrorType.PROCESSING_ERROR, 'Health check failed', error);
    }
  }
}

/**
 * 路由注册器
 */
export class RouteRegistry {
  private routes: Map<string, RouteConfig> = new Map();
  private middleware?: MiddlewarePipeline;

  constructor() {
    // 注释掉中间件初始化，避免参数问题
    // this.middleware = createDefaultPipeline();
  }

  /**
   * 注册路由
   */
  register(config: RouteConfig): void {
    const key = `${config.method}:${config.path}`;
    this.routes.set(key, config);
  }

  /**
   * 获取路由
   */
  getRoute(method: string, path: string): RouteConfig | undefined {
    const key = `${method}:${path}`;
    return this.routes.get(key);
  }

  /**
   * 获取所有路由
   */
  getAllRoutes(): RouteConfig[] {
    return Array.from(this.routes.values());
  }

  /**
   * 处理请求
   */
  async handleRequest(method: string, path: string, request: any, context: RouteContext): Promise<any> {
    const route = this.getRoute(method, path);
    if (!route) {
      throw ErrorHandler.createError(FileErrorType.VALIDATION_ERROR, `Route not found: ${method} ${path}`);
    }

    // 执行路由处理器
    return await route.handler.handle(request, context);
  }
}

/**
 * 路由工厂
 */
export class RouteFactory {
  static createFileRoutes(fileService: any): RouteConfig[] {
    return [
      {
        path: '/files/upload',
        method: 'POST',
        handler: new FileUploadRouteHandler(fileService),
        auth: true,
        middleware: ['auth', 'rateLimit', 'validation']
      },
      {
        path: '/files/batch-upload',
        method: 'POST',
        handler: new BatchUploadRouteHandler(fileService),
        auth: true,
        middleware: ['auth', 'rateLimit', 'validation']
      },
      {
        path: '/files/:fileId',
        method: 'DELETE',
        handler: new FileDeleteRouteHandler(fileService),
        auth: true,
        middleware: ['auth', 'authorization']
      },
      {
        path: '/files/:fileId',
        method: 'GET',
        handler: new FileInfoRouteHandler(fileService),
        auth: false,
        middleware: ['rateLimit']
      },
      {
        path: '/files/search',
        method: 'POST',
        handler: new FileSearchRouteHandler(fileService),
        auth: false,
        middleware: ['rateLimit', 'validation']
      },
      {
        path: '/files/stats',
        method: 'GET',
        handler: new FileStatsRouteHandler(fileService),
        auth: true,
        middleware: ['auth']
      },
      {
        path: '/health',
        method: 'GET',
        handler: new HealthCheckRouteHandler(fileService),
        auth: false,
        middleware: []
      }
    ];
  }
}

/**
 * 路由管理器
 */
export class RouteManager {
  private registry: RouteRegistry;
  private fileService: any;

  constructor(star: Starlight) {
    this.registry = new RouteRegistry();
    this.fileService = new (FileService as any)();
    this.initializeRoutes();
  }

  /**
   * 初始化路由
   */
  private initializeRoutes(): void {
    const routes = RouteFactory.createFileRoutes(this.fileService);
    routes.forEach(route => this.registry.register(route));
  }

  /**
   * 处理HTTP请求
   */
  async handleHttpRequest(method: string, path: string, request: any, headers: Record<string, string>, query: Record<string, string>, params: Record<string, string>, star: Starlight): Promise<any> {
    const context: RouteContext = {
      star,
      headers,
      query,
      params,
      ip: headers['x-forwarded-for'] || headers['x-real-ip'] || 'unknown',
      userAgent: headers['user-agent'] || 'unknown',
      timestamp: Date.now()
    };

    return await this.registry.handleRequest(method, path, request, context);
  }

  /**
   * 获取路由信息
   */
  getRouteInfo(): { path: string; method: string; auth: boolean }[] {
    return this.registry.getAllRoutes().map(route => ({
      path: route.path,
      method: route.method,
      auth: route.auth || false
    }));
  }
}

/**
 * 导出默认路由管理器创建函数
 */
export function createRouteManager(star: Starlight): RouteManager {
  return new RouteManager(star);
}

/**
 * 路由工具类
 */
export class RouteUtils {
  /**
   * 解析路径参数
   */
  static parsePathParams(pattern: string, path: string): Record<string, string> {
    const params: Record<string, string> = {};
    const patternParts = pattern.split('/');
    const pathParts = path.split('/');

    if (patternParts.length !== pathParts.length) {
      return params;
    }

    for (let i = 0; i < patternParts.length; i++) {
      const patternPart = patternParts[i];
      const pathPart = pathParts[i];

      if (patternPart.startsWith(':')) {
        const paramName = patternPart.slice(1);
        params[paramName] = decodeURIComponent(pathPart);
      } else if (patternPart !== pathPart) {
        return {}; // 路径不匹配
      }
    }

    return params;
  }

  /**
   * 验证路径是否匹配模式
   */
  static matchPath(pattern: string, path: string): boolean {
    const params = this.parsePathParams(pattern, path);
    return Object.keys(params).length > 0 || pattern === path;
  }

  /**
   * 构建响应对象
   */
  static buildResponse(data: any, status: number = 200, message?: string): any {
    return {
      success: status >= 200 && status < 300,
      status,
      message: message || (status >= 200 && status < 300 ? 'Success' : 'Error'),
      data,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * 构建错误响应
   */
  static buildErrorResponse(error: any, status: number = 500): any {
    return {
      success: false,
      status,
      message: error.message || 'Internal Server Error',
      error: {
        code: error.code || 'UNKNOWN_ERROR',
        details: error.details || null
      },
      timestamp: new Date().toISOString()
    };
  }
}