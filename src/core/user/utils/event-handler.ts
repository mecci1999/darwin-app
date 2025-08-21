// User微服务事件处理工具类
import { Starlight } from 'typings';
import { UserEventData, UserLoginEvent, UserStatusChangeEvent } from '../types';

class EventHandler {
  private static instance: EventHandler;
  private star: Starlight | null = null;
  private eventQueue: UserEventData[] = [];
  private processing = false;

  static getInstance(): EventHandler {
    if (!EventHandler.instance) {
      EventHandler.instance = new EventHandler();
    }
    return EventHandler.instance;
  }

  /**
   * 初始化事件处理器
   */
  initialize(star: Starlight) {
    this.star = star;
    this.startEventProcessor();
  }

  /**
   * 启动事件处理器
   */
  private startEventProcessor() {
    setInterval(() => {
      this.processEventQueue();
    }, 1000); // 每秒处理一次事件队列
  }

  /**
   * 处理事件队列
   */
  private async processEventQueue() {
    if (this.processing || this.eventQueue.length === 0) {
      return;
    }

    this.processing = true;
    const batchSize = 10;
    const events = this.eventQueue.splice(0, batchSize);

    for (const event of events) {
      try {
        await this.publishEvent(event);
      } catch (error) {
        this.star?.logger?.error('Failed to publish event:', error);
        // 重新加入队列重试
        this.eventQueue.unshift(event);
      }
    }

    this.processing = false;
  }

  /**
   * 发布事件到内部事件总线
   */
  private async publishEvent(eventData: UserEventData) {
    if (!this.star) {
      throw new Error('EventHandler not initialized');
    }

    // 使用Star实例的emit方法发布事件
    this.star.emit(eventData.eventType, {
      userId: eventData.userId,
      timestamp: eventData.timestamp,
      data: eventData.data,
      source: eventData.source,
      metadata: eventData.metadata,
    });
  }

  /**
   * 发布用户创建事件
   */
  publishUserCreated(userId: string, userData: any, source: string = 'user-service') {
    const event: UserEventData = {
      userId,
      eventType: 'user.created',
      timestamp: new Date(),
      data: userData,
      source,
      metadata: {
        action: 'create',
        service: 'user',
      },
    };
    this.eventQueue.push(event);
  }

  /**
   * 发布用户更新事件
   */
  publishUserUpdated(userId: string, updateData: any, source: string = 'user-service') {
    const event: UserEventData = {
      userId,
      eventType: 'user.updated',
      timestamp: new Date(),
      data: updateData,
      source,
      metadata: {
        action: 'update',
        service: 'user',
      },
    };
    this.eventQueue.push(event);
  }

  /**
   * 发布用户删除事件
   */
  publishUserDeleted(userId: string, source: string = 'user-service') {
    const event: UserEventData = {
      userId,
      eventType: 'user.deleted',
      timestamp: new Date(),
      data: { userId },
      source,
      metadata: {
        action: 'delete',
        service: 'user',
      },
    };
    this.eventQueue.push(event);
  }

  /**
   * 发布用户登录事件
   */
  publishUserLogin(loginEvent: UserLoginEvent) {
    const event: UserEventData = {
      userId: loginEvent.userId,
      eventType: 'user.login',
      timestamp: loginEvent.timestamp,
      data: {
        source: loginEvent.source,
        ip: loginEvent.ip,
        userAgent: loginEvent.userAgent,
        success: loginEvent.success,
        failureReason: loginEvent.failureReason,
      },
      source: 'user-service',
      metadata: {
        action: 'login',
        service: 'user',
      },
    };
    this.eventQueue.push(event);
  }

  /**
   * 发布用户登出事件
   */
  publishUserLogout(userId: string, deviceId?: string, reason?: string) {
    const event: UserEventData = {
      userId,
      eventType: 'user.logout',
      timestamp: new Date(),
      data: {
        deviceId,
        reason: reason || 'manual',
      },
      source: 'user-service',
      metadata: {
        action: 'logout',
        service: 'user',
      },
    };
    this.eventQueue.push(event);
  }

  /**
   * 发布用户状态变更事件
   */
  publishUserStatusChanged(statusChangeEvent: UserStatusChangeEvent) {
    const event: UserEventData = {
      userId: statusChangeEvent.userId,
      eventType: 'user.status.changed',
      timestamp: statusChangeEvent.timestamp,
      data: {
        oldStatus: statusChangeEvent.oldStatus,
        newStatus: statusChangeEvent.newStatus,
        reason: statusChangeEvent.reason,
        changedBy: statusChangeEvent.changedBy,
      },
      source: 'user-service',
      metadata: {
        action: 'status_change',
        service: 'user',
      },
    };
    this.eventQueue.push(event);
  }



  /**
   * 发布用户应用关联事件
   */
  publishUserApplicationAdded(userId: string, applicationId: string) {
    const event: UserEventData = {
      userId,
      eventType: 'user.application.added',
      timestamp: new Date(),
      data: { applicationId },
      source: 'user-service',
      metadata: {
        action: 'application_add',
        service: 'user',
      },
    };
    this.eventQueue.push(event);
  }

  /**
   * 发布用户应用移除事件
   */
  publishUserApplicationRemoved(userId: string, applicationId: string) {
    const event: UserEventData = {
      userId,
      eventType: 'user.application.removed',
      timestamp: new Date(),
      data: { applicationId },
      source: 'user-service',
      metadata: {
        action: 'application_remove',
        service: 'user',
      },
    };
    this.eventQueue.push(event);
  }

  /**
   * 获取事件队列状态
   */
  getQueueStatus() {
    return {
      queueLength: this.eventQueue.length,
      processing: this.processing,
    };
  }

  /**
   * 清空事件队列
   */
  clearQueue() {
    this.eventQueue = [];
  }

  /**
   * 停止事件处理器
   */
  stop() {
    this.processing = false;
    this.eventQueue = [];
  }
}

export default EventHandler;