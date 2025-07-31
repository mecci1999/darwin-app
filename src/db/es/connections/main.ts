import { Client } from '@elastic/elasticsearch';
import elasticsearchConnectionManager, { ElasticsearchOptions } from '../manager';

class MainElasticsearchConnection {
  public connection: Client | null = null;
  public promise: Promise<Client> | null = null;

  constructor(public options?: any) {}

  public getConnection(): Promise<Client> {
    if (this.promise !== null) return this.promise.then(() => this.connection as Client);

    throw new Error('请先调用bindConnectionES方法，建立连接');
  }

  /**
   * 获取Elasticsearch的连接
   */
  public getConnectionByOptions(options: ElasticsearchOptions = {}) {
    return elasticsearchConnectionManager.getConnection(options);
  }

  /**
   * 绑定Elasticsearch连接
   */
  public bindConnectionES(options: ElasticsearchOptions = {}) {
    return new Promise<Client>((resolve, reject) => {
      try {
        this.connection = this.getConnectionByOptions(options);

        // 测试连接
        this.promise = this.connection
          .ping()
          .then(() => {
            return this.connection as Client;
          })
          .catch((error) => {
            throw new Error(`Elasticsearch connection failed: ${error.message}`);
          });

        resolve(this.promise);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 关闭Elasticsearch连接
   */
  public async destroy() {
    if (this.connection) {
      elasticsearchConnectionManager.closeConnection(this.connection);
      this.connection = null;
      this.promise = null;
    }
  }

  /**
   * 检查连接状态
   */
  public async isConnected(): Promise<boolean> {
    try {
      if (!this.connection) return false;
      await this.connection.ping();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 获取集群信息
   */
  public async getClusterInfo() {
    const connection = await this.getConnection();
    return connection.info();
  }

  /**
   * 获取集群健康状态
   */
  public async getClusterHealth() {
    const connection = await this.getConnection();
    return connection.cluster.health();
  }
}

// 导出实例
export default new MainElasticsearchConnection();
