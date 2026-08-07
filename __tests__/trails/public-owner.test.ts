import { createPublicOwnerResolver } from '../../src/apps/starlight/trails/utils/public-owner';

describe('public owner resolver', () => {
  it('uses only complete server-owned deployment configuration', () => {
    expect(createPublicOwnerResolver({ NODE_ENV: 'production', TRAILS_PUBLIC_OWNER_TENANT_ID: 'tenant-public', TRAILS_PUBLIC_OWNER_USER_ID: 'owner-public' }).resolve()).toEqual({ tenantId: 'tenant-public', ownerUserId: 'owner-public' });
  });

  it('fails closed in production and only supplies the demo owner outside production', () => {
    expect(createPublicOwnerResolver({ NODE_ENV: 'production' }).resolve()).toBeUndefined();
    expect(createPublicOwnerResolver({ NODE_ENV: 'production', TRAILS_PUBLIC_OWNER_TENANT_ID: 'tenant-only' }).resolve()).toBeUndefined();
    expect(createPublicOwnerResolver({ NODE_ENV: 'development' }).resolve()).toEqual({ tenantId: 'development-demo', ownerUserId: 'development-demo' });
  });
});
