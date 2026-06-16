/**
 * Elasticsearch连接管理器
 * 在微服务启动时初始化连接，提供全局ES客户端实例
 */
import { ElasticsearchClient, summarizeElasticsearchError } from './elasticsearch';
import { Context } from 'node-universe';

class ElasticsearchManager {
  private static instance: ElasticsearchManager;
  private esClient: ElasticsearchClient | null = null;
  private isInitialized = false;
  private baseConfig: { node: string; username?: string; password?: string } | null = null;
  private tenantClients = new Map<string, ElasticsearchClient>();

  private constructor() {}

  static getInstance(): ElasticsearchManager {
    if (!ElasticsearchManager.instance) {
      ElasticsearchManager.instance = new ElasticsearchManager();
    }
    return ElasticsearchManager.instance;
  }

  /**
   * 初始化Elasticsearch连接
   * 在微服务启动时调用
   */
  async initialize(config: { node: string; password?: string; username?: string }, options?: { initializeIndex?: boolean }): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    this.baseConfig = {
      node: config.node,
      username: config.username,
      password: config.password,
    };

    // 创建ES客户端实例。即使首次索引初始化失败，也保留配置，便于后续请求或定时任务自动重试。
    this.esClient = new ElasticsearchClient({
      node: config.node,
      username: config.username,
      password: config.password,
      index: 'logs', // 默认索引前缀
    });

    try {
      if (options?.initializeIndex !== false) {
        await this.esClient.initializeIndex();
      }

      this.isInitialized = true;
      console.log('Elasticsearch connection initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Elasticsearch connection:', summarizeElasticsearchError(error));
      throw error;
    }
  }

  configure(config: { node: string; password?: string; username?: string }): void {
    this.baseConfig = {
      node: config.node,
      username: config.username,
      password: config.password,
    };

    this.esClient = new ElasticsearchClient({
      node: config.node,
      username: config.username,
      password: config.password,
      index: 'logs',
    });
  }

  async ensureConnected(): Promise<boolean> {
    if (this.isInitialized) return true;
    if (!this.baseConfig) return false;

    try {
      await this.initialize(this.baseConfig);
      return true;
    } catch (error) {
      console.warn('Elasticsearch reconnect attempt failed:', summarizeElasticsearchError(error));
      return false;
    }
  }

  /**
   * 获取ES客户端实例
   * 为特定租户创建索引配置
   */
  getClient(tenantId?: string): ElasticsearchClient {
    if (!this.isInitialized || !this.esClient || !this.baseConfig) {
      throw new Error('Elasticsearch client not initialized. Call initialize() first.');
    }

    const index = tenantId ? `logs-${tenantId}` : 'logs';
    const cachedClient = this.tenantClients.get(index);
    if (cachedClient) return cachedClient;

    const config = {
      ...this.baseConfig,
      index,
    };

    const client = new ElasticsearchClient(config);
    this.tenantClients.set(index, client);
    return client;
  }

  /**
   * 从Context中获取ES客户端
   * 自动处理租户ID
   */
  getClientFromContext(ctx: Context, tenantId?: string): ElasticsearchClient {
    // 从context中获取租户ID
    const actualTenantId = tenantId || ctx.params?.tenantId || (ctx.meta as any)?.tenantId;

    if (!actualTenantId) {
      throw new Error('Tenant ID is required for Elasticsearch operations');
    }

    return this.getClient(actualTenantId);
  }

  /**
   * 检查连接状态
   */
  isConnected(): boolean {
    return this.isInitialized && this.esClient !== null;
  }

  /**
   * 关闭连接
   */
  async close(): Promise<void> {
    if (this.esClient) {
      // ElasticsearchClient没有close方法，但可以清理引用
      this.esClient = null;
      this.baseConfig = null;
      this.tenantClients.clear();
      this.isInitialized = false;
      console.log('Elasticsearch connection closed');
    }
  }
}

// 导出单例实例
export const elasticsearchManager = ElasticsearchManager.getInstance();
export default elasticsearchManager;
