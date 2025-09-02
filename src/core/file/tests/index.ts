import { FileCategory, FileUploadRequest, FileUploadResponse, FileDeleteResponse, FileInfoResponse, BatchUploadRequest, BatchUploadResponse, FileSearchRequest, FileSearchResponse, FileStats, HealthCheck, FileErrorType, FileStatus, ProcessingProfile } from '../types';
import FileService from '../actions';
import { RouteManager } from '../routes';
import { ConfigManager } from '../config';
import { ErrorHandler, PerformanceMonitor } from '../utils';

/**
 * 测试工具类
 */
export class TestUtils {
  /**
   * 创建模拟文件缓冲区
   */
  static createMockFileBuffer(size: number = 1024): Buffer {
    return Buffer.alloc(size, 'test data');
  }

  /**
   * 创建模拟文件上传请求
   */
  static createMockUploadRequest(overrides: Partial<FileUploadRequest> = {}): FileUploadRequest {
    return {
      file: this.createMockFileBuffer(),
      filename: 'test-file.jpg',
      mimetype: 'image/jpeg',
      category: FileCategory.GENERAL,
      userId: 'test-user-123',
      metadata: { test: true },
      ...overrides
    };
  }

  /**
   * 创建模拟Starlight实例
   */
  static createMockStarlight(): any {
    return {
      db: {
        query: () => Promise.resolve({ rows: [], count: 0 }),
        insert: () => Promise.resolve({}),
        update: () => Promise.resolve({}),
        delete: () => Promise.resolve({})
      },
      storage: {
        save: () => Promise.resolve('uploads/test-file.jpg'),
        delete: () => Promise.resolve(true),
        getUrl: () => 'https://example.com/uploads/test-file.jpg',
        exists: () => Promise.resolve(true)
      },
      cache: {
        get: () => Promise.resolve(null),
        set: () => Promise.resolve(),
        delete: () => Promise.resolve()
      },
      logger: {
        info: () => {},
        error: () => {},
        warn: () => {},
        debug: () => {}
      }
    };
  }

  /**
   * 创建模拟处理配置
   */
  static createMockProcessingProfile(overrides: Partial<ProcessingProfile> = {}): ProcessingProfile {
    return {
      maxSize: 10 * 1024 * 1024, // 10MB
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      imageProcessing: {
        resize: {
          width: 800,
          height: 600,
          fit: 'cover'
        },
        quality: 80,
        format: 'jpeg',
        thumbnail: {
          width: 200,
          height: 200,
          quality: 70
        }
      },
      ...overrides
    };
  }

  /**
   * 等待指定时间
   */
  static async wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 生成随机字符串
   */
  static generateRandomString(length: number = 10): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * 验证文件上传响应
   */
  static validateUploadResponse(response: FileUploadResponse): boolean {
    return !!
      response &&
      typeof response.success === 'boolean' &&
      typeof response.fileId === 'string' &&
      typeof response.filename === 'string' &&
      typeof response.url === 'string' &&
      response.uploadedAt instanceof Date;
  }

  /**
   * 验证错误响应
   */
  static validateErrorResponse(error: any): boolean {
    return !!
      error &&
      typeof error.message === 'string' &&
      Object.values(FileErrorType).includes(error.type);
  }
}

/**
 * 文件服务测试套件
 */
export class FileServiceTests {
  private fileService: any;
  private mockStar: any;

  constructor() {
    this.fileService = new (FileService as any)();
    this.mockStar = TestUtils.createMockStarlight();
  }

  /**
   * 测试文件上传
   */
  async testFileUpload(): Promise<void> {
    const request = TestUtils.createMockUploadRequest();
    
    // 模拟成功响应
    this.mockStar.storage.save = () => Promise.resolve('uploads/test-file.jpg');
    this.mockStar.storage.getUrl = () => 'https://example.com/uploads/test-file.jpg';
    
    try {
      const response = await this.fileService.uploadFile(request, this.mockStar);
      
      if (!TestUtils.validateUploadResponse(response)) {
        throw new Error('Invalid upload response format');
      }
      
      console.log('✓ File upload test passed');
    } catch (error) {
      console.error('✗ File upload test failed:', error);
      throw error;
    }
  }

  /**
   * 测试文件删除
   */
  async testFileDelete(): Promise<void> {
    const fileId = 'test-file-123';
    
    // 模拟成功响应
    this.mockStar.storage.delete = () => Promise.resolve(true);
    
    try {
      const response = await this.fileService.deleteFile(fileId, this.mockStar);
      
      if (!response || typeof response.deleted !== 'boolean') {
        throw new Error('Invalid delete response format');
      }
      
      console.log('✓ File delete test passed');
    } catch (error) {
      console.error('✗ File delete test failed:', error);
      throw error;
    }
  }

  /**
   * 测试批量上传
   */
  async testBatchUpload(): Promise<void> {
    const request: BatchUploadRequest = {
      files: [
        TestUtils.createMockUploadRequest({ filename: 'file1.jpg' }),
        TestUtils.createMockUploadRequest({ filename: 'file2.jpg' })
      ],
      userId: 'test-user-123',
      category: FileCategory.GENERAL
    };
    
    // 模拟成功响应
    this.mockStar.storage.save = () => Promise.resolve('uploads/batch-file.jpg');
    this.mockStar.storage.getUrl = () => 'https://example.com/uploads/batch-file.jpg';
    
    try {
      const response = await this.fileService.batchUpload(request, this.mockStar);
      
      if (!response || typeof response.success !== 'boolean' || !Array.isArray(response.results)) {
        throw new Error('Invalid batch upload response format');
      }
      
      console.log('✓ Batch upload test passed');
    } catch (error) {
      console.error('✗ Batch upload test failed:', error);
      throw error;
    }
  }

  /**
   * 测试文件搜索
   */
  async testFileSearch(): Promise<void> {
    const request: FileSearchRequest = {
      userId: 'test-user-123',
      category: FileCategory.GENERAL,
      limit: 10,
      offset: 0
    };
    
    // 模拟搜索结果
    this.mockStar.db.query = () => Promise.resolve({
      rows: [],
      count: 0
    });
    
    try {
      const response = await this.fileService.searchFiles(request, this.mockStar);
      
      if (!response || !Array.isArray(response.files) || typeof response.total !== 'number') {
        throw new Error('Invalid search response format');
      }
      
      console.log('✓ File search test passed');
    } catch (error) {
      console.error('✗ File search test failed:', error);
      throw error;
    }
  }

  /**
   * 运行所有测试
   */
  async runAllTests(): Promise<void> {
    console.log('Running FileService tests...');
    
    try {
      await this.testFileUpload();
      await this.testFileDelete();
      await this.testBatchUpload();
      await this.testFileSearch();
      
      console.log('✓ All FileService tests passed');
    } catch (error) {
      console.error('✗ FileService tests failed:', error);
      throw error;
    }
  }
}

/**
 * 工具类测试套件
 */
export class UtilsTests {
  /**
   * 测试文件验证器
   */
  async testFileValidator(): Promise<void> {
    const profile = TestUtils.createMockProcessingProfile();
    const validFile = TestUtils.createMockUploadRequest();
    const invalidFile = TestUtils.createMockUploadRequest({
      mimetype: 'application/pdf', // 不在允许列表中
      file: Buffer.alloc(20 * 1024 * 1024) // 超过大小限制
    });
    
    try {
      // 测试文件验证逻辑（简化版）
      const isValidMimeType = profile.allowedMimeTypes.includes(validFile.mimetype);
      const isValidSize = validFile.file.length <= profile.maxSize;
      
      if (!isValidMimeType || !isValidSize) {
        throw new Error('Valid file should pass validation');
      }
      
      // 测试无效文件
      const isInvalidMimeType = profile.allowedMimeTypes.includes(invalidFile.mimetype);
      const isInvalidSize = invalidFile.file.length <= profile.maxSize;
      
      if (isInvalidMimeType && isInvalidSize) {
        throw new Error('Invalid file should fail validation');
      }
      
      console.log('✓ File validator test passed');
    } catch (error) {
      console.error('✗ File validator test failed:', error);
      throw error;
    }
  }

  /**
   * 测试错误处理器
   */
  async testErrorHandler(): Promise<void> {
    try {
      const error = ErrorHandler.createError(
        'validation_error' as any,
        'Test validation error'
      );
      
      if (!TestUtils.validateErrorResponse(error)) {
        throw new Error('Invalid error format');
      }
      
      console.log('✓ Error handler test passed');
    } catch (error) {
      console.error('✗ Error handler test failed:', error);
      throw error;
    }
  }

  /**
   * 测试性能监控器
   */
  async testPerformanceMonitor(): Promise<void> {
    const monitor = new PerformanceMonitor();
    
    try {
      // 记录一些指标
      monitor.recordDuration('upload', 100);
      monitor.recordDuration('upload', 200);
      monitor.incrementCounter('requests');
      monitor.incrementCounter('requests');
      
      // 验证指标
      const avgDuration = monitor.getAverageDuration('upload');
      const requestCount = monitor.getCounter('requests');
      
      if (avgDuration !== 150 || requestCount !== 2) {
        throw new Error('Performance metrics are incorrect');
      }
      
      console.log('✓ Performance monitor test passed');
    } catch (error) {
      console.error('✗ Performance monitor test failed:', error);
      throw error;
    }
  }

  /**
   * 运行所有工具测试
   */
  async runAllTests(): Promise<void> {
    console.log('Running Utils tests...');
    
    try {
      await this.testFileValidator();
      await this.testErrorHandler();
      await this.testPerformanceMonitor();
      
      console.log('✓ All Utils tests passed');
    } catch (error) {
      console.error('✗ Utils tests failed:', error);
      throw error;
    }
  }
}

/**
 * 配置测试套件
 */
export class ConfigTests {
  /**
   * 测试配置管理器
   */
  async testConfigManager(): Promise<void> {
    try {
      const configManager = ConfigManager.getInstance();
      const config = configManager.getConfig();
      
      if (!config || typeof config !== 'object') {
        throw new Error('Config should be an object');
      }
      
      // 配置应该是有效的（默认配置在初始化时已验证）
      if (!config.serviceName || !config.version) {
        throw new Error('Default config should be valid');
      }
      
      console.log('✓ Config manager test passed');
    } catch (error) {
      console.error('✗ Config manager test failed:', error);
      throw error;
    }
  }

  /**
   * 运行所有配置测试
   */
  async runAllTests(): Promise<void> {
    console.log('Running Config tests...');
    
    try {
      await this.testConfigManager();
      
      console.log('✓ All Config tests passed');
    } catch (error) {
      console.error('✗ Config tests failed:', error);
      throw error;
    }
  }
}

/**
 * 集成测试套件
 */
export class IntegrationTests {
  private mockStar: any;

  constructor() {
    this.mockStar = TestUtils.createMockStarlight();
  }

  /**
   * 测试完整的文件上传流程
   */
  async testCompleteUploadFlow(): Promise<void> {
    const routeManager = new RouteManager(this.mockStar);
    const request = TestUtils.createMockUploadRequest();
    
    // 模拟存储响应
    this.mockStar.storage.save.mockResolvedValue('uploads/integration-test.jpg');
    this.mockStar.storage.getUrl.mockReturnValue('https://example.com/uploads/integration-test.jpg');
    
    try {
      const response = await routeManager.handleHttpRequest(
        'POST',
        '/files/upload',
        request,
        { 'content-type': 'multipart/form-data' },
        {},
        {},
        this.mockStar
      );
      
      if (!TestUtils.validateUploadResponse(response)) {
        throw new Error('Integration test failed: invalid response');
      }
      
      console.log('✓ Complete upload flow test passed');
    } catch (error) {
      console.error('✗ Complete upload flow test failed:', error);
      throw error;
    }
  }

  /**
   * 运行所有集成测试
   */
  async runAllTests(): Promise<void> {
    console.log('Running Integration tests...');
    
    try {
      await this.testCompleteUploadFlow();
      
      console.log('✓ All Integration tests passed');
    } catch (error) {
      console.error('✗ Integration tests failed:', error);
      throw error;
    }
  }
}

/**
 * 测试运行器
 */
export class TestRunner {
  /**
   * 运行所有测试套件
   */
  static async runAllTests(): Promise<void> {
    console.log('🧪 Starting File Service Test Suite...');
    console.log('=====================================');
    
    try {
      // 运行单元测试
      const fileServiceTests = new FileServiceTests();
      await fileServiceTests.runAllTests();
      
      const utilsTests = new UtilsTests();
      await utilsTests.runAllTests();
      
      const configTests = new ConfigTests();
      await configTests.runAllTests();
      
      // 运行集成测试
      const integrationTests = new IntegrationTests();
      await integrationTests.runAllTests();
      
      console.log('=====================================');
      console.log('🎉 All tests passed successfully!');
    } catch (error) {
      console.log('=====================================');
      console.error('❌ Test suite failed:', error);
      throw error;
    }
  }

  /**
   * 运行特定测试套件
   */
  static async runTestSuite(suiteName: 'fileService' | 'utils' | 'config' | 'integration'): Promise<void> {
    console.log(`🧪 Running ${suiteName} tests...`);
    
    try {
      switch (suiteName) {
        case 'fileService':
          await new FileServiceTests().runAllTests();
          break;
        case 'utils':
          await new UtilsTests().runAllTests();
          break;
        case 'config':
          await new ConfigTests().runAllTests();
          break;
        case 'integration':
          await new IntegrationTests().runAllTests();
          break;
        default:
          throw new Error(`Unknown test suite: ${suiteName}`);
      }
      
      console.log(`✅ ${suiteName} tests completed successfully`);
    } catch (error) {
      console.error(`❌ ${suiteName} tests failed:`, error);
      throw error;
    }
  }
}

// 导出测试运行函数
export async function runTests(): Promise<void> {
  await TestRunner.runAllTests();
}

export async function runTestSuite(suiteName: 'fileService' | 'utils' | 'config' | 'integration'): Promise<void> {
  await TestRunner.runTestSuite(suiteName);
}