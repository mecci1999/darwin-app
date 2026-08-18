const path = require('path');

const BASELINE_MIGRATION_ID = '001-initial-model-baseline';
const ADMIN_BOOTSTRAP_LOCK_MIGRATION_ID = '002-admin-bootstrap-lock';
const TRAILS_SYNC_FOUNDATION_MIGRATION_ID = '003-trails-portfolio-category-sync-foundation';
const TRAILS_CATEGORY_TENANT_IDENTITY_MIGRATION_ID = '004-trails-portfolio-category-tenant-identity';
const TRAILS_DURABLE_PORTFOLIO_MIGRATION_ID = '005-trails-durable-portfolio-v2';
const TRAILS_DURABLE_JOURNAL_MIGRATION_ID = '006-trails-durable-journal-v2';
const TRAILS_DURABLE_HIKE_MIGRATION_ID = '007-trails-durable-hike-v2';
const TRAILS_DURABLE_GEAR_MIGRATION_ID = '008-trails-durable-gear-v2';
const TRAILS_DURABLE_PACKING_PLAN_MIGRATION_ID = '009-trails-durable-packing-plan-v2';
const TRAILS_DURABLE_FINANCE_MIGRATION_ID = '010-trails-durable-finance-v2';
const TRAILS_DURABLE_FINANCE_BALANCE_SNAPSHOT_MIGRATION_ID = '011-trails-durable-finance-balance-snapshot-v2';
const TRAILS_DURABLE_PUBLIC_CATEGORY_QUERY_MIGRATION_ID = '012-trails-durable-public-category-query-v2';
const TRAILS_DURABLE_MEDIA_COMMERCE_MIGRATION_ID = '013-trails-durable-media-commerce-v2';
const TRAILS_MEDIA_ASSET_REGISTRY_MIGRATION_ID = '014-trails-media-asset-registry-v2';
const TRAILS_MEDIA_ASSET_REGISTRY_MUTATION_MIGRATION_ID = '015-trails-media-asset-registry-mutations-v2';
const TRAILS_MEDIA_ASSET_ARTIFACT_MIGRATION_ID = '016-trails-media-asset-artifacts-v2';
const TRAILS_TRUSTED_PHOTOSHOP_INGESTION_OPERATION_MIGRATION_ID = '017-trails-trusted-photoshop-ingestion-operation-v1';
const TRAILS_TRUSTED_PHOTOSHOP_STORAGE_WRITE_FENCE_MIGRATION_ID = '018-trails-trusted-photoshop-storage-write-fence-v1';
const TRAILS_DURABLE_PUBLISHING_PACKAGE_MIGRATION_ID = '019-trails-durable-publishing-package-v2';
const CREATOR_SPACE_MEMBERSHIP_MIGRATION_ID = '020-creator-space-membership-authority';
const TRAILS_RICH_DOCUMENT_MIGRATION_ID = '021-trails-rich-document-v2';
const TRAILS_PUBLIC_CONTENT_AND_COMMENTS_MIGRATION_ID = '022-trails-public-content-and-comments-v2';
const TRAILS_GUEST_COMMENT_OUTBOX_MIGRATION_ID = '023-trails-guest-comment-outbox-v2';
const TRAILS_GUEST_COMMENT_DELIVERY_LEASE_MIGRATION_ID = '024-trails-guest-comment-delivery-lease-v2';
const TRAILS_GUEST_COMMENT_NOTIFICATION_STATUS_MIGRATION_ID = '025-trails-guest-comment-notification-status-v2';
const TRAILS_DURABLE_GUIDED_TRIP_MIGRATION_ID = '026-trails-durable-guided-trip-v2';
const TRAILS_DURABLE_EXTERNAL_VIDEO_REFERENCE_MIGRATION_ID = '027-trails-durable-external-video-reference-v2';
const TRAILS_DURABLE_LOCATION_CARD_MIGRATION_ID = '028-trails-durable-location-card-v2';
const TRAILS_DURABLE_PORTFOLIO_PHOTO_TECHNICAL_METADATA_MIGRATION_ID = '029-trails-durable-portfolio-photo-technical-metadata-v2';
const TRAILS_DURABLE_ANALYTICS_MIGRATION_ID = '030-trails-durable-aggregate-analytics-v1';
const TRAILS_DURABLE_ANALYTICS_CONTENT_VISITOR_MIGRATION_ID = '031-trails-durable-analytics-content-visitors-v1';
const TRAILS_DURABLE_TRIP_REGISTRATION_MIGRATION_ID = '032-trails-durable-trip-registration-v2';
const TRAILS_DURABLE_TRIP_CAPACITY_MIGRATION_ID = '033-trails-durable-trip-capacity-v2';
const TRAILS_DURABLE_ANALYTICS_AUDIENCE_MIGRATION_ID = '034-trails-durable-analytics-audience-v1';
const TRAILS_SHOOTING_LOCATION_MIGRATION_ID = '035-trails-shooting-location-v2';
const TRAILS_CONTENT_METRICS_INDEX_MIGRATION_ID = '036-trails-content-metrics-aggregates-v1';
const TRAILS_DURABLE_JOURNAL_PINNING_MIGRATION_ID = '037-trails-durable-journal-pinning-v1';
const ALERT_DURABLE_OUTBOX_MIGRATION_ID = '038-alert-durable-outbox-v1';
const REGISTRY_MISSING_ALERTS_MIGRATION_ID = '039-registry-missing-alerts-v1';
const TRAILS_MEDIA_RENDITION_4K_MIGRATION_ID = '040-trails-media-rendition-4k-v1';
const TRAILS_PUBLIC_DERIVATIVE_PUBLICATION_JOB_MIGRATION_ID = '041-trails-public-derivative-publication-job-v1';
const TRAILS_DURABLE_EXHIBITION_THEME_MIGRATION_ID = '042-trails-durable-exhibition-theme-v1';
const TRAILS_DURABLE_PORTFOLIO_EXHIBITION_PRESENTATION_MIGRATION_ID = '043-trails-durable-portfolio-exhibition-presentation-v1';

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

const tableExists = (tables, tableName) => tables.some(table => String(table).toLowerCase() === tableName.toLowerCase());
const ensureTable = async (queryInterface, tableName, definition) => {
  if (!tableExists(await queryInterface.showAllTables(), tableName)) await queryInterface.createTable(tableName, definition);
};
const ensureIndex = async (queryInterface, tableName, fields, options) => {
  const indexes = await queryInterface.showIndex(tableName);
  if (!indexes.some(index => index.name === options.name)) await queryInterface.addIndex(tableName, fields, options);
};
const ensureColumn = async (queryInterface, tableName, columnName, definition) => {
  const columns = await queryInterface.describeTable(tableName);
  if (!Object.prototype.hasOwnProperty.call(columns, columnName)) await queryInterface.addColumn(tableName, columnName, definition);
};
const enumColumnIncludes = (column, values) => {
  if (!column || typeof column.type !== 'string') return false;
  const entries = [...column.type.matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]);
  return values.every(value => entries.includes(value));
};
const isNullableChar = (column, length) => Boolean(column && column.allowNull === true && typeof column.type === 'string' && new RegExp(`^CHAR\\(${length}\\)$`, 'i').test(column.type.replace(/\s/g, '')));

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
  {
    id: TRAILS_SYNC_FOUNDATION_MIGRATION_ID,
    // MySQL DDL implicitly commits. Each table check makes interrupted deployment retries safe.
    transactional: false,
    async up({ queryInterface, sequelize }) {
      const { DataTypes } = require('sequelize');
      await ensureTable(queryInterface, 'TrailsPortfolioCategory', {
        id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, tenant_id: { type: DataTypes.STRING(64), allowNull: false }, owner_user_id: { type: DataTypes.STRING(64), allowNull: false }, slug: { type: DataTypes.STRING(160), allowNull: false }, name_zh: { type: DataTypes.STRING(160), allowNull: false }, description: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' }, sort_order: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 }, visibility: { type: DataTypes.ENUM('public', 'private', 'unlisted'), allowNull: false }, status: { type: DataTypes.ENUM('active', 'archived'), allowNull: false }, lifecycle: { type: DataTypes.ENUM('draft', 'published', 'archived'), allowNull: false }, resource_version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsPortfolioCategory', ['tenant_id', 'owner_user_id', 'slug'], { unique: true, name: 'trails_category_owner_slug_unique' });
      await ensureIndex(queryInterface, 'TrailsPortfolioCategory', ['tenant_id', 'owner_user_id', 'sort_order', 'slug'], { name: 'trails_category_owner_sort' });
      await ensureTable(queryInterface, 'TrailsSyncChange', {
        cursor: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true }, tenant_id: { type: DataTypes.STRING(64), allowNull: false }, owner_user_id: { type: DataTypes.STRING(64), allowNull: false }, resource_type: { type: DataTypes.ENUM('portfolio-category'), allowNull: false }, resource_id: { type: DataTypes.STRING(160), allowNull: false }, operation: { type: DataTypes.ENUM('upsert'), allowNull: false }, resource_version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false }, resource_json: { type: DataTypes.TEXT('long'), allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsSyncChange', ['tenant_id', 'owner_user_id', 'cursor'], { name: 'trails_sync_owner_cursor' });
      await ensureTable(queryInterface, 'TrailsSyncMutation', {
        tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, actor_user_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, mutation_id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, fingerprint: { type: DataTypes.STRING(128), allowNull: false }, result_kind: { type: DataTypes.ENUM('applied', 'conflict'), allowNull: false }, result_json: { type: DataTypes.TEXT('long'), allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsSyncMutation', ['tenant_id', 'actor_user_id', 'mutation_id'], { unique: true, name: 'trails_sync_mutation_unique' });
    },
  },
  {
    id: TRAILS_CATEGORY_TENANT_IDENTITY_MIGRATION_ID,
    // Existing deployments may have recorded 003; repair identity through a new retry-safe migration.
    transactional: false,
    async up({ queryInterface, sequelize }) {
      if (!tableExists(await queryInterface.showAllTables(), 'TrailsPortfolioCategory')) return;
      const indexes = await queryInterface.showIndex('TrailsPortfolioCategory');
      const primary = indexes.find(index => index.primary === true || index.name === 'PRIMARY');
      const fields = primary?.fields?.map(field => field.attribute || field.name || field) || [];
      if (fields.includes('tenant_id') && fields.includes('id')) return;
      if (primary) await queryInterface.removeConstraint('TrailsPortfolioCategory', primary.name);
      await queryInterface.addConstraint('TrailsPortfolioCategory', { fields: ['tenant_id', 'id'], type: 'primary key', name: 'trails_category_tenant_id_primary' });
    },
  },
  {
    id: TRAILS_DURABLE_PORTFOLIO_MIGRATION_ID,
    // MySQL DDL implicitly commits, so every step is safe to retry after interruption.
    transactional: false,
    async up({ queryInterface, sequelize }) {
      const { DataTypes } = require('sequelize');
      await ensureTable(queryInterface, 'TrailsDurablePortfolio', {
        id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, owner_user_id: { type: DataTypes.STRING(64), allowNull: false }, title: { type: DataTypes.STRING(160), allowNull: false }, summary: { type: DataTypes.TEXT, allowNull: false }, category_id: { type: DataTypes.STRING(160), allowNull: true }, cover_media_id: { type: DataTypes.STRING(160), allowNull: true }, media_ids: { type: DataTypes.TEXT('long'), allowNull: false }, location_label: { type: DataTypes.STRING(240), allowNull: true }, visibility: { type: DataTypes.ENUM('public', 'private', 'unlisted'), allowNull: false }, lifecycle: { type: DataTypes.ENUM('draft', 'published', 'archived'), allowNull: false }, resource_version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsDurablePortfolio', ['tenant_id', 'owner_user_id', 'updated_at'], { name: 'trails_durable_portfolio_owner_updated' });
      await ensureIndex(queryInterface, 'TrailsDurablePortfolio', ['tenant_id', 'owner_user_id', 'visibility', 'lifecycle', 'updated_at'], { name: 'trails_durable_portfolio_public' });
    },
  },
  {
    id: TRAILS_DURABLE_JOURNAL_MIGRATION_ID,
    // MySQL DDL implicitly commits, so every step is safe to retry after interruption.
    transactional: false,
    async up({ queryInterface }) {
      const { DataTypes } = require('sequelize');
      await ensureTable(queryInterface, 'TrailsDurableJournal', {
        id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, owner_user_id: { type: DataTypes.STRING(64), allowNull: false }, title: { type: DataTypes.STRING(160), allowNull: false }, excerpt: { type: DataTypes.TEXT, allowNull: false }, body: { type: DataTypes.TEXT('long'), allowNull: false }, cover_media_id: { type: DataTypes.STRING(160), allowNull: true }, published_at: { type: DataTypes.DATE, allowNull: true }, visibility: { type: DataTypes.ENUM('public', 'private', 'unlisted'), allowNull: false }, lifecycle: { type: DataTypes.ENUM('draft', 'published', 'archived'), allowNull: false }, resource_version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsDurableJournal', ['tenant_id', 'owner_user_id', 'updated_at'], { name: 'trails_durable_journal_owner_updated' });
      await ensureIndex(queryInterface, 'TrailsDurableJournal', ['tenant_id', 'owner_user_id', 'visibility', 'lifecycle', 'published_at'], { name: 'trails_durable_journal_public' });
    },
  },
  {
    id: TRAILS_DURABLE_HIKE_MIGRATION_ID,
    // MySQL DDL implicitly commits, so every step is safe to retry after interruption.
    transactional: false,
    async up({ queryInterface }) {
      const { DataTypes } = require('sequelize');
      await ensureTable(queryInterface, 'TrailsDurableHike', {
        id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, owner_user_id: { type: DataTypes.STRING(64), allowNull: false }, title: { type: DataTypes.STRING(160), allowNull: false }, started_at: { type: DataTypes.DATE, allowNull: false }, distance_km: { type: DataTypes.DECIMAL(12, 3), allowNull: true }, elevation_gain_m: { type: DataTypes.DECIMAL(12, 3), allowNull: true }, route_provider: { type: DataTypes.STRING(160), allowNull: false }, route_external_id: { type: DataTypes.STRING(160), allowNull: false }, route_label: { type: DataTypes.STRING(240), allowNull: false }, private_geometry: { type: DataTypes.TEXT('long'), allowNull: true }, visibility: { type: DataTypes.ENUM('private'), allowNull: false }, lifecycle: { type: DataTypes.ENUM('draft'), allowNull: false }, resource_version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsDurableHike', ['tenant_id', 'owner_user_id', 'updated_at'], { name: 'trails_durable_hike_owner_updated' });
    },
  },
  {
    id: TRAILS_DURABLE_GEAR_MIGRATION_ID,
    // MySQL DDL implicitly commits, so every step is safe to retry after interruption.
    transactional: false,
    async up({ queryInterface }) {
      const { DataTypes } = require('sequelize');
      await ensureTable(queryInterface, 'TrailsDurableGear', {
        id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, owner_user_id: { type: DataTypes.STRING(64), allowNull: false }, name: { type: DataTypes.STRING(160), allowNull: false }, weight_grams: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false }, quantity: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false }, active: { type: DataTypes.BOOLEAN, allowNull: false }, visibility: { type: DataTypes.ENUM('private'), allowNull: false }, lifecycle: { type: DataTypes.ENUM('draft'), allowNull: false }, resource_version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsDurableGear', ['tenant_id', 'owner_user_id', 'updated_at'], { name: 'trails_durable_gear_owner_updated' });
    },
  },
  {
    id: TRAILS_DURABLE_PACKING_PLAN_MIGRATION_ID,
    // MySQL DDL implicitly commits, so every table and index operation must be retry-safe.
    transactional: false,
    async up({ queryInterface }) {
      const { DataTypes } = require('sequelize');
      await ensureTable(queryInterface, 'TrailsDurablePackingPlan', {
        id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, owner_user_id: { type: DataTypes.STRING(64), allowNull: false }, name: { type: DataTypes.STRING(160), allowNull: false }, visibility: { type: DataTypes.ENUM('private'), allowNull: false }, lifecycle: { type: DataTypes.ENUM('draft'), allowNull: false }, resource_version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsDurablePackingPlan', ['tenant_id', 'owner_user_id', 'updated_at'], { name: 'trails_durable_packing_plan_owner_updated' });
      await ensureTable(queryInterface, 'TrailsDurablePackingPlanItem', {
        tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, plan_id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, gear_id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, snapshot_weight_grams: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false }, sort_order: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsDurablePackingPlanItem', ['tenant_id', 'plan_id', 'sort_order'], { name: 'trails_durable_packing_plan_item_order' });
    },
  },
  {
    id: TRAILS_DURABLE_FINANCE_MIGRATION_ID,
    // Retention disposal needs nullable payload columns so the redaction is irreversible in-place.
    transactional: false,
    async up({ queryInterface }) {
      const { DataTypes } = require('sequelize');
      await ensureTable(queryInterface, 'TrailsDurableFinance', {
        id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, owner_user_id: { type: DataTypes.STRING(64), allowNull: false }, occurred_on: { type: DataTypes.DATEONLY, allowNull: true }, category: { type: DataTypes.STRING(160), allowNull: true }, amount_cents: { type: DataTypes.BIGINT, allowNull: true }, currency: { type: DataTypes.STRING(3), allowNull: true }, calendar_financial_year: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false }, retention_expires_at: { type: DataTypes.DATE, allowNull: false }, disposed_at: { type: DataTypes.DATE, allowNull: true }, visibility: { type: DataTypes.ENUM('private'), allowNull: false }, lifecycle: { type: DataTypes.ENUM('draft'), allowNull: false }, resource_version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsDurableFinance', ['tenant_id', 'owner_user_id', 'retention_expires_at'], { name: 'trails_durable_finance_owner_expiry' });
      await ensureTable(queryInterface, 'TrailsDurableFinanceDeletionAudit', {
        event_id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, event_type: { type: DataTypes.ENUM('retention-disposal'), allowNull: false }, scope_digest: { type: DataTypes.STRING(128), allowNull: false }, policy_version: { type: DataTypes.STRING(64), allowNull: false }, eligible_at: { type: DataTypes.DATE, allowNull: false }, executed_at: { type: DataTypes.DATE, allowNull: false }, outcome: { type: DataTypes.ENUM('disposed', 'nothing-eligible'), allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsDurableFinanceDeletionAudit', ['scope_digest', 'executed_at'], { name: 'trails_durable_finance_audit_scope_executed' });
    },
  },
  {
    id: TRAILS_DURABLE_FINANCE_BALANCE_SNAPSHOT_MIGRATION_ID,
    // Payload columns are nullable so ten-year retention disposal can irreversibly redact them in place.
    transactional: false,
    async up({ queryInterface }) {
      const { DataTypes } = require('sequelize');
      await ensureTable(queryInterface, 'TrailsDurableFinanceBalanceSnapshot', {
        id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, owner_user_id: { type: DataTypes.STRING(64), allowNull: false }, observed_at: { type: DataTypes.DATE, allowNull: true }, balance_cents: { type: DataTypes.BIGINT, allowNull: true }, currency: { type: DataTypes.STRING(3), allowNull: true }, calendar_financial_year: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false }, retention_expires_at: { type: DataTypes.DATE, allowNull: false }, disposed_at: { type: DataTypes.DATE, allowNull: true }, visibility: { type: DataTypes.ENUM('private'), allowNull: false }, lifecycle: { type: DataTypes.ENUM('draft'), allowNull: false }, resource_version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsDurableFinanceBalanceSnapshot', ['tenant_id', 'owner_user_id', 'currency', 'observed_at'], { name: 'trails_durable_finance_balance_owner_current' });
      await ensureIndex(queryInterface, 'TrailsDurableFinanceBalanceSnapshot', ['tenant_id', 'owner_user_id', 'retention_expires_at'], { name: 'trails_durable_finance_balance_owner_expiry' });
    },
  },
  {
    id: TRAILS_DURABLE_PUBLIC_CATEGORY_QUERY_MIGRATION_ID,
    transactional: false,
    async up({ queryInterface }) {
      if (!tableExists(await queryInterface.showAllTables(), 'TrailsPortfolioCategory') || !tableExists(await queryInterface.showAllTables(), 'TrailsDurablePortfolio')) return;
      await ensureIndex(queryInterface, 'TrailsPortfolioCategory', ['tenant_id', 'owner_user_id', 'visibility', 'status', 'lifecycle', 'sort_order', 'slug'], { name: 'trails_category_public_order' });
      await ensureIndex(queryInterface, 'TrailsDurablePortfolio', ['tenant_id', 'owner_user_id', 'category_id', 'visibility', 'lifecycle', 'updated_at'], { name: 'trails_durable_portfolio_public_category' });
    },
  },
  {
    id: TRAILS_DURABLE_MEDIA_COMMERCE_MIGRATION_ID,
    transactional: false,
    async up({ queryInterface }) {
      const { DataTypes } = require('sequelize');
      await ensureTable(queryInterface, 'TrailsDurableMediaCommerce', {
        tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, owner_user_id: { type: DataTypes.STRING(64), allowNull: false }, record_type: { type: DataTypes.STRING(48), allowNull: false }, buyer_user_id: { type: DataTypes.STRING(64), allowNull: true }, status: { type: DataTypes.STRING(32), allowNull: false }, resource_version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false }, payload_json: { type: DataTypes.TEXT('long'), allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsDurableMediaCommerce', ['tenant_id', 'owner_user_id', 'record_type', 'status'], { name: 'trails_commerce_owner_type_status' });
      await ensureIndex(queryInterface, 'TrailsDurableMediaCommerce', ['tenant_id', 'buyer_user_id', 'record_type'], { name: 'trails_commerce_buyer_type' });
      await ensureTable(queryInterface, 'TrailsDurableMediaCommerceMutation', {
        tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, actor_user_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, mutation_id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, fingerprint: { type: DataTypes.STRING(128), allowNull: false }, result_json: { type: DataTypes.TEXT('long'), allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
    },
  },
  {
    id: TRAILS_MEDIA_ASSET_REGISTRY_MIGRATION_ID,
    transactional: false,
    async up({ queryInterface }) {
      const { DataTypes } = require('sequelize');
      await ensureTable(queryInterface, 'TrailsMediaAssetRegistry', {
        tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, owner_user_id: { type: DataTypes.STRING(64), allowNull: false }, mime_type: { type: DataTypes.STRING(160), allowNull: false }, private_master_locator: { type: DataTypes.STRING(512), allowNull: false }, status: { type: DataTypes.ENUM('draft', 'published'), allowNull: false }, resource_version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsMediaAssetRegistry', ['tenant_id', 'owner_user_id', 'status'], { name: 'trails_media_asset_owner_status' });
      await ensureTable(queryInterface, 'TrailsMediaAssetVariant', {
        tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, asset_id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, name: { type: DataTypes.ENUM('grid-960', 'cover-2048', 'preview-4096'), allowNull: false, primaryKey: true }, public_reference: { type: DataTypes.STRING(160), allowNull: false }, width: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false }, height: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false }, state: { type: DataTypes.ENUM('ready'), allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
    },
  },
  {
    id: TRAILS_MEDIA_ASSET_REGISTRY_MUTATION_MIGRATION_ID,
    transactional: false,
    async up({ queryInterface }) {
      const { DataTypes } = require('sequelize');
      await ensureTable(queryInterface, 'TrailsMediaAssetRegistryMutation', {
        tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, actor_user_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, mutation_id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, fingerprint: { type: DataTypes.STRING(128), allowNull: false }, result_json: { type: DataTypes.TEXT('long'), allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
    },
  },
  {
    id: TRAILS_MEDIA_ASSET_ARTIFACT_MIGRATION_ID,
    // MySQL DDL implicitly commits, so table and index checks make retries safe.
    transactional: false,
    async up({ queryInterface }) {
      const { DataTypes } = require('sequelize');
      await ensureTable(queryInterface, 'TrailsMediaAssetArtifact', {
        tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, asset_id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, logical_rendition: { type: DataTypes.ENUM('grid-960', 'cover-2048', 'preview-4096'), allowNull: false, primaryKey: true }, codec: { type: DataTypes.ENUM('avif', 'webp', 'jpeg'), allowNull: false, primaryKey: true }, private_locator: { type: DataTypes.STRING(512), allowNull: false }, mime_type: { type: DataTypes.ENUM('image/avif', 'image/webp', 'image/jpeg'), allowNull: false }, width: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false }, height: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false }, byte_length: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false }, sha256: { type: DataTypes.CHAR(64), allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsMediaAssetArtifact', ['tenant_id', 'asset_id'], { name: 'trails_media_artifact_asset' });
    },
  },
  {
    id: TRAILS_TRUSTED_PHOTOSHOP_INGESTION_OPERATION_MIGRATION_ID,
    transactional: false,
    async up({ queryInterface }) {
      const { DataTypes } = require('sequelize');
      await ensureTable(queryInterface, 'TrailsTrustedPhotoshopIngestionOperation', {
        tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, operation_id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, owner_user_id: { type: DataTypes.STRING(64), allowNull: false }, asset_id: { type: DataTypes.STRING(160), allowNull: false }, asset_fingerprint: { type: DataTypes.CHAR(64), allowNull: false }, intent_digest: { type: DataTypes.CHAR(64), allowNull: false }, register_mutation_id: { type: DataTypes.STRING(160), allowNull: false }, artifact_mutation_id: { type: DataTypes.STRING(160), allowNull: false }, phase: { type: DataTypes.ENUM('prepared', 'storage_pending', 'storage_recorded', 'registry_master_pending', 'registry_master_recorded', 'registry_artifacts_pending', 'completed', 'blocked_ambiguous', 'cleanup_pending', 'cleaned', 'failed'), allowNull: false }, resource_version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false }, prepared_at: { type: DataTypes.DATE, allowNull: true }, storage_pending_at: { type: DataTypes.DATE, allowNull: true }, storage_recorded_at: { type: DataTypes.DATE, allowNull: true }, registry_master_pending_at: { type: DataTypes.DATE, allowNull: true }, registry_master_recorded_at: { type: DataTypes.DATE, allowNull: true }, registry_artifacts_pending_at: { type: DataTypes.DATE, allowNull: true }, completed_at: { type: DataTypes.DATE, allowNull: true }, blocked_ambiguous_at: { type: DataTypes.DATE, allowNull: true }, cleanup_pending_at: { type: DataTypes.DATE, allowNull: true }, cleaned_at: { type: DataTypes.DATE, allowNull: true }, failed_at: { type: DataTypes.DATE, allowNull: true }, lease_owner: { type: DataTypes.STRING(160), allowNull: true }, lease_expires_at: { type: DataTypes.DATE, allowNull: true }, failure_class: { type: DataTypes.ENUM('validation', 'storage', 'registry', 'cleanup', 'internal'), allowNull: true }, master_locator: { type: DataTypes.STRING(512), allowNull: true }, master_mime_type: { type: DataTypes.STRING(160), allowNull: false }, master_byte_length: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false }, master_sha256: { type: DataTypes.CHAR(64), allowNull: false }, registry_master_version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true }, registry_artifacts_version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsTrustedPhotoshopIngestionOperation', ['tenant_id', 'phase', 'lease_expires_at'], { name: 'trails_photoshop_ingestion_claim' });
      await ensureTable(queryInterface, 'TrailsTrustedPhotoshopIngestionArtifact', {
        tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, operation_id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, logical_rendition: { type: DataTypes.ENUM('grid-960', 'cover-2048', 'preview-4096'), allowNull: false, primaryKey: true }, codec: { type: DataTypes.ENUM('avif', 'webp', 'jpeg'), allowNull: false, primaryKey: true }, mime_type: { type: DataTypes.ENUM('image/avif', 'image/webp', 'image/jpeg'), allowNull: false }, width: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false }, height: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false }, byte_length: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false }, sha256: { type: DataTypes.CHAR(64), allowNull: false }, locator: { type: DataTypes.STRING(512), allowNull: true }, write_state: { type: DataTypes.ENUM('pending', 'recorded'), allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsTrustedPhotoshopIngestionArtifact', ['tenant_id', 'operation_id'], { name: 'trails_photoshop_ingestion_artifacts' });
    },
  },
  {
    id: TRAILS_TRUSTED_PHOTOSHOP_STORAGE_WRITE_FENCE_MIGRATION_ID,
    // MySQL DDL implicitly commits, so independently idempotent steps are required.
    transactional: false,
    async up({ queryInterface }) {
      const { DataTypes } = require('sequelize');
      await ensureTable(queryInterface, 'TrailsTrustedPhotoshopStorageWriteFence', {
        tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, operation_id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, slot: { type: DataTypes.ENUM('master', 'grid-960:avif', 'grid-960:webp', 'grid-960:jpeg', 'cover-2048:avif', 'cover-2048:webp', 'cover-2048:jpeg', 'preview-4096:avif', 'preview-4096:webp', 'preview-4096:jpeg'), allowNull: false, primaryKey: true }, intent_digest: { type: DataTypes.CHAR(64), allowNull: false }, object_identity: { type: DataTypes.CHAR(64), allowNull: false }, mime_type: { type: DataTypes.STRING(160), allowNull: false }, byte_length: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false }, sha256: { type: DataTypes.CHAR(64), allowNull: false }, state: { type: DataTypes.ENUM('pending', 'issued', 'recorded'), allowNull: false }, fence_token: { type: DataTypes.CHAR(64), allowNull: true }, issued_at: { type: DataTypes.DATE, allowNull: true }, recorded_at: { type: DataTypes.DATE, allowNull: true }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsTrustedPhotoshopStorageWriteFence', ['tenant_id', 'operation_id'], { name: 'trails_photoshop_storage_fence_operation' });
    },
  },
  {
    id: TRAILS_DURABLE_PUBLISHING_PACKAGE_MIGRATION_ID,
    // MySQL DDL implicitly commits; every table/index operation remains retry-safe.
    transactional: false,
    async up({ queryInterface }) {
      const { DataTypes } = require('sequelize');
      await ensureTable(queryInterface, 'TrailsDurablePublishingPackage', {
        tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, owner_user_id: { type: DataTypes.STRING(64), allowNull: false }, platform: { type: DataTypes.STRING(80), allowNull: false }, status: { type: DataTypes.ENUM('draft', 'prepared', 'reviewed', 'approved', 'ready_manual_handoff', 'manually_published', 'measured', 'learned'), allowNull: false }, resource_version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false }, payload_json: { type: DataTypes.TEXT('long'), allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsDurablePublishingPackage', ['tenant_id', 'owner_user_id', 'updated_at'], { name: 'trails_durable_publishing_package_owner_updated' });
      await ensureTable(queryInterface, 'TrailsDurablePublishingPackageMutation', {
        tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, actor_user_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, mutation_id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, fingerprint: { type: DataTypes.CHAR(64), allowNull: false }, result_json: { type: DataTypes.TEXT('long'), allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureTable(queryInterface, 'TrailsDurablePublishingPackageAudit', {
        event_id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, tenant_id: { type: DataTypes.STRING(64), allowNull: false }, package_id: { type: DataTypes.STRING(160), allowNull: false }, actor_user_id: { type: DataTypes.STRING(64), allowNull: false }, owner_user_id: { type: DataTypes.STRING(64), allowNull: false }, mutation_id: { type: DataTypes.STRING(160), allowNull: false }, operation: { type: DataTypes.ENUM('create', 'transition', 'measure', 'learn'), allowNull: false }, from_status: { type: DataTypes.STRING(48), allowNull: true }, to_status: { type: DataTypes.STRING(48), allowNull: false }, resource_version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false }, occurred_at: { type: DataTypes.DATE, allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsDurablePublishingPackageAudit', ['tenant_id', 'package_id', 'occurred_at'], { name: 'trails_durable_publishing_package_audit_package_time' });
    },
  },
  {
    id: CREATOR_SPACE_MEMBERSHIP_MIGRATION_ID,
    // MySQL DDL implicitly commits; checks make a retried deploy safe.
    transactional: false,
    async up({ queryInterface }) {
      const { DataTypes } = require('sequelize');
      await ensureTable(queryInterface, 'CreatorSpaceMembership', {
        tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
        user_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
        role: { type: DataTypes.ENUM('creator-space-owner', 'creator-space-editor', 'participant'), allowNull: false },
        assigned_owner_user_id: { type: DataTypes.STRING(64), allowNull: true },
        status: { type: DataTypes.ENUM('active', 'disabled'), allowNull: false, defaultValue: 'active' },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'CreatorSpaceMembership', ['tenant_id', 'assigned_owner_user_id'], { name: 'creator_space_membership_owner' });
    },
  },
  {
    id: TRAILS_RICH_DOCUMENT_MIGRATION_ID,
    // MySQL DDL implicitly commits; each operation remains safe to retry after interruption.
    transactional: false,
    async up({ queryInterface }) {
      const { DataTypes } = require('sequelize');
      await ensureTable(queryInterface, 'TrailsRichDocument', {
        tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, subject_type: { type: DataTypes.ENUM('portfolio', 'journal'), allowNull: false, primaryKey: true }, subject_id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, owner_user_id: { type: DataTypes.STRING(64), allowNull: false }, document_json: { type: DataTypes.TEXT('long'), allowNull: false }, revision: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false }, resource_version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsRichDocument', ['tenant_id', 'owner_user_id', 'updated_at'], { name: 'trails_rich_document_owner_updated' });
      await ensureTable(queryInterface, 'TrailsRichDocumentRevision', {
        tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, subject_type: { type: DataTypes.ENUM('portfolio', 'journal'), allowNull: false, primaryKey: true }, subject_id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, revision: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, primaryKey: true }, document_json: { type: DataTypes.TEXT('long'), allowNull: false }, created_by_user_id: { type: DataTypes.STRING(64), allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsRichDocumentRevision', ['tenant_id', 'subject_type', 'subject_id', 'revision'], { name: 'trails_rich_document_revision_lookup' });
    },
  },
  {
    id: TRAILS_PUBLIC_CONTENT_AND_COMMENTS_MIGRATION_ID,
    transactional: false,
    async up({ queryInterface }) {
      const { DataTypes } = require('sequelize');
      await ensureTable(queryInterface, 'TrailsPublicSiteContent', {
        tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, owner_user_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, status: { type: DataTypes.ENUM('draft', 'published'), allowNull: false }, content_json: { type: DataTypes.TEXT('long'), allowNull: false }, resource_version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, published_at: { type: DataTypes.DATE, allowNull: true },
      });
      await ensureIndex(queryInterface, 'TrailsPublicSiteContent', ['tenant_id', 'owner_user_id', 'status'], { name: 'trails_public_site_content_owner_status' });
      await ensureTable(queryInterface, 'TrailsGuestComment', {
        tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, owner_user_id: { type: DataTypes.STRING(64), allowNull: false }, subject_type: { type: DataTypes.ENUM('guestbook', 'portfolio', 'journal'), allowNull: false }, subject_id: { type: DataTypes.STRING(160), allowNull: true }, display_name: { type: DataTypes.STRING(120), allowNull: false }, avatar_id: { type: DataTypes.STRING(32), allowNull: false }, body: { type: DataTypes.TEXT, allowNull: false }, email_ciphertext: { type: DataTypes.TEXT, allowNull: true }, email_hash: { type: DataTypes.CHAR(64), allowNull: false }, verification_token_hash: { type: DataTypes.CHAR(64), allowNull: true }, verification_expires_at: { type: DataTypes.DATE, allowNull: true }, status: { type: DataTypes.ENUM('pending-verification', 'pending-moderation', 'approved', 'rejected', 'redacted'), allowNull: false }, resource_version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false }, verified_at: { type: DataTypes.DATE, allowNull: true }, moderated_at: { type: DataTypes.DATE, allowNull: true }, moderated_by_user_id: { type: DataTypes.STRING(64), allowNull: true }, redacted_at: { type: DataTypes.DATE, allowNull: true }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsGuestComment', ['tenant_id', 'owner_user_id', 'status', 'created_at'], { name: 'trails_guest_comment_moderation_queue' });
      await ensureIndex(queryInterface, 'TrailsGuestComment', ['tenant_id', 'owner_user_id', 'subject_type', 'subject_id', 'status', 'created_at'], { name: 'trails_guest_comment_public_subject' });
      await ensureIndex(queryInterface, 'TrailsGuestComment', ['verification_token_hash', 'verification_expires_at'], { name: 'trails_guest_comment_verification' });
      await ensureTable(queryInterface, 'TrailsGuestCommentAudit', {
        event_id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, tenant_id: { type: DataTypes.STRING(64), allowNull: false }, comment_id: { type: DataTypes.STRING(160), allowNull: false }, actor_user_id: { type: DataTypes.STRING(64), allowNull: true }, operation: { type: DataTypes.ENUM('submitted', 'verified', 'moderated', 'redacted'), allowNull: false }, from_status: { type: DataTypes.STRING(32), allowNull: true }, to_status: { type: DataTypes.STRING(32), allowNull: false }, resource_version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false }, occurred_at: { type: DataTypes.DATE, allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsGuestCommentAudit', ['tenant_id', 'comment_id', 'occurred_at'], { name: 'trails_guest_comment_audit_comment_time' });
    },
  },
  {
    id: TRAILS_GUEST_COMMENT_OUTBOX_MIGRATION_ID,
    transactional: false,
    async up({ queryInterface, sequelize }) {
      const { DataTypes } = require('sequelize');
      if (tableExists(await queryInterface.showAllTables(), 'TrailsGuestComment')) {
        const columns = await queryInterface.describeTable('TrailsGuestComment');
        if (!isNullableChar(columns.email_hash, 64)) await queryInterface.changeColumn('TrailsGuestComment', 'email_hash', { type: DataTypes.CHAR(64), allowNull: true });
        await sequelize.query('UPDATE TrailsGuestComment SET email_hash = NULL WHERE email_hash IS NOT NULL');
      }
      await ensureTable(queryInterface, 'TrailsGuestCommentNotification', {
        tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, comment_id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, encrypted_payload: { type: DataTypes.TEXT('long'), allowNull: false }, status: { type: DataTypes.ENUM('pending', 'failed', 'sent'), allowNull: false }, attempts: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 }, last_attempt_at: { type: DataTypes.DATE, allowNull: true }, sent_at: { type: DataTypes.DATE, allowNull: true }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsGuestCommentNotification', ['status', 'updated_at'], { name: 'trails_guest_comment_notification_retry' });
    },
  },
  {
    id: TRAILS_GUEST_COMMENT_DELIVERY_LEASE_MIGRATION_ID,
    transactional: false,
    async up({ queryInterface, sequelize }) {
      const { DataTypes } = require('sequelize');
      if (!tableExists(await queryInterface.showAllTables(), 'TrailsGuestCommentNotification')) return;
      await ensureColumn(queryInterface, 'TrailsGuestCommentNotification', 'delivery_id', { type: DataTypes.STRING(192), allowNull: true });
      await ensureColumn(queryInterface, 'TrailsGuestCommentNotification', 'next_attempt_at', { type: DataTypes.DATE, allowNull: true });
      await ensureColumn(queryInterface, 'TrailsGuestCommentNotification', 'lease_token', { type: DataTypes.STRING(160), allowNull: true });
      await ensureColumn(queryInterface, 'TrailsGuestCommentNotification', 'lease_expires_at', { type: DataTypes.DATE, allowNull: true });
      await sequelize.query("UPDATE TrailsGuestCommentNotification SET delivery_id = CONCAT('guest-comment-delivery_', tenant_id, '_', comment_id), next_attempt_at = created_at WHERE delivery_id IS NULL OR next_attempt_at IS NULL");
      await queryInterface.changeColumn('TrailsGuestCommentNotification', 'delivery_id', { type: DataTypes.STRING(192), allowNull: false });
      await queryInterface.changeColumn('TrailsGuestCommentNotification', 'next_attempt_at', { type: DataTypes.DATE, allowNull: false });
      await ensureIndex(queryInterface, 'TrailsGuestCommentNotification', ['status', 'next_attempt_at', 'lease_expires_at'], { name: 'trails_guest_comment_notification_claim' });
    },
  },
  {
    // Deployments that already recorded 024 need an incremental enum repair; MySQL DDL is retried safely by inspecting the column first.
    id: TRAILS_GUEST_COMMENT_NOTIFICATION_STATUS_MIGRATION_ID,
    transactional: false,
    async up({ queryInterface }) {
      const { DataTypes } = require('sequelize');
      if (!tableExists(await queryInterface.showAllTables(), 'TrailsGuestCommentNotification')) return;
      const columns = await queryInterface.describeTable('TrailsGuestCommentNotification');
      if (!enumColumnIncludes(columns.status, ['pending', 'processing', 'retryable-failure', 'failed', 'sent'])) {
        await queryInterface.changeColumn('TrailsGuestCommentNotification', 'status', { type: DataTypes.ENUM('pending', 'processing', 'retryable-failure', 'failed', 'sent'), allowNull: false });
      }
    },
  },
  {
    id: TRAILS_DURABLE_LOCATION_CARD_MIGRATION_ID,
    transactional: false,
    async up({ queryInterface }) {
      const { DataTypes } = require('sequelize');
      await ensureTable(queryInterface, 'TrailsDurableLocationCard', {
        tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, owner_user_id: { type: DataTypes.STRING(64), allowNull: false }, status: { type: DataTypes.ENUM('draft', 'published', 'archived'), allowNull: false }, resource_version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false }, payload_json: { type: DataTypes.TEXT('long'), allowNull: false }, published_at: { type: DataTypes.DATE, allowNull: true }, archived_at: { type: DataTypes.DATE, allowNull: true }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsDurableLocationCard', ['tenant_id', 'owner_user_id', 'status', 'id'], { name: 'trails_location_card_owner_status' });
      await ensureTable(queryInterface, 'TrailsDurableLocationCardMutation', {
        tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, actor_user_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, mutation_id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, fingerprint: { type: DataTypes.CHAR(64), allowNull: false }, result_json: { type: DataTypes.TEXT('long'), allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsDurableLocationCardMutation', ['tenant_id', 'actor_user_id', 'mutation_id'], { unique: true, name: 'trails_location_card_mutation_unique' });
      await ensureTable(queryInterface, 'TrailsDurableLocationCardAudit', {
        event_id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, tenant_id: { type: DataTypes.STRING(64), allowNull: false }, location_card_id: { type: DataTypes.STRING(160), allowNull: false }, actor_user_id: { type: DataTypes.STRING(64), allowNull: false }, owner_user_id: { type: DataTypes.STRING(64), allowNull: false }, mutation_id: { type: DataTypes.STRING(160), allowNull: false }, operation: { type: DataTypes.ENUM('create-draft', 'update-draft', 'publish', 'unpublish', 'archive'), allowNull: false }, from_version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true }, to_version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false }, occurred_at: { type: DataTypes.DATE, allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsDurableLocationCardAudit', ['tenant_id', 'location_card_id', 'occurred_at'], { name: 'trails_location_card_audit' });
    },
  },
  {
    id: TRAILS_DURABLE_EXTERNAL_VIDEO_REFERENCE_MIGRATION_ID,
    transactional: false,
    async up({ queryInterface }) {
      const { DataTypes } = require('sequelize');
      await ensureTable(queryInterface, 'TrailsDurableExternalVideoReference', {
        tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, owner_user_id: { type: DataTypes.STRING(64), allowNull: false }, portfolio_id: { type: DataTypes.STRING(160), allowNull: false }, status: { type: DataTypes.ENUM('draft', 'published', 'archived'), allowNull: false }, sort_order: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false }, resource_version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false }, payload_json: { type: DataTypes.TEXT('long'), allowNull: false }, published_at: { type: DataTypes.DATE, allowNull: true }, archived_at: { type: DataTypes.DATE, allowNull: true }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsDurableExternalVideoReference', ['tenant_id', 'owner_user_id', 'portfolio_id', 'status', 'sort_order', 'id'], { name: 'trails_external_video_reference_owner' });
      await ensureIndex(queryInterface, 'TrailsDurableExternalVideoReference', ['tenant_id', 'owner_user_id', 'status', 'portfolio_id', 'sort_order', 'id'], { name: 'trails_external_video_reference_public' });
      await ensureTable(queryInterface, 'TrailsDurableExternalVideoReferenceMutation', {
        tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, actor_user_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, mutation_id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, fingerprint: { type: DataTypes.CHAR(64), allowNull: false }, result_json: { type: DataTypes.TEXT('long'), allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureTable(queryInterface, 'TrailsDurableExternalVideoReferenceAudit', {
        event_id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, tenant_id: { type: DataTypes.STRING(64), allowNull: false }, reference_id: { type: DataTypes.STRING(160), allowNull: false }, actor_user_id: { type: DataTypes.STRING(64), allowNull: false }, owner_user_id: { type: DataTypes.STRING(64), allowNull: false }, mutation_id: { type: DataTypes.STRING(160), allowNull: false }, operation: { type: DataTypes.ENUM('create-draft', 'update-draft', 'publish', 'unpublish', 'archive'), allowNull: false }, from_version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true }, to_version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false }, occurred_at: { type: DataTypes.DATE, allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsDurableExternalVideoReferenceAudit', ['tenant_id', 'reference_id', 'occurred_at'], { name: 'trails_external_video_reference_audit' });
    },
  },
  {
    id: TRAILS_DURABLE_GUIDED_TRIP_MIGRATION_ID,
    transactional: false,
    async up({ queryInterface }) {
      const { DataTypes } = require('sequelize');
      await ensureTable(queryInterface, 'TrailsDurableGuidedTrip', {
        tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, owner_user_id: { type: DataTypes.STRING(64), allowNull: false }, status: { type: DataTypes.ENUM('draft', 'published', 'cancelled'), allowNull: false }, starts_on: { type: DataTypes.DATEONLY, allowNull: false }, resource_version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false }, payload_json: { type: DataTypes.TEXT('long'), allowNull: false }, published_at: { type: DataTypes.DATE, allowNull: true }, cancelled_at: { type: DataTypes.DATE, allowNull: true }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsDurableGuidedTrip', ['tenant_id', 'owner_user_id', 'status', 'starts_on', 'id'], { name: 'trails_guided_trip_owner_status' });
      await ensureIndex(queryInterface, 'TrailsDurableGuidedTrip', ['tenant_id', 'owner_user_id', 'status', 'starts_on', 'id'], { name: 'trails_guided_trip_public' });
      await ensureTable(queryInterface, 'TrailsDurableGuidedTripMutation', {
        tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, actor_user_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, mutation_id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, fingerprint: { type: DataTypes.CHAR(64), allowNull: false }, result_json: { type: DataTypes.TEXT('long'), allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureTable(queryInterface, 'TrailsDurableGuidedTripAudit', {
        event_id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, tenant_id: { type: DataTypes.STRING(64), allowNull: false }, trip_id: { type: DataTypes.STRING(160), allowNull: false }, actor_user_id: { type: DataTypes.STRING(64), allowNull: false }, owner_user_id: { type: DataTypes.STRING(64), allowNull: false }, mutation_id: { type: DataTypes.STRING(160), allowNull: false }, operation: { type: DataTypes.ENUM('create-draft', 'update-draft', 'publish', 'unpublish', 'cancel'), allowNull: false }, from_version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true }, to_version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false }, occurred_at: { type: DataTypes.DATE, allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsDurableGuidedTripAudit', ['tenant_id', 'trip_id', 'occurred_at'], { name: 'trails_guided_trip_audit' });
    },
  },
  {
    id: TRAILS_DURABLE_PORTFOLIO_PHOTO_TECHNICAL_METADATA_MIGRATION_ID,
    // MySQL DDL implicitly commits, so every step is safe to retry after interruption.
    transactional: false,
    async up({ queryInterface }) {
      const { DataTypes } = require('sequelize');
      if (!tableExists(await queryInterface.showAllTables(), 'TrailsDurablePortfolio')) return;
      await ensureColumn(queryInterface, 'TrailsDurablePortfolio', 'photo_technical_metadata', { type: DataTypes.TEXT('long'), allowNull: true });
    },
  },
  {
    id: TRAILS_DURABLE_ANALYTICS_MIGRATION_ID,
    transactional: false,
    async up({ queryInterface }) {
      const { DataTypes } = require('sequelize');
      await ensureTable(queryInterface, 'TrailsAnalyticsEventDedup', {
        tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, event_id: { type: DataTypes.STRING(36), allowNull: false, primaryKey: true }, received_at: { type: DataTypes.DATE, allowNull: false },
      });
      await ensureTable(queryInterface, 'TrailsAnalyticsVisitorDay', {
        tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, owner_user_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, day: { type: DataTypes.DATEONLY, allowNull: false, primaryKey: true }, visitor_digest: { type: DataTypes.CHAR(64), allowNull: false, primaryKey: true },
      });
      await ensureTable(queryInterface, 'TrailsAnalyticsDaily', {
        tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, owner_user_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, day: { type: DataTypes.DATEONLY, allowNull: false, primaryKey: true }, content_type: { type: DataTypes.ENUM('site', 'portfolio', 'journal', 'trip', 'edition', 'location'), allowNull: false, primaryKey: true }, content_id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, event_name: { type: DataTypes.ENUM('page-view', 'content-view', 'outbound-click'), allowNull: false, primaryKey: true }, event_count: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 }, visitor_count: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      });
      await ensureIndex(queryInterface, 'TrailsAnalyticsDaily', ['tenant_id', 'owner_user_id', 'day'], { name: 'trails_analytics_owner_day' });
      await ensureIndex(queryInterface, 'TrailsAnalyticsEventDedup', ['received_at'], { name: 'trails_analytics_event_received' });
    },
  },
  {
    id: TRAILS_DURABLE_ANALYTICS_CONTENT_VISITOR_MIGRATION_ID,
    transactional: false,
    async up({ queryInterface }) {
      const { DataTypes } = require('sequelize');
      await ensureTable(queryInterface, 'TrailsAnalyticsContentVisitorDay', {
        tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, owner_user_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, day: { type: DataTypes.DATEONLY, allowNull: false, primaryKey: true }, content_type: { type: DataTypes.ENUM('site', 'portfolio', 'journal', 'trip', 'edition', 'location'), allowNull: false, primaryKey: true }, content_id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, visitor_digest: { type: DataTypes.CHAR(64), allowNull: false, primaryKey: true },
      });
      await ensureIndex(queryInterface, 'TrailsAnalyticsContentVisitorDay', ['tenant_id', 'owner_user_id', 'day'], { name: 'trails_analytics_content_visitor_day' });
    },
  },
  {
    id: TRAILS_DURABLE_TRIP_REGISTRATION_MIGRATION_ID,
    transactional: false,
    async up({ queryInterface }) {
      const { DataTypes } = require('sequelize');
      await ensureTable(queryInterface, 'TrailsDurableTripRegistration', {
        id: { type: DataTypes.STRING(80), allowNull: false, primaryKey: true }, tenant_id: { type: DataTypes.STRING(64), allowNull: false }, trip_id: { type: DataTypes.STRING(160), allowNull: false }, participant_user_id: { type: DataTypes.STRING(64), allowNull: false }, status: { type: DataTypes.ENUM('submitted', 'waitlisted', 'rejected', 'cancelled'), allowNull: false }, required_acknowledgement_accepted_at: { type: DataTypes.DATE, allowNull: false }, release_accepted_at: { type: DataTypes.DATE, allowNull: false }, release_version: { type: DataTypes.STRING(160), allowNull: false }, resource_version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsDurableTripRegistration', ['tenant_id', 'trip_id', 'participant_user_id'], { unique: true, name: 'trails_trip_registration_participant_unique' });
      await ensureIndex(queryInterface, 'TrailsDurableTripRegistration', ['tenant_id', 'trip_id', 'status'], { name: 'trails_trip_registration_summary' });
      await ensureTable(queryInterface, 'TrailsDurableTripRegistrationMutation', {
        tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, actor_user_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, mutation_id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, fingerprint: { type: DataTypes.CHAR(64), allowNull: false }, result_json: { type: DataTypes.TEXT('long'), allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureTable(queryInterface, 'TrailsDurableTripRegistrationAudit', {
        event_id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, tenant_id: { type: DataTypes.STRING(64), allowNull: false }, trip_id: { type: DataTypes.STRING(160), allowNull: false }, registration_id: { type: DataTypes.STRING(80), allowNull: false }, actor_user_id: { type: DataTypes.STRING(64), allowNull: false }, operation: { type: DataTypes.ENUM('submitted', 'waitlisted', 'rejected', 'cancelled'), allowNull: false }, occurred_at: { type: DataTypes.DATE, allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsDurableTripRegistrationAudit', ['tenant_id', 'trip_id', 'occurred_at'], { name: 'trails_trip_registration_audit' });
    },
  },
  {
    id: TRAILS_DURABLE_TRIP_CAPACITY_MIGRATION_ID,
    transactional: false,
    async up({ queryInterface }) {
      const { DataTypes } = require('sequelize');
      if (tableExists(await queryInterface.showAllTables(), 'TrailsDurableTripRegistration')) await queryInterface.changeColumn('TrailsDurableTripRegistration', 'status', { type: DataTypes.ENUM('submitted', 'waitlisted', 'confirmed', 'rejected', 'cancelled'), allowNull: false });
      await ensureTable(queryInterface, 'TrailsDurableTripCapacity', {
        tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, trip_id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, capacity: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false }, resource_version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false }, updated_by_user_id: { type: DataTypes.STRING(64), allowNull: false }, updated_at: { type: DataTypes.DATE, allowNull: false },
      });
    },
  },
  {
    id: TRAILS_DURABLE_ANALYTICS_AUDIENCE_MIGRATION_ID,
    transactional: false,
    async up({ queryInterface }) {
      const { DataTypes } = require('sequelize');
      await ensureTable(queryInterface, 'TrailsAnalyticsAudienceDaily', {
        tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, owner_user_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, day: { type: DataTypes.DATEONLY, allowNull: false, primaryKey: true }, acquisition_channel: { type: DataTypes.ENUM('direct', 'external-referral', 'campaign'), allowNull: false, primaryKey: true }, device_class: { type: DataTypes.ENUM('desktop', 'mobile', 'tablet', 'other'), allowNull: false, primaryKey: true }, page_views: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      });
      await ensureIndex(queryInterface, 'TrailsAnalyticsAudienceDaily', ['tenant_id', 'owner_user_id', 'day'], { name: 'trails_analytics_audience_day' });
    },
  },
  {
    id: TRAILS_SHOOTING_LOCATION_MIGRATION_ID,
    // MySQL DDL implicitly commits; all steps are individually retry-safe.
    transactional: false,
    async up({ queryInterface }) {
      const { DataTypes } = require('sequelize');
      await ensureTable(queryInterface, 'TrailsShootingLocation', {
        tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, owner_user_id: { type: DataTypes.STRING(64), allowNull: false }, status: { type: DataTypes.ENUM('active', 'archived'), allowNull: false }, resource_version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false }, payload_json: { type: DataTypes.TEXT('long'), allowNull: false }, archived_at: { type: DataTypes.DATE }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsShootingLocation', ['tenant_id', 'owner_user_id', 'status', 'updated_at'], { name: 'trails_shooting_location_owner_status' });
      await ensureTable(queryInterface, 'TrailsShootingLocationMutation', {
        tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, actor_user_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, mutation_id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, fingerprint: { type: DataTypes.CHAR(64), allowNull: false }, result_json: { type: DataTypes.TEXT('long'), allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureTable(queryInterface, 'TrailsShootingLocationAudit', {
        event_id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, tenant_id: { type: DataTypes.STRING(64), allowNull: false }, shooting_location_id: { type: DataTypes.STRING(160), allowNull: false }, actor_user_id: { type: DataTypes.STRING(64), allowNull: false }, owner_user_id: { type: DataTypes.STRING(64), allowNull: false }, mutation_id: { type: DataTypes.STRING(160), allowNull: false }, operation: { type: DataTypes.STRING(24), allowNull: false }, from_version: { type: DataTypes.BIGINT.UNSIGNED }, to_version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false }, occurred_at: { type: DataTypes.DATE, allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsShootingLocationAudit', ['tenant_id', 'shooting_location_id', 'occurred_at'], { name: 'trails_shooting_location_audit_resource' });
    },
  },
  {
    id: TRAILS_CONTENT_METRICS_INDEX_MIGRATION_ID,
    transactional: false,
    async up({ queryInterface }) {
      await ensureIndex(queryInterface, 'TrailsAnalyticsDaily', ['tenant_id', 'owner_user_id', 'day', 'content_type', 'content_id'], { name: 'trails_analytics_content_metrics' });
      await ensureIndex(queryInterface, 'TrailsGuestComment', ['tenant_id', 'owner_user_id', 'status', 'created_at', 'subject_type', 'subject_id'], { name: 'trails_comment_approved_metrics' });
    },
  },
  {
    id: TRAILS_DURABLE_JOURNAL_PINNING_MIGRATION_ID,
    // MySQL DDL implicitly commits, so the column and index checks make retries safe.
    transactional: false,
    async up({ queryInterface }) {
      const { DataTypes } = require('sequelize');
      if (!tableExists(await queryInterface.showAllTables(), 'TrailsDurableJournal')) return;
      await ensureColumn(queryInterface, 'TrailsDurableJournal', 'is_pinned', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
      await ensureIndex(queryInterface, 'TrailsDurableJournal', ['tenant_id', 'owner_user_id', 'visibility', 'lifecycle', 'is_pinned', 'published_at', 'id'], { name: 'trails_durable_journal_public_pinned' });
    },
  },
  {
    id: ALERT_DURABLE_OUTBOX_MIGRATION_ID,
    // MySQL DDL implicitly commits, so every table and index operation is independently retry-safe.
    transactional: false,
    async up({ queryInterface }) {
      const { DataTypes } = require('sequelize');
      await ensureTable(queryInterface, 'AlertInstance', {
        tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true }, alert_id: { type: DataTypes.STRING(192), allowNull: false, primaryKey: true }, rule_id: { type: DataTypes.STRING(160), allowNull: false }, status: { type: DataTypes.ENUM('active', 'resolved', 'suppressed', 'pending'), allowNull: false }, payload_json: { type: DataTypes.TEXT('long'), allowNull: false }, last_notification_at: { type: DataTypes.DATE, allowNull: true }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'AlertInstance', ['tenant_id', 'status', 'updated_at'], { name: 'alert_instance_tenant_status_updated' });
      await ensureTable(queryInterface, 'AlertEvent', {
        event_id: { type: DataTypes.STRING(192), allowNull: false, primaryKey: true }, tenant_id: { type: DataTypes.STRING(64), allowNull: false }, alert_id: { type: DataTypes.STRING(192), allowNull: false }, event_key: { type: DataTypes.STRING(255), allowNull: false }, event_type: { type: DataTypes.ENUM('notification-requested'), allowNull: false }, payload_json: { type: DataTypes.TEXT('long'), allowNull: false }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'AlertEvent', ['tenant_id', 'alert_id', 'event_key'], { unique: true, name: 'alert_event_idempotency' });
      await ensureTable(queryInterface, 'AlertNotificationDelivery', {
        delivery_id: { type: DataTypes.STRING(192), allowNull: false, primaryKey: true }, tenant_id: { type: DataTypes.STRING(64), allowNull: false }, event_id: { type: DataTypes.STRING(192), allowNull: false }, alert_id: { type: DataTypes.STRING(192), allowNull: false }, channel: { type: DataTypes.ENUM('InApp', 'Email', 'Webhook'), allowNull: false }, status: { type: DataTypes.ENUM('pending', 'processing', 'delivered', 'retrying', 'failed'), allowNull: false }, target_json: { type: DataTypes.TEXT, allowNull: false }, payload_json: { type: DataTypes.TEXT('long'), allowNull: false }, attempts: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 }, next_attempt_at: { type: DataTypes.DATE, allowNull: false }, lease_token: { type: DataTypes.STRING(160), allowNull: true }, lease_expires_at: { type: DataTypes.DATE, allowNull: true }, last_error: { type: DataTypes.TEXT, allowNull: true }, delivered_at: { type: DataTypes.DATE, allowNull: true }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'AlertNotificationDelivery', ['status', 'next_attempt_at', 'lease_expires_at'], { name: 'alert_delivery_claim' });
      await ensureIndex(queryInterface, 'AlertNotificationDelivery', ['event_id', 'channel'], { unique: true, name: 'alert_delivery_event_channel' });
    },
  },
  {
    // MySQL DDL implicitly commits; table checks allow an interrupted deployment to retry safely.
    id: REGISTRY_MISSING_ALERTS_MIGRATION_ID,
    transactional: false,
    async up({ queryInterface }) {
      const { DataTypes } = require('sequelize');
      await ensureTable(queryInterface, 'RegistryMissingAlertRule', {
        rule_id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, service_name: { type: DataTypes.STRING(120), allowNull: false }, for_seconds: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false }, deploy_grace_seconds: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false }, severity: { type: DataTypes.ENUM('critical', 'warning', 'info'), allowNull: false }, enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }, channels_json: { type: DataTypes.TEXT, allowNull: false }, email_recipients_json: { type: DataTypes.TEXT, allowNull: false }, notify_on_recovery: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      if (tableExists(await queryInterface.showAllTables(), 'AlertNotificationDelivery')) {
        await ensureColumn(queryInterface, 'AlertNotificationDelivery', 'target_key', { type: DataTypes.STRING(64), allowNull: true });
        await queryInterface.sequelize.query("UPDATE AlertNotificationDelivery SET target_key = SHA2(target_json, 256) WHERE target_key IS NULL");
        await queryInterface.changeColumn('AlertNotificationDelivery', 'target_key', { type: DataTypes.STRING(64), allowNull: false });
        const deliveryIndexes = await queryInterface.showIndex('AlertNotificationDelivery');
        if (deliveryIndexes.some(index => index.name === 'alert_delivery_event_channel')) await queryInterface.removeIndex('AlertNotificationDelivery', 'alert_delivery_event_channel');
        await ensureIndex(queryInterface, 'AlertNotificationDelivery', ['event_id', 'channel', 'target_key'], { unique: true, name: 'alert_delivery_event_channel_target' });
      }
      await ensureIndex(queryInterface, 'RegistryMissingAlertRule', ['service_name'], { unique: true, name: 'registry_missing_rule_service_unique' });
      await ensureTable(queryInterface, 'RegistryMissingAlertIncident', {
        rule_id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true }, generation: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 }, status: { type: DataTypes.ENUM('absent', 'active', 'resolved'), allowNull: false }, absent_since: { type: DataTypes.DATE, allowNull: true }, opened_at: { type: DataTypes.DATE, allowNull: true }, resolved_at: { type: DataTypes.DATE, allowNull: true }, created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
    },
  },
  {
    // MySQL DDL implicitly commits. Table and index checks allow a deployment retry after interruption.
    id: TRAILS_PUBLIC_DERIVATIVE_PUBLICATION_JOB_MIGRATION_ID,
    transactional: false,
    async up({ queryInterface }) {
      const { DataTypes } = require('sequelize');
      await ensureTable(queryInterface, 'TrailsPublicDerivativePublicationJob', {
        tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
        job_id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true },
        asset_id: { type: DataTypes.STRING(160), allowNull: false },
        owner_user_id: { type: DataTypes.STRING(64), allowNull: false },
        actor_user_id: { type: DataTypes.STRING(64), allowNull: false },
        expected_resource_version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
        approval_id: { type: DataTypes.STRING(160), allowNull: false },
        status: { type: DataTypes.ENUM('pending', 'processing', 'published', 'failed'), allowNull: false },
        attempts: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        lease_token: { type: DataTypes.CHAR(64), allowNull: true },
        lease_expires_at: { type: DataTypes.DATE, allowNull: true },
        published_at: { type: DataTypes.DATE, allowNull: true },
        failed_at: { type: DataTypes.DATE, allowNull: true },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsPublicDerivativePublicationJob', ['job_id'], { unique: true, name: 'trails_public_derivative_publication_job_unique' });
      await ensureIndex(queryInterface, 'TrailsPublicDerivativePublicationJob', ['status', 'lease_expires_at', 'created_at'], { name: 'trails_public_derivative_publication_claim' });
    },
  },
  {
    // Existing production databases recorded the old rendition enum values. MySQL enum DDL
    // commits implicitly, so each step is deliberately safe to repeat after interruption.
    id: TRAILS_MEDIA_RENDITION_4K_MIGRATION_ID,
    transactional: false,
    async up({ queryInterface, sequelize }) {
      const { DataTypes } = require('sequelize');
      const oldRenditions = ['grid-800', 'cover-1600', 'preview-2048'];
      const renditions = ['grid-960', 'cover-2048', 'preview-4096'];
      const replaceValues = async (table, column, values) => {
        if (!tableExists(await queryInterface.showAllTables(), table)) return;
        // These columns are members of existing composite primary keys. Re-declaring a
        // single-column primary key makes MySQL reject the enum expansion.
        await queryInterface.changeColumn(table, column, { type: DataTypes.ENUM(...oldRenditions, ...renditions), allowNull: false });
        for (const [from, to] of [['grid-800', 'grid-960'], ['cover-1600', 'cover-2048'], ['preview-2048', 'preview-4096']]) {
          await sequelize.query(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`, { replacements: [to, from] });
        }
        await queryInterface.changeColumn(table, column, { type: DataTypes.ENUM(...renditions), allowNull: false });
      };
      await replaceValues('TrailsMediaAssetVariant', 'name');
      await replaceValues('TrailsMediaAssetArtifact', 'logical_rendition');
      await replaceValues('TrailsTrustedPhotoshopIngestionArtifact', 'logical_rendition');
      if (tableExists(await queryInterface.showAllTables(), 'TrailsTrustedPhotoshopStorageWriteFence')) {
        const oldSlots = ['master', ...oldRenditions.flatMap(rendition => ['avif', 'webp', 'jpeg'].map(codec => `${rendition}:${codec}`))];
        const slots = ['master', ...renditions.flatMap(rendition => ['avif', 'webp', 'jpeg'].map(codec => `${rendition}:${codec}`))];
        const expandedSlots = [...new Set([...oldSlots, ...slots])];
        await queryInterface.changeColumn('TrailsTrustedPhotoshopStorageWriteFence', 'slot', { type: DataTypes.ENUM(...expandedSlots), allowNull: false });
        for (const [from, to] of [['grid-800', 'grid-960'], ['cover-1600', 'cover-2048'], ['preview-2048', 'preview-4096']]) {
          await sequelize.query('UPDATE TrailsTrustedPhotoshopStorageWriteFence SET slot = REPLACE(slot, ?, ?) WHERE slot LIKE ?', { replacements: [from, to, `${from}:%`] });
        }
        await queryInterface.changeColumn('TrailsTrustedPhotoshopStorageWriteFence', 'slot', { type: DataTypes.ENUM(...slots), allowNull: false });
      }
    },
  },
  {
    // This nullable JSON text keeps existing portfolios unchanged and makes DDL retry-safe.
    id: TRAILS_DURABLE_PORTFOLIO_EXHIBITION_PRESENTATION_MIGRATION_ID,
    transactional: false,
    async up({ queryInterface }) {
      if (!tableExists(await queryInterface.showAllTables(), 'TrailsDurablePortfolio')) return;
      const { DataTypes } = require('sequelize');
      await ensureColumn(queryInterface, 'TrailsDurablePortfolio', 'exhibition_presentation', { type: DataTypes.TEXT, allowNull: true });
    },
  },
  {
    // MySQL DDL implicitly commits. Table and index checks keep a failed deployment retryable.
    id: TRAILS_DURABLE_EXHIBITION_THEME_MIGRATION_ID,
    transactional: false,
    async up({ queryInterface }) {
      const { DataTypes } = require('sequelize');
      await ensureTable(queryInterface, 'TrailsDurableExhibitionTheme', {
        tenant_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
        id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true },
        owner_user_id: { type: DataTypes.STRING(64), allowNull: false },
        slug: { type: DataTypes.STRING(160), allowNull: false },
        status: { type: DataTypes.ENUM('draft', 'published', 'archived'), allowNull: false },
        resource_version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
        payload_json: { type: DataTypes.TEXT('long'), allowNull: false },
        published_at: { type: DataTypes.DATE, allowNull: true },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      await ensureIndex(queryInterface, 'TrailsDurableExhibitionTheme', ['tenant_id', 'owner_user_id', 'slug'], { unique: true, name: 'trails_exhibition_theme_owner_slug_unique' });
      await ensureIndex(queryInterface, 'TrailsDurableExhibitionTheme', ['tenant_id', 'owner_user_id', 'status', 'published_at'], { name: 'trails_exhibition_theme_public' });
    },
  },
];

// Numeric migration IDs are the deployment ordering authority; keep append-only migrations ordered even when their definitions are grouped by resource.
migrations.sort((left, right) => left.id.localeCompare(right.id));

/** Test-only schema bootstrap for the isolated Trails MySQL harness. It never uses migration ledger/locks. */
const applyTrailsCategoryMigrations = async sequelize => {
  const queryInterface = sequelize.getQueryInterface();
  const requiredIds = [TRAILS_SYNC_FOUNDATION_MIGRATION_ID, TRAILS_CATEGORY_TENANT_IDENTITY_MIGRATION_ID, TRAILS_DURABLE_PORTFOLIO_MIGRATION_ID, TRAILS_DURABLE_JOURNAL_MIGRATION_ID, TRAILS_DURABLE_HIKE_MIGRATION_ID, TRAILS_DURABLE_GEAR_MIGRATION_ID, TRAILS_DURABLE_PACKING_PLAN_MIGRATION_ID, TRAILS_DURABLE_FINANCE_MIGRATION_ID, TRAILS_DURABLE_FINANCE_BALANCE_SNAPSHOT_MIGRATION_ID, TRAILS_DURABLE_PUBLIC_CATEGORY_QUERY_MIGRATION_ID, TRAILS_DURABLE_MEDIA_COMMERCE_MIGRATION_ID, TRAILS_MEDIA_ASSET_REGISTRY_MIGRATION_ID, TRAILS_MEDIA_ASSET_REGISTRY_MUTATION_MIGRATION_ID, TRAILS_MEDIA_ASSET_ARTIFACT_MIGRATION_ID, TRAILS_TRUSTED_PHOTOSHOP_INGESTION_OPERATION_MIGRATION_ID, TRAILS_DURABLE_PUBLISHING_PACKAGE_MIGRATION_ID, TRAILS_RICH_DOCUMENT_MIGRATION_ID, TRAILS_PUBLIC_CONTENT_AND_COMMENTS_MIGRATION_ID, TRAILS_GUEST_COMMENT_OUTBOX_MIGRATION_ID, TRAILS_GUEST_COMMENT_DELIVERY_LEASE_MIGRATION_ID, TRAILS_GUEST_COMMENT_NOTIFICATION_STATUS_MIGRATION_ID, TRAILS_DURABLE_GUIDED_TRIP_MIGRATION_ID, TRAILS_DURABLE_EXTERNAL_VIDEO_REFERENCE_MIGRATION_ID, TRAILS_DURABLE_LOCATION_CARD_MIGRATION_ID, TRAILS_DURABLE_PORTFOLIO_PHOTO_TECHNICAL_METADATA_MIGRATION_ID, TRAILS_DURABLE_ANALYTICS_MIGRATION_ID, TRAILS_DURABLE_ANALYTICS_CONTENT_VISITOR_MIGRATION_ID, TRAILS_DURABLE_TRIP_REGISTRATION_MIGRATION_ID, TRAILS_DURABLE_TRIP_CAPACITY_MIGRATION_ID, TRAILS_DURABLE_ANALYTICS_AUDIENCE_MIGRATION_ID, TRAILS_SHOOTING_LOCATION_MIGRATION_ID, TRAILS_CONTENT_METRICS_INDEX_MIGRATION_ID, TRAILS_DURABLE_JOURNAL_PINNING_MIGRATION_ID, TRAILS_MEDIA_RENDITION_4K_MIGRATION_ID, TRAILS_PUBLIC_DERIVATIVE_PUBLICATION_JOB_MIGRATION_ID, TRAILS_DURABLE_EXHIBITION_THEME_MIGRATION_ID, TRAILS_DURABLE_PORTFOLIO_EXHIBITION_PRESENTATION_MIGRATION_ID];
  for (const id of requiredIds) {
    const migration = migrations.find(candidate => candidate.id === id);
    if (!migration) throw new Error(`Required Trails category migration is not registered: ${id}`);
    await migration.up({ sequelize, queryInterface, existingTables: await queryInterface.showAllTables() });
  }
};

module.exports = {
  ADMIN_BOOTSTRAP_LOCK_MIGRATION_ID,
  TRAILS_SYNC_FOUNDATION_MIGRATION_ID,
  TRAILS_CATEGORY_TENANT_IDENTITY_MIGRATION_ID,
  TRAILS_DURABLE_PORTFOLIO_MIGRATION_ID,
  TRAILS_DURABLE_JOURNAL_MIGRATION_ID,
  TRAILS_DURABLE_HIKE_MIGRATION_ID,
  TRAILS_DURABLE_GEAR_MIGRATION_ID,
  TRAILS_DURABLE_PACKING_PLAN_MIGRATION_ID,
  TRAILS_DURABLE_FINANCE_MIGRATION_ID,
  TRAILS_DURABLE_FINANCE_BALANCE_SNAPSHOT_MIGRATION_ID,
  TRAILS_DURABLE_PUBLIC_CATEGORY_QUERY_MIGRATION_ID,
  TRAILS_DURABLE_MEDIA_COMMERCE_MIGRATION_ID,
  TRAILS_MEDIA_ASSET_REGISTRY_MIGRATION_ID,
  TRAILS_MEDIA_ASSET_REGISTRY_MUTATION_MIGRATION_ID,
  TRAILS_MEDIA_ASSET_ARTIFACT_MIGRATION_ID,
  TRAILS_TRUSTED_PHOTOSHOP_INGESTION_OPERATION_MIGRATION_ID,
  TRAILS_TRUSTED_PHOTOSHOP_STORAGE_WRITE_FENCE_MIGRATION_ID,
  TRAILS_DURABLE_PUBLISHING_PACKAGE_MIGRATION_ID,
  CREATOR_SPACE_MEMBERSHIP_MIGRATION_ID,
  TRAILS_RICH_DOCUMENT_MIGRATION_ID,
  TRAILS_PUBLIC_CONTENT_AND_COMMENTS_MIGRATION_ID,
  TRAILS_GUEST_COMMENT_OUTBOX_MIGRATION_ID,
  TRAILS_GUEST_COMMENT_DELIVERY_LEASE_MIGRATION_ID,
  TRAILS_GUEST_COMMENT_NOTIFICATION_STATUS_MIGRATION_ID,
  TRAILS_DURABLE_GUIDED_TRIP_MIGRATION_ID,
  TRAILS_DURABLE_EXTERNAL_VIDEO_REFERENCE_MIGRATION_ID,
  TRAILS_DURABLE_LOCATION_CARD_MIGRATION_ID,
  TRAILS_DURABLE_PORTFOLIO_PHOTO_TECHNICAL_METADATA_MIGRATION_ID,
  TRAILS_DURABLE_ANALYTICS_MIGRATION_ID,
  TRAILS_DURABLE_ANALYTICS_CONTENT_VISITOR_MIGRATION_ID,
  TRAILS_DURABLE_TRIP_REGISTRATION_MIGRATION_ID,
  TRAILS_DURABLE_TRIP_CAPACITY_MIGRATION_ID,
  TRAILS_DURABLE_ANALYTICS_AUDIENCE_MIGRATION_ID,
  TRAILS_SHOOTING_LOCATION_MIGRATION_ID,
  TRAILS_CONTENT_METRICS_INDEX_MIGRATION_ID,
  TRAILS_DURABLE_JOURNAL_PINNING_MIGRATION_ID,
  TRAILS_MEDIA_RENDITION_4K_MIGRATION_ID,
  TRAILS_PUBLIC_DERIVATIVE_PUBLICATION_JOB_MIGRATION_ID,
  TRAILS_DURABLE_EXHIBITION_THEME_MIGRATION_ID,
  TRAILS_DURABLE_PORTFOLIO_EXHIBITION_PRESENTATION_MIGRATION_ID,
  ALERT_DURABLE_OUTBOX_MIGRATION_ID,
  BASELINE_MIGRATION_ID,
  getModelTableNames,
  getProductionModels,
  ensureIndex,
  ensureColumn,
  ensureTable,
  applyTrailsCategoryMigrations,
  migrations,
};
