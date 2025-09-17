import { EventEmitter } from 'events';
import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, HttpStatusCode, Starlight } from 'typings';
import { LogStreamEvent } from '../types';
import { validateLogStream } from '../validators';

// 全局活跃流存储
let _activeStreams: Map<string, any> | undefined;
let _cleanupInterval: NodeJS.Timeout | undefined;

export default function stream(star: Starlight) {
  return {
    'v1.logStream': {
      metadata: {
        auth: true,
        roles: ['admin', 'user'],
      },

      async handler(ctx: Context): Promise<HttpResponseItem> {
        const { service, level } = ctx.params;
        const apiKey = (ctx.meta as any)?.apiKey;
        const tenantId = (ctx.meta as any)?.tenantId;

        try {
          // 验证流式传输参数
          const validation = validateLogStream({ service, level, tenantId });
          if (!validation.valid) {
            return {
              status: HttpStatusCode.BAD_REQUEST,
              data: {
                content: null,
                message: validation.errors.join(', '),
                code: HttpResponseCode.ParamsError,
                success: false,
              },
            };
          }
          // 设置SSE响应头
          (ctx.meta as any).$responseHeaders = {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Cache-Control',
          };

          // 创建流连接
          const streamId = generateStreamId(tenantId, apiKey?.id);
          const stream = createLogStream(streamId, { service, level, tenantId });

          // 发送连接成功事件
          const connectEvent: LogStreamEvent = {
            type: 'connected',
            data: `Connection established, stream ID: ${streamId}`,
            timestamp: new Date().toISOString(),
          };

          sendStreamEvent(ctx, connectEvent);

          // 注册流监听器
          registerStreamListeners(stream, ctx, { service, level, tenantId });

          // 记录流连接
          star.logger?.info('Log stream connected', {
            streamId,
            tenantId,
            service,
            level,
          });

          // 保持连接活跃
          const heartbeatInterval = setInterval(() => {
            if (!(ctx.meta as any).$responseFinished) {
              sendHeartbeat(ctx);
            } else {
              clearInterval(heartbeatInterval);
              cleanupStream(streamId);
            }
          }, 30000); // 30秒心跳

          // 处理客户端断开连接
          (ctx.meta as any).$responseOnClose = () => {
            clearInterval(heartbeatInterval);
            cleanupStream(streamId);
            star.logger?.info('Log stream disconnected', {
              streamId,
              tenantId,
            });
          };

          // 返回流响应
          return {
            status: HttpStatusCode.OK,
            data: {
              content: createStreamResponse(streamId),
              message: 'Log stream established',
              code: HttpResponseCode.Success,
              success: true,
            },
          };
        } catch (error: any) {
          star.logger?.error('Log stream creation failed', {
            error: error.message,
            tenantId,
            service,
            level,
          });

          const errorEvent: LogStreamEvent = {
            type: 'error',
            data: `Stream creation failed: ${error.message}`,
            timestamp: new Date().toISOString(),
          };

          sendStreamEvent(ctx, errorEvent);

          return {
            status: HttpStatusCode.INTERNAL_SERVER_ERROR,
            data: {
              content: null,
              message: 'Stream creation failed',
              code: HttpResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        }
      },
    },
  };
}

// 辅助函数

// 生成流ID
function generateStreamId(tenantId: string, apiKeyId?: string): string {
  return `stream_${tenantId}_${apiKeyId || 'unknown'}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// 创建日志流
function createLogStream(
  streamId: string,
  filters: { service?: string; level?: string; tenantId: string },
) {
  const stream = new EventEmitter();

  // 存储活跃流
  if (!_activeStreams) {
    _activeStreams = new Map();
  }

  _activeStreams.set(streamId, {
    stream,
    filters,
    createdAt: Date.now(),
    lastActivity: Date.now(),
  });

  return stream;
}

// 注册流监听器
function registerStreamListeners(stream: EventEmitter, ctx: Context, filters: any) {
  // 这里可以添加事件监听逻辑
  // 由于没有broker实例，暂时简化处理
  // star.logger?.debug('Stream listeners registered', { filters });
}

// 判断是否应该转发到流
function shouldForwardToStream(
  data: any,
  filters: { service?: string; level?: string; tenantId: string },
): boolean {
  // 租户隔离
  if (data.tenantId !== filters.tenantId) {
    return false;
  }

  // 服务过滤
  if (filters.service && data.service !== filters.service) {
    return false;
  }

  // 日志级别过滤
  if (filters.level && data.level !== filters.level) {
    return false;
  }

  return true;
}

// 发送流事件
function sendStreamEvent(ctx: Context, event: LogStreamEvent) {
  try {
    if (!ctx.meta.$responseFinished) {
      const eventData = `data: ${JSON.stringify(event)}\n\n`;
      ctx.meta.$responseWrite?.(eventData);
    }
  } catch (error: any) {
    console.log('Failed to send stream event', { error: error.message });
  }
}

// 发送心跳
function sendHeartbeat(ctx: Context) {
  const heartbeatEvent: LogStreamEvent = {
    type: 'connected',
    data: 'heartbeat',
    timestamp: new Date().toISOString(),
  };

  sendStreamEvent(ctx, heartbeatEvent);
}

// 清理流
function cleanupStream(streamId: string) {
  if (_activeStreams?.has(streamId)) {
    const streamInfo = _activeStreams.get(streamId);
    streamInfo.stream.removeAllListeners();
    _activeStreams.delete(streamId);
  }
}

// 创建流响应
function createStreamResponse(streamId: string) {
  return {
    success: true,
    message: 'Log stream established',
    data: {
      streamId,
      type: 'event-stream',
      instructions: {
        format: 'Server-Sent Events (SSE)',
        events: [
          'connected - Connection status',
          'log - New log data',
          'error - Error information',
          'disconnected - Connection closed',
        ],
      },
    },
    meta: {
      timestamp: new Date().toISOString(),
      contentType: 'text/event-stream',
    },
  };
}

// 获取活跃流统计
function getActiveStreamsStats(): { total: number; byTenant: Record<string, number> } {
  if (!_activeStreams) {
    return { total: 0, byTenant: {} };
  }

  const byTenant: Record<string, number> = {};
  let total = 0;

  for (const [streamId, streamInfo] of _activeStreams) {
    total++;
    const tenantId = streamInfo.filters.tenantId;
    byTenant[tenantId] = (byTenant[tenantId] || 0) + 1;
  }

  return { total, byTenant };
}

// 清理过期流
function cleanupExpiredStreams() {
  if (!_activeStreams) return;

  const now = Date.now();
  const maxAge = 60 * 60 * 1000; // 1小时

  for (const [streamId, streamInfo] of _activeStreams) {
    if (now - streamInfo.lastActivity > maxAge) {
      cleanupStream(streamId);
      console.log('Cleaned up expired stream', { streamId, age: now - streamInfo.createdAt });
    }
  }
}

// 广播消息到所有流
function broadcastToStreams(message: any, tenantId?: string) {
  if (!_activeStreams) return;

  const event: LogStreamEvent = {
    type: 'log',
    data: message,
    timestamp: new Date().toISOString(),
  };

  for (const [streamId, streamInfo] of _activeStreams) {
    if (!tenantId || streamInfo.filters.tenantId === tenantId) {
      streamInfo.stream.emit('broadcast', event);
    }
  }
}

// 初始化清理定时器
function initializeCleanup() {
  if (!_cleanupInterval) {
    _cleanupInterval = setInterval(
      () => {
        cleanupExpiredStreams();
      },
      5 * 60 * 1000,
    ); // 5分钟清理一次
  }
}

// 停止清理并清理所有流
function stopAndCleanupAll() {
  if (_cleanupInterval) {
    clearInterval(_cleanupInterval);
    _cleanupInterval = undefined;
  }

  // 清理所有活跃流
  if (_activeStreams) {
    for (const streamId of _activeStreams.keys()) {
      cleanupStream(streamId);
    }
  }
}
