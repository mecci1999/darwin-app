import { Sequelize } from 'sequelize';
import initializeTrailsPortfolioCategory, { TrailsPortfolioCategoryTable } from '../../src/db/mysql/models/trailsPortfolioCategory';
import initializeTrailsSyncChange, { TrailsSyncChangeTable } from '../../src/db/mysql/models/trailsSyncChange';
import initializeTrailsSyncMutation, { TrailsSyncMutationTable } from '../../src/db/mysql/models/trailsSyncMutation';
import initializeTrailsDurablePortfolio, { TrailsDurablePortfolioTable } from '../../src/db/mysql/models/trailsDurablePortfolio';
import initializeTrailsDurableJournal, { TrailsDurableJournalTable } from '../../src/db/mysql/models/trailsDurableJournal';
import initializeTrailsDurableHike, { TrailsDurableHikeTable } from '../../src/db/mysql/models/trailsDurableHike';
import initializeTrailsDurableGear, { TrailsDurableGearTable } from '../../src/db/mysql/models/trailsDurableGear';
import initializeTrailsDurablePackingPlan, { TrailsDurablePackingPlanTable } from '../../src/db/mysql/models/trailsDurablePackingPlan';
import initializeTrailsDurablePackingPlanItem, { TrailsDurablePackingPlanItemTable } from '../../src/db/mysql/models/trailsDurablePackingPlanItem';
import initializeTrailsDurableFinance, { TrailsDurableFinanceTable } from '../../src/db/mysql/models/trailsDurableFinance';
import initializeTrailsDurableFinanceDeletionAudit, { TrailsDurableFinanceDeletionAuditTable } from '../../src/db/mysql/models/trailsDurableFinanceDeletionAudit';
import initializeTrailsDurableFinanceBalanceSnapshot, { TrailsDurableFinanceBalanceSnapshotTable } from '../../src/db/mysql/models/trailsDurableFinanceBalanceSnapshot';
import { createSequelizeTrailsPortfolioCategorySyncModels, MySqlPortfolioCategorySyncRepository, SequelizeTrailsSyncConnection } from '../../src/apps/starlight/trails/repository/mysqlPortfolioCategorySync';
import { createSequelizeDurablePortfolioModel, MySqlDurablePortfolioRepository } from '../../src/apps/starlight/trails/repository/mysqlDurablePortfolio';
import { createSequelizeDurableJournalModel, MySqlDurableJournalRepository } from '../../src/apps/starlight/trails/repository/mysqlDurableJournal';
import { createSequelizeDurableHikeModel, MySqlDurableHikeRepository } from '../../src/apps/starlight/trails/repository/mysqlDurableHike';
import { createSequelizeDurableGearModel, MySqlDurableGearRepository } from '../../src/apps/starlight/trails/repository/mysqlDurableGear';
import { createSequelizeDurablePackingPlanModels, MySqlDurablePackingPlanRepository } from '../../src/apps/starlight/trails/repository/mysqlDurablePackingPlan';
import { createSequelizeDurableFinanceModels, MySqlDurableFinanceRepository } from '../../src/apps/starlight/trails/repository/mysqlDurableFinance';
import { Actor } from '../../src/apps/starlight/trails/types';
const { applyTrailsCategoryMigrations } = require('../../scripts/migrations');

const enabled = process.env.TRAILS_MYSQL_INTEGRATION === '1';
const describeMySql = enabled ? describe : describe.skip;
const databaseName = 'darwin_trails_it';
const owner: Actor = { tenantId: 'mysql-it-tenant', userId: 'mysql-it-owner', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
let initialCreate: Awaited<ReturnType<MySqlPortfolioCategorySyncRepository['push']>>;

describeMySql('MySQL portfolio-category durable adapter', () => {
  const sequelize = new Sequelize(databaseName, 'darwin_trails_it', 'darwin_trails_it', { dialect: 'mysql', host: '127.0.0.1', port: 3308, logging: false });

  beforeAll(async () => {
    if (sequelize.getDatabaseName() !== databaseName) throw new Error('Refusing Trails integration schema setup outside darwin_trails_it');
    const categories = initializeTrailsPortfolioCategory(sequelize);
    const changes = initializeTrailsSyncChange(sequelize);
    const mutations = initializeTrailsSyncMutation(sequelize);
    const portfolios = initializeTrailsDurablePortfolio(sequelize);
    const journals = initializeTrailsDurableJournal(sequelize);
    const hikes = initializeTrailsDurableHike(sequelize);
    const gear = initializeTrailsDurableGear(sequelize);
    initializeTrailsDurablePackingPlan(sequelize);
    initializeTrailsDurablePackingPlanItem(sequelize);
    initializeTrailsDurableFinance(sequelize);
    initializeTrailsDurableFinanceBalanceSnapshot(sequelize);
    initializeTrailsDurableFinanceDeletionAudit(sequelize);
    await applyTrailsCategoryMigrations(sequelize);
    const repository = new MySqlPortfolioCategorySyncRepository(new SequelizeTrailsSyncConnection(sequelize), createSequelizeTrailsPortfolioCategorySyncModels({ categories, changes, mutations }));
    initialCreate = await repository.push(owner, { mutationId: 'mysql-it-mutation', resourceId: 'mysql-it-category', baseVersion: null, payload: { slug: 'mysql-it', nameZh: 'MySQL integration' } });
    const portfolioRepository = new MySqlDurablePortfolioRepository(new SequelizeTrailsSyncConnection(sequelize), createSequelizeDurablePortfolioModel(portfolios));
    await portfolioRepository.createDraft(owner, { id: 'mysql-it-portfolio', title: 'Draft', summary: 'Private draft', mediaIds: ['media-1'], visibility: 'public' });
    const journalRepository = new MySqlDurableJournalRepository(new SequelizeTrailsSyncConnection(sequelize), createSequelizeDurableJournalModel(journals));
    await journalRepository.createDraft(owner, { id: 'mysql-it-journal', title: 'Draft', excerpt: 'Private excerpt', body: 'Private journal body', visibility: 'public' });
    const hikeRepository = new MySqlDurableHikeRepository(new SequelizeTrailsSyncConnection(sequelize), createSequelizeDurableHikeModel(hikes));
    await hikeRepository.create(owner, { id: 'mysql-it-hike', title: 'Private hike', startedAt: '2026-07-31T00:00:00.000Z', route: { provider: 'private-provider', externalId: 'private-id', label: 'Private label' }, privateGeometry: 'PRIVATE GEOMETRY' });
    const gearRepository = new MySqlDurableGearRepository(new SequelizeTrailsSyncConnection(sequelize), createSequelizeDurableGearModel(gear));
    await gearRepository.create(owner, { id: 'mysql-it-gear', name: 'Pack', weightGrams: 1000, quantity: 1 });
  });

  afterAll(async () => { await sequelize.close(); });

  it('executes v2 durable category CRUD/read behavior, CAS, replay, archive/reorder, and ordered pull against the disposable database', async () => {
    const repository = new MySqlPortfolioCategorySyncRepository(new SequelizeTrailsSyncConnection(sequelize), createSequelizeTrailsPortfolioCategorySyncModels({ categories: TrailsPortfolioCategoryTable, changes: TrailsSyncChangeTable, mutations: TrailsSyncMutationTable }));
    const duplicate = await repository.push(owner, { mutationId: 'mysql-it-mutation', resourceId: 'mysql-it-category', baseVersion: null, payload: { slug: 'mysql-it', nameZh: 'MySQL integration' } });
    const updated = await repository.push(owner, { mutationId: 'mysql-it-update', resourceId: 'mysql-it-category', baseVersion: '1', payload: { slug: 'mysql-it', nameZh: 'MySQL integration updated', sortOrder: 7 } });
    const stale = await repository.push(owner, { mutationId: 'mysql-it-stale', resourceId: 'mysql-it-category', baseVersion: '1', payload: { slug: 'mysql-it', nameZh: 'Stale update' } });
    const second = await repository.create(owner, { mutationId: 'mysql-it-second', resourceId: 'mysql-it-category-2', baseVersion: null, payload: { slug: 'mysql-it-second', nameZh: 'Second', visibility: 'public', sortOrder: 1 } });
    await repository.push(owner, { mutationId: 'mysql-it-draft', resourceId: 'mysql-it-draft', baseVersion: null, payload: { slug: 'mysql-it-draft', nameZh: 'Draft', visibility: 'public' } });
    const reordered = await repository.reorder(owner, [
      { mutationId: 'mysql-it-reorder-batch:0', resourceId: 'mysql-it-category-2', baseVersion: second.kind === 'conflict' ? '0' : second.resource.resourceVersion, payload: { sortOrder: 0 } },
      { mutationId: 'mysql-it-reorder-batch:1', resourceId: 'mysql-it-category', baseVersion: updated.kind === 'conflict' ? '0' : updated.resource.resourceVersion, payload: { sortOrder: 1 } },
    ]);
    const archived = await repository.archive(owner, { mutationId: 'mysql-it-archive', resourceId: 'mysql-it-category', baseVersion: reordered[1].kind === 'conflict' ? '0' : reordered[1].resource.resourceVersion, payload: {} });
    const reorderReplay = await repository.reorder(owner, [
      { mutationId: 'mysql-it-reorder-batch:0', resourceId: 'mysql-it-category-2', baseVersion: second.kind === 'conflict' ? '0' : second.resource.resourceVersion, payload: { sortOrder: 0 } },
      { mutationId: 'mysql-it-reorder-batch:1', resourceId: 'mysql-it-category', baseVersion: updated.kind === 'conflict' ? '0' : updated.resource.resourceVersion, payload: { sortOrder: 1 } },
    ]);
    const workspace = await repository.listWorkspace(owner);
    const publicCategories = await repository.listPublic({ tenantId: owner.tenantId, userId: owner.userId });
    const result = await repository.pull(owner, '0');

    expect(initialCreate).toEqual(expect.objectContaining({ kind: 'applied', resource: expect.objectContaining({ id: 'mysql-it-category', slug: 'mysql-it', nameZh: 'MySQL integration', resourceVersion: '1' }) }));
    expect(duplicate.kind).toBe('duplicate');
    expect(updated).toEqual(expect.objectContaining({ kind: 'applied', resource: expect.objectContaining({ resourceVersion: '2', nameZh: 'MySQL integration updated', sortOrder: 7 }) }));
    expect(stale).toEqual(expect.objectContaining({ kind: 'conflict', code: 'STALE_VERSION', current: expect.objectContaining({ resourceVersion: '2', nameZh: 'MySQL integration updated' }) }));
    expect(reordered.every((entry) => entry.kind === 'applied')).toBe(true);
    expect(reorderReplay.map((entry) => entry.kind)).toEqual(['duplicate', 'duplicate']);
    expect(archived).toEqual(expect.objectContaining({ kind: 'applied', resource: expect.objectContaining({ status: 'archived' }) }));
    expect(workspace.map((entry) => entry.slug)).toEqual(['mysql-it-draft', 'mysql-it-second', 'mysql-it']);
    expect(publicCategories.map((entry) => entry.slug)).toEqual(['mysql-it-second']);
    expect(result.changes).toHaveLength(7);
    expect(result.changes.map((change) => change.resource.resourceVersion)).toEqual(['1', '2', '1', '1', '2', '3', '4']);
  });

  it('persists portfolio drafts and exposes only public published records', async () => {
    const repository = new MySqlDurablePortfolioRepository(new SequelizeTrailsSyncConnection(sequelize), createSequelizeDurablePortfolioModel(TrailsDurablePortfolioTable));
    const draftWorkspace = await repository.listWorkspace(owner);
    const published = await repository.publish(owner, { id: 'mysql-it-portfolio', resourceVersion: '1' });
    const privateDraft = await repository.createDraft(owner, { id: 'mysql-it-private', title: 'Private', summary: 'Private', mediaIds: [], visibility: 'private' });
    await repository.publish(owner, { id: privateDraft.id, resourceVersion: privateDraft.resourceVersion });
    const publicRecords = await repository.listPublic({ tenantId: owner.tenantId, userId: owner.userId });
    const sameTenantOtherOwner: Actor = { tenantId: owner.tenantId, userId: 'mysql-it-other-owner', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
    const otherWorkspace = await repository.listWorkspace(sameTenantOtherOwner);

    expect(draftWorkspace).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'mysql-it-portfolio', lifecycle: 'draft', resourceVersion: '1' })]));
    expect(published).toEqual(expect.objectContaining({ lifecycle: 'published', resourceVersion: '2' }));
    expect(publicRecords).toEqual([expect.objectContaining({ id: 'mysql-it-portfolio', visibility: 'public', lifecycle: 'published' })]);
    expect(otherWorkspace).toEqual([]);
    await expect(repository.publish(owner, { id: published.id, resourceVersion: published.resourceVersion })).rejects.toThrow('只有草稿作品集可以发布');
  });

  it('rejects a portfolio publish at the unsigned BIGINT version ceiling without changing the draft', async () => {
    const repository = new MySqlDurablePortfolioRepository(new SequelizeTrailsSyncConnection(sequelize), createSequelizeDurablePortfolioModel(TrailsDurablePortfolioTable));
    await repository.createDraft(owner, { id: 'mysql-it-portfolio-max-version', title: 'Ceiling', summary: 'Ceiling', mediaIds: [], visibility: 'private' });
    await sequelize.query("UPDATE TrailsDurablePortfolio SET resource_version = '18446744073709551615' WHERE tenant_id = ? AND id = ?", { replacements: [owner.tenantId, 'mysql-it-portfolio-max-version'] });

    await expect(repository.publish(owner, { id: 'mysql-it-portfolio-max-version', resourceVersion: '18446744073709551615' })).rejects.toThrow('作品集版本已达到存储上限');
    expect(await repository.listWorkspace(owner)).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'mysql-it-portfolio-max-version', lifecycle: 'draft', resourceVersion: '18446744073709551615' })]));
  });

  it('persists journal drafts, publishes with CAS, excludes private records, and isolates owners', async () => {
    const repository = new MySqlDurableJournalRepository(new SequelizeTrailsSyncConnection(sequelize), createSequelizeDurableJournalModel(TrailsDurableJournalTable));
    const draftWorkspace = await repository.listWorkspace(owner);
    const published = await repository.publish(owner, { id: 'mysql-it-journal', resourceVersion: '1' });
    const privateDraft = await repository.createDraft(owner, { id: 'mysql-it-private-journal', title: 'Private', excerpt: 'Private', body: 'Private body', visibility: 'private' });
    await repository.publish(owner, { id: privateDraft.id, resourceVersion: privateDraft.resourceVersion });
    const publicRecords = await repository.listPublic({ tenantId: owner.tenantId, userId: owner.userId });
    const sameTenantOtherOwner: Actor = { tenantId: owner.tenantId, userId: 'mysql-it-other-owner', isAdmin: false, creatorSpaceRole: 'creator-space-owner' };
    const otherWorkspace = await repository.listWorkspace(sameTenantOtherOwner);

    expect(draftWorkspace).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'mysql-it-journal', lifecycle: 'draft', resourceVersion: '1' })]));
    expect(published).toEqual(expect.objectContaining({ lifecycle: 'published', resourceVersion: '2', publishedAt: expect.any(String) }));
    expect(publicRecords).toEqual([expect.objectContaining({ id: 'mysql-it-journal', visibility: 'public', lifecycle: 'published' })]);
    expect(otherWorkspace).toEqual([]);
    await expect(repository.publish(owner, { id: published.id, resourceVersion: published.resourceVersion })).rejects.toThrow('只有草稿日记可以发布');
  });

  it('persists owner-private current balances through the retention cut-off and irreversibly redacts eligible payloads', async () => {
    const models = createSequelizeDurableFinanceModels(TrailsDurableFinanceTable, TrailsDurableFinanceDeletionAuditTable, TrailsDurableFinanceBalanceSnapshotTable);
    let currentTime = new Date('2026-07-31T00:00:00.000Z');
    const repository = new MySqlDurableFinanceRepository(new SequelizeTrailsSyncConnection(sequelize), models.finance, models.audits, models.snapshots, () => currentTime);
    const sameTenantAdmin: Actor = { tenantId: owner.tenantId, userId: 'mysql-it-finance-admin', isAdmin: true, creatorSpaceRole: 'creator-space-owner' };
    const created = await repository.create(owner, { id: 'mysql-it-finance', occurredOn: '2026-07-31', category: 'equipment', amountCents: 1000, currency: 'CNY' });
    await repository.recordBalance(owner, { id: 'mysql-it-balance-old', balanceCents: -2500, currency: 'CNY' });
    currentTime = new Date('2026-08-01T00:00:00.000Z');
    await repository.recordBalance(owner, { id: 'mysql-it-balance-current', balanceCents: -1500, currency: 'CNY' });
    currentTime = new Date('2026-08-02T00:00:00.000Z');
    await repository.recordBalance(owner, { id: 'mysql-it-balance-usd', balanceCents: 500, currency: 'USD' });
    expect(await repository.currentBalances(sameTenantAdmin)).toEqual([]);
    expect(await repository.currentBalances(owner)).toEqual([
      expect.objectContaining({ id: 'mysql-it-balance-current', balanceCents: -1500, currency: 'CNY' }),
      expect.objectContaining({ id: 'mysql-it-balance-usd', balanceCents: 500, currency: 'USD' }),
    ]);
    currentTime = new Date('2037-01-01T00:00:00.000Z');
    const disposed = await repository.disposeEligible(owner);
    const workspace = await repository.listWorkspace(owner);
    const audits = await TrailsDurableFinanceDeletionAuditTable.findAll();

    expect(created).toEqual(expect.objectContaining({ retentionExpiresAt: '2037-01-01T00:00:00.000Z', visibility: 'private', lifecycle: 'draft' }));
    expect(disposed).toEqual(expect.objectContaining({ outcome: 'disposed', disposedCount: 4 }));
    expect(workspace).toEqual([expect.objectContaining({ id: 'mysql-it-finance', disposedAt: '2037-01-01T00:00:00.000Z' })]);
    expect(workspace[0]).not.toHaveProperty('occurredOn'); expect(workspace[0]).not.toHaveProperty('category'); expect(workspace[0]).not.toHaveProperty('amountCents'); expect(workspace[0]).not.toHaveProperty('currency');
    expect(await repository.currentBalances(owner)).toEqual([]);
    expect(audits.map((audit) => Object.keys(audit.get()).sort())).toEqual([['createdAt', 'eligibleAt', 'eventId', 'eventType', 'executedAt', 'outcome', 'policyVersion', 'scopeDigest', 'updatedAt']]);
  });

  it('rejects a journal publish at the unsigned BIGINT version ceiling without changing the draft', async () => {
    const repository = new MySqlDurableJournalRepository(new SequelizeTrailsSyncConnection(sequelize), createSequelizeDurableJournalModel(TrailsDurableJournalTable));
    await repository.createDraft(owner, { id: 'mysql-it-journal-max-version', title: 'Ceiling', excerpt: 'Ceiling', body: 'Ceiling', visibility: 'private' });
    await sequelize.query("UPDATE TrailsDurableJournal SET resource_version = '18446744073709551615' WHERE tenant_id = ? AND id = ?", { replacements: [owner.tenantId, 'mysql-it-journal-max-version'] });

    await expect(repository.publish(owner, { id: 'mysql-it-journal-max-version', resourceVersion: '18446744073709551615' })).rejects.toThrow('日记版本已达到存储上限');
    expect(await repository.listWorkspace(owner)).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'mysql-it-journal-max-version', lifecycle: 'draft', resourceVersion: '18446744073709551615' })]));
  });

  it('persists permanently private actor-owned hikes and isolates same-tenant and cross-tenant actors', async () => {
    const repository = new MySqlDurableHikeRepository(new SequelizeTrailsSyncConnection(sequelize), createSequelizeDurableHikeModel(TrailsDurableHikeTable));
    const ownerWorkspace = await repository.listWorkspace(owner);
    const sameTenantOther: Actor = { tenantId: owner.tenantId, userId: 'mysql-it-other-owner', isAdmin: true, creatorSpaceRole: 'creator-space-owner' };
    const crossTenantSameUser: Actor = { tenantId: 'mysql-it-other-tenant', userId: owner.userId, isAdmin: true };

    expect(ownerWorkspace).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'mysql-it-hike', visibility: 'private', lifecycle: 'draft', resourceVersion: '1', privateGeometry: 'PRIVATE GEOMETRY', route: { provider: 'private-provider', externalId: 'private-id', label: 'Private label' } })]));
    expect(await repository.listWorkspace(sameTenantOther)).toEqual([]);
    expect(await repository.listWorkspace(crossTenantSameUser)).toEqual([]);
  });

  it('persists private gear, CAS-updates/deactivates it, retains inactive history, and isolates same-tenant admins', async () => {
    const repository = new MySqlDurableGearRepository(new SequelizeTrailsSyncConnection(sequelize), createSequelizeDurableGearModel(TrailsDurableGearTable));
    const updated = await repository.update(owner, { id: 'mysql-it-gear', resourceVersion: '1', name: 'Updated pack', weightGrams: 1200, quantity: 2 });
    const deactivated = await repository.deactivate(owner, { id: 'mysql-it-gear', resourceVersion: '2' });
    const sameTenantAdmin: Actor = { tenantId: owner.tenantId, userId: 'mysql-it-admin', isAdmin: true, creatorSpaceRole: 'creator-space-owner' };

    expect(updated).toEqual(expect.objectContaining({ name: 'Updated pack', weightGrams: 1200, quantity: 2, active: true, visibility: 'private', lifecycle: 'draft', resourceVersion: '2' }));
    expect(deactivated).toEqual(expect.objectContaining({ active: false, resourceVersion: '3' }));
    expect(await repository.listWorkspace(owner)).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'mysql-it-gear', active: false, resourceVersion: '3' })]));
    expect(await repository.listWorkspace(sameTenantAdmin)).toEqual([]);
    await expect(repository.update(owner, { id: 'mysql-it-gear', resourceVersion: '2', name: 'Stale', weightGrams: 1, quantity: 1 })).rejects.toThrow('装备版本已过期');
    await expect(repository.deactivate(owner, { id: 'mysql-it-gear', resourceVersion: '3' })).rejects.toThrow('装备已停用');
  });

  it('rejects gear mutation at the unsigned BIGINT version ceiling without changing the record', async () => {
    const repository = new MySqlDurableGearRepository(new SequelizeTrailsSyncConnection(sequelize), createSequelizeDurableGearModel(TrailsDurableGearTable));
    await repository.create(owner, { id: 'mysql-it-gear-max-version', name: 'Ceiling', weightGrams: 1, quantity: 1 });
    await sequelize.query("UPDATE TrailsDurableGear SET resource_version = '18446744073709551615' WHERE tenant_id = ? AND id = ?", { replacements: [owner.tenantId, 'mysql-it-gear-max-version'] });

    await expect(repository.deactivate(owner, { id: 'mysql-it-gear-max-version', resourceVersion: '18446744073709551615' })).rejects.toThrow('装备版本已达到存储上限');
    expect(await repository.listWorkspace(owner)).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'mysql-it-gear-max-version', active: true, resourceVersion: '18446744073709551615' })]));
  });

  it('persists actor-private plans with immutable ordered gear snapshots and atomically replaces selections', async () => {
    const gearRepository = new MySqlDurableGearRepository(new SequelizeTrailsSyncConnection(sequelize), createSequelizeDurableGearModel(TrailsDurableGearTable));
    await gearRepository.create(owner, { id: 'mysql-it-plan-gear-1', name: 'Tent', weightGrams: 1200, quantity: 1 });
    await gearRepository.create(owner, { id: 'mysql-it-plan-gear-2', name: 'Food', weightGrams: 800, quantity: 1 });
    const repository = new MySqlDurablePackingPlanRepository(new SequelizeTrailsSyncConnection(sequelize), createSequelizeDurablePackingPlanModels(TrailsDurablePackingPlanTable, TrailsDurablePackingPlanItemTable, TrailsDurableGearTable));
    const created = await repository.create(owner, { id: 'mysql-it-plan', name: 'Overnight', gearIds: ['mysql-it-plan-2-not-found'] }).catch(() => undefined);
    expect(created).toBeUndefined();
    const plan = await repository.create(owner, { id: 'mysql-it-plan', name: 'Overnight', gearIds: ['mysql-it-plan-gear-2', 'mysql-it-plan-gear-1'] });
    await gearRepository.deactivate(owner, { id: 'mysql-it-plan-gear-1', resourceVersion: '1' });
    const retained = await repository.listWorkspace(owner);
    const updated = await repository.update(owner, { id: plan.id, resourceVersion: plan.resourceVersion, name: 'Light', gearIds: ['mysql-it-plan-gear-2'] });
    const other: Actor = { tenantId: owner.tenantId, userId: 'mysql-it-other-owner', isAdmin: true };
    expect(plan).toEqual(expect.objectContaining({ snapshotWeightGrams: 2000, items: [{ gearId: 'mysql-it-plan-gear-2', snapshotWeightGrams: 800, sortOrder: 0 }, { gearId: 'mysql-it-plan-gear-1', snapshotWeightGrams: 1200, sortOrder: 1 }] }));
    expect(retained).toEqual([expect.objectContaining({ id: plan.id, snapshotWeightGrams: 2000 })]);
    expect(updated).toEqual(expect.objectContaining({ resourceVersion: '2', snapshotWeightGrams: 800, items: [{ gearId: 'mysql-it-plan-gear-2', snapshotWeightGrams: 800, sortOrder: 0 }] }));
    expect(await repository.listWorkspace(other)).toEqual([]);
    await expect(repository.update(owner, { id: plan.id, resourceVersion: '2', name: 'Invalid', gearIds: ['mysql-it-plan-gear-1'] })).rejects.toThrow('装备已停用');
    expect(await repository.listWorkspace(owner)).toEqual([expect.objectContaining({ id: plan.id, name: 'Light', resourceVersion: '2', snapshotWeightGrams: 800 })]);
  });
});
