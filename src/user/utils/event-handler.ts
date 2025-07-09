// User微服务事件处理工具类
import { UserEventData, UserLoginEvent, UserStatusChangeEvent } from '../types';
import { EVENT_TYPES, KAFKA_CONFIG } from '../constants';

class EventHandler {
  private static instance: EventHandler;
  private kafkaProducer: any;
  private broker: any;
  private eventQueue: UserEventData[] = [];
  private processingTimer?: NodeJS.Timeout;

  static getInstance(): EventHandler {
    if (!EventHandler.instance) {
      EventHandler.instance = new EventHandler();
    }
    return EventHandler.instance;
  }

  /**
   * 初始化事件处理器
   */
  async initialize(kafkaProducer?: any, broker?: any): Promise<void> {
    this.kafkaProducer = kafkaProducer;
    this.broker = broker;
    
    // 启动事件处理定时器
    this.startEventProcessing();
  }

  /**
   * 启动事件处理定时器
   */
  private startEventProcessing(): void {
    this.processingTimer = setInterval(() => {
      this.processEventQueue();
    }, 1000); // 每秒处理一次事件队列
  }

  /**
   * 处理事件队列
   */
  private async processEventQueue(): Promise<void> {
    if (this.eventQueue.length === 0) return;
    
    const events = this.eventQueue.splice(0, 10); // 每次处理最多10个事件
    
    for (const event of events) {
      try {
        await this.publishEvent(event);
      } catch (error) {
        console.error('Failed to process event:', error);
        // 重新加入队列进行重试
        this.eventQueue.unshift(event);
      }
    }
  }

  /**
   * 发布事件到Kafka
   */
  private async publishEvent(event: UserEventData): Promise<void> {
    if (this.kafkaProducer) {
      try {
        await this.kafkaProducer.send({
          topic: KAFKA_CONFIG.TOPICS.USER_EVENTS,
          messages: [{
            key: event.userId,
            value: JSON.stringify(event),
            timestamp: event.timestamp.getTime().toString(),
          }],
        });
      } catch (error) {
        console.error('Failed to publish event to Kafka:', error);
        throw error;
      }
    }
    
    // 同时通过内部事件总线发布
    if (this.broker) {
      try {
        await this.broker.emit(event.eventType, event);
      } catch (error) {
        console.error('Failed to emit event through broker:', error);
      }
    }
  }

  /**
   * 发布用户创建事件
   */
  async publishUserCreated(userId: string, userData: any, source: string): Promise<void> {
    const event: UserEventData = {
      userId,
      eventType: EVENT_TYPES.USER_CREATED,
      timestamp: new Date(),
      data: {
        nickname: userData.nickname,
        source: userData.source,
        status: userData.status,
      },
      source,
      metadata: {
        version: '1.0',
        service: 'user',
      },
    };
    
    this.eventQueue.push(event);
  }

  /**
   * 发布用户更新事件
   */
  async publishUserUpdated(userId: string, oldData: any, newData: any, source: string): Promise<void> {
    const event: UserEventData = {
      userId,
      eventType: EVENT_TYPES.USER_UPDATED,
      timestamp: new Date(),
      data: {
        oldData: {
          nickname: oldData.nickname,
          status: oldData.status,
        },
        newData: {
          nickname: newData.nickname,
          status: newData.status,
        },
        changes: this.getChangedFields(oldData, newData),
      },
      source,
      metadata: {
        version: '1.0',
        service: 'user',
      },
    };
    
    this.eventQueue.push(event);
  }

  /**
   * 发布用户删除事件
   */
  async publishUserDeleted(userId: string, userData: any, source: string): Promise<void> {
    const event: UserEventData = {
      userId,
      eventType: EVENT_TYPES.USER_DELETED,
      timestamp: new Date(),
      data: {
        nickname: userData.nickname,
        deletedAt: new Date(),
        reason: 'user_request',
      },
      source,
      metadata: {
        version: '1.0',
        service: 'user',
      },
    };
    
    this.eventQueue.push(event);
  }

  /**
   * 发布用户状态变更事件
   */
  async publishUserStatusChanged(event: UserStatusChangeEvent): Promise<void> {
    const userEvent: UserEventData = {
      userId: event.userId,
      eventType: EVENT_TYPES.USER_STATUS_CHANGED,
      timestamp: event.timestamp,
      data: {
        oldStatus: event.oldStatus,
        newStatus: event.newStatus,
        reason: event.reason,
        changedBy: event.changedBy,
      },
      source: 'user-service',
      metadata: {
        version: '1.0',
        service: 'user',
      },
    };
    
    this.eventQueue.push(userEvent);
  }

  /**
   * 发布用户资料更新事件
   */
  async publishUserProfileUpdated(userId: string, profileData: any, source: string): Promise<void> {
    const event: UserEventData = {
      userId,
      eventType: EVENT_TYPES.USER_PROFILE_UPDATED,
      timestamp: new Date(),
      data: {
        nickname: profileData.nickname,
        avatar: profileData.avatar,
        bio: profileData.bio,
        preferences: profileData.preferences,
      },
      source,
      metadata: {
        version: '1.0',
        service: 'user',
      },
    };
    
    this.eventQueue.push(event);
  }

  /**
   * 发布用户登录事件
   */
  async publishUserLogin(loginEvent: UserLoginEvent): Promise<void> {
    const event: UserEventData = {
      userId: loginEvent.userId,
      eventType: EVENT_TYPES.USER_LOGIN,
      timestamp: loginEvent.timestamp,
      data: {
        source: loginEvent.source,
        ip: loginEvent.ip,
        userAgent: loginEvent.userAgent,
        success: loginEvent.success,
        failureReason: loginEvent.failureReason,
      },
      source: loginEvent.source,
      metadata: {
        version: '1.0',
        service: 'user',
      },
    };
    
    this.eventQueue.push(event);
  }

  /**
   * 发布用户登出事件
   */
  async publishUserLogout(userId: string, source: string, metadata?: any): Promise<void> {
    const event: UserEventData = {
      userId,
      eventType: EVENT_TYPES.USER_LOGOUT,
      timestamp: new Date(),
      data: {
        source,
        logoutTime: new Date(),
        sessionDuration: metadata?.sessionDuration,
      },
      source,
      metadata: {
        version: '1.0',
        service: 'user',
        ...metadata,
      },
    };
    
    this.eventQueue.push(event);
  }

  /**
   * 获取变更的字段
   */
  private getChangedFields(oldData: any, newData: any): string[] {
    const changes: string[] = [];
    const fields = ['nickname', 'avatar', 'email', 'phone', 'bio', 'status'];
    
    for (const field of fields) {
      if (oldData[field] !== newData[field]) {
        changes.push(field);
      }
    }
    
    return changes;
  }

  /**
   * 处理外部事件
   */
  async handleExternalEvent(eventType: string, data: any): Promise<void> {
    switch (eventType) {
      case 'auth.login':
        await this.handleAuthLoginEvent(data);
        break;
      case 'auth.logout':
        await this.handleAuthLogoutEvent(data);
        break;
      case 'subscription.updated':
        await this.handleSubscriptionUpdatedEvent(data);
        break;
      default:
        console.warn(`Unhandled external event type: ${eventType}`);
    }
  }

  /**
   * 处理认证登录事件
   */
  private async handleAuthLoginEvent(data: any): Promise<void> {
    const loginEvent: UserLoginEvent = {
      userId: data.userId,
      source: data.source || 'web',
      ip: data.ip,
      userAgent: data.userAgent,
      timestamp: new Date(data.timestamp),
      success: data.success,
      failureReason: data.failureReason,
    };
    
    await this.publishUserLogin(loginEvent);
  }

  /**
   * 处理认证登出事件
   */
  private async handleAuthLogoutEvent(data: any): Promise<void> {
    await this.publishUserLogout(data.userId, data.source, {
      sessionDuration: data.sessionDuration,
      ip: data.ip,
    });
  }

  /**
   * 处理订阅更新事件
   */
  private async handleSubscriptionUpdatedEvent(data: any): Promise<void> {
    // 这里可以处理订阅更新对用户状态的影响
    console.log(`User ${data.userId} subscription updated to plan: ${data.planId}`);
  }

  /**
   * 获取事件队列状态
   */
  getEventQueueStatus(): { queueSize: number; isProcessing: boolean } {
    return {
      queueSize: this.eventQueue.length,
      isProcessing: !!this.processingTimer,
    };
  }

  /**
   * 停止事件处理器
   */
  async stop(): Promise<void> {
    if (this.processingTimer) {
      clearInterval(this.processingTimer);
      this.processingTimer = undefined;
    }
    
    // 处理剩余的事件
    await this.processEventQueue();
    
    this.eventQueue = [];
    this.kafkaProducer = null;
    this.broker = null;
  }
}

export default EventHandler;