/**
 * Elasticsearch初始化器 - 通用版本，可供所有微服务使用
 */
import * as esConnections from './index';
import { ElasticsearchOptions } from './manager';

// 常量定义
const HEALTH_CHECK_INTERVAL = 30 * 1000; // 30秒
const CONNECTION_TIMEOUT = 10000; // 10秒

/**
 * Elasticsearch状态接口
 */
export interface ElasticsearchState {
  isConnected?: boolean;
  clusterHealth?: any;
  healthTimer?: NodeJS.Timeout | null;
  lastHealthCheck?: Date;
}

/**
 * Elasticsearch初始化器
 * 提供通用的Elasticsearch连接、健康检查等功能
 */
export class ElasticsearchInitializer {
  /**
   * 初始化Elasticsearch连接
   * @param logger 日志记录器
   * @param state 状态对象
   * @param options Elasticsearch连接选项
   */
  public static async initializeElasticsearch(
    logger?: any,
    state?: ElasticsearchState,
    options?: ElasticsearchOptions & {
      enableHealthCheck?: boolean;
      healthCheckInterval?: number;
    },
  ) {
    const {
      enableHealthCheck = true,
      healthCheckInterval = HEALTH_CHECK_INTERVAL,
      ...esOptions
    } = options || {};

    try {
      const connectionOptions: ElasticsearchOptions = {
        requestTimeout: CONNECTION_TIMEOUT,
        ...esOptions,
      };

      await esConnections.esConnection.bindConnectionES(connectionOptions);
      logger?.info('Elasticsearch connection is success!');

      // 如果提供了状态对象，则更新连接状态
      if (state) {
        state.isConnected = true;
        state.lastHealthCheck = new Date();

        // 获取集群健康状态
        try {
          state.clusterHealth = await esConnections.esConnection.getClusterHealth();
          logger?.info(`Elasticsearch cluster health: ${state.clusterHealth.status}`);
        } catch (error) {
          logger?.warn('Failed to get cluster health:', error);
        }

        // 如果启用健康检查
        if (enableHealthCheck) {
          this.setupHealthCheckTimer(state, logger, healthCheckInterval);
        }
      }
    } catch (error) {
      logger?.error('Elasticsearch initialization failed:', error);
      if (state) {
        state.isConnected = false;
      }
      throw error;
    }
  }

  /**
   * 设置健康检查定时器
   * @param state 状态对象
   * @param logger 日志记录器
   * @param customInterval 自定义检查间隔（毫秒）
   */
  public static setupHealthCheckTimer(
    state: ElasticsearchState,
    logger?: any,
    customInterval?: number,
  ) {
    try {
      const interval = customInterval || HEALTH_CHECK_INTERVAL;

      state.healthTimer = setInterval(async () => {
        try {
          const isConnected = await esConnections.esConnection.isConnected();
          state.isConnected = isConnected;
          state.lastHealthCheck = new Date();

          if (isConnected) {
            // 更新集群健康状态
            try {
              state.clusterHealth = await esConnections.esConnection.getClusterHealth();
            } catch (error) {
              logger?.warn('Failed to get cluster health during health check:', error);
            }
          } else {
            logger?.warn('Elasticsearch connection lost during health check');
          }
        } catch (error) {
          logger?.error('Health check failed:', error);
          state.isConnected = false;
        }
      }, interval);
    } catch (error) {
      logger?.error('Failed to setup health check timer:', error);
    }
  }

  /**
   * 清理资源
   * @param state 状态对象
   */
  public static async cleanup(state?: ElasticsearchState) {
    try {
      await esConnections.esConnection.destroy();

      if (state?.healthTimer) {
        clearInterval(state.healthTimer);
        state.healthTimer = null;
      }

      if (state) {
        state.isConnected = false;
        state.clusterHealth = null;
      }
    } catch (error) {
      throw new Error(`Failed to cleanup Elasticsearch resources: ${error}`);
    }
  }

  /**
   * 检查Elasticsearch是否可用
   * @param state 状态对象
   * @returns 是否可用
   */
  public static isElasticsearchAvailable(state: ElasticsearchState): boolean {
    return state.isConnected === true;
  }

  /**
   * 获取集群健康状态
   * @param state 状态对象
   * @returns 集群健康状态
   */
  public static getClusterHealth(state: ElasticsearchState): any {
    return state.clusterHealth;
  }

  /**
   * 重新连接Elasticsearch
   * @param logger 日志记录器
   * @param state 状态对象
   * @param options 连接选项
   */
  public static async reconnect(
    logger?: any,
    state?: ElasticsearchState,
    options?: ElasticsearchOptions,
  ) {
    try {
      // 先清理现有连接
      await esConnections.esConnection.destroy();

      // 重新初始化
      await this.initializeElasticsearch(logger, state, options);

      logger?.info('Elasticsearch reconnection successful');
    } catch (error) {
      logger?.error('Elasticsearch reconnection failed:', error);
      throw error;
    }
  }
}
