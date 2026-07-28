import { Sequelize } from 'sequelize';
import initializeSubscriptionPlan from '../../src/db/mysql/models/subscription/subscriptionPlan';
import initializeUserSubscription from '../../src/db/mysql/models/subscription/userSubscription';

describe('subscription Sequelize models', () => {
  it('registers the model names used by subscription database APIs', () => {
    const sequelize = new Sequelize('database', 'user', 'password', { dialect: 'mysql', logging: false });

    initializeSubscriptionPlan(sequelize);
    initializeUserSubscription(sequelize);

    expect(sequelize.models.SubscriptionPlan.getTableName()).toBe('subscription_plans');
    expect(sequelize.models.UserSubscription.getTableName()).toBe('user_subscriptions');
  });
});
