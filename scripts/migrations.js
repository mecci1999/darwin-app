const path = require('path');

const BASELINE_MIGRATION_ID = '001-initial-model-baseline';
const ADMIN_BOOTSTRAP_LOCK_MIGRATION_ID = '002-admin-bootstrap-lock';

const getProductionModels = sequelize => {
  const distRoot = path.join(__dirname, '..', 'dist');
  const sourceRoot = path.join(__dirname, '..', 'src');
  const root = require('fs').existsSync(distRoot) ? distRoot : sourceRoot;
  if (root === sourceRoot) {
    require('ts-node/register');
    require('tsconfig-paths/register');
  }

  const { DataBaseTableNames } = require(path.join(root, 'typings'));
  const initializeModels = require(path.join(root, 'db', 'mysql', 'models')).default;
  const modelKeys = Object.values(DataBaseTableNames);

  initializeModels(sequelize, modelKeys);

  const missingModels = modelKeys.filter(modelKey => !sequelize.models[modelKey]);
  if (missingModels.length > 0) {
    throw new Error(`Production model registry is incomplete: ${missingModels.join(', ')}`);
  }

  return modelKeys.map(modelKey => sequelize.models[modelKey]);
};

const getModelTableNames = models =>
  models.map(model => {
    const tableName = model.getTableName();
    return typeof tableName === 'string' ? tableName : tableName.tableName;
  });

const tableSet = tables => new Set(tables.map(table => String(table).toLowerCase()));

const migrations = [
  {
    id: BASELINE_MIGRATION_ID,
    transactional: false,
    async up({ sequelize, existingTables }) {
      const models = getProductionModels(sequelize);
      const expectedTables = getModelTableNames(models);
      const nonLedgerTables = existingTables.filter(table => String(table).toLowerCase() !== 'app_migrations');

      if (nonLedgerTables.length > 0) {
        throw new Error(
          `Initial baseline requires an empty database; found existing tables: ${nonLedgerTables.join(', ')}`,
        );
      }

      await sequelize.sync({ force: false, alter: false });

      const createdTables = tableSet(await sequelize.getQueryInterface().showAllTables());
      const missingTables = expectedTables.filter(table => !createdTables.has(table.toLowerCase()));
      if (missingTables.length > 0) {
        throw new Error(`Initial baseline did not create required tables: ${missingTables.join(', ')}`);
      }
    },
  },
  {
    id: ADMIN_BOOTSTRAP_LOCK_MIGRATION_ID,
    // MySQL implicitly commits DDL, so this migration must be retryable rather than transactional.
    transactional: false,
    async up({ sequelize, queryInterface }) {
      const existingTables = await queryInterface.showAllTables();
      if (!existingTables.some(table => String(table).toLowerCase() === 'adminbootstraplock')) {
        await queryInterface.createTable(
          'adminBootstrapLock',
          {
            lock_id: {
              type: require('sequelize').DataTypes.TINYINT,
              allowNull: false,
              primaryKey: true,
            },
          },
        );
      }
      await sequelize.query(
        'INSERT IGNORE INTO adminBootstrapLock (lock_id) VALUES (?)',
        { replacements: [1] },
      );
    },
  },
];

module.exports = {
  ADMIN_BOOTSTRAP_LOCK_MIGRATION_ID,
  BASELINE_MIGRATION_ID,
  getModelTableNames,
  getProductionModels,
  migrations,
};
