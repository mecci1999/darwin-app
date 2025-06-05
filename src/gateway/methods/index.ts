import { TokenExpiredError, UnAuthorizedError, UserNotLoginError } from 'error';
import { createServer } from 'http';
import { Context, Star } from 'node-universe';
import { ResponseCode } from 'typings/enum';
import WebSocket from 'ws';
import url from 'url';
import { WS_SERVER_PATH, WS_SERVER_PORT } from 'config';

// WebSocket 相关变量
let wss: WebSocket.Server | null = null;
let wsClients = new Map<string, WebSocketClient>();
let eventListeners: Map<string, (data: any) => void> = new Map();

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

/**
 * 网关微服务的方法
 */
const gatewayMethods = (star: Star) => {
  return {
    /**
     * token校验,判断是否是管理员，判断是否是用户
     * 1、判断token是否有效
     * 2、获取到token对应的user数据，并携带到其他服务中
     */
    async authorize(ctx: Context, token: string) {
      if (!token) {
        return Promise.reject(new UserNotLoginError());
      }

      // Verify JWT token
      return await ctx
        .call('auth.resolveToken', { token })
        .then((user) => {
          if (!user) {
            return Promise.reject(new UnAuthorizedError());
          } else {
            if (user && user.isExpired) {
              // token过期续签
              return Promise.reject(new TokenExpiredError());
            }
            (ctx.meta as any).user = user;
          }
        })
        .catch((err) => {
          if (err.code === ResponseCode.REFRESH_TOKEN) {
            return Promise.reject(new TokenExpiredError());
          }
          star.logger?.error('gateway_app authorize error~', 'error:', err);
          return Promise.reject(new UnAuthorizedError());
        });
    },

    /**
     * 初始化 WebSocket 服务器
     */
    initWebSocketServer() {
      try {
        // 创建独立的 HTTP 服务器用于 WebSocket
        const server = createServer();

        // 创建 WebSocket 服务器
        wss = new WebSocket.Server({
          server,
          path: WS_SERVER_PATH || '/ws',
        });

        // 处理 WebSocket 连接
        wss.on('connection', (ws, request) => {
          const parsedUrl = url.parse(request.url || '', true);
          const query = parsedUrl.query || {};

          // 从URL参数中获取clientId和token
          const clientId = query.clientId as string;
          const token = query.token as string;

          // 验证clientId是否存在
          if (!clientId) {
            star.logger?.warn('WebSocket connection rejected: missing clientId');
            ws.close(1008, 'Missing clientId parameter');
            return;
          }

          // 检查客户端ID是否已存在，如果存在则清理旧连接（支持重连）
          if (wsClients.has(clientId)) {
            const existingClient = wsClients.get(clientId);
            if (existingClient && existingClient.ws.readyState === WebSocket.OPEN) {
              existingClient.ws.close(1000, '客户端重连');
            }
            wsClients.delete(clientId);
            star.logger?.info(`Client ${clientId} reconnecting, cleaned old connection`);
          }

          // 创建客户端对象
          const client: WebSocketClient = {
            ws,
            id: clientId,
            subscriptions: new Set(),
            isAlive: true,
            isAuthenticated: false,
            token: token, // 保存token用于后续验证
          };

          // 存储客户端连接
          wsClients.set(clientId, client);

          star.logger?.info(`WebSocket client ${clientId} connected${token ? ' with token' : ''}`);

          // 如果提供了token，进行认证
          if (token) {
            this.authenticateClient(client, token);
          }

          // 发送连接成功消息
          this.sendToClient(client, {
            type: 'connected',
            data: {
              clientId: clientId,
              message: 'WebSocket连接成功',
              serverTime: Date.now(),
              authenticated: !!token,
            },
          });

          // 处理客户端消息
          ws.on('message', (message) => {
            try {
              const data = JSON.parse(message.toString());
              this.handleClientMessage(client, data);
            } catch (error) {
              star.logger?.error(`WebSocket message parse error from ${clientId}: ${error}`);
              this.sendToClient(client, {
                type: 'error',
                data: {
                  message: '消息格式错误',
                  code: 400,
                },
              });
            }
          });

          // 处理连接关闭
          ws.on('close', (code, reason) => {
            star.logger?.info(`WebSocket client ${clientId} disconnected: ${code} ${reason}`);
            this.handleClientDisconnect(clientId);
          });

          // 处理连接错误
          ws.on('error', (error) => {
            star.logger?.error(`WebSocket client ${clientId} error:`, error);
            this.handleClientDisconnect(clientId);
          });

          // 处理心跳检测响应
          ws.on('pong', () => {
            if (wsClients.has(clientId)) {
              wsClients.get(clientId)!.isAlive = true;
            }
          });
        });

        // 启动心跳检测
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
        }, 30000); // 30秒心跳检测

        // 启动 WebSocket 服务器
        server.listen(Number(WS_SERVER_PORT || 8090), '0.0.0.0', () => {
          star.logger?.info('WebSocket server started on port 8090');
        });

        // 设置默认事件监听器
        this.setupEventListeners();
      } catch (error) {
        star.logger?.error('Failed to initialize WebSocket server:', error);
      }
    },

    /**
     * 认证客户端
     */
    async authenticateClient(client: WebSocketClient, token: string) {
      try {
        // 创建上下文对象
        const ctx = { meta: {} } as Context;

        // 验证令牌
        await this.authorize(ctx, token);

        // 认证成功，保存用户信息
        client.user = (ctx.meta as any).user;
        client.isAuthenticated = true;

        this.sendToClient(client, {
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
        this.sendToClient(client, {
          type: 'auth_error',
          data: { message: '认证失败', code: 401 },
        });
      }
    },

    /**
     * 处理客户端消息
     */
    handleClientMessage(client: WebSocketClient, message: any) {
      const { type, data } = message;

      switch (type) {
        case 'heartbeat':
        case 'ping':
          // 心跳检测响应
          this.sendToClient(client, {
            type: 'pong',
            data: {
              time: Date.now(),
              clientId: client.id,
            },
          });
          break;

        case 'subscribe':
          if (data && data.channel) {
            // 添加到订阅列表
            client.subscriptions.add(data.channel);
            this.sendToClient(client, {
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
            // 从订阅列表移除
            client.subscriptions.delete(data.channel);
            this.sendToClient(client, {
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
          // 重新认证
          if (data && data.token) {
            this.authenticateClient(client, data.token);
          }
          break;

        default:
          // 处理自定义消息
          star.logger?.info(
            `Received message from client ${client.id}: ${JSON.stringify(message)}`,
          );
          break;
      }
    },

    /**
     * 处理客户端断开连接
     */
    handleClientDisconnect(clientId: string) {
      if (wsClients.has(clientId)) {
        wsClients.delete(clientId);
        star.logger?.info(`WebSocket client ${clientId} disconnected`);
      }
    },

    /**
     * 设置事件监听器
     */
    setupEventListeners() {
      // 清除现有的事件监听器
      eventListeners.forEach((listener, event) => {
        star.localBus?.off(event, listener);
      });
      eventListeners.clear();

      // 设置指标数据事件监听器
      const metricsListener = (list: any) => {
        this.broadcastToChannel('metrics', {
          type: 'metrics',
          data: list,
          timestamp: Date.now(),
        });
      };
      star.localBus?.on('$metrics.snapshot', metricsListener);
      eventListeners.set('$metrics.snapshot', metricsListener);

      // // 设置二维码事件监听器
      // const qrcodeListener = (qrcodeData: any) => {
      //   this.broadcastToChannel('qrcode', {
      //     type: 'qrcode',
      //     data: qrcodeData,
      //     timestamp: Date.now(),
      //   });
      // };
      // star.localBus?.on('$qrcode.update', qrcodeListener);
      // eventListeners.set('$qrcode.update', qrcodeListener);

      // // 设置告警事件监听器
      // const alertListener = (alertData: any) => {
      //   this.broadcastToChannel('alert', {
      //     type: 'alert',
      //     data: alertData,
      //     timestamp: Date.now(),
      //   });
      // };
      // star.localBus?.on('$alert.new', alertListener);
      // eventListeners.set('$alert.new', alertListener);

      // 设置消息事件监听器
      const messageListener = (messageData: any) => {
        // 如果消息有特定接收者，则只发送给该接收者
        if (messageData.recipientId) {
          this.sendToUser(messageData.recipientId, {
            type: 'message',
            data: messageData,
            timestamp: Date.now(),
          });
        } else {
          // 否则广播到消息频道
          this.broadcastToChannel('message', {
            type: 'message',
            data: messageData,
            timestamp: Date.now(),
          });
        }
      };
      star.localBus?.on('$message.new', messageListener);
      eventListeners.set('$message.new', messageListener);
    },

    /**
     * 广播消息到特定频道
     */
    broadcastToChannel(channel: string, message: any) {
      let count = 0;
      wsClients.forEach((client) => {
        if (client.subscriptions.has(channel)) {
          if (this.sendToClient(client, message)) {
            count++;
          }
        }
      });
      star.logger?.debug(`Broadcasted message to ${count} clients on channel ${channel}`);
      return count;
    },

    /**
     * 发送消息给特定用户
     */
    sendToUser(userId: string, message: any) {
      let sent = false;
      wsClients.forEach((client) => {
        if (client.user && client.user.id === userId) {
          if (this.sendToClient(client, message)) {
            sent = true;
          }
        }
      });
      return sent;
    },

    /**
     * 发送消息给特定客户端
     */
    sendToClient(client: WebSocketClient, message: any): boolean {
      try {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(JSON.stringify(message));
          return true;
        }
      } catch (error) {
        star.logger?.error(`Failed to send message to client ${client.id}:`, error);
      }
      return false;
    },

    /**
     * 触发 WebSocket 事件
     * 这个方法可以被其他服务调用，用于触发 WebSocket 事件
     */
    triggerWebSocketEvent(eventName: string, data: any) {
      star.localBus?.emit(eventName, data);
      return { success: true, eventName, timestamp: Date.now() };
    },

    /**
     * 生成客户端ID
     */
    generateClientId(): string {
      return (
        Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
      );
    },

    /**
     * 获取 WebSocket 状态
     */
    getWebSocketStatus() {
      const channelStats: Record<string, number> = {};
      const channels = ['metrics', 'qrcode', 'alert', 'message'];

      channels.forEach((channel) => {
        channelStats[channel] = 0;
      });

      wsClients.forEach((client) => {
        client.subscriptions.forEach((channel) => {
          if (channelStats[channel] !== undefined) {
            channelStats[channel]++;
          }
        });
      });

      return {
        isRunning: wss !== null,
        clientCount: wsClients.size,
        channels: channelStats,
        eventListeners: Array.from(eventListeners.keys()),
      };
    },

    /**
     * 清理 WebSocket 资源
     */
    cleanupWebSocket() {
      // 关闭所有客户端连接
      wsClients.forEach((client) => {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.close();
        }
      });
      wsClients.clear();

      // 移除所有事件监听器
      eventListeners.forEach((listener, event) => {
        star.localBus?.off(event, listener);
      });
      eventListeners.clear();

      // 关闭 WebSocket 服务器
      if (wss) {
        wss.close();
        wss = null;
      }

      star.logger?.info('WebSocket resources cleaned up');
    },
  };
};

export default gatewayMethods;
