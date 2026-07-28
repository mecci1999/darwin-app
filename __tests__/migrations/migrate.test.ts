const migrationDefinitions = require('../../scripts/migrations');
const migrationRunner = require('../../scripts/migrate');

const createSequelize = () => {
  const events: string[] = [];
  const appliedIds: string[] = [];
  const queryInterface = {
    showAllTables: jest.fn(async () => ['app_migrations']),
    createTable: jest.fn(),
  };
  const sequelize = {
    getQueryInterface: () => queryInterface,
    query: jest.fn(async (sql: string, options?: { replacements?: string[] }) => {
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
      if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }]];
      if (sql.startsWith('SELECT id')) return [appliedIds.map(id => ({ id }))];
      if (sql.startsWith('INSERT INTO app_migrations')) {
        events.push('ledger');
        appliedIds.push(options?.replacements?.[0] || '');
      }
      return [[]];
    }),
    transaction: jest.fn(async (callback: (transaction: string) => Promise<void>) => {
      events.push('transaction-start');
      await callback('transaction');
      events.push('transaction-commit');
    }),
  };

  return { appliedIds, events, queryInterface, sequelize };
};

describe('migration runner', () => {
  const originalMigrations = [...migrationDefinitions.migrations];

  afterEach(() => {
    migrationDefinitions.migrations.splice(0, migrationDefinitions.migrations.length, ...originalMigrations);
  });

  it('records a transactional migration in the same transaction after its schema work', async () => {
    const { appliedIds, events, sequelize } = createSequelize();
    migrationDefinitions.migrations.splice(0, migrationDefinitions.migrations.length, {
      id: 'test-transactional-migration',
      transactional: true,
      up: async ({ transaction }: { transaction: string }) => {
        expect(transaction).toBe('transaction');
        events.push('schema');
      },
    });

    await migrationRunner.runMigrations(sequelize);

    expect(events).toEqual(['transaction-start', 'schema', 'ledger', 'transaction-commit']);
    expect(appliedIds).toEqual(['test-transactional-migration']);
  });

  it('does not record a failed migration and always releases the exclusive lock', async () => {
    const { appliedIds, sequelize } = createSequelize();
    migrationDefinitions.migrations.splice(0, migrationDefinitions.migrations.length, {
      id: 'test-failing-migration',
      transactional: true,
      up: async () => {
        throw new Error('schema step failed');
      },
    });

    await expect(migrationRunner.runMigrations(sequelize)).rejects.toThrow('schema step failed');

    expect(appliedIds).toEqual([]);
    expect(sequelize.query).toHaveBeenCalledWith('SELECT RELEASE_LOCK(?)', {
      replacements: ['darwin-app-schema-migrations'],
    });
  });
});
