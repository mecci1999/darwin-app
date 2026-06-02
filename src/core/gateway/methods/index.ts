import { WS_SERVER_PATH, WS_SERVER_PORT } from 'config';
import { TokenExpiredError, UnAuthorizedError, UserNotLoginError } from 'error';
import { createServer } from 'http';
import { Context, Star } from 'node-universe';
import { HttpResponseCode } from 'typings';
import url from 'url';
import WebSocket from 'ws';

// WebSocket 相关变量
let wss: WebSocket.Server | null = null;
const wsClients = new Map<string, WebSocketClient>();
const eventListeners: Map<string, (data: any) => void> = new Map();
const AUTH_CACHE_TTL_MS = 30 * 1000;
const authCache = new Map<string, { expiresAt: number; user: any }>();

// WebSocket 客户端类型定义
// WebSocket 客户端接口
interface WebSocketClient {
  ws: WebSocket;
  id: string;
  subscriptions: Set<string>;
  isAlive: boolean;
  isAuthenticated: boolean;
  token?: string; // 添加token字段
  user?: any;
}

// WebSocket 消息类型定义
interface WebSocketMessage {
  type: 'init' | 'subscribe' | 'unsubscribe' | 'ping' | 'auth' | string; // 添加 init 类型
  channel?: string; // 频道: metrics, qrcode, alert, etc.
  data?: any; // 消息数据
  id?: string; // 消息ID，用于客户端确认
}

const createWebSocketManager = (
  star: Star,
  authorizeFn: (ctx: Context, token: string) => Promise<void>,
) => {
  const sendToClient = (client: WebSocketClient, message: any): boolean => {
    try {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify(message));
        return true;
      }
    } catch (error) {
      star.logger?.error(`Failed to send message to client ${client.id}:`, error);
    }
    return false;
  };

  const broadcastToChannel = (channel: string, message: any) => {
    let count = 0;
    wsClients.forEach((client) => {
      if (client.subscriptions.has(channel)) {
        if (sendToClient(client, message)) {
          count++;
        }
      }
    });
    star.logger?.debug(`Broadcasted message to ${count} clients on channel ${channel}`);
    return count;
  };

  const sendToUser = (userId: string, message: any) => {
    let sent = false;
    wsClients.forEach((client) => {
      if (client.user && client.user.id === userId) {
        if (sendToClient(client, message)) {
          sent = true;
        }
      }
    });
    return sent;
  };

  const handleClientDisconnect = (clientId: string) => {
    if (wsClients.has(clientId)) {
      wsClients.delete(clientId);
      star.logger?.info(`WebSocket client ${clientId} disconnected`);
    }
  };

  const authenticateClient = async (client: WebSocketClient, token: string) => {
    try {
      const ctx = { meta: {} } as Context;
      await authorizeFn(ctx, token);
      client.user = (ctx.meta as any).user;
      client.isAuthenticated = true;

      sendToClient(client, {
        type: 'auth_success',
        data: {
          message: '认证成功',
          user: {
            id: client.user.id,
            username: client.user.username,
          },
        },
      });

      star.logger?.info(`Client ${client.id} authenticated as user ${client.user.id}`);
    } catch (error) {
      star.logger?.error(`Client ${client.id} authentication error:`, error);
      client.isAuthenticated = false;
      sendToClient(client, {
        type: 'auth_error',
        data: { message: '认证失败', code: 401 },
      });
    }
  };

  const handleClientMessage = (client: WebSocketClient, message: any) => {
    const { type, data } = message;

    switch (type) {
      case 'heartbeat':
      case 'ping':
        sendToClient(client, {
          type: 'pong',
          data: {
            time: Date.now(),
            clientId: client.id,
          },
        });
        break;

      case 'subscribe':
        if (data && data.channel) {
          client.subscriptions.add(data.channel);
          sendToClient(client, {
            type: 'subscribed',
            data: {
              channel: data.channel,
              message: `成功订阅 ${data.channel} 频道`,
            },
          });
          star.logger?.info(`Client ${client.id} subscribed to ${data.channel}`);
        }
        break;

      case 'unsubscribe':
        if (data && data.channel) {
          client.subscriptions.delete(data.channel);
          sendToClient(client, {
            type: 'unsubscribed',
            data: {
              channel: data.channel,
              message: `已取消订阅 ${data.channel} 频道`,
            },
          });
          star.logger?.info(`Client ${client.id} unsubscribed from ${data.channel}`);
        }
        break;

      case 'auth':
        if (data && data.token) {
          authenticateClient(client, data.token);
        }
        break;

      default:
        star.logger?.info(`Received message from client ${client.id}: ${JSON.stringify(message)}`);
        break;
    }
  };

  const setupEventListeners = () => {
    eventListeners.forEach((listener, event) => {
      star.localBus?.off(event, listener);
    });
    eventListeners.clear();

    const metricsListener = (list: any) => {
      broadcastToChannel('metrics', {
        type: 'metrics',
        data: list,
        timestamp: Date.now(),
      });
    };
    star.localBus?.on('$metrics.snapshot', metricsListener);
    eventListeners.set('$metrics.snapshot', metricsListener);

    const topologySnapshotListener = (payload: any) => {
      broadcastToChannel('topology', {
        type: 'topology_snapshot',
        data: payload,
        timestamp: Date.now(),
      });
    };
    star.localBus?.on('$topology.snapshot', topologySnapshotListener);
    eventListeners.set('$topology.snapshot', topologySnapshotListener);

    const topologyDeltaListener = (payload: any) => {
      broadcastToChannel('topology', {
        type: 'topology_delta',
        data: payload,
        timestamp: Date.now(),
      });
    };
    star.localBus?.on('$topology.delta', topologyDeltaListener);
    eventListeners.set('$topology.delta', topologyDeltaListener);

    const messageListener = (messageData: any) => {
      if (messageData.recipientId) {
        sendToUser(messageData.recipientId, {
          type: 'message',
          data: messageData,
          timestamp: Date.now(),
        });
      } else {
        broadcastToChannel('message', {
          type: 'message',
          data: messageData,
          timestamp: Date.now(),
        });
      }
    };
    star.localBus?.on('$message.new', messageListener);
    eventListeners.set('$message.new', messageListener);
  };

  const initWebSocketServer = () => {
    try {
      const server = createServer();

      wss = new WebSocket.Server({
        server,
        path: WS_SERVER_PATH || '/ws',
      });

      wss.on('connection', (ws, request) => {
        const parsedUrl = url.parse(request.url || '', true);
        const query = parsedUrl.query || {};

        const clientId = query.clientId as string;
        const token = query.token as string;

        if (!clientId) {
          star.logger?.warn('WebSocket connection rejected: missing clientId');
          ws.close(1008, 'Missing clientId parameter');
          return;
        }

        if (wsClients.has(clientId)) {
          const existingClient = wsClients.get(clientId);
          if (existingClient && existingClient.ws.readyState === WebSocket.OPEN) {
            existingClient.ws.close(1000, '客户端重连');
          }
          wsClients.delete(clientId);
          star.logger?.info(`Client ${clientId} reconnecting, cleaned old connection`);
        }

        const client: WebSocketClient = {
          ws,
          id: clientId,
          subscriptions: new Set(),
          isAlive: true,
          isAuthenticated: false,
          token,
        };

        wsClients.set(clientId, client);

        star.logger?.info(`WebSocket client ${clientId} connected${token ? ' with token' : ''}`);

        if (token) {
          authenticateClient(client, token);
        }

        sendToClient(client, {
          type: 'connected',
          data: {
            clientId,
            message: 'WebSocket连接成功',
            serverTime: Date.now(),
            authenticated: !!token,
          },
        });

        ws.on('message', (message) => {
          try {
            const data = JSON.parse(message.toString());
            handleClientMessage(client, data);
          } catch (error) {
            star.logger?.error(`WebSocket message parse error from ${clientId}: ${error}`);
            sendToClient(client, {
              type: 'error',
              data: {
                message: '消息格式错误',
                code: 400,
              },
            });
          }
        });

        ws.on('close', (code, reason) => {
          star.logger?.info(`WebSocket client ${clientId} disconnected: ${code} ${reason}`);
          handleClientDisconnect(clientId);
        });

        ws.on('error', (error) => {
          star.logger?.error(`WebSocket client ${clientId} error:`, error);
          handleClientDisconnect(clientId);
        });

        ws.on('pong', () => {
          if (wsClients.has(clientId)) {
            wsClients.get(clientId)!.isAlive = true;
          }
        });
      });

      const pingInterval = setInterval(() => {
        if (wss) {
          wsClients.forEach((client, id) => {
            if (!client.isAlive) {
              client.ws.terminate();
              wsClients.delete(id);
              star.logger?.info(`WebSocket client ${id} terminated due to inactivity`);
              return;
            }

            client.isAlive = false;
            client.ws.ping();
          });
        } else {
          clearInterval(pingInterval);
        }
      }, 30000);

      server.listen(Number(WS_SERVER_PORT || 8090), '0.0.0.0', () => {
        star.logger?.info('WebSocket server started on port 8090');
      });

      setupEventListeners();
    } catch (error) {
      star.logger?.error('Failed to initialize WebSocket server:', error);
    }
  };

  const cleanupWebSocket = async () => {
    wsClients.forEach((client) => {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.close();
      }
    });
    wsClients.clear();

    eventListeners.forEach((listener, event) => {
      star.localBus?.off(event, listener);
    });
    eventListeners.clear();

    if (wss) {
      wss.close();
      wss = null;
    }

    star.logger?.info('WebSocket resources cleaned up');
  };

  return { initWebSocketServer, cleanupWebSocket };
};

/**
 * 网关微服务的方法
 */
const gatewayMethods: any = (star: Star) => ({
  /**
   * token校验,判断是否是管理员，判断是否是用户
   * 1、判断token是否有效
   * 2、获取到token对应的user数据，并携带到其他服务中
   */
  async authorize(ctx: Context, token: string) {
    if (!token) {
      return Promise.reject(new UserNotLoginError());
    }

    const authorizeStartedAt = Date.now();
    try {
      const cachedAuth = authCache.get(token);
      if (cachedAuth && cachedAuth.expiresAt > Date.now()) {
        const authorizedUser = {
          ...cachedAuth.user,
          isAdmin: Boolean(cachedAuth.user?.isAdmin),
        };
        (ctx.meta as any).user = authorizedUser;
        const tenantId =
          (authorizedUser as any).tenantId ||
          (authorizedUser as any).tenantID ||
          (authorizedUser as any).tenant_id ||
          (authorizedUser as any).userId;
        if (tenantId) (ctx.meta as any).tenantId = String(tenantId);

        star.logger?.info('Gateway authorize timing', {
          userId: (authorizedUser as any).userId,
          tenantId: tenantId ? String(tenantId) : undefined,
          isAdmin: Boolean((authorizedUser as any).isAdmin),
          cacheHit: true,
          resolveTokenDurationMs: 0,
          userLookupDurationMs: 0,
          totalDurationMs: Date.now() - authorizeStartedAt,
        });
        return;
      }
      if (cachedAuth) {
        authCache.delete(token);
      }

      const resolveTokenStartedAt = Date.now();
      const user = await ctx.call('auth.resolveToken', { token });
      const resolveTokenDurationMs = Date.now() - resolveTokenStartedAt;
      if (!user) {
        return Promise.reject(new UnAuthorizedError());
      }
      if ((user as any).code === HttpResponseCode.REFRESH_TOKEN || (user as any).error) {
        return Promise.reject(new TokenExpiredError());
      }
      if (!(user as any).userId) {
        return Promise.reject(new UnAuthorizedError());
      }
      if (user && (user as any).isExpired) {
        return Promise.reject(new TokenExpiredError());
      }

      authCache.set(token, {
        user,
        expiresAt: Math.min(
          Date.now() + AUTH_CACHE_TTL_MS,
          Number((user as any).expirationTime || Date.now() + AUTH_CACHE_TTL_MS),
        ),
      });

      const authorizedUser = {
        ...user,
        isAdmin: Boolean((user as any).isAdmin),
      };
      (ctx.meta as any).user = authorizedUser;
      const tenantId =
        (authorizedUser as any).tenantId ||
        (authorizedUser as any).tenantID ||
        (authorizedUser as any).tenant_id ||
        (authorizedUser as any).userId;
      if (tenantId) (ctx.meta as any).tenantId = String(tenantId);

      star.logger?.info('Gateway authorize timing', {
        userId: (authorizedUser as any).userId,
        tenantId: tenantId ? String(tenantId) : undefined,
        isAdmin: Boolean((authorizedUser as any).isAdmin),
        cacheHit: false,
        resolveTokenDurationMs,
        userLookupDurationMs: 0,
        totalDurationMs: Date.now() - authorizeStartedAt,
      });
    } catch (err: any) {
      if (err?.code === HttpResponseCode.REFRESH_TOKEN) {
        return Promise.reject(new TokenExpiredError());
      }
      star.logger?.error('gateway_app authorize error~', 'error:', err);
      return Promise.reject(new UnAuthorizedError());
    }
  },

  async broadcastToChannel(channel: string, data: any) {
    const normalized = String(channel || '').trim();
    if (!normalized) {
      return { ok: false, channel: '' };
    }

    const message = {
      type: normalized,
      data: {
        ...data,
        timestamp: Date.now(),
      },
    };

    const sent = (this as any).broadcastToChannel?.(normalized, message) ?? 0;
    return { ok: true, channel: normalized, sent };
  },

  async triggerWebSocketEvent(eventName: string, data: any) {
    const normalized = String(eventName || '').trim();
    if (!normalized) {
      return { ok: false, eventName: '' };
    }

    star.localBus?.emit(normalized, data);
    return { ok: true, eventName: normalized };
  },
});

export { createWebSocketManager };
export default gatewayMethods;
