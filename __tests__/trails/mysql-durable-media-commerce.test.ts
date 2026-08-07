const migrations = require('../../scripts/migrations');

describe('durable media commerce migration registration', () => {
  it('registers the v2 commerce migration in disposable Trails schema bootstrap', () => {
    expect(migrations.TRAILS_DURABLE_MEDIA_COMMERCE_MIGRATION_ID).toBe('013-trails-durable-media-commerce-v2');
    expect(migrations.migrations.some((item: { id: string }) => item.id === migrations.TRAILS_DURABLE_MEDIA_COMMERCE_MIGRATION_ID)).toBe(true);
  });

  it('orders the isolated asset-registry migration after commerce and includes it in the disposable schema bootstrap', () => {
    expect(migrations.TRAILS_MEDIA_ASSET_REGISTRY_MIGRATION_ID).toBe('014-trails-media-asset-registry-v2');
    const ids = migrations.migrations.map((item: { id: string }) => item.id);
    expect(ids.indexOf(migrations.TRAILS_MEDIA_ASSET_REGISTRY_MIGRATION_ID)).toBeGreaterThan(ids.indexOf(migrations.TRAILS_DURABLE_MEDIA_COMMERCE_MIGRATION_ID));
  });

  it('orders the registry mutation ledger after the registry schema', () => {
    expect(migrations.TRAILS_MEDIA_ASSET_REGISTRY_MUTATION_MIGRATION_ID).toBe('015-trails-media-asset-registry-mutations-v2');
    const ids = migrations.migrations.map((item: { id: string }) => item.id);
    expect(ids.indexOf(migrations.TRAILS_MEDIA_ASSET_REGISTRY_MUTATION_MIGRATION_ID)).toBeGreaterThan(ids.indexOf(migrations.TRAILS_MEDIA_ASSET_REGISTRY_MIGRATION_ID));
  });
});
