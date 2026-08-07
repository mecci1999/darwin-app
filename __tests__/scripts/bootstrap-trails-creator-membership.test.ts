const authenticate = jest.fn();
const closeConnection = jest.fn();
const query = jest.fn();
const transaction = jest.fn(async (callback: (transaction: string) => Promise<void>) => callback('transaction'));
const showAllTables = jest.fn(async () => ['CreatorSpaceMembership']);

jest.mock('../../scripts/db', () => ({
  createDatabaseConnection: () => ({ authenticate, close: closeConnection, query, transaction, getQueryInterface: () => ({ showAllTables }) }),
}));

const { bootstrapInput, bootstrapMembership } = require('../../scripts/bootstrap-trails-creator-membership');

const environment = process.env;
const validEnvironment = () => ({
  TRAILS_CREATOR_BOOTSTRAP_TENANT_ID: 'tenant-one',
  TRAILS_CREATOR_BOOTSTRAP_USER_ID: 'creator-one',
  TRAILS_CREATOR_BOOTSTRAP_ROLE: 'creator-space-owner',
});

describe('CreatorSpaceMembership bootstrap CLI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...environment, ...validEnvironment() };
  });

  afterAll(() => { process.env = environment; });

  it('requires explicit valid bootstrap input', () => {
    delete process.env.TRAILS_CREATOR_BOOTSTRAP_TENANT_ID;
    expect(() => bootstrapInput()).toThrow('TRAILS_CREATOR_BOOTSTRAP_TENANT_ID is required');
    process.env = { ...environment, ...validEnvironment(), TRAILS_CREATOR_BOOTSTRAP_ROLE: 'admin' };
    expect(() => bootstrapInput()).toThrow('TRAILS_CREATOR_BOOTSTRAP_ROLE must be');
  });

  it('upserts precisely the requested active owner membership after canonical user validation', async () => {
    query.mockResolvedValueOnce([{ userId: 'creator-one', tenantId: 'tenant-one', status: 'active' }]).mockResolvedValueOnce([]);
    const sequelize = { getQueryInterface: () => ({ showAllTables }), query, transaction };
    await bootstrapMembership(sequelize, bootstrapInput());
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining('ON DUPLICATE KEY UPDATE'), expect.objectContaining({ replacements: ['tenant-one', 'creator-one', 'creator-space-owner', null], transaction: 'transaction' }));
  });

  it('rejects a cross-tenant target before membership writes', async () => {
    query.mockResolvedValueOnce([{ userId: 'creator-one', tenantId: 'other-tenant', status: 'active' }]);
    const sequelize = { getQueryInterface: () => ({ showAllTables }), query, transaction };
    await expect(bootstrapMembership(sequelize, bootstrapInput())).rejects.toThrow('Target user must exist, be active, and belong');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('creates a missing validated editor owner only under the explicit allow policy', async () => {
    process.env = { ...environment, ...validEnvironment(), TRAILS_CREATOR_BOOTSTRAP_ROLE: 'creator-space-editor', TRAILS_CREATOR_BOOTSTRAP_ASSIGNED_OWNER_USER_ID: 'owner-one', TRAILS_CREATOR_BOOTSTRAP_ALLOW_OWNER_CREATE: 'true' };
    query.mockResolvedValueOnce([{ userId: 'creator-one', tenantId: 'tenant-one', status: 'active' }]).mockResolvedValueOnce([{ userId: 'owner-one', tenantId: 'tenant-one', status: 'active' }]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const sequelize = { getQueryInterface: () => ({ showAllTables }), query, transaction };
    await bootstrapMembership(sequelize, bootstrapInput());
    expect(query).toHaveBeenCalledWith(expect.stringContaining("'creator-space-owner'"), expect.objectContaining({ replacements: ['tenant-one', 'owner-one'], transaction: 'transaction' }));
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining('ON DUPLICATE KEY UPDATE'), expect.objectContaining({ replacements: ['tenant-one', 'creator-one', 'creator-space-editor', 'owner-one'], transaction: 'transaction' }));
  });
});
