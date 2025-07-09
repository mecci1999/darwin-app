import { Context } from 'node-universe';
import { ResponseCode } from 'typings/enum';
import { WebSocketMessageParams } from '../types';
import { GatewayUtils } from './gateway-utils';
import { ResponseUtils } from 'utils';

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
      timeout: 0,
      handler(ctx: Context) {
        const { channel, data, clientId, userId } = ctx.params;

        try {
          WebSocketHandler.sendMessage(this, { channel, data, clientId, userId }, messageType);
          return ResponseUtils.createResponse(
            200,
            { sent: true },
            successMessage,
            ResponseCode.Success,
          );
        } catch (error) {
          // 使用this.logger而不是ctx.broker.logger
          (this as any).logger?.error(`Failed to send ${messageType}:`, error);
          return ResponseUtils.createResponse(
            500,
            { sent: false },
            `Failed to send ${messageType}`,
            ResponseCode.ServiceActionFaild,
            false,
          );
        }
      },
    };
  }
}
