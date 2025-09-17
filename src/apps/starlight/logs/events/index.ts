/**
 * 日志微服务事件处理器统一导出
 */
import { LogsState } from '../types';
import { createLogsEventHandlers, LogsEventHandlers } from './logs-events';
import { createTenantEventHandlers, TenantEventHandlers } from './tenant-events';

/**
 * 事件处理器管理器
 */
export class EventHandlersManager {
  private logsEventHandlers: LogsEventHandlers;
  private tenantEventHandlers: TenantEventHandlers;

  constructor(logsState: LogsState) {
    this.logsEventHandlers = createLogsEventHandlers(logsState);
    this.tenantEventHandlers = createTenantEventHandlers(logsState);
  }

  /**
   * 获取所有事件处理器
   */
  getAllEventHandlers() {
    return {
      ...this.logsEventHandlers.getEventHandlers(),
      ...this.tenantEventHandlers.getEventHandlers(),
    };
  }

  /**
   * 获取日志事件处理器
   */
  getLogsEventHandlers() {
    return this.logsEventHandlers;
  }

  /**
   * 获取租户事件处理器
   */
  getTenantEventHandlers() {
    return this.tenantEventHandlers;
  }
}

/**
 * 创建事件处理器管理器
 */
export function createEventHandlersManager(logsState: LogsState) {
  return new EventHandlersManager(logsState);
}

// 导出事件处理器类
export { LogsEventHandlers, TenantEventHandlers };
export { createLogsEventHandlers, createTenantEventHandlers };