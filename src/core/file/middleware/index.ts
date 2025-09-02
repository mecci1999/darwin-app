/**
 * 文件微服务中间件
 * 提供认证、限流、日志、验证等中间件功能
 */

import { Starlight } from 'typings';
import { 
  FileUploadRequest, 
  FileCategory, 
  FileErrorType,
  FileOperation 
} from '../types';
import { 
  SECURITY_CONFIG, 
  LOG_CONFIG 
} from '../constants';
import { performanceMonitor, ErrorHandler } from '../utils';

/**
 * 中间件接口
 */
export interface Middleware {
  execute(context: MiddlewareContext): Promise<MiddlewareResult>;
}

/**
 * 中间件上下文
 */
export interface MiddlewareContext {
  star: Starlight;
  request: any;
  response?: any;
  user?: {
    id: string;
    role: string;
    permissions: string[];
  };
  metadata: Record<string, any>;
  startTime: number;
}

/**
 * 中间件执行结果
 */
export interface MiddlewareResult {
  success: boolean;
  error?: Error;
  data?: any;
  shouldContinue: boolean;
}

/**
 * 认证中间件
 */
export class AuthenticationMiddleware implements Middleware {
  private star: Starlight;

  constructor(star: Starlight) {
    this.star = star;
  }

  async execute(context: MiddlewareContext): Promise<MiddlewareResult> {
    try {
      const { request } = context;
      
      // 检查是否需要认证
      if (!this.requiresAuthentication(request)) {
        return {
          success: true,
          shouldContinue: true
        };
      }

      // 提取认证信息
      const token = this.extractToken(request);
      if (!token) {
        return {
          success: false,
          error: ErrorHandler.createError(
            FileErrorType.PERMISSION_ERROR,
            '缺少认证令牌',
            FileOperation.UPLOAD,
            undefined,
            { middleware: 'authentication' }
          ),
          shouldContinue: false
        };
      }

      // 验证令牌
      const user = await this.validateToken(token);
      if (!user) {
        return {
          success: false,
          error: ErrorHandler.createError(
            FileErrorType.PERMISSION_ERROR,
            '无效的认证令牌',
            FileOperation.UPLOAD,
            undefined,
            { middleware: 'authentication', token: token.substring(0, 10) + '...' }
          ),
          shouldContinue: false
        };
      }

      // 将用户信息添加到上下文
      context.user = user;
      context.metadata.userId = user.id;

      this.star.logger?.debug('用户认证成功', {
        userId: user.id,
        role: user.role
      });

      return {
        success: true,
        shouldContinue: true,
        data: { user }
      };

    } catch (error) {
      this.star.logger?.error('认证中间件执行失败', { error });
      return {
        success: false,
        error: error as Error,
        shouldContinue: false
      };
    }
  }

  private requiresAuthentication(request: any): boolean {
    // 根据请求类型判断是否需要认证
    // 这里可以根据实际需求配置
    return true;
  }

  private extractToken(request: any): string | null {
    // 从请求头或其他地方提取令牌
    const authHeader = request.headers?.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    return request.token || null;
  }

  private async validateToken(token: string): Promise<any> {
    // 这里应该调用实际的令牌验证服务
    // 暂时返回模拟用户信息
    if (token === 'valid-token') {
      return {
        id: 'user-123',
        role: 'user',
        permissions: ['file:upload', 'file:delete']
      };
    }
    return null;
  }
}

/**
 * 授权中间件
 */
export class AuthorizationMiddleware implements Middleware {
  private star: Starlight;

  constructor(star: Starlight) {
    this.star = star;
  }

  async execute(context: MiddlewareContext): Promise<MiddlewareResult> {
    try {
      const { request, user } = context;
      
      if (!user) {
        return {
          success: false,
          error: ErrorHandler.createError(
            FileErrorType.PERMISSION_ERROR,
            '用户未认证',
            FileOperation.UPLOAD,
            undefined,
            { middleware: 'authorization' }
          ),
          shouldContinue: false
        };
      }

      // 检查操作权限
      const operation = this.getOperationFromRequest(request);
      const hasPermission = await this.checkPermission(user, operation, request);
      
      if (!hasPermission) {
        return {
          success: false,
          error: ErrorHandler.createError(
            FileErrorType.PERMISSION_ERROR,
            `用户无权限执行操作: ${operation}`,
            operation,
            undefined,
            { 
              middleware: 'authorization',
              userId: user.id,
              operation,
              userRole: user.role
            }
          ),
          shouldContinue: false
        };
      }

      this.star.logger?.debug('用户授权成功', {
        userId: user.id,
        operation,
        role: user.role
      });

      return {
        success: true,
        shouldContinue: true
      };

    } catch (error) {
      this.star.logger?.error('授权中间件执行失败', { error });
      return {
        success: false,
        error: error as Error,
        shouldContinue: false
      };
    }
  }

  private getOperationFromRequest(request: any): FileOperation {
    // 根据请求类型确定操作
    if (request.method === 'POST' && request.path?.includes('/upload')) {
      return FileOperation.UPLOAD;
    }
    if (request.method === 'DELETE') {
      return FileOperation.DELETE;
    }
    return FileOperation.UPLOAD; // 默认
  }

  private async checkPermission(user: any, operation: FileOperation, request: any): Promise<boolean> {
    // 检查用户权限
    const requiredPermission = `file:${operation.toLowerCase()}`;
    
    if (!user.permissions.includes(requiredPermission)) {
      return false;
    }

    // 额外的业务逻辑检查
    if (operation === FileOperation.UPLOAD) {
      return this.checkUploadPermission(user, request);
    }
    
    if (operation === FileOperation.DELETE) {
      return this.checkDeletePermission(user, request);
    }

    return true;
  }

  private checkUploadPermission(user: any, request: any): boolean {
    // 检查上传权限的具体逻辑
    const category = request.category || FileCategory.GENERAL;
    
    // 管理员可以上传任何类型
    if (user.role === 'admin') {
      return true;
    }

    // 普通用户只能上传头像和一般文件
    if (user.role === 'user') {
      return [FileCategory.AVATAR, FileCategory.GENERAL].includes(category);
    }

    return false;
  }

  private checkDeletePermission(user: any, request: any): boolean {
    // 检查删除权限的具体逻辑
    const fileUserId = request.fileUserId;
    
    // 管理员可以删除任何文件
    if (user.role === 'admin') {
      return true;
    }

    // 用户只能删除自己的文件
    return user.id === fileUserId;
  }
}

/**
 * 限流中间件
 */
export class RateLimitMiddleware implements Middleware {
  private star: Starlight;
  private requestCounts: Map<string, { count: number; resetTime: number }> = new Map();

  constructor(star: Starlight) {
    this.star = star;
  }

  async execute(context: MiddlewareContext): Promise<MiddlewareResult> {
    try {
      const { user, request } = context;
      const identifier = this.getIdentifier(user, request);
      const limit = this.getLimit(user);
      const windowMs = 60000; // 1分钟窗口

      const now = Date.now();
      const userLimit = this.requestCounts.get(identifier);

      if (!userLimit || now > userLimit.resetTime) {
        // 重置计数器
        this.requestCounts.set(identifier, {
          count: 1,
          resetTime: now + windowMs
        });
        return {
          success: true,
          shouldContinue: true
        };
      }

      if (userLimit.count >= limit) {
        return {
          success: false,
          error: ErrorHandler.createError(
            FileErrorType.VALIDATION_ERROR,
            `请求频率过高，请稍后再试`,
            FileOperation.UPLOAD,
            undefined,
            { 
              middleware: 'rateLimit',
              identifier,
              limit,
              current: userLimit.count,
              resetTime: userLimit.resetTime
            }
          ),
          shouldContinue: false
        };
      }

      // 增加计数
      userLimit.count++;
      this.requestCounts.set(identifier, userLimit);

      return {
        success: true,
        shouldContinue: true,
        data: {
          remaining: limit - userLimit.count,
          resetTime: userLimit.resetTime
        }
      };

    } catch (error) {
      this.star.logger?.error('限流中间件执行失败', { error });
      return {
        success: false,
        error: error as Error,
        shouldContinue: false
      };
    }
  }

  private getIdentifier(user: any, request: any): string {
    // 优先使用用户ID，否则使用IP地址
    return user?.id || request.ip || 'anonymous';
  }

  private getLimit(user: any): number {
    // 根据用户角色设置不同的限制
    if (user?.role === 'admin') {
      return 1000; // 管理员限制
    }
    if (user?.role === 'premium') {
      return 200; // 高级用户限制
    }
    return 100; // 默认限制
  }

  /**
   * 清理过期的计数器
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, value] of this.requestCounts.entries()) {
      if (now > value.resetTime) {
        this.requestCounts.delete(key);
      }
    }
  }
}

/**
 * 日志中间件
 */
export class LoggingMiddleware implements Middleware {
  private star: Starlight;

  constructor(star: Starlight) {
    this.star = star;
  }

  async execute(context: MiddlewareContext): Promise<MiddlewareResult> {
    try {
      const { request, user, startTime } = context;
      
      // 记录请求开始
      this.star.logger?.info('文件服务请求开始', {
        userId: user?.id,
        method: request.method,
        path: request.path,
        userAgent: request.headers?.['user-agent'],
        ip: request.ip,
        timestamp: new Date().toISOString()
      });

      // 更新性能指标
      performanceMonitor.incrementCounter('middleware_requests');
      performanceMonitor.recordDuration('middleware_start', Date.now() - startTime);

      return {
        success: true,
        shouldContinue: true
      };

    } catch (error) {
      this.star.logger?.error('日志中间件执行失败', { error });
      return {
        success: true, // 日志失败不应该阻止请求
        shouldContinue: true
      };
    }
  }

  /**
   * 记录请求完成
   */
  logCompletion(context: MiddlewareContext, result: any, error?: Error): void {
    const { request, user, startTime } = context;
    const duration = Date.now() - startTime;

    if (error) {
      this.star.logger?.error('文件服务请求失败', {
        userId: user?.id,
        method: request.method,
        path: request.path,
        duration,
        error: error.message,
        stack: error.stack
      });
    } else {
      this.star.logger?.info('文件服务请求完成', {
        userId: user?.id,
        method: request.method,
        path: request.path,
        duration,
        success: true
      });
    }

    // 更新性能指标
    performanceMonitor.recordDuration('request_duration', duration);
    if (error) {
      performanceMonitor.incrementCounter('request_errors');
    } else {
      performanceMonitor.incrementCounter('request_success');
    }
  }
}

/**
 * 验证中间件
 */
export class ValidationMiddleware implements Middleware {
  private star: Starlight;

  constructor(star: Starlight) {
    this.star = star;
  }

  async execute(context: MiddlewareContext): Promise<MiddlewareResult> {
    try {
      const { request } = context;
      
      // 验证请求格式
      const validationResult = this.validateRequest(request);
      if (!validationResult.isValid) {
        return {
          success: false,
          error: ErrorHandler.createError(
            FileErrorType.VALIDATION_ERROR,
            `请求验证失败: ${validationResult.errors.join(', ')}`,
            FileOperation.VALIDATE,
            undefined,
            { 
              middleware: 'validation',
              errors: validationResult.errors
            }
          ),
          shouldContinue: false
        };
      }

      return {
        success: true,
        shouldContinue: true
      };

    } catch (error) {
      this.star.logger?.error('验证中间件执行失败', { error });
      return {
        success: false,
        error: error as Error,
        shouldContinue: false
      };
    }
  }

  private validateRequest(request: any): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // 验证文件上传请求
    if (request.file) {
      if (!request.file.buffer || request.file.buffer.length === 0) {
        errors.push('文件内容不能为空');
      }
      
      if (!request.filename || typeof request.filename !== 'string') {
        errors.push('文件名无效');
      }
      
      if (!request.mimetype || typeof request.mimetype !== 'string') {
        errors.push('文件类型无效');
      }
    }

    // 验证文件类别
    if (request.category && !Object.values(FileCategory).includes(request.category)) {
      errors.push('无效的文件类别');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

/**
 * 中间件管道
 */
export class MiddlewarePipeline {
  private middlewares: Middleware[] = [];
  private star: Starlight;

  constructor(star: Starlight) {
    this.star = star;
  }

  /**
   * 添加中间件
   */
  use(middleware: Middleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * 执行中间件管道
   */
  async execute(context: MiddlewareContext): Promise<MiddlewareResult> {
    for (const middleware of this.middlewares) {
      try {
        const result = await middleware.execute(context);
        
        if (!result.success || !result.shouldContinue) {
          return result;
        }
        
        // 将中间件的数据合并到上下文
        if (result.data) {
          Object.assign(context.metadata, result.data);
        }
        
      } catch (error) {
        this.star.logger?.error('中间件执行异常', { 
          error, 
          middleware: middleware.constructor.name 
        });
        
        return {
          success: false,
          error: error as Error,
          shouldContinue: false
        };
      }
    }

    return {
      success: true,
      shouldContinue: true
    };
  }

  /**
   * 获取中间件数量
   */
  getMiddlewareCount(): number {
    return this.middlewares.length;
  }

  /**
   * 清空中间件
   */
  clear(): void {
    this.middlewares = [];
  }
}

/**
 * 创建默认中间件管道
 */
export function createDefaultPipeline(star: Starlight): MiddlewarePipeline {
  const pipeline = new MiddlewarePipeline(star);
  
  // 按顺序添加中间件
  pipeline
    .use(new LoggingMiddleware(star))
    .use(new ValidationMiddleware(star))
    .use(new AuthenticationMiddleware(star))
    .use(new AuthorizationMiddleware(star))
    .use(new RateLimitMiddleware(star));
  
  return pipeline;
}

/**
 * 默认导出
 */
export default {
  MiddlewarePipeline,
  AuthenticationMiddleware,
  AuthorizationMiddleware,
  RateLimitMiddleware,
  LoggingMiddleware,
  ValidationMiddleware,
  createDefaultPipeline
};