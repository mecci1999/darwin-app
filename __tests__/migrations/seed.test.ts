export {};

const { QueryTypes } = require('sequelize');

const query = jest.fn();
const authenticate = jest.fn();
const closeConnection = jest.fn();
const showAllTables = jest.fn();

jest.mock('../../scripts/db', () => ({
  createDatabaseConnection: () => ({
    authenticate,
    close: closeConnection,
    getQueryInterface: () => ({ showAllTables }),
    query,
  }),
}));

describe('subscription seed', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    authenticate.mockResolvedValue(undefined);
    closeConnection.mockResolvedValue(undefined);
    showAllTables.mockResolvedValue(['subscription_plans']);
    query.mockResolvedValue([]);
  });

  it('inserts the free plan with the SubscriptionPlan physical timestamp columns', async () => {
    require('../../scripts/seed');
    await new Promise(setImmediate);

    const insert = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO subscription_plans'));
    expect(insert).toBeDefined();
    expect(insert?.[0]).toContain('created_at, updated_at');
    expect(insert?.[0]).not.toContain('createdAt');
    expect(insert?.[0]).toContain('ON DUPLICATE KEY UPDATE id = id');
    expect(insert?.[1].replacements).toEqual([
      '00000000-0000-4000-8000-000000000001',
      'free',
      'Free',
      'Initial free subscription plan',
      '0.00',
      'USD',
      'monthly',
      '{}',
      '{}',
      0,
    ]);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
