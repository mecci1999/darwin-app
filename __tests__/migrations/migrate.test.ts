const migrationDefinitions = require('../../scripts/migrations');
const migrationRunner = require('../../scripts/migrate');

const createSequelize = () => {
  const events: string[] = [];
  const appliedIds: string[] = [];
    const queryInterface = {
      showAllTables: jest.fn(async () => ['app_migrations']),
      createTable: jest.fn(),
      describeTable: jest.fn(async () => ({})),
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

  it('runs the baseline before durable media commerce on a fresh production schema', async () => {
    const { appliedIds, queryInterface, sequelize } = createSequelize();
    const executedIds: string[] = [];
    const tables = ['app_migrations'];
    queryInterface.showAllTables.mockImplementation(async () => tables);

    const selectedMigrations = migrationDefinitions.migrations.filter((migration: { id: string }) =>
      [
        migrationDefinitions.BASELINE_MIGRATION_ID,
        migrationDefinitions.TRAILS_DURABLE_MEDIA_COMMERCE_MIGRATION_ID,
      ].includes(migration.id),
    );
    migrationDefinitions.migrations.splice(0, migrationDefinitions.migrations.length, ...selectedMigrations.map((migration: { id: string }) => ({
      ...migration,
      up: async ({ existingTables }: { existingTables: string[] }) => {
        if (migration.id === migrationDefinitions.BASELINE_MIGRATION_ID) {
          expect(existingTables).toEqual(['app_migrations']);
        } else {
          tables.push('TrailsDurableMediaCommerce');
        }
        executedIds.push(migration.id);
      },
    })));

    await expect(migrationRunner.runMigrations(sequelize)).resolves.toBeUndefined();

    expect(executedIds).toEqual([
      migrationDefinitions.BASELINE_MIGRATION_ID,
      migrationDefinitions.TRAILS_DURABLE_MEDIA_COMMERCE_MIGRATION_ID,
    ]);
    expect(appliedIds).toEqual(executedIds);
  });

  it('creates and seeds the admin bootstrap singleton through a retryable incremental migration', async () => {
    const migrations: Array<{ id: string; up: (...args: unknown[]) => Promise<void> }> =
      migrationDefinitions.migrations;
    const migration = migrations.find(item => item.id === migrationDefinitions.ADMIN_BOOTSTRAP_LOCK_MIGRATION_ID);
    const queryInterface = {
      showAllTables: jest.fn(async () => ['user']),
      createTable: jest.fn(),
    };
    const sequelize = {
      query: jest.fn(),
    };

    if (!migration) {
      throw new Error('Admin bootstrap lock migration is not registered');
    }

    await migration.up({ sequelize, queryInterface });

    expect(queryInterface.createTable).toHaveBeenCalledWith(
      'adminBootstrapLock',
      expect.objectContaining({ lock_id: expect.any(Object) }),
    );
    expect(sequelize.query).toHaveBeenCalledWith(
      'INSERT IGNORE INTO adminBootstrapLock (lock_id) VALUES (?)',
      { replacements: [1] },
    );
  });

  it('retries a partially applied bootstrap-lock migration by seeding an existing table', async () => {
    const migrations: Array<{ id: string; up: (...args: unknown[]) => Promise<void> }> =
      migrationDefinitions.migrations;
    const migration = migrations.find(item => item.id === migrationDefinitions.ADMIN_BOOTSTRAP_LOCK_MIGRATION_ID);
    const queryInterface = {
      showAllTables: jest.fn(async () => ['user', 'adminBootstrapLock']),
      createTable: jest.fn(),
    };
    const sequelize = { query: jest.fn() };

    if (!migration) {
      throw new Error('Admin bootstrap lock migration is not registered');
    }

    await migration.up({ sequelize, queryInterface });

    expect(queryInterface.createTable).not.toHaveBeenCalled();
    expect(sequelize.query).toHaveBeenCalledWith(
      'INSERT IGNORE INTO adminBootstrapLock (lock_id) VALUES (?)',
      { replacements: [1] },
    );
  });

  it('repairs every missing Trails sync index when an earlier DDL attempt created only tables', async () => {
    const migrations: Array<{ id: string; up: (...args: unknown[]) => Promise<void> }> = migrationDefinitions.migrations;
    const migration = migrations.find(item => item.id === migrationDefinitions.TRAILS_SYNC_FOUNDATION_MIGRATION_ID);
    const indexes: Record<string, Array<{ name: string }>> = {
      TrailsPortfolioCategory: [{ name: 'trails_category_owner_slug_unique' }],
      TrailsSyncChange: [],
      TrailsSyncMutation: [],
    };
    const queryInterface = {
      showAllTables: jest.fn(async () => ['TrailsPortfolioCategory', 'TrailsSyncChange', 'TrailsSyncMutation']),
      createTable: jest.fn(),
      showIndex: jest.fn(async (tableName: string) => indexes[tableName]),
      addIndex: jest.fn(async (tableName: string, _fields: string[], options: { name: string }) => { indexes[tableName].push({ name: options.name }); }),
    };

    if (!migration) throw new Error('Trails sync foundation migration is not registered');
    await migration.up({ queryInterface });

    expect(queryInterface.createTable).not.toHaveBeenCalled();
    expect(queryInterface.addIndex).toHaveBeenCalledWith('TrailsPortfolioCategory', ['tenant_id', 'owner_user_id', 'sort_order', 'slug'], { name: 'trails_category_owner_sort' });
    expect(queryInterface.addIndex).toHaveBeenCalledWith('TrailsSyncChange', ['tenant_id', 'owner_user_id', 'cursor'], { name: 'trails_sync_owner_cursor' });
    expect(queryInterface.addIndex).toHaveBeenCalledWith('TrailsSyncMutation', ['tenant_id', 'actor_user_id', 'mutation_id'], { unique: true, name: 'trails_sync_mutation_unique' });
  });

  it('upgrades an existing category table to a tenant-qualified primary identity once', async () => {
    const migrations: Array<{ id: string; up: (...args: unknown[]) => Promise<void> }> = migrationDefinitions.migrations;
    const migration = migrations.find(item => item.id === migrationDefinitions.TRAILS_CATEGORY_TENANT_IDENTITY_MIGRATION_ID);
    const queryInterface = {
      showAllTables: jest.fn(async () => ['TrailsPortfolioCategory']),
      showIndex: jest.fn(async () => [{ name: 'PRIMARY', primary: true, fields: [{ attribute: 'id' }] }]),
      removeConstraint: jest.fn(),
      addConstraint: jest.fn(),
      changeColumn: jest.fn(),
      addColumn: jest.fn(),
      describeTable: jest.fn(async () => ({})),
    };

    if (!migration) throw new Error('Trails tenant identity migration is not registered');
    await migration.up({ queryInterface });

    expect(queryInterface.removeConstraint).toHaveBeenCalledWith('TrailsPortfolioCategory', 'PRIMARY');
    expect(queryInterface.addConstraint).toHaveBeenCalledWith('TrailsPortfolioCategory', { fields: ['tenant_id', 'id'], type: 'primary key', name: 'trails_category_tenant_id_primary' });
  });

  it('adds retry-safe indexes for public category navigation and category-filtered portfolios', async () => {
    const migration = migrationDefinitions.migrations.find((item: { id: string }) => item.id === migrationDefinitions.TRAILS_DURABLE_PUBLIC_CATEGORY_QUERY_MIGRATION_ID);
    const indexes: Record<string, Array<{ name: string }>> = { TrailsPortfolioCategory: [], TrailsDurablePortfolio: [] };
    const queryInterface = {
      showAllTables: jest.fn(async () => ['TrailsPortfolioCategory', 'TrailsDurablePortfolio']),
      showIndex: jest.fn(async (tableName: string) => indexes[tableName]),
      addIndex: jest.fn(async (tableName: string, _fields: string[], options: { name: string }) => { indexes[tableName].push({ name: options.name }); }),
    };

    if (!migration) throw new Error('Public category query migration is not registered');
    await migration.up({ queryInterface });

    expect(queryInterface.addIndex).toHaveBeenCalledWith('TrailsPortfolioCategory', ['tenant_id', 'owner_user_id', 'visibility', 'status', 'lifecycle', 'sort_order', 'slug'], { name: 'trails_category_public_order' });
    expect(queryInterface.addIndex).toHaveBeenCalledWith('TrailsDurablePortfolio', ['tenant_id', 'owner_user_id', 'category_id', 'visibility', 'lifecycle', 'updated_at'], { name: 'trails_durable_portfolio_public_category' });
  });

  it('creates retry-safe registry, public-variant, private-artifact, and actor mutation-ledger tables', async () => {
    const registry = migrationDefinitions.migrations.find((item: { id: string }) => item.id === migrationDefinitions.TRAILS_MEDIA_ASSET_REGISTRY_MIGRATION_ID);
    const ledger = migrationDefinitions.migrations.find((item: { id: string }) => item.id === migrationDefinitions.TRAILS_MEDIA_ASSET_REGISTRY_MUTATION_MIGRATION_ID);
    const artifacts = migrationDefinitions.migrations.find((item: { id: string }) => item.id === migrationDefinitions.TRAILS_MEDIA_ASSET_ARTIFACT_MIGRATION_ID);
    const tables: string[] = [];
    const indexes: Record<string, Array<{ name: string }>> = { TrailsMediaAssetRegistry: [], TrailsMediaAssetVariant: [], TrailsMediaAssetArtifact: [], TrailsMediaAssetRegistryMutation: [] };
    const queryInterface = { showAllTables: jest.fn(async () => tables), createTable: jest.fn(async (name: string) => { tables.push(name); }), showIndex: jest.fn(async (name: string) => indexes[name]), addIndex: jest.fn(async (name: string, _fields: string[], options: { name: string }) => { indexes[name].push({ name: options.name }); }) };
    if (!registry || !ledger || !artifacts) throw new Error('Media asset registry migrations are not registered');
    await registry.up({ queryInterface });
    await ledger.up({ queryInterface });
    await artifacts.up({ queryInterface });
    await registry.up({ queryInterface });
    await ledger.up({ queryInterface });
    await artifacts.up({ queryInterface });
    expect(queryInterface.createTable).toHaveBeenCalledTimes(4);
    expect(queryInterface.createTable).toHaveBeenCalledWith('TrailsMediaAssetRegistry', expect.objectContaining({ tenant_id: expect.objectContaining({ primaryKey: true }), id: expect.objectContaining({ primaryKey: true }), private_master_locator: expect.any(Object), resource_version: expect.any(Object) }));
    expect(queryInterface.createTable).toHaveBeenCalledWith('TrailsMediaAssetVariant', expect.objectContaining({ tenant_id: expect.objectContaining({ primaryKey: true }), asset_id: expect.objectContaining({ primaryKey: true }), name: expect.objectContaining({ primaryKey: true }), public_reference: expect.any(Object) }));
    expect(queryInterface.createTable).toHaveBeenCalledWith('TrailsMediaAssetRegistryMutation', expect.objectContaining({ tenant_id: expect.objectContaining({ primaryKey: true }), actor_user_id: expect.objectContaining({ primaryKey: true }), mutation_id: expect.objectContaining({ primaryKey: true }), fingerprint: expect.any(Object), result_json: expect.any(Object) }));
    expect(queryInterface.createTable).toHaveBeenCalledWith('TrailsMediaAssetArtifact', expect.objectContaining({ tenant_id: expect.objectContaining({ primaryKey: true }), asset_id: expect.objectContaining({ primaryKey: true }), logical_rendition: expect.objectContaining({ primaryKey: true }), codec: expect.objectContaining({ primaryKey: true }), private_locator: expect.any(Object), sha256: expect.any(Object) }));
    expect(queryInterface.addIndex).toHaveBeenCalledWith('TrailsMediaAssetRegistry', ['tenant_id', 'owner_user_id', 'status'], { name: 'trails_media_asset_owner_status' });
    expect(queryInterface.addIndex).toHaveBeenCalledWith('TrailsMediaAssetArtifact', ['tenant_id', 'asset_id'], { name: 'trails_media_artifact_asset' });
  });

  it('creates the retry-safe canonical creator-space membership table and owner index', async () => {
    const migration = migrationDefinitions.migrations.find((item: { id: string }) => item.id === migrationDefinitions.CREATOR_SPACE_MEMBERSHIP_MIGRATION_ID);
    const tables: string[] = [];
    const indexes: Record<string, Array<{ name: string }>> = { CreatorSpaceMembership: [] };
    const queryInterface = { showAllTables: jest.fn(async () => tables), createTable: jest.fn(async (name: string) => { tables.push(name); }), showIndex: jest.fn(async (name: string) => indexes[name]), addIndex: jest.fn(async (name: string, _fields: string[], options: { name: string }) => { indexes[name].push({ name: options.name }); }) };
    if (!migration) throw new Error('Creator-space membership migration is not registered');
    await migration.up({ queryInterface });
    await migration.up({ queryInterface });
    expect(queryInterface.createTable).toHaveBeenCalledTimes(1);
    expect(queryInterface.createTable).toHaveBeenCalledWith('CreatorSpaceMembership', expect.objectContaining({ tenant_id: expect.objectContaining({ primaryKey: true }), user_id: expect.objectContaining({ primaryKey: true }), role: expect.any(Object), assigned_owner_user_id: expect.any(Object), status: expect.any(Object) }));
    expect(queryInterface.addIndex).toHaveBeenCalledWith('CreatorSpaceMembership', ['tenant_id', 'assigned_owner_user_id'], { name: 'creator_space_membership_owner' });
  });

  it('creates retry-safe private trusted Photoshop operation and exact child artifact tables', async () => {
    const migration = migrationDefinitions.migrations.find((item: { id: string }) => item.id === migrationDefinitions.TRAILS_TRUSTED_PHOTOSHOP_INGESTION_OPERATION_MIGRATION_ID);
    const tables: string[] = [];
    const indexes: Record<string, Array<{ name: string }>> = { TrailsTrustedPhotoshopIngestionOperation: [], TrailsTrustedPhotoshopIngestionArtifact: [] };
    const queryInterface = { showAllTables: jest.fn(async () => tables), createTable: jest.fn(async (name: string) => { tables.push(name); }), showIndex: jest.fn(async (name: string) => indexes[name]), addIndex: jest.fn(async (name: string, _fields: string[], options: { name: string }) => { indexes[name].push({ name: options.name }); }) };
    if (!migration) throw new Error('Trusted Photoshop ingestion migration is not registered');
    await migration.up({ queryInterface });
    await migration.up({ queryInterface });
    expect(queryInterface.createTable).toHaveBeenCalledTimes(2);
    expect(queryInterface.createTable).toHaveBeenCalledWith('TrailsTrustedPhotoshopIngestionOperation', expect.objectContaining({ tenant_id: expect.objectContaining({ primaryKey: true }), operation_id: expect.objectContaining({ primaryKey: true }), intent_digest: expect.any(Object), lease_owner: expect.any(Object), master_locator: expect.any(Object) }));
    expect(queryInterface.createTable).toHaveBeenCalledWith('TrailsTrustedPhotoshopIngestionArtifact', expect.objectContaining({ tenant_id: expect.objectContaining({ primaryKey: true }), operation_id: expect.objectContaining({ primaryKey: true }), logical_rendition: expect.objectContaining({ primaryKey: true }), codec: expect.objectContaining({ primaryKey: true }), locator: expect.any(Object), write_state: expect.any(Object) }));
    expect(queryInterface.addIndex).toHaveBeenCalledWith('TrailsTrustedPhotoshopIngestionOperation', ['tenant_id', 'phase', 'lease_expires_at'], { name: 'trails_photoshop_ingestion_claim' });
    expect(queryInterface.addIndex).toHaveBeenCalledWith('TrailsTrustedPhotoshopIngestionArtifact', ['tenant_id', 'operation_id'], { name: 'trails_photoshop_ingestion_artifacts' });
  });

  it('creates the retry-safe private trusted Photoshop storage write-fence table', async () => {
    const migration = migrationDefinitions.migrations.find((item: { id: string }) => item.id === migrationDefinitions.TRAILS_TRUSTED_PHOTOSHOP_STORAGE_WRITE_FENCE_MIGRATION_ID);
    const tables: string[] = [];
    const indexes: Record<string, Array<{ name: string }>> = { TrailsTrustedPhotoshopStorageWriteFence: [] };
    const queryInterface = { showAllTables: jest.fn(async () => tables), createTable: jest.fn(async (name: string) => { tables.push(name); }), showIndex: jest.fn(async (name: string) => indexes[name]), addIndex: jest.fn(async (name: string, _fields: string[], options: { name: string }) => { indexes[name].push({ name: options.name }); }) };
    if (!migration) throw new Error('Trusted Photoshop storage write-fence migration is not registered');
    await migration.up({ queryInterface });
    await migration.up({ queryInterface });
    expect(queryInterface.createTable).toHaveBeenCalledTimes(1);
    expect(queryInterface.createTable).toHaveBeenCalledWith('TrailsTrustedPhotoshopStorageWriteFence', expect.objectContaining({ tenant_id: expect.objectContaining({ primaryKey: true }), operation_id: expect.objectContaining({ primaryKey: true }), slot: expect.objectContaining({ primaryKey: true }), intent_digest: expect.any(Object), object_identity: expect.any(Object), fence_token: expect.any(Object), state: expect.any(Object) }));
    expect(queryInterface.addIndex).toHaveBeenCalledWith('TrailsTrustedPhotoshopStorageWriteFence', ['tenant_id', 'operation_id'], { name: 'trails_photoshop_storage_fence_operation' });
  });

  it('applies the isolated Trails durable migrations without production runner state or Sequelize synchronization', async () => {
    const tables: string[] = [];
    const queryInterface = {
      showAllTables: jest.fn(async () => tables),
      createTable: jest.fn(async (name: string) => { tables.push(name); }),
      showIndex: jest.fn(async (name: string) => name === 'TrailsPortfolioCategory' ? [{ name: 'PRIMARY', primary: true, fields: [{ attribute: 'id' }] }] : []),
      addIndex: jest.fn(),
      removeConstraint: jest.fn(),
      addConstraint: jest.fn(),
      changeColumn: jest.fn(),
      addColumn: jest.fn(),
      describeTable: jest.fn(async () => ({})),
    };
    const sequelize = { getQueryInterface: () => queryInterface, sync: jest.fn(), query: jest.fn() };
    await migrationDefinitions.applyTrailsCategoryMigrations(sequelize);
    expect(queryInterface.createTable).toHaveBeenCalledTimes(50);
    expect(queryInterface.createTable).toHaveBeenCalledWith('TrailsRichDocument', expect.objectContaining({ tenant_id: expect.objectContaining({ primaryKey: true }), subject_type: expect.objectContaining({ primaryKey: true }), subject_id: expect.objectContaining({ primaryKey: true }), document_json: expect.any(Object), revision: expect.any(Object) }));
    expect(queryInterface.createTable).toHaveBeenCalledWith('TrailsRichDocumentRevision', expect.objectContaining({ tenant_id: expect.objectContaining({ primaryKey: true }), subject_type: expect.objectContaining({ primaryKey: true }), subject_id: expect.objectContaining({ primaryKey: true }), revision: expect.objectContaining({ primaryKey: true }), created_by_user_id: expect.any(Object) }));
    expect(queryInterface.createTable).toHaveBeenCalledWith('TrailsPublicSiteContent', expect.objectContaining({ tenant_id: expect.objectContaining({ primaryKey: true }), owner_user_id: expect.objectContaining({ primaryKey: true }), content_json: expect.any(Object), resource_version: expect.any(Object) }));
    expect(queryInterface.createTable).toHaveBeenCalledWith('TrailsDurableExternalVideoReference', expect.objectContaining({ tenant_id: expect.objectContaining({ primaryKey: true }), id: expect.objectContaining({ primaryKey: true }), portfolio_id: expect.any(Object), payload_json: expect.any(Object), resource_version: expect.any(Object) }));
    expect(queryInterface.createTable).toHaveBeenCalledWith('TrailsDurableExternalVideoReferenceMutation', expect.objectContaining({ tenant_id: expect.objectContaining({ primaryKey: true }), actor_user_id: expect.objectContaining({ primaryKey: true }), mutation_id: expect.objectContaining({ primaryKey: true }), fingerprint: expect.any(Object) }));
    expect(queryInterface.createTable).toHaveBeenCalledWith('TrailsDurableExternalVideoReferenceAudit', expect.objectContaining({ event_id: expect.objectContaining({ primaryKey: true }), reference_id: expect.any(Object), from_version: expect.any(Object), to_version: expect.any(Object) }));
    expect(queryInterface.createTable).toHaveBeenCalledWith('TrailsGuestComment', expect.objectContaining({ tenant_id: expect.objectContaining({ primaryKey: true }), id: expect.objectContaining({ primaryKey: true }), email_hash: expect.any(Object), verification_token_hash: expect.any(Object), verification_expires_at: expect.any(Object) }));
    expect(queryInterface.createTable).toHaveBeenCalledWith('TrailsGuestCommentAudit', expect.objectContaining({ event_id: expect.objectContaining({ primaryKey: true }), comment_id: expect.any(Object), operation: expect.any(Object) }));
    expect(queryInterface.createTable).toHaveBeenCalledWith('TrailsGuestCommentNotification', expect.objectContaining({ tenant_id: expect.objectContaining({ primaryKey: true }), comment_id: expect.objectContaining({ primaryKey: true }), encrypted_payload: expect.any(Object), status: expect.any(Object) }));
    expect(queryInterface.createTable).toHaveBeenCalledWith('TrailsDurableGuidedTrip', expect.objectContaining({ tenant_id: expect.objectContaining({ primaryKey: true }), id: expect.objectContaining({ primaryKey: true }), owner_user_id: expect.any(Object), status: expect.any(Object), starts_on: expect.any(Object), resource_version: expect.any(Object), payload_json: expect.any(Object) }));
    expect(queryInterface.createTable).toHaveBeenCalledWith('TrailsDurableGuidedTripMutation', expect.objectContaining({ tenant_id: expect.objectContaining({ primaryKey: true }), actor_user_id: expect.objectContaining({ primaryKey: true }), mutation_id: expect.objectContaining({ primaryKey: true }), fingerprint: expect.any(Object), result_json: expect.any(Object) }));
    expect(queryInterface.createTable).toHaveBeenCalledWith('TrailsDurableGuidedTripAudit', expect.objectContaining({ event_id: expect.objectContaining({ primaryKey: true }), tenant_id: expect.any(Object), trip_id: expect.any(Object), actor_user_id: expect.any(Object), mutation_id: expect.any(Object), operation: expect.any(Object), from_version: expect.any(Object), to_version: expect.any(Object), occurred_at: expect.any(Object) }));
    expect(queryInterface.createTable).toHaveBeenCalledWith('TrailsDurableLocationCard', expect.objectContaining({ tenant_id: expect.objectContaining({ primaryKey: true }), id: expect.objectContaining({ primaryKey: true }), owner_user_id: expect.any(Object), status: expect.any(Object), resource_version: expect.any(Object), payload_json: expect.any(Object) }));
    expect(queryInterface.createTable).toHaveBeenCalledWith('TrailsDurableLocationCardMutation', expect.objectContaining({ tenant_id: expect.objectContaining({ primaryKey: true }), actor_user_id: expect.objectContaining({ primaryKey: true }), mutation_id: expect.objectContaining({ primaryKey: true }), fingerprint: expect.any(Object), result_json: expect.any(Object) }));
    expect(queryInterface.createTable).toHaveBeenCalledWith('TrailsDurableLocationCardAudit', expect.objectContaining({ event_id: expect.objectContaining({ primaryKey: true }), location_card_id: expect.any(Object), from_version: expect.any(Object), to_version: expect.any(Object) }));
    expect(queryInterface.createTable).toHaveBeenCalledWith('TrailsShootingLocation', expect.objectContaining({ tenant_id: expect.objectContaining({ primaryKey: true }), id: expect.objectContaining({ primaryKey: true }), owner_user_id: expect.any(Object), status: expect.any(Object), resource_version: expect.any(Object), payload_json: expect.any(Object) }));
    expect(queryInterface.createTable).toHaveBeenCalledWith('TrailsShootingLocationMutation', expect.objectContaining({ tenant_id: expect.objectContaining({ primaryKey: true }), actor_user_id: expect.objectContaining({ primaryKey: true }), mutation_id: expect.objectContaining({ primaryKey: true }), fingerprint: expect.any(Object), result_json: expect.any(Object) }));
    expect(queryInterface.createTable).toHaveBeenCalledWith('TrailsShootingLocationAudit', expect.objectContaining({ event_id: expect.objectContaining({ primaryKey: true }), shooting_location_id: expect.any(Object), from_version: expect.any(Object), to_version: expect.any(Object) }));
    expect(queryInterface.createTable).toHaveBeenCalledWith('TrailsAnalyticsDaily', expect.objectContaining({ tenant_id: expect.objectContaining({ primaryKey: true }), owner_user_id: expect.objectContaining({ primaryKey: true }), day: expect.objectContaining({ primaryKey: true }), content_type: expect.objectContaining({ primaryKey: true }), content_id: expect.objectContaining({ primaryKey: true }), event_name: expect.objectContaining({ primaryKey: true }) }));
    expect(queryInterface.createTable).toHaveBeenCalledWith('TrailsAnalyticsContentVisitorDay', expect.objectContaining({ tenant_id: expect.objectContaining({ primaryKey: true }), owner_user_id: expect.objectContaining({ primaryKey: true }), day: expect.objectContaining({ primaryKey: true }), content_type: expect.objectContaining({ primaryKey: true }), content_id: expect.objectContaining({ primaryKey: true }), visitor_digest: expect.objectContaining({ primaryKey: true }) }));
    expect(queryInterface.addIndex).toHaveBeenCalledWith('TrailsAnalyticsDaily', ['tenant_id', 'owner_user_id', 'day', 'content_type', 'content_id'], { name: 'trails_analytics_content_metrics' });
    expect(queryInterface.addIndex).toHaveBeenCalledWith('TrailsGuestComment', ['tenant_id', 'owner_user_id', 'status', 'created_at', 'subject_type', 'subject_id'], { name: 'trails_comment_approved_metrics' });
    expect(queryInterface.createTable).toHaveBeenCalledWith('TrailsDurableTripRegistration', expect.objectContaining({ id: expect.objectContaining({ primaryKey: true }), tenant_id: expect.any(Object), trip_id: expect.any(Object), participant_user_id: expect.any(Object), status: expect.any(Object), release_version: expect.any(Object), resource_version: expect.any(Object) }));
    expect(queryInterface.addColumn).toHaveBeenCalledWith('TrailsGuestCommentNotification', 'delivery_id', expect.objectContaining({ allowNull: true }));
    expect(queryInterface.addColumn).toHaveBeenCalledWith('TrailsGuestCommentNotification', 'next_attempt_at', expect.objectContaining({ allowNull: true }));
    expect(queryInterface.addIndex).toHaveBeenCalledWith('TrailsGuestCommentNotification', ['status', 'next_attempt_at', 'lease_expires_at'], { name: 'trails_guest_comment_notification_claim' });
    expect(queryInterface.changeColumn).toHaveBeenCalledWith('TrailsGuestCommentNotification', 'status', expect.objectContaining({ allowNull: false }));
    expect(queryInterface.addConstraint).toHaveBeenCalledWith('TrailsPortfolioCategory', { fields: ['tenant_id', 'id'], type: 'primary key', name: 'trails_category_tenant_id_primary' });
    expect(sequelize.sync).not.toHaveBeenCalled();
    expect(sequelize.query).toHaveBeenCalledWith('UPDATE TrailsGuestComment SET email_hash = NULL WHERE email_hash IS NOT NULL');
  });

  it('repairs migration 024 from a partially upgraded outbox and is safe to rerun', async () => {
    const migration = migrationDefinitions.migrations.find((item: { id: string }) => item.id === migrationDefinitions.TRAILS_GUEST_COMMENT_DELIVERY_LEASE_MIGRATION_ID);
    const columns: Record<string, unknown> = { delivery_id: {} };
    const indexes: Array<{ name: string }> = [];
    const queryInterface = {
      showAllTables: jest.fn(async () => ['TrailsGuestCommentNotification']),
      describeTable: jest.fn(async () => columns),
      addColumn: jest.fn(async (_table: string, name: string) => { columns[name] = {}; }),
      changeColumn: jest.fn(),
      showIndex: jest.fn(async () => indexes),
      addIndex: jest.fn(async (_table: string, _fields: string[], options: { name: string }) => { indexes.push({ name: options.name }); }),
    };
    const sequelize = { query: jest.fn(async () => [[]]) };

    if (!migration) throw new Error('Guest comment delivery lease migration is not registered');
    await migration.up({ queryInterface, sequelize });
    await migration.up({ queryInterface, sequelize });

    expect(queryInterface.addColumn).toHaveBeenCalledTimes(3);
    expect(queryInterface.addColumn).toHaveBeenCalledWith('TrailsGuestCommentNotification', 'next_attempt_at', expect.any(Object));
    expect(queryInterface.addColumn).toHaveBeenCalledWith('TrailsGuestCommentNotification', 'lease_token', expect.any(Object));
    expect(queryInterface.addColumn).toHaveBeenCalledWith('TrailsGuestCommentNotification', 'lease_expires_at', expect.any(Object));
    expect(queryInterface.changeColumn).toHaveBeenCalledTimes(4);
    expect(queryInterface.addIndex).toHaveBeenCalledTimes(1);
  });

  it('adds the retry-safe durable journal pin column and public ordering index once', async () => {
    const migration = migrationDefinitions.migrations.find((item: { id: string }) => item.id === migrationDefinitions.TRAILS_DURABLE_JOURNAL_PINNING_MIGRATION_ID);
    const columns: Record<string, unknown> = {};
    const indexes: Array<{ name: string }> = [];
    const queryInterface = {
      showAllTables: jest.fn(async () => ['TrailsDurableJournal']),
      describeTable: jest.fn(async () => columns),
      addColumn: jest.fn(async (_table: string, name: string) => { columns[name] = {}; }),
      showIndex: jest.fn(async () => indexes),
      addIndex: jest.fn(async (_table: string, _fields: string[], options: { name: string }) => { indexes.push({ name: options.name }); }),
    };
    if (!migration) throw new Error('Durable journal pinning migration is not registered');
    await migration.up({ queryInterface });
    await migration.up({ queryInterface });
    expect(queryInterface.addColumn).toHaveBeenCalledTimes(1);
    expect(queryInterface.addColumn).toHaveBeenCalledWith('TrailsDurableJournal', 'is_pinned', expect.objectContaining({ allowNull: false, defaultValue: false }));
    expect(queryInterface.addIndex).toHaveBeenCalledTimes(1);
    expect(queryInterface.addIndex).toHaveBeenCalledWith('TrailsDurableJournal', ['tenant_id', 'owner_user_id', 'visibility', 'lifecycle', 'is_pinned', 'published_at', 'id'], { name: 'trails_durable_journal_public_pinned' });
  });

  it('retries partial migration 023 without repeating an already-completed nullable email_hash alteration', async () => {
    const migration = migrationDefinitions.migrations.find((item: { id: string }) => item.id === migrationDefinitions.TRAILS_GUEST_COMMENT_OUTBOX_MIGRATION_ID);
    const tables = ['TrailsGuestComment'];
    const indexes: Array<{ name: string }> = [];
    const queryInterface = {
      showAllTables: jest.fn(async () => tables),
      describeTable: jest.fn(async () => ({ email_hash: { type: 'CHAR(64)', allowNull: true } })),
      changeColumn: jest.fn(),
      createTable: jest.fn(async (tableName: string) => { tables.push(tableName); }),
      showIndex: jest.fn(async () => indexes),
      addIndex: jest.fn(async (_tableName: string, _fields: string[], options: { name: string }) => { indexes.push({ name: options.name }); }),
    };
    const sequelize = { query: jest.fn(async () => [[]]) };

    if (!migration) throw new Error('Guest comment outbox migration is not registered');
    await migration.up({ queryInterface, sequelize });
    await migration.up({ queryInterface, sequelize });

    expect(queryInterface.changeColumn).not.toHaveBeenCalled();
    expect(sequelize.query).toHaveBeenCalledTimes(2);
    expect(queryInterface.createTable).toHaveBeenCalledTimes(1);
    expect(queryInterface.createTable).toHaveBeenCalledWith('TrailsGuestCommentNotification', expect.any(Object));
    expect(queryInterface.addIndex).toHaveBeenCalledTimes(1);
    expect(queryInterface.addIndex).toHaveBeenCalledWith('TrailsGuestCommentNotification', ['status', 'updated_at'], { name: 'trails_guest_comment_notification_retry' });
  });

  it('repairs a missing migration 023 retry index without recreating a partial outbox table', async () => {
    const migration = migrationDefinitions.migrations.find((item: { id: string }) => item.id === migrationDefinitions.TRAILS_GUEST_COMMENT_OUTBOX_MIGRATION_ID);
    const indexes: Array<{ name: string }> = [];
    const queryInterface = {
      showAllTables: jest.fn(async () => ['TrailsGuestComment', 'TrailsGuestCommentNotification']),
      describeTable: jest.fn(async () => ({ email_hash: { type: 'char(64)', allowNull: true } })),
      changeColumn: jest.fn(),
      createTable: jest.fn(),
      showIndex: jest.fn(async () => indexes),
      addIndex: jest.fn(async (_tableName: string, _fields: string[], options: { name: string }) => { indexes.push({ name: options.name }); }),
    };
    const sequelize = { query: jest.fn(async () => [[]]) };

    if (!migration) throw new Error('Guest comment outbox migration is not registered');
    await migration.up({ queryInterface, sequelize });
    await migration.up({ queryInterface, sequelize });

    expect(queryInterface.changeColumn).not.toHaveBeenCalled();
    expect(queryInterface.createTable).not.toHaveBeenCalled();
    expect(queryInterface.addIndex).toHaveBeenCalledTimes(1);
    expect(queryInterface.addIndex).toHaveBeenCalledWith('TrailsGuestCommentNotification', ['status', 'updated_at'], { name: 'trails_guest_comment_notification_retry' });
  });

  it('repairs the legacy outbox status enum after migration 024 was recorded and is safe to rerun', async () => {
    const migration = migrationDefinitions.migrations.find((item: { id: string }) => item.id === migrationDefinitions.TRAILS_GUEST_COMMENT_NOTIFICATION_STATUS_MIGRATION_ID);
    const columns: Record<string, { type: string }> = { status: { type: "ENUM('pending','failed','sent')" } };
    const queryInterface = {
      showAllTables: jest.fn(async () => ['TrailsGuestCommentNotification']),
      describeTable: jest.fn(async () => columns),
      changeColumn: jest.fn(async () => { columns.status = { type: "ENUM('pending','processing','retryable-failure','failed','sent')" }; }),
    };

    if (!migration) throw new Error('Guest comment notification status migration is not registered');
    await migration.up({ queryInterface });
    await migration.up({ queryInterface });

    expect(queryInterface.changeColumn).toHaveBeenCalledTimes(1);
    expect(queryInterface.changeColumn).toHaveBeenCalledWith('TrailsGuestCommentNotification', 'status', expect.objectContaining({ allowNull: false }));
  });

  it('skips the status repair when the outbox table is absent', async () => {
    const migration = migrationDefinitions.migrations.find((item: { id: string }) => item.id === migrationDefinitions.TRAILS_GUEST_COMMENT_NOTIFICATION_STATUS_MIGRATION_ID);
    const queryInterface = {
      showAllTables: jest.fn(async () => []),
      describeTable: jest.fn(),
      changeColumn: jest.fn(),
    };

    if (!migration) throw new Error('Guest comment notification status migration is not registered');
    await migration.up({ queryInterface });

    expect(queryInterface.describeTable).not.toHaveBeenCalled();
    expect(queryInterface.changeColumn).not.toHaveBeenCalled();
  });
});
