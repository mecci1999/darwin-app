/**
 * 流管理器工具类
 * 负责管理日志实时流连接和事件分发
 */

import { EventEmitter } from 'events';
import { LogStreamParams, LogStreamEvent, StoredLog, LogEntry } from '../types';
import { STREAM_CONFIG } from '../constants';

export interface StreamConnection {
  id: string;
  tenantId: string;
  userId?: string;
  params: LogStreamParams;
  response: any; // HTTP Response对象
  lastActivity: number;
  isActive: boolean;
  filters: StreamFilter[];
}

export interface StreamFilter {
  type: 'level' | 'service' | 'source' | 'userId' | 'keyword';
  value: string;
  operator: 'equals' | 'contains' | 'startsWith' | 'regex';
}

export interface StreamStats {
  totalConnections: number;
  activeConnections: number;
  messagesSent: number;
  bytesTransferred: number;
  connectionsByTenant: Record<string, number>;
  lastActivity: number;
}

export class StreamManager extends EventEmitter {
  private connections: Map<string, StreamConnection> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private stats: StreamStats = {
    totalConnections: 0,
    activeConnections: 0,
    messagesSent: 0,
    bytesTransferred: 0,
    connectionsByTenant: {},
    lastActivity: Date.now(),
  };

  constructor(private logger?: any) {
    super();
    this.startHeartbeat();
    this.startCleanup();
  }

  /**
   * 创建新的流连接
   */
  createConnection(
    tenantId: string,
    response: any,
    params: LogStreamParams,
    userId?: string,
  ): string {
    try {
      // 检查连接数限制
      if (this.connections.size >= STREAM_CONFIG.MAX_CONNECTIONS) {
        throw new Error('已达到最大连接数限制');
      }

      // 检查租户连接数
      const tenantConnections = this.getTenantConnectionCount(tenantId);
      const maxPerTenant = Math.floor(STREAM_CONFIG.MAX_CONNECTIONS / 10); // 每个租户最多10%的连接

      if (tenantConnections >= maxPerTenant) {
        throw new Error('租户连接数已达到限制');
      }

      const connectionId = this.generateConnectionId();
      const connection: StreamConnection = {
        id: connectionId,
        tenantId,
        userId,
        params,
        response,
        lastActivity: Date.now(),
        isActive: true,
        filters: this.parseFilters(params),
      };

      this.connections.set(connectionId, connection);

      // 更新统计
      this.stats.totalConnections++;
      this.stats.activeConnections++;
      this.stats.connectionsByTenant[tenantId] =
        (this.stats.connectionsByTenant[tenantId] || 0) + 1;
      this.stats.lastActivity = Date.now();

      // 设置SSE响应头
      this.setupSSEResponse(response);

      // 发送连接确认
      this.sendToConnection(connectionId, {
        type: 'connected',
        data: `连接已建立: ${connectionId}`,
        timestamp: new Date().toISOString(),
      });

      this.logger?.info('流连接已创建', {
        connectionId,
        tenantId,
        userId,
        totalConnections: this.stats.activeConnections,
      });

      // 监听连接关闭
      response.on('close', () => {
        this.closeConnection(connectionId);
      });

      response.on('error', (error: any) => {
        this.logger?.error('流连接错误', { connectionId, error: error.message });
        this.closeConnection(connectionId);
      });

      return connectionId;
    } catch (error: any) {
      this.logger?.error('创建流连接失败', { error: error?.message || 'Unknown error', tenantId });
      throw error;
    }
  }

  /**
   * 关闭连接
   */
  closeConnection(connectionId: string): void {
    try {
      const connection = this.connections.get(connectionId);
      if (!connection) {
        return;
      }

      connection.isActive = false;

      // 发送关闭消息
      this.sendToConnection(connectionId, {
        type: 'disconnected',
        data: '流连接已关闭',
        timestamp: new Date().toISOString(),
      });

      // 关闭响应
      if (connection.response && !connection.response.destroyed) {
        connection.response.end();
      }

      // 更新统计
      this.stats.activeConnections--;
      this.stats.connectionsByTenant[connection.tenantId]--;
      if (this.stats.connectionsByTenant[connection.tenantId] <= 0) {
        delete this.stats.connectionsByTenant[connection.tenantId];
      }

      this.connections.delete(connectionId);

      this.logger?.info('流连接已关闭', {
        connectionId,
        tenantId: connection.tenantId,
        activeConnections: this.stats.activeConnections,
      });
    } catch (error: any) {
      this.logger?.error('关闭流连接失败', { error: error.message, connectionId });
    }
  }

  /**
   * 广播日志到所有匹配的连接
   */
  broadcastLog(log: StoredLog): void {
    try {
      const event: LogStreamEvent = {
        type: 'log',
        data: {
          ...log,
          source: log.source || 'server', // 确保source属性有值
        } as LogEntry,
        timestamp: new Date().toISOString(),
      };

      let sentCount = 0;

      for (const [connectionId, connection] of this.connections.entries()) {
        if (!connection.isActive) {
          continue;
        }

        // 检查租户隔离
        if (connection.tenantId !== log.tenantId) {
          continue;
        }

        // 检查过滤条件
        if (!this.matchesFilters(log, connection.filters)) {
          continue;
        }

        // 发送日志
        if (this.sendToConnection(connectionId, event)) {
          sentCount++;
          connection.lastActivity = Date.now();
        }
      }

      if (sentCount > 0) {
        this.stats.messagesSent += sentCount;
        this.stats.lastActivity = Date.now();

        this.logger?.debug('日志已广播', {
          logId: log.id,
          sentToConnections: sentCount,
          totalActiveConnections: this.stats.activeConnections,
        });
      }
    } catch (error: any) {
      this.logger?.error('广播日志失败', { error: error.message, logId: log.id });
    }
  }

  /**
   * 发送消息到特定连接
   */
  private sendToConnection(connectionId: string, event: LogStreamEvent): boolean {
    try {
      const connection = this.connections.get(connectionId);
      if (!connection || !connection.isActive || connection.response.destroyed) {
        return false;
      }

      const data = `data: ${JSON.stringify(event)}\n\n`;
      connection.response.write(data);

      // 更新字节传输统计
      this.stats.bytesTransferred += Buffer.byteLength(data, 'utf8');

      return true;
    } catch (error: any) {
      this.logger?.error('发送消息到连接失败', { error: error.message, connectionId });
      // 连接可能已断开，标记为非活跃
      const connection = this.connections.get(connectionId);
      if (connection) {
        connection.isActive = false;
      }
      return false;
    }
  }

  /**
   * 发送心跳到所有连接
   */
  private sendHeartbeat(): void {
    const heartbeatEvent: LogStreamEvent = {
      type: 'heartbeat',
      data: `心跳 - 活跃连接数: ${this.stats.activeConnections}`,
      timestamp: new Date().toISOString(),
    };

    for (const [connectionId, connection] of this.connections.entries()) {
      if (connection.isActive) {
        this.sendToConnection(connectionId, heartbeatEvent);
      }
    }
  }

  /**
   * 检查日志是否匹配过滤条件
   */
  private matchesFilters(log: StoredLog, filters: StreamFilter[]): boolean {
    if (filters.length === 0) {
      return true;
    }

    return filters.every((filter) => {
      let value: string;

      switch (filter.type) {
        case 'level':
          value = log.level;
          break;
        case 'service':
          value = log.service || '';
          break;
        case 'source':
          value = log.source || '';
          break;
        case 'userId':
          value = log.userId || '';
          break;
        case 'keyword':
          value = log.message;
          break;
        default:
          return true;
      }

      switch (filter.operator) {
        case 'equals':
          return value === filter.value;
        case 'contains':
          return value.includes(filter.value);
        case 'startsWith':
          return value.startsWith(filter.value);
        case 'regex':
          try {
            return new RegExp(filter.value).test(value);
          } catch {
            return false;
          }
        default:
          return true;
      }
    });
  }

  /**
   * 解析过滤参数
   */
  private parseFilters(params: LogStreamParams): StreamFilter[] {
    const filters: StreamFilter[] = [];

    if (params.level) {
      const levelValue = Array.isArray(params.level) ? params.level.join(',') : params.level;
      filters.push({
        type: 'level',
        value: levelValue,
        operator: 'equals',
      });
    }

    if (params.service) {
      filters.push({
        type: 'service',
        value: params.service,
        operator: 'equals',
      });
    }

    if (params.source) {
      filters.push({
        type: 'source',
        value: params.source,
        operator: 'equals',
      });
    }

    if (params.userId) {
      filters.push({
        type: 'userId',
        value: params.userId,
        operator: 'equals',
      });
    }

    // keyword属性在LogStreamParams中不存在，移除此过滤器
    // 如果需要关键字搜索，应该使用query参数或其他方式

    return filters;
  }

  /**
   * 设置SSE响应头
   */
  private setupSSEResponse(response: any): void {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
    });
  }

  /**
   * 生成连接ID
   */
  private generateConnectionId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 15);
    return `stream_${timestamp}_${random}`;
  }

  /**
   * 获取租户连接数
   */
  private getTenantConnectionCount(tenantId: string): number {
    return this.stats.connectionsByTenant[tenantId] || 0;
  }

  /**
   * 启动心跳
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, STREAM_CONFIG.HEARTBEAT_INTERVAL);
  }

  /**
   * 启动清理任务
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveConnections();
    }, 60000); // 每分钟清理一次
  }

  /**
   * 清理非活跃连接
   */
  private cleanupInactiveConnections(): void {
    const now = Date.now();
    const timeout = STREAM_CONFIG.CONNECTION_TIMEOUT;
    const toRemove: string[] = [];

    for (const [connectionId, connection] of this.connections.entries()) {
      // 检查连接是否超时
      if (now - connection.lastActivity > timeout) {
        toRemove.push(connectionId);
      }

      // 检查响应是否已销毁
      if (connection.response.destroyed) {
        connection.isActive = false;
        toRemove.push(connectionId);
      }
    }

    // 移除非活跃连接
    toRemove.forEach((connectionId) => {
      this.closeConnection(connectionId);
    });

    if (toRemove.length > 0) {
      this.logger?.info('清理非活跃连接', {
        removedCount: toRemove.length,
        activeConnections: this.stats.activeConnections,
      });
    }
  }

  /**
   * 获取连接统计
   */
  getStats(): StreamStats {
    return { ...this.stats };
  }

  /**
   * 获取连接详情
   */
  getConnectionDetails(connectionId: string): StreamConnection | undefined {
    return this.connections.get(connectionId);
  }

  /**
   * 获取租户的所有连接
   */
  getTenantConnections(tenantId: string): StreamConnection[] {
    return Array.from(this.connections.values()).filter(
      (conn) => conn.tenantId === tenantId && conn.isActive,
    );
  }

  /**
   * 向租户的所有连接发送消息
   */
  broadcastToTenant(tenantId: string, event: LogStreamEvent): void {
    const tenantConnections = this.getTenantConnections(tenantId);

    tenantConnections.forEach((connection) => {
      this.sendToConnection(connection.id, event);
    });

    this.logger?.debug('向租户广播消息', {
      tenantId,
      connectionCount: tenantConnections.length,
      eventType: event.type,
    });
  }

  /**
   * 停止流管理器
   */
  stop(): void {
    try {
      // 停止定时器
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }

      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
        this.cleanupInterval = null;
      }

      // 关闭所有连接
      const connectionIds = Array.from(this.connections.keys());
      connectionIds.forEach((id) => this.closeConnection(id));

      this.logger?.info('流管理器已停止', {
        closedConnections: connectionIds.length,
      });
    } catch (error: any) {
      this.logger?.error('停止流管理器失败', { error: error.message });
    }
  }
}

// 导出单例实例
export const streamManager = new StreamManager();
