/**
 * 数据库初始化器 - 通用版本，可供所有微服务使用
 */
import * as dbConnections from './index';
import { getAllIpBlackList, saveOrUpdateIpBlackList } from './apis/ipBlackList';
import { getAllConfigList } from './apis/config';
import { ConfigKeysMap } from 'typings/enum';
import _ from 'lodash';

// 常量定义
const IP_SYNC_INTERVAL = 30 * 60 * 1000; // 30分钟
const SLOW_QUERY_THRESHOLD = 1000; // 1秒

/**
 * 数据库状态接口
 */
export interface DatabaseState {
  configs?: Record<string, any>;
  ipBlackList?: any[];
  ips?: string[];
  ipTimer?: NodeJS.Timeout | null;
}

/**
 * 数据库初始化器
 * 提供通用的数据库连接、配置加载、IP黑名单管理等功能
 */
export class DatabaseInitializer {
  /**
   * 初始化数据库连接
   * @param logger 日志记录器
   * @param state 状态对象
   * @param options 数据库连接选项
   */
  public static async initializeDatabase(
    logger?: any,
    state?: DatabaseState,
    options?: {
      enableSlowQueryLog?: boolean;
      slowQueryThreshold?: number;
    }
  ) {
    const { enableSlowQueryLog = true, slowQueryThreshold = SLOW_QUERY_THRESHOLD } = options || {};
    
    try {
      const connectionOptions: any = {
        benchmark: true,
      };

      if (enableSlowQueryLog && logger) {
        connectionOptions.logging = (sql: string, timing?: number) => {
          if (timing && timing > slowQueryThreshold) {
            logger.warn(`Mysql operation is timeout, sql: ${sql}, timing: ${timing}ms`);
          }
        };
      }

      await dbConnections.mainConnection.bindManinConnection(connectionOptions);
      logger?.info('Mysql connection is success!');

      // 如果提供了状态对象，则加载配置项
      if (state) {
        state.configs = await getAllConfigList();
      }
    } catch (error) {
      logger?.error('Database initialization failed:', error);
      throw error;
    }
  }

  /**
   * 初始化IP黑名单
   * @param state 状态对象
   */
  public static async initializeIpBlacklist(state: DatabaseState) {
    try {
      state.ipBlackList = (await getAllIpBlackList()) || [];
      if (state.ipBlackList.length > 0) {
        state.ips = _.compact(state.ipBlackList.map((ip) => ip?.ipv4 || ip?.ipv6 || ''));
      }
    } catch (error) {
      throw new Error(`Failed to initialize IP blacklist: ${error}`);
    }
  }

  /**
   * 设置IP同步定时器
   * @param state 状态对象
   * @param customInterval 自定义同步间隔（毫秒）
   */
  public static setupIpSyncTimer(state: DatabaseState, customInterval?: number) {
    try {
      let interval = customInterval || IP_SYNC_INTERVAL;
      
      // 如果有配置项，则使用配置的间隔
      if (state.configs && state.configs[ConfigKeysMap.IPAccessBlackList]) {
        const IPConfig = JSON.parse(state.configs[ConfigKeysMap.IPAccessBlackList]);
        interval = IPConfig?.updateTimer * 60 * 1000 || interval;
      }

      state.ipTimer = setInterval(() => {
        if (state.ipBlackList) {
          saveOrUpdateIpBlackList(state.ipBlackList);
        }
      }, interval);
    } catch (error) {
      throw new Error(`Failed to setup IP sync timer: ${error}`);
    }
  }

  /**
   * 清理资源
   * @param state 状态对象
   */
  public static async cleanup(state?: DatabaseState) {
    try {
      await dbConnections.mainConnection.destroy();
      
      if (state?.ipTimer) {
        clearInterval(state.ipTimer);
        state.ipTimer = null;
      }
    } catch (error) {
      throw new Error(`Failed to cleanup database resources: ${error}`);
    }
  }

  /**
   * 获取配置项
   * @param key 配置键
   * @param state 状态对象
   * @returns 配置值
   */
  public static getConfig(key: string, state: DatabaseState): any {
    return state.configs?.[key];
  }

  /**
   * 检查IP是否在黑名单中
   * @param ip IP地址
   * @param state 状态对象
   * @returns 是否被阻止
   */
  public static isIpBlocked(ip: string, state: DatabaseState): boolean {
    return state.ips ? state.ips.includes(ip) : false;
  }

  /**
   * 完整初始化（包含数据库连接、配置加载、IP黑名单初始化）
   * @param logger 日志记录器
   * @param state 状态对象
   * @param options 初始化选项
   */
  public static async fullInitialize(
    logger?: any,
    state?: DatabaseState,
    options?: {
      enableSlowQueryLog?: boolean;
      slowQueryThreshold?: number;
      enableIpBlacklist?: boolean;
      enableIpSyncTimer?: boolean;
      ipSyncInterval?: number;
    }
  ) {
    const {
      enableSlowQueryLog = true,
      slowQueryThreshold = SLOW_QUERY_THRESHOLD,
      enableIpBlacklist = true,
      enableIpSyncTimer = true,
      ipSyncInterval
    } = options || {};

    // 初始化数据库连接
    await this.initializeDatabase(logger, state, {
      enableSlowQueryLog,
      slowQueryThreshold
    });

    // 如果启用IP黑名单功能且提供了状态对象
    if (enableIpBlacklist && state) {
      await this.initializeIpBlacklist(state);
      
      if (enableIpSyncTimer) {
        this.setupIpSyncTimer(state, ipSyncInterval);
      }
    }
  }
}