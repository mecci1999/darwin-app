import { Sequelize } from 'sequelize';
import initializeTrailsMediaAssetRegistry, { TrailsMediaAssetRegistryTable } from '../../src/db/mysql/models/trailsMediaAssetRegistry';
import initializeTrailsMediaAssetVariant, { TrailsMediaAssetVariantTable } from '../../src/db/mysql/models/trailsMediaAssetVariant';
import initializeTrailsMediaAssetArtifact, { TrailsMediaAssetArtifactTable } from '../../src/db/mysql/models/trailsMediaAssetArtifact';
import initializeTrailsMediaAssetRegistryMutation, { TrailsMediaAssetRegistryMutationTable } from '../../src/db/mysql/models/trailsMediaAssetRegistryMutation';
import { Actor, DurableMediaAssetArtifactDescriptor } from '../../src/apps/trails/types';
import { createSequelizeMediaAssetRegistryModels, MySqlMediaAssetRegistryRepository } from '../../src/apps/trails/repository/mysqlMediaAssetRegistry';
import { SequelizeTrailsSyncConnection } from '../../src/apps/trails/repository/mysqlPortfolioCategorySync';

const enabled = process.env.TRAILS_MYSQL_INTEGRATION === '1';
const describeIntegration = enabled ? describe : describe.skip;
const owner: Actor = { tenantId: 'mysql-media-tenant', userId: 'mysql-media-owner', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };

describeIntegration('durable media asset registry MySQL schema', () => {
  let sequelize: Sequelize;
  let repository: MySqlMediaAssetRegistryRepository;
  beforeAll(async () => {
    sequelize = new Sequelize('darwin_trails_it', 'darwin_trails_it', 'darwin_trails_it', { host: '127.0.0.1', port: 3308, dialect: 'mysql', logging: false });
    await sequelize.authenticate();
    const assets = initializeTrailsMediaAssetRegistry(sequelize);
    const variants = initializeTrailsMediaAssetVariant(sequelize);
    const artifacts = initializeTrailsMediaAssetArtifact(sequelize);
    const mutations = initializeTrailsMediaAssetRegistryMutation(sequelize);
    await require('../../scripts/migrations').applyTrailsCategoryMigrations(sequelize);
    repository = new MySqlMediaAssetRegistryRepository(new SequelizeTrailsSyncConnection(sequelize), createSequelizeMediaAssetRegistryModels(assets, variants, artifacts, mutations));
  });
  afterAll(async () => { await sequelize.close(); });
  it('creates registry, public variants, private artifacts, and actor-scoped mutation-ledger tables', async () => {
    const query = sequelize.getQueryInterface();
    expect((await query.showAllTables()).map(String)).toEqual(expect.arrayContaining(['TrailsMediaAssetRegistry', 'TrailsMediaAssetVariant', 'TrailsMediaAssetArtifact', 'TrailsMediaAssetRegistryMutation']));
    const registryIndexes = await query.showIndex('TrailsMediaAssetRegistry') as Array<{ name: string; fields: Array<{ attribute?: string; name?: string }> }>;
    const ownerStatus = registryIndexes.find(index => index.name === 'trails_media_asset_owner_status');
    expect(ownerStatus?.fields.map(field => field.attribute ?? field.name)).toEqual(['tenant_id', 'owner_user_id', 'status']);
    const mutations = await query.showIndex('TrailsMediaAssetRegistryMutation') as Array<{ name: string; primary?: boolean; fields: Array<{ attribute?: string; name?: string }> }>;
    const primary = mutations.find(index => index.primary || index.name === 'PRIMARY');
    expect(primary?.fields.map(field => field.attribute ?? field.name)).toEqual(['tenant_id', 'actor_user_id', 'mutation_id']);
  });
  it('persists exactly the private nine-artifact matrix without changing public projection', async () => {
    const registered = await repository.register(owner, { mutationId: 'mysql-artifacts-register', expectedResourceVersion: null, id: 'mysql-artifact-asset', mimeType: 'image/jpeg', privateMasterLocator: 'mysql_artifact_master' });
    const artifacts: DurableMediaAssetArtifactDescriptor[] = (['grid-960', 'cover-2048', 'preview-4096'] as const).flatMap(logicalRendition => (['avif', 'webp', 'jpeg'] as const).map(codec => ({ logicalRendition, codec, mimeType: `image/${codec}` as DurableMediaAssetArtifactDescriptor['mimeType'], privateLocator: `${logicalRendition}_${codec}`, width: 960, height: 600, byteLength: 100, sha256: 'a'.repeat(64) })));
    const persisted = await repository.persistArtifacts(owner, { mutationId: 'mysql-artifacts-persist', expectedResourceVersion: registered.resourceVersion, assetId: registered.id, artifacts });
    expect(persisted.resourceVersion).toBe('2');
    expect(await TrailsMediaAssetArtifactTable.count({ where: { tenantId: owner.tenantId, assetId: registered.id } })).toBe(9);
    expect(await TrailsMediaAssetVariantTable.count({ where: { tenantId: owner.tenantId, assetId: registered.id } })).toBe(0);
    expect(JSON.stringify(persisted)).not.toMatch(/mysql_artifact_master|grid-960_avif|https?:\/\//);
  });
  it('persists and replays register, approved derivative, and publish mutations exactly once', async () => {
    const register = { mutationId: 'mysql-register', expectedResourceVersion: null, id: 'mysql-media-asset', mimeType: 'image/jpeg', privateMasterLocator: 'mysql_master_locator' };
    const firstRegister = await repository.register(owner, register);
    const replayRegister = await repository.register(owner, register);
    expect(replayRegister).toEqual(firstRegister);
    const artifacts: DurableMediaAssetArtifactDescriptor[] = (['grid-960', 'cover-2048', 'preview-4096'] as const).flatMap(logicalRendition => (['avif', 'webp', 'jpeg'] as const).map(codec => ({ logicalRendition, codec, mimeType: `image/${codec}` as DurableMediaAssetArtifactDescriptor['mimeType'], privateLocator: `${logicalRendition}_${codec}_approval`, width: 960, height: 600, byteLength: 100, sha256: 'a'.repeat(64) })));
    const persisted = await repository.persistArtifacts(owner, { mutationId: 'mysql-persist', expectedResourceVersion: firstRegister.resourceVersion, assetId: firstRegister.id, artifacts });
    const approval = { mutationId: 'mysql-approval', expectedResourceVersion: persisted.resourceVersion, assetId: persisted.id, publication: { approvalId: 'approval_1', identityMode: 'workload-identity' as const } };
    const current = await repository.approvePublicDerivatives(owner, approval);
    expect(await repository.approvePublicDerivatives(owner, approval)).toEqual(current);
    const publish = { mutationId: 'mysql-publish', expectedResourceVersion: current.resourceVersion, id: current.id };
    const firstPublish = await repository.publish(owner, publish);
    const replayPublish = await repository.publish(owner, publish);
    expect(firstPublish).toEqual(expect.objectContaining({ status: 'published', resourceVersion: '4' }));
    expect(replayPublish).toEqual(firstPublish);
    expect(await TrailsMediaAssetRegistryTable.count({ where: { tenantId: owner.tenantId, id: current.id } })).toBe(1);
    expect(await TrailsMediaAssetVariantTable.count({ where: { tenantId: owner.tenantId, assetId: current.id } })).toBe(3);
    expect(await TrailsMediaAssetRegistryMutationTable.count({ where: { tenantId: owner.tenantId, actorUserId: owner.userId } })).toBe(4);
    expect(JSON.stringify(firstPublish)).not.toMatch(/mysql_master_locator|https?:\/\/|publicReference|privateLocator/);
    expect('getPublicById' in repository).toBe(false);
  });
  it('propagates an asset primary-key collision with a distinct mutation instead of replaying the ledger', async () => {
    const first = { mutationId: 'mysql-asset-unique-first', expectedResourceVersion: null, id: 'mysql-media-asset-unique', mimeType: 'image/jpeg', privateMasterLocator: 'mysql_unique_master' };
    await repository.register(owner, first);
    const collision = { ...first, mutationId: 'mysql-asset-unique-second' };
    await expect(repository.register(owner, collision)).rejects.toMatchObject({ name: 'SequelizeUniqueConstraintError' });
    expect(await TrailsMediaAssetRegistryMutationTable.count({ where: { tenantId: owner.tenantId, actorUserId: owner.userId, mutationId: collision.mutationId } })).toBe(0);
  });
});
