const { DataTypes } = require('sequelize');
const { createDatabaseConnection } = require('./db');
const { migrations } = require('./migrations');

const MIGRATIONS_TABLE = 'app_migrations';
const MIGRATION_LOCK = 'darwin-app-schema-migrations';

const tableExists = (tables, tableName) =>
  tables.some(table => String(table).toLowerCase() === tableName.toLowerCase());

const ensureLedger = async queryInterface => {
  const tables = await queryInterface.showAllTables();
  if (tableExists(tables, MIGRATIONS_TABLE)) return;

  await queryInterface.createTable(MIGRATIONS_TABLE, {
    id: { type: DataTypes.STRING(191), allowNull: false, primaryKey: true },
    applied_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
};

const acquireMigrationLock = async sequelize => {
  const [rows] = await sequelize.query('SELECT GET_LOCK(?, 30) AS acquired', {
    replacements: [MIGRATION_LOCK],
  });
  if (Number(rows[0]?.acquired) !== 1) {
    throw new Error('Could not acquire the migration lock; another migration job may be running');
  }
};

const releaseMigrationLock = async sequelize => {
  await sequelize.query('SELECT RELEASE_LOCK(?)', { replacements: [MIGRATION_LOCK] });
};

const getAppliedMigrationIds = async sequelize => {
  const [rows] = await sequelize.query(`SELECT id FROM ${MIGRATIONS_TABLE} ORDER BY id`);
  return new Set(rows.map(row => row.id));
};

const recordMigration = async (sequelize, migration, transaction) => {
  await sequelize.query(
    `INSERT INTO ${MIGRATIONS_TABLE} (id, applied_at) VALUES (?, CURRENT_TIMESTAMP)`,
    { replacements: [migration.id], transaction },
  );
};

const runMigrations = async sequelize => {
  const queryInterface = sequelize.getQueryInterface();
  await acquireMigrationLock(sequelize);

  try {
    await ensureLedger(queryInterface);
    const applied = await getAppliedMigrationIds(sequelize);
    for (const migration of migrations) {
      if (applied.has(migration.id)) continue;

      const existingTables = await queryInterface.showAllTables();
      if (migration.transactional) {
        await sequelize.transaction(async transaction => {
          await migration.up({ sequelize, queryInterface, transaction, existingTables });
          await recordMigration(sequelize, migration, transaction);
        });
      } else {
        await migration.up({ sequelize, queryInterface, existingTables });
        await recordMigration(sequelize, migration);
      }
      console.log(`Applied migration ${migration.id}`);
    }
  } finally {
    await releaseMigrationLock(sequelize);
  }
};

const run = async () => {
  const sequelize = createDatabaseConnection();
  try {
    await sequelize.authenticate();
    await runMigrations(sequelize);
  } finally {
    await sequelize.close();
  }
};

if (require.main === module) {
  run().catch(error => {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  });
}

module.exports = {
  MIGRATIONS_TABLE,
  acquireMigrationLock,
  ensureLedger,
  getAppliedMigrationIds,
  recordMigration,
  releaseMigrationLock,
  run,
  runMigrations,
};
