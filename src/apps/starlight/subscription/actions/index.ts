import { Starlight } from 'typings';
import payment from './payment';
import plans from './plans';
import quota from './quota';
import subscription from './subscription';
import { instrumentServiceActions } from '../../metrics/utils/action-metrics';

/**
 * 订阅微服务的动作
 */
const subscriptionActions = (star: Starlight) => {
  const plansAction = plans(star);
  const subscriptionAction = subscription(star);
  const quotaAction = quota(star);
  const paymentAction = payment(star);

  return instrumentServiceActions(star, 'subscription', {
    ...plansAction,
    ...subscriptionAction,
    ...quotaAction,
    ...paymentAction,
  });
};

export default subscriptionActions;
