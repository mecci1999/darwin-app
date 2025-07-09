import { Context, Star } from 'node-universe';
import { ResponseCode } from 'typings/enum';
import plans from './plans';
import subscription from './subscription';
import quota from './quota';
import payment from './payment';
import billing from './billing';

/**
 * 订阅微服务的动作
 */
const subscriptionActions = (star: Star) => {
  const plansAction = plans(star);
  const subscriptionAction = subscription(star);
  const quotaAction = quota(star);
  const paymentAction = payment(star);
  const billingAction = billing(star);

  return {
    ...plansAction,
    ...subscriptionAction,
    ...quotaAction,
    ...paymentAction,
    ...billingAction,
  };
};

export default subscriptionActions;
