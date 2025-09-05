/**
 * Events处理器统一导出
 * 集中管理所有事件处理逻辑
 */
import metricsEvents from './metrics';
import quotaEvents from './quota';
import tenantEvents from './tenant';
import userEvents from './user';
import subscriptionEvents from './subscription';

// 导出所有事件处理器
export default {
  ...metricsEvents,
  ...quotaEvents,
  ...tenantEvents,
  ...userEvents,
  ...subscriptionEvents,
};
