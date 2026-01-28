import { Context } from 'node-universe';
import { HttpResponseCode, HttpStatusCode } from 'typings';
import { WebSocketMessageParams } from '../types';

/**
 * WebSocket处理器
 */
export class WebSocketHandler {
  /**
   * 发送WebSocket消息的通用方法
   */
  public static sendMessage(
    service: any,
    { channel, data, clientId, userId }: WebSocketMessageParams,
    messageType: string,
  ) {
    const message = {
      type: messageType,
      data: {
        ...data,
        timestamp: Date.now(),
      },
    };

    if (clientId) {
      service.sendToClient(clientId, message);
    } else if (userId) {
      service.sendToUser(userId, message);
    } else if (channel) {
      service.broadcastToChannel(channel, message);
    } else {
      service.broadcastToClients(message);
    }
  }

  /**
   * 创建WebSocket动作处理器
   */
  public static createWebSocketAction(messageType: string, successMessage: string) {
    return {
      // visibility: "published",
      timeout: 0,
      handler(ctx: Context) {
        const { channel, data, clientId, userId } = ctx.params;

        try {
          WebSocketHandler.sendMessage(this, { channel, data, clientId, userId }, messageType);
          return {
            status: HttpStatusCode.OK,
            data: {
              content: { sent: true },
              message: successMessage,
              code: HttpResponseCode.Success,
              success: true,
            },
          };
        } catch (error) {
          // 使用this.logger而不是ctx.broker.logger
          (this as any).logger?.error(`Failed to send ${messageType}:`, error);
          return {
            status: HttpStatusCode.INTERNAL_SERVER_ERROR,
            data: {
              content: { sent: false },
              message: `Failed to send ${messageType}`,
              code: HttpResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        }
      },
    };
  }
}
