/**
 * Events处理器统一导出
 * 集中管理所有事件处理逻辑
 */
import metricsEvents from './metrics';
import quotaEvents from './quota';
import tenantEvents from './tenant';
import userEvents from './user';
import subscriptionEvents from './subscription';

export const coreEvents = {
  ...metricsEvents,
  ...quotaEvents,
};

export const lifecycleEvents = {
  ...tenantEvents,
  ...userEvents,
  ...subscriptionEvents,
};

// 保留默认导出用于旧调用方；主 metrics 服务不再直接使用全部事件集合
export default {
  ...coreEvents,
  ...lifecycleEvents,
};
