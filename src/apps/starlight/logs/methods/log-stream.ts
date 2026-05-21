/**
 * 日志流方法
 * 处理日志实时流和Server-Sent Events
 */

import { Context } from 'node-universe';
import {
  LogStreamParams,
  LogStreamConnection,
  LogEntry,
  ApiPermission,
  LogStreamEvent,
} from '../types';
import { ApiKeyManager } from '../utils/api-key-manager';
import { QuotaChecker } from '../utils/quota-checker';
import { StreamManager } from '../utils/stream-manager';
import { LogUtils } from '../utils/log-utils';
import { STREAM_CONFIG } from '../constants';

/**
 * 创建日志流连接
 */
export async function createLogStream(
  ctx: Context,
  params: {
    apiKey: string;
    streamParams: LogStreamParams;
    tenantId: string;
    userId?: string;
    response: any; // HTTP Response对象
  },
): Promise<{
  success: boolean;
  connectionId?: string;
  error?: string;
}> {
  try {
    const { apiKey, streamParams, tenantId, userId, response } = params;

    // 验证API密钥
    const apiKeyManager = ApiKeyManager.getInstance();
    const validatedKey = await apiKeyManager.validateApiKey(apiKey);
    if (!validatedKey || validatedKey.tenantId !== tenantId) {
      throw new Error('Invalid API key');
    }

    // 检查权限
    const hasPermission = apiKeyManager.hasPermission(validatedKey, ApiPermission.READ);
    if (!hasPermission) {
      throw new Error('Insufficient permissions for log streaming');
    }

    // 检查流配额
    const quotaChecker = new QuotaChecker();
    const quotaCheck = await quotaChecker.checkStreamQuota(tenantId);
    if (!quotaCheck.allowed) {
      throw new Error(`Stream quota exceeded: ${quotaCheck.reason}`);
    }

    // 验证流参数
    const validationResult = LogUtils.validateSearchParams(streamParams);
    if (!validationResult.valid) {
      throw new Error(`Invalid stream parameters: ${validationResult.errors.join(', ')}`);
    }

    // 检查租户连接数限制
    const streamManager = StreamManager.getInstance();
    const tenantConnections = streamManager.getTenantConnectionCount(tenantId);
    const maxConnectionsPerTenant = Math.floor(STREAM_CONFIG.MAX_CONNECTIONS / 10);
    if (tenantConnections >= maxConnectionsPerTenant) {
      throw new Error('Maximum concurrent connections exceeded for tenant');
    }

    // 创建流连接
    const connectionId = streamManager.createConnection(tenantId, response, streamParams, userId);

    // 更新流配额使用量
    await quotaChecker.updateStreamUsage(tenantId, 1);

    // 记录流创建事件
    await ctx.emit('logs.stream.created', {
      connectionId,
      tenantId,
      userId,
      filters: streamParams.filters,
      timestamp: Date.now(),
    });

    ctx.service?.logger?.debug(`Log stream created: ${connectionId}`);

    return {
      success: true,
      connectionId,
    };
  } catch (error) {
    ctx.service?.logger?.error('Failed to create log stream:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 关闭日志流连接
 */
export async function closeLogStream(
  ctx: Context,
  params: {
    connectionId: string;
    tenantId: string;
    userId?: string;
  },
): Promise<{ success: boolean; error?: string }> {
  try {
    const { connectionId, tenantId, userId } = params;

    const streamManager = StreamManager.getInstance();
    const success = streamManager.closeConnection(connectionId);

    if (success) {
      // 记录流关闭事件
      await ctx.emit('logs.stream.closed', {
        connectionId,
        tenantId,
        userId,
        timestamp: Date.now(),
      });

      ctx.service?.logger?.debug(`Log stream closed: ${connectionId}`);
    }

    return { success };
  } catch (error) {
    ctx.service?.logger?.error('Failed to close log stream:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 广播日志到所有流
 */
export async function broadcastLogToStreams(
  ctx: Context,
  params: {
    log: LogEntry;
    tenantId: string;
  },
): Promise<{ success: boolean; broadcastCount: number }> {
  try {
    const { log, tenantId } = params;

    const streamManager = StreamManager.getInstance();
    const broadcastCount = streamManager.broadcastLog(log as any);

    if (broadcastCount > 0) {
      ctx.service?.logger?.debug(
        `Log broadcasted to ${broadcastCount} streams for tenant ${tenantId}`,
      );
    }

    return {
      success: true,
      broadcastCount,
    };
  } catch (error) {
    ctx.service?.logger?.error('Failed to broadcast log to streams:', error);
    return {
      success: false,
      broadcastCount: 0,
    };
  }
}

/**
 * 获取流连接统计
 */
export async function getStreamStats(
  ctx: Context,
  params: {
    tenantId: string;
    userId?: string;
  },
): Promise<{
  totalConnections: number;
  activeConnections: number;
  tenantConnections: number;
  userConnections?: number;
  connectionDetails: Array<{
    connectionId: string;
    userId?: string;
    createdAt: Date;
    lastActivity: Date;
    filters: any;
  }>;
}> {
  try {
    const { tenantId, userId } = params;

    const streamManager = StreamManager.getInstance();
    const stats = streamManager.getConnectionStats();
    const tenantConnections = streamManager.getTenantConnectionCount(tenantId);
    const userConnections = userId
      ? streamManager.getUserConnectionCount(tenantId, userId)
      : undefined;

    const connectionDetails = streamManager
      .getTenantConnections(tenantId)
      .filter((conn) => !userId || conn.userId === userId)
      .map((conn) => ({
        connectionId: conn.id,
        userId: conn.userId,
        createdAt: new Date(conn.createdAt),
        lastActivity: new Date(conn.lastActivity),
        filters: conn.filters,
      }));

    return {
      totalConnections: stats.totalConnections,
      activeConnections: stats.activeConnections,
      tenantConnections,
      userConnections,
      connectionDetails,
    };
  } catch (error) {
    ctx.service?.logger?.error('Failed to get stream stats:', error);
    throw error;
  }
}

/**
 * 发送心跳到所有流
 */
export async function sendHeartbeatToStreams(
  ctx: Context,
  params: {
    tenantId?: string;
  } = {},
): Promise<{ success: boolean; heartbeatCount: number }> {
  try {
    const { tenantId } = params;

    const streamManager = StreamManager.getInstance();
    const heartbeatCount = streamManager.sendHeartbeat(tenantId);

    if (heartbeatCount > 0) {
      ctx.service?.logger?.debug(
        `Heartbeat sent to ${heartbeatCount} streams${tenantId ? ` for tenant ${tenantId}` : ''}`,
      );
    }

    return {
      success: true,
      heartbeatCount,
    };
  } catch (error) {
    ctx.service?.logger?.error('Failed to send heartbeat to streams:', error);
    return {
      success: false,
      heartbeatCount: 0,
    };
  }
}

/**
 * 清理非活跃的流连接
 */
export async function cleanupInactiveStreams(
  ctx: Context,
  params: {
    maxInactiveTime?: number; // 最大非活跃时间（毫秒），默认30分钟
  } = {},
): Promise<{ success: boolean; cleanedCount: number }> {
  try {
    const { maxInactiveTime = 30 * 60 * 1000 } = params; // 30分钟

    const streamManager = StreamManager.getInstance();
    const cleanedCount = streamManager.cleanupInactiveConnections(maxInactiveTime);

    if (cleanedCount > 0) {
      ctx.service?.logger?.info(`Cleaned up ${cleanedCount} inactive stream connections`);
    }

    return {
      success: true,
      cleanedCount,
    };
  } catch (error) {
    ctx.service?.logger?.error('Failed to cleanup inactive streams:', error);
    return {
      success: false,
      cleanedCount: 0,
    };
  }
}

/**
 * 更新流过滤器
 */
export async function updateStreamFilters(
  ctx: Context,
  params: {
    connectionId: string;
    filters: any;
    tenantId: string;
    userId?: string;
  },
): Promise<{ success: boolean; error?: string }> {
  try {
    const { connectionId, filters, tenantId, userId } = params;

    const streamManager = StreamManager.getInstance();
    const connection = streamManager.getConnectionDetails(connectionId);

    if (!connection) {
      throw new Error('Stream connection not found');
    }

    // 验证权限
    if (connection.tenantId !== tenantId || (userId && connection.userId !== userId)) {
      throw new Error('Insufficient permissions to update stream filters');
    }

    // 验证过滤器
    const validationResult = LogUtils.validateSearchParams({ tenantId, filters });
    if (!validationResult.valid) {
      throw new Error(`Invalid filters: ${validationResult.errors.join(', ')}`);
    }

    // 更新过滤器
    const success = streamManager.updateConnectionFilters(connectionId, filters);

    if (success) {
      // 记录更新事件
      await ctx.emit('logs.stream.filters.updated', {
        connectionId,
        tenantId,
        userId,
        filters,
        timestamp: Date.now(),
      });

      ctx.service?.logger?.debug(`Stream filters updated: ${connectionId}`);
    }

    return { success };
  } catch (error) {
    ctx.service?.logger?.error('Failed to update stream filters:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 发送自定义消息到流
 */
export async function sendMessageToStream(
  ctx: Context,
  params: {
    connectionId: string;
    message: any;
    eventType?: LogStreamEvent['type'];
    tenantId: string;
    userId?: string;
  },
): Promise<{ success: boolean; error?: string }> {
  try {
    const { connectionId, message, eventType = 'message', tenantId, userId } = params;

    const streamManager = StreamManager.getInstance();
    const connection = streamManager.getConnectionDetails(connectionId);

    if (!connection) {
      throw new Error('Stream connection not found');
    }

    // 验证权限
    if (connection.tenantId !== tenantId || (userId && connection.userId !== userId)) {
      throw new Error('Insufficient permissions to send message to stream');
    }

    // 发送消息
    const success = streamManager.sendMessageToConnection(connectionId, message, eventType);

    if (success) {
      ctx.service?.logger?.debug(`Message sent to stream ${connectionId}: ${eventType}`);
    }

    return { success };
  } catch (error) {
    ctx.service?.logger?.error('Failed to send message to stream:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 广播消息到租户的所有流
 */
export async function broadcastMessageToTenant(
  ctx: Context,
  params: {
    tenantId: string;
    message: any;
    eventType?: LogStreamEvent['type'];
    userId?: string; // 可选：只发送给特定用户的流
  },
): Promise<{ success: boolean; broadcastCount: number }> {
  try {
    const { tenantId, message, eventType = 'broadcast', userId } = params;

    const streamManager = StreamManager.getInstance();
    const connections = streamManager
      .getTenantConnections(tenantId)
      .filter((conn) => !userId || conn.userId === userId);

    let broadcastCount = 0;
    for (const connection of connections) {
      const success = streamManager.sendMessageToConnection(connection.id, message, eventType);
      if (success) {
        broadcastCount++;
      }
    }

    if (broadcastCount > 0) {
      ctx.service?.logger?.debug(
        `Message broadcasted to ${broadcastCount} streams for tenant ${tenantId}`,
      );
    }

    return {
      success: true,
      broadcastCount,
    };
  } catch (error) {
    ctx.service?.logger?.error('Failed to broadcast message to tenant:', error);
    return {
      success: false,
      broadcastCount: 0,
    };
  }
}

/**
 * 获取流连接详情
 */
export async function getStreamConnectionDetails(
  ctx: Context,
  params: {
    connectionId: string;
    tenantId: string;
    userId?: string;
  },
): Promise<{
  connection?: {
    connectionId: string;
    tenantId: string;
    userId?: string;
    createdAt: Date;
    lastActivity: Date;
    filters: any;
    isActive: boolean;
    messageCount: number;
  };
  error?: string;
}> {
  try {
    const { connectionId, tenantId, userId } = params;

    const streamManager = StreamManager.getInstance();
    const connection = streamManager.getConnectionDetails(connectionId);

    if (!connection) {
      return { error: 'Stream connection not found' };
    }

    // 验证权限
    if (connection.tenantId !== tenantId || (userId && connection.userId !== userId)) {
      return { error: 'Insufficient permissions to view connection details' };
    }

    return {
      connection: {
        connectionId: connection.id,
        tenantId: connection.tenantId,
        userId: connection.userId,
        createdAt: new Date(connection.createdAt),
        lastActivity: new Date(connection.lastActivity),
        filters: connection.filters,
        isActive: connection.isActive,
        messageCount: connection.messageCount || 0,
      },
    };
  } catch (error) {
    ctx.service?.logger?.error('Failed to get stream connection details:', error);
    return {
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 启动流管理器
 */
export async function startStreamManager(
  ctx: Context,
): Promise<{ success: boolean; error?: string }> {
  try {
    const streamManager = StreamManager.getInstance();
    streamManager.start();

    ctx.service?.logger?.info('Stream manager started successfully');

    return { success: true };
  } catch (error) {
    ctx.service?.logger?.error('Failed to start stream manager:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 停止流管理器
 */
export async function stopStreamManager(
  ctx: Context,
): Promise<{ success: boolean; error?: string }> {
  try {
    const streamManager = StreamManager.getInstance();
    streamManager.stop();

    ctx.service?.logger?.info('Stream manager stopped successfully');

    return { success: true };
  } catch (error) {
    ctx.service?.logger?.error('Failed to stop stream manager:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
