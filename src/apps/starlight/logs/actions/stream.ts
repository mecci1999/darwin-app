import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, HttpStatusCode, Starlight } from 'typings';
import { LogStreamEvent } from '../types';
import { validateLogStream } from '../validators';
import { isAdminContext, isDarwinLogRequest, resolveLogTenantId } from '../utils/access-control';
import { getLogServiceFilter } from '../utils/log-service-filter';

// 全局活跃流存储
let _activeStreams: Map<string, any> | undefined;
let _cleanupInterval: NodeJS.Timeout | undefined;
const STREAM_DIAGNOSTIC_INTERVAL_MS = 10000;
initializeCleanup();

export default function stream(star: Starlight) {
  return {
    'v1.stream': {
      metadata: {
        auth: true,
        roles: ['admin', 'user'],
      },
      timeout: 0,

      async handler(ctx: Context): Promise<HttpResponseItem> {
        const { level, keywords, originType, streamTraceId } = ctx.params;
        const service = getLogServiceFilter(ctx.params);
        const apiKey = (ctx.meta as any)?.apiKey;
        const tenantId = resolveLogTenantId(ctx, originType);
        const traceId = String(streamTraceId || `server-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

        try {
          star.logger?.info('Log stream request received', {
            traceId,
            tenantId,
            service,
            level,
            keywords: keywords ? '[present]' : undefined,
            originType,
            userId: (ctx.meta as any)?.user?.userId,
          });

          // 验证流式传输参数
          if (isDarwinLogRequest(originType) && !isAdminContext(ctx)) {
            star.logger?.warn('Log stream rejected: Darwin logs require admin', { traceId, tenantId, originType });
            return {
              status: HttpStatusCode.FORBIDDEN,
              data: {
                content: null,
                message: 'Only administrators can access Darwin logs',
                code: HttpResponseCode.NoPermissionError,
                success: false,
              },
            };
          }

          const validation = validateLogStream({ service, level, keywords, tenantId, originType });
          if (!validation.valid) {
            star.logger?.warn('Log stream rejected: validation failed', { traceId, errors: validation.errors });
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

          if (!tenantId) {
            star.logger?.warn('Log stream rejected: missing tenantId', { traceId, originType });
            return {
              status: HttpStatusCode.BAD_REQUEST,
              data: {
                content: null,
                message: 'tenantId is required',
                code: HttpResponseCode.ParamsError,
                success: false,
              },
            };
          }
          const requestOrigin =
            (ctx.meta as any)?.$request?.headers?.origin ||
            (ctx.meta as any)?.request?.headers?.origin ||
            (ctx.meta as any)?.headers?.origin;

          // 设置SSE响应头
          (ctx.meta as any).$responseHeaders = {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            ...(requestOrigin ? { 'Access-Control-Allow-Origin': requestOrigin } : {}),
            'Access-Control-Allow-Credentials': 'true',
            'Access-Control-Allow-Headers': 'Cache-Control, Content-Type',
            Vary: 'Origin',
          };
          star.logger?.info('Log stream response headers prepared', {
            traceId,
            contentType: (ctx.meta as any).$responseHeaders['Content-Type'],
            requestOrigin: requestOrigin || null,
          });

          // 创建流连接
          const streamId = generateStreamId(tenantId, apiKey?.id);
          const responseStream = new PassThrough();
          const stream = createLogStream(streamId, { service, level, keywords, tenantId, originType, responseStream, traceId, logger: star.logger });

          responseStream.on('close', () => {
            star.logger?.info('Log stream PassThrough close', { traceId, streamId, destroyed: responseStream.destroyed });
          });
          responseStream.on('end', () => {
            star.logger?.info('Log stream PassThrough end', { traceId, streamId });
          });
          responseStream.on('error', (error) => {
            star.logger?.error('Log stream PassThrough error', { traceId, streamId, error: error?.message || String(error) });
          });

          // 发送连接成功事件
          const connectEvent: LogStreamEvent = {
            type: 'connected',
            data: `Connection established, stream ID: ${streamId}`,
            timestamp: new Date().toISOString(),
          };

          sendStreamEvent(responseStream, connectEvent, traceId, 'connect');
          star.logger?.info('Log stream initial connected event written', {
            traceId,
            streamId,
            writableLength: responseStream.writableLength,
            readableLength: responseStream.readableLength,
          });

          // 注册流监听器
          registerStreamListeners(stream, responseStream, { service, level, keywords, tenantId, originType });

          // 记录流连接
          star.logger?.info('Log stream connected', {
            traceId,
            streamId,
            tenantId,
            service,
            level,
            keywords,
          });

          // 保持连接活跃
          const heartbeatInterval = setInterval(() => {
            if (!responseStream.destroyed) {
              star.logger?.info('Log stream heartbeat tick', { traceId, streamId });
              sendHeartbeat(responseStream, traceId);
            } else {
              clearInterval(heartbeatInterval);
              cleanupStream(streamId);
            }
          }, 30000); // 30秒心跳

          // 处理客户端断开连接
          responseStream.on('close', () => {
            clearInterval(heartbeatInterval);
            cleanupStream(streamId);
            star.logger?.info('Log stream disconnected', {
              traceId,
              streamId,
              tenantId,
            });
          });

          return responseStream as any;
        } catch (error: any) {
          star.logger?.error('Log stream creation failed', {
            traceId,
            error: error.message,
            tenantId,
            service,
            level,
          });

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
    filters: { service?: string; level?: string; keywords?: string; tenantId: string; originType?: string; responseStream?: PassThrough; traceId?: string; logger?: any },
) {
  const stream = new EventEmitter();

  // 存储活跃流
  if (!_activeStreams) {
    _activeStreams = new Map();
  }

  const diagnostics = {
    attempted: 0,
    emitted: 0,
    forwarded: 0,
    filtered: 0,
    written: 0,
    bytes: 0,
    lastLoggedAt: 0,
  };

  const streamInfo = {
    stream,
    filters: { ...filters, diagnostics },
    createdAt: Date.now(),
    lastActivity: Date.now(),
    diagnostics,
  };

  _activeStreams.set(streamId, streamInfo);
  filters.logger?.info?.('Log stream registered', {
    traceId: filters.traceId,
    streamId,
    tenantId: filters.tenantId,
    originType: filters.originType,
    activeStreams: _activeStreams.size,
  });

  return stream;
}

// 注册流监听器
function registerStreamListeners(stream: EventEmitter, responseStream: PassThrough, filters: any) {
  stream.on('broadcast', (event: LogStreamEvent) => {
    if (event?.type === 'log' && event.data && shouldForwardToStream(event.data, filters)) {
      const bytes = sendStreamEvent(responseStream, event, filters.traceId, 'broadcast');
      filters.diagnostics.forwarded++;
      if (bytes > 0) {
        filters.diagnostics.written++;
        filters.diagnostics.bytes += bytes;
      }
      return;
    }

    if (event?.type === 'error') {
      const bytes = sendStreamEvent(responseStream, event, filters.traceId, 'error');
      filters.diagnostics.forwarded++;
      if (bytes > 0) {
        filters.diagnostics.written++;
        filters.diagnostics.bytes += bytes;
      }
      return;
    }

    filters.diagnostics.filtered++;
  });
}

// 判断是否应该转发到流
function shouldForwardToStream(
  data: any,
  filters: { service?: string; level?: string; keywords?: string; tenantId: string; originType?: string },
): boolean {
  // 租户隔离
  if (data.tenantId !== filters.tenantId) {
    return false;
  }

  if (filters.originType && data.originType !== filters.originType) {
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

  if (filters.keywords) {
    const keyword = String(filters.keywords).toLowerCase();
    const haystack = `${data.message || ''} ${data.service || ''}`.toLowerCase();
    if (!haystack.includes(keyword)) {
      return false;
    }
  }

  return true;
}

// 发送流事件
function sendStreamEvent(responseStream: PassThrough, event: LogStreamEvent, traceId?: string, reason?: string): number {
  try {
    if (!responseStream.destroyed) {
      const eventData = `data: ${JSON.stringify(event)}\n\n`;
      responseStream.write(eventData);
      return Buffer.byteLength(eventData);
    } else {
      console.warn('Log stream SSE event skipped because response stream is destroyed', { traceId, type: event.type });
    }
  } catch (error: any) {
    console.warn('Failed to send stream event', { traceId, reason, error: error.message });
  }
  return 0;
}

// 发送心跳
function sendHeartbeat(responseStream: PassThrough, traceId?: string) {
  const heartbeatEvent: LogStreamEvent = {
    type: 'connected',
    data: 'heartbeat',
    timestamp: new Date().toISOString(),
  };

  sendStreamEvent(responseStream, heartbeatEvent, traceId, 'heartbeat');
}

// 清理流
function cleanupStream(streamId: string) {
  if (_activeStreams?.has(streamId)) {
    const streamInfo = _activeStreams.get(streamId);
    streamInfo.stream.removeAllListeners();
    _activeStreams.delete(streamId);
    streamInfo.filters?.logger?.info?.('Log stream cleaned up', {
      traceId: streamInfo.filters?.traceId,
      streamId,
      activeStreams: _activeStreams.size,
      diagnostics: streamInfo.diagnostics,
    });
  }
}

function shouldSkipSelfStreamLog(message: any) {
  const service = String(message?.service || message?.svc || message?.mod || '').toLowerCase();
  if (service !== 'logs') return false;
  const text = String(message?.message || '');
  return (
    text.includes('Log stream') ||
    text.includes('Darwin explorer search checkpoint') ||
    text.includes('Darwin log search storage checkpoint')
  );
}

function maybeLogStreamDiagnostics(streamId: string, streamInfo: any) {
  const diagnostics = streamInfo.diagnostics;
  if (!diagnostics) return;
  const now = Date.now();
  if (now - diagnostics.lastLoggedAt < STREAM_DIAGNOSTIC_INTERVAL_MS) return;
  diagnostics.lastLoggedAt = now;
  streamInfo.filters?.logger?.info?.('Log stream forwarding checkpoint', {
    traceId: streamInfo.filters?.traceId,
    streamId,
    tenantId: streamInfo.filters?.tenantId,
    originType: streamInfo.filters?.originType,
    activeStreams: _activeStreams?.size || 0,
    attempted: diagnostics.attempted,
    forwarded: diagnostics.forwarded,
    filtered: diagnostics.filtered,
    written: diagnostics.written,
    bytes: diagnostics.bytes,
  });
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
export function broadcastToStreams(message: any, tenantId?: string) {
  if (!_activeStreams) {
    return;
  }

  if (shouldSkipSelfStreamLog(message)) return;

  const event: LogStreamEvent = {
    type: 'log',
    data: message,
    timestamp: new Date().toISOString(),
  };

  let matched = 0;
  for (const [streamId, streamInfo] of _activeStreams) {
    streamInfo.diagnostics.attempted++;
    if (!tenantId || streamInfo.filters.tenantId === tenantId) {
      matched++;
      streamInfo.diagnostics.emitted++;
      streamInfo.stream.emit('broadcast', event);
    } else {
      streamInfo.diagnostics.filtered++;
    }
    maybeLogStreamDiagnostics(streamId, streamInfo);
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
