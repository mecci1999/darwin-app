import { Model, ModelStatic } from 'sequelize';
jest.mock('config', () => ({ MYSQL_HOST: '', MYSQL_PORT: '', MYSQL_DATABASE: '', MYSQL_PASSWORD: '', MYSQL_USER: '' }), { virtual: true });

import { mainConnection } from '../../src/db/mysql';
import { DataBaseTableNames } from '../../src/typings';
import { durableTrailsPersistenceEnabled } from '../../src/apps/starlight/trails/durable-persistence';
import { DurableCategorySyncConnection, DurableCategorySyncConnectionFactory, DurableCategorySyncLifecycle, durableCategorySyncModelKeys } from '../../src/apps/starlight/trails/durable-category-sync-lifecycle';
import { InMemoryTrailsRepository } from '../../src/apps/starlight/trails/repository';
import { TrailsState } from '../../src/apps/starlight/trails/types';

type RegisteredModels = Partial<Record<typeof durableCategorySyncModelKeys[number], ModelStatic<Model>>>;

class FakeConnection implements DurableCategorySyncConnection {
  readonly authenticate = jest.fn(async () => undefined);
  readonly close = jest.fn(async () => undefined);
  readonly requestedKeys: string[] = [];

  constructor(private readonly models: RegisteredModels) {}

  getModel<T extends Model>(key: typeof durableCategorySyncModelKeys[number]): ModelStatic<T> | undefined {
    this.requestedKeys.push(key);
    return this.models[key] as ModelStatic<T> | undefined;
  }

  async transaction<T>(work: (transaction: object) => Promise<T>): Promise<T> {
    return work({});
  }

  async query(_sql: string, _options: { replacements: unknown[]; transaction: object }): Promise<[unknown, unknown]> {
    return [[], []];
  }
}

class FakeFactory implements DurableCategorySyncConnectionFactory {
  readonly create = jest.fn(() => this.connections.shift() ?? new FakeConnection({}));

  constructor(private readonly connections: FakeConnection[]) {}
}

const models: RegisteredModels = {
  [DataBaseTableNames.TrailsPortfolioCategory]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsSyncChange]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsSyncMutation]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsDurablePortfolio]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsDurableJournal]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsRichDocument]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsRichDocumentRevision]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsDurableHike]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsDurableGear]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsDurablePackingPlan]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsDurablePackingPlanItem]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsDurableFinance]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsDurableFinanceBalanceSnapshot]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsDurableFinanceDeletionAudit]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsDurableMediaCommerce]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsDurableMediaCommerceMutation]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsMediaAssetRegistry]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsMediaAssetVariant]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsMediaAssetArtifact]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsMediaAssetRegistryMutation]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsTrustedPhotoshopIngestionOperation]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsTrustedPhotoshopIngestionArtifact]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsTrustedPhotoshopStorageWriteFence]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsDurablePublishingPackage]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsDurablePublishingPackageMutation]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsDurablePublishingPackageAudit]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsPublicSiteContent]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsGuestComment]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsGuestCommentAudit]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsGuestCommentNotification]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsDurableGuidedTrip]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsDurableGuidedTripMutation]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsDurableGuidedTripAudit]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsDurableExternalVideoReference]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsDurableExternalVideoReferenceMutation]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsDurableExternalVideoReferenceAudit]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsDurableLocationCard]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsDurableLocationCardMutation]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsDurableLocationCardAudit]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsShootingLocation]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsShootingLocationMutation]: {} as ModelStatic<Model>,
  [DataBaseTableNames.TrailsShootingLocationAudit]: {} as ModelStatic<Model>,
};
const state = (): TrailsState => ({ repository: new InMemoryTrailsRepository() });

const expectDurableStateCleared = (trailsState: TrailsState) => {
  expect(trailsState.durablePortfolioCategorySync).toBeUndefined();
  expect(trailsState.durablePortfolioStore).toBeUndefined();
  expect(trailsState.durableJournalStore).toBeUndefined();
  expect(trailsState.durableRichDocumentStore).toBeUndefined();
  expect(trailsState.durableHikeStore).toBeUndefined();
  expect(trailsState.durableGearStore).toBeUndefined();
  expect(trailsState.durablePackingPlanStore).toBeUndefined();
  expect(trailsState.durableFinanceStore).toBeUndefined();
  expect(trailsState.durableMediaCommerceStore).toBeUndefined();
  expect(trailsState.durableMediaAssetRegistryStore).toBeUndefined();
  expect(trailsState.durablePublishingPackageStore).toBeUndefined();
  expect(trailsState.durablePublicSiteContentStore).toBeUndefined();
  expect(trailsState.durableGuestCommentStore).toBeUndefined();
  expect(trailsState.durableGuidedTripStore).toBeUndefined();
  expect(trailsState.shootingLocationStore).toBeUndefined();
  expect('publicMediaAssetCatalog' in trailsState).toBe(false);
};

describe('Trails durable persistence feature gate', () => {
  it.each([undefined, '', '1', 'TRUE', 'false', ' true '])('defaults closed for %#', (value) => {
    expect(durableTrailsPersistenceEnabled({ TRAILS_DURABLE_PERSISTENCE_ENABLED: value })).toBe(false);
  });

  it('enables only the explicit true value', () => {
    expect(durableTrailsPersistenceEnabled({ TRAILS_DURABLE_PERSISTENCE_ENABLED: 'true' })).toBe(true);
  });

  it('uses the legacy category flag only when the durable persistence flag is absent', () => {
    expect(durableTrailsPersistenceEnabled({ TRAILS_DURABLE_CATEGORY_SYNC: 'true' })).toBe(true);
    expect(durableTrailsPersistenceEnabled({ TRAILS_DURABLE_PERSISTENCE_ENABLED: 'false', TRAILS_DURABLE_CATEGORY_SYNC: 'true' })).toBe(false);
    expect(durableTrailsPersistenceEnabled({ TRAILS_DURABLE_PERSISTENCE_ENABLED: 'true', TRAILS_DURABLE_CATEGORY_SYNC: 'false' })).toBe(false);
  });

  it('accepts matching explicit and legacy settings without broadening exact-value semantics', () => {
    expect(durableTrailsPersistenceEnabled({ TRAILS_DURABLE_PERSISTENCE_ENABLED: 'true', TRAILS_DURABLE_CATEGORY_SYNC: 'true' })).toBe(true);
    expect(durableTrailsPersistenceEnabled({ TRAILS_DURABLE_PERSISTENCE_ENABLED: 'false', TRAILS_DURABLE_CATEGORY_SYNC: 'false' })).toBe(false);
  });
});

describe('DurableCategorySyncLifecycle', () => {
  beforeEach(() => { process.env.TRAILS_GUEST_COMMENT_NOTIFICATION_KEY = Buffer.alloc(32, 7).toString('base64'); });
  afterEach(() => { delete process.env.TRAILS_GUEST_COMMENT_NOTIFICATION_KEY; });
  it('leaves every durable store unavailable until enabled composition starts', () => {
    expectDurableStateCleared(state());
  });

  it('authenticates and composes every durable store without global connection state', async () => {
    const connection = new FakeConnection(models);
    const lifecycle = new DurableCategorySyncLifecycle(new FakeFactory([connection]));
    const trailsState = state();
    const originalConnection = mainConnection.connection;
    const originalPromise = mainConnection.promise;

    await lifecycle.start(trailsState);

    expect(connection.authenticate).toHaveBeenCalledTimes(1);
    expect(connection.requestedKeys).toEqual(durableCategorySyncModelKeys);
    expect(mainConnection.connection).toBe(originalConnection);
    expect(mainConnection.promise).toBe(originalPromise);
    expect(trailsState.durablePortfolioCategorySync).toBeDefined();
    expect(trailsState.durablePortfolioStore).toBeDefined();
    expect(trailsState.durableJournalStore).toBeDefined();
    expect(trailsState.durableRichDocumentStore).toBeDefined();
    expect(trailsState.durableHikeStore).toBeDefined();
    expect(trailsState.durableGearStore).toBeDefined();
    expect(trailsState.durablePackingPlanStore).toBeDefined();
    expect(trailsState.durableFinanceStore).toBeDefined();
    expect(trailsState.durableMediaCommerceStore).toBeDefined();
    expect(trailsState.durableMediaAssetRegistryStore).toBeDefined();
    expect(trailsState.durablePublicSiteContentStore).toBeDefined();
    expect(trailsState.durableGuestCommentStore).toBeDefined();
    expect(trailsState.durableGuidedTripStore).toBeDefined();
    expect(trailsState.shootingLocationStore).toBeDefined();
    expect('publicMediaAssetCatalog' in trailsState).toBe(false);
  });

  it('closes its private connection and leaves state unset when startup fails', async () => {
    const connection = new FakeConnection({});
    const lifecycle = new DurableCategorySyncLifecycle(new FakeFactory([connection]));
    const trailsState = state();

    await expect(lifecycle.start(trailsState)).rejects.toThrow('models are unavailable');

    expect(connection.close).toHaveBeenCalledTimes(1);
    expectDurableStateCleared(trailsState);
  });

  it('preserves an authentication failure while clearing every durable dependency', async () => {
    const connection = new FakeConnection(models);
    connection.authenticate.mockRejectedValueOnce(new Error('authentication failed'));
    const lifecycle = new DurableCategorySyncLifecycle(new FakeFactory([connection]));
    const trailsState = state();

    await expect(lifecycle.start(trailsState)).rejects.toThrow('authentication failed');

    expect(connection.close).toHaveBeenCalledTimes(1);
    expectDurableStateCleared(trailsState);
  });

  it('preserves a model lookup failure while closing and clearing every durable dependency', async () => {
    const connection = new FakeConnection(models);
    const originalError = new Error('model lookup failed');
    jest.spyOn(connection, 'getModel').mockImplementationOnce(() => { throw originalError; });
    const lifecycle = new DurableCategorySyncLifecycle(new FakeFactory([connection]));
    const trailsState = state();

    await expect(lifecycle.start(trailsState)).rejects.toBe(originalError);

    expect(connection.close).toHaveBeenCalledTimes(1);
    expectDurableStateCleared(trailsState);
  });

  it('clears every durable dependency if closing during stop fails', async () => {
    const connection = new FakeConnection(models);
    connection.close.mockRejectedValueOnce(new Error('close failed'));
    const lifecycle = new DurableCategorySyncLifecycle(new FakeFactory([connection]));
    const trailsState = state();

    await lifecycle.start(trailsState);
    await expect(lifecycle.stop(trailsState)).rejects.toThrow('close failed');

    expectDurableStateCleared(trailsState);
  });

  it('cleans up each private connection across stop and restart', async () => {
    const first = new FakeConnection(models);
    const second = new FakeConnection(models);
    const lifecycle = new DurableCategorySyncLifecycle(new FakeFactory([first, second]));
    const trailsState = state();

    await lifecycle.start(trailsState);
    const firstRepository = trailsState.durablePortfolioCategorySync;
    await lifecycle.stop(trailsState);
    await lifecycle.start(trailsState);

    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.authenticate).toHaveBeenCalledTimes(1);
    expect(trailsState.durablePortfolioCategorySync).toBeDefined();
    expect(trailsState.durablePortfolioCategorySync).not.toBe(firstRepository);
    await lifecycle.stop(trailsState);
    expect(second.close).toHaveBeenCalledTimes(1);
    expectDurableStateCleared(trailsState);
  });
});
