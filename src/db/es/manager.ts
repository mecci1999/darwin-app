/**
 * 管理Elasticsearch的连接和断开
 */
import { Client } from '@elastic/elasticsearch';
import deepmerge from 'deepmerge';

export interface ElasticsearchOptions {
  node?: string;
  nodes?: string[];
  auth?: {
    username: string;
    password: string;
  };
  ssl?: {
    rejectUnauthorized?: boolean;
  };
  requestTimeout?: number;
  pingTimeout?: number;
  maxRetries?: number;
  resurrectStrategy?: string;
}

export class ElasticsearchConnectionManager {
  public connections: { connection: Client }[] = [];

  constructor(public options?: any) {}

  /**
   * 获得Elasticsearch的连接
   * @param options 连接选项
   */
  public getConnection(options: ElasticsearchOptions = {}): Client {
    const defaultOptions: ElasticsearchOptions = {
      node: process.env.ELASTICSEARCH_NODE || 'http://localhost:9200',
      requestTimeout: 30000,
      pingTimeout: 3000,
      maxRetries: 3,
      resurrectStrategy: 'ping',
    };

    // 如果有认证信息
    if (process.env.ELASTICSEARCH_USERNAME && process.env.ELASTICSEARCH_PASSWORD) {
      defaultOptions.auth = {
        username: process.env.ELASTICSEARCH_USERNAME,
        password: process.env.ELASTICSEARCH_PASSWORD,
      };
    }

    // 如果是HTTPS连接
    if (process.env.ELASTICSEARCH_SSL === 'true') {
      defaultOptions.ssl = {
        rejectUnauthorized: process.env.ELASTICSEARCH_SSL_REJECT_UNAUTHORIZED !== 'false',
      };
    }

    const connection = new Client(deepmerge(defaultOptions, options) as any);

    this.connections.push({ connection });

    return connection;
  }

  /**
   * 关闭连接
   * @param connection
   */
  public closeConnection(connection: Client) {
    const index = this.connections.findIndex((conn) => conn.connection === connection);
    if (index !== -1) {
      this.connections[index].connection.close();
      this.connections.splice(index, 1);
    }
  }

  /**
   * 关闭所有连接
   */
  public closeAllConnections() {
    this.connections.forEach(({ connection }) => {
      connection.close();
    });
    this.connections = [];
  }
}

export default new ElasticsearchConnectionManager();
