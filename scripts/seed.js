const { QueryTypes } = require('sequelize');
const { createDatabaseConnection } = require('./db');

const FREE_PLAN = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'free',
  displayName: 'Free',
  description: 'Initial free subscription plan',
  price: '0.00',
  currency: 'USD',
  billingCycle: 'monthly',
  features: JSON.stringify({}),
  limits: JSON.stringify({}),
  sortOrder: 0,
};

const run = async () => {
  const sequelize = createDatabaseConnection();
  try {
    await sequelize.authenticate();
    const tables = await sequelize.getQueryInterface().showAllTables();
    if (!tables.some(table => String(table).toLowerCase() === 'subscription_plans')) {
      throw new Error('subscription_plans does not exist; run pnpm migrate before pnpm seed');
    }

    const existing = await sequelize.query(
      'SELECT id FROM subscription_plans WHERE name = ? LIMIT 1',
      { replacements: [FREE_PLAN.name], type: QueryTypes.SELECT },
    );
    if (existing.length > 0) {
      console.log('Free plan already exists; no seed changes applied');
      return;
    }

    await sequelize.query(
      `INSERT INTO subscription_plans
        (id, name, display_name, description, price, currency, billing_cycle, features, limits, is_active, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, true, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      {
        replacements: [
          FREE_PLAN.id,
          FREE_PLAN.name,
          FREE_PLAN.displayName,
          FREE_PLAN.description,
          FREE_PLAN.price,
          FREE_PLAN.currency,
          FREE_PLAN.billingCycle,
          FREE_PLAN.features,
          FREE_PLAN.limits,
          FREE_PLAN.sortOrder,
        ],
      },
    );
    console.log('Created deterministic free subscription plan');
  } finally {
    await sequelize.close();
  }
};

run().catch(error => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});
