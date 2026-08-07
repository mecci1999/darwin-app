import { PublicOwnerResolver } from '../types';

const developmentDemoOwner = { tenantId: 'development-demo', ownerUserId: 'development-demo' };
const configuredValue = (value: string | undefined): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 64 ? value.trim() : undefined;

/**
 * Resolves the one public site owner from trusted deployment configuration only.
 * Development gets a deliberately explicit demo fallback; production fails closed.
 */
export const createPublicOwnerResolver = (environment: NodeJS.ProcessEnv = process.env): PublicOwnerResolver => ({
  resolve() {
    const tenantId = configuredValue(environment.TRAILS_PUBLIC_OWNER_TENANT_ID);
    const ownerUserId = configuredValue(environment.TRAILS_PUBLIC_OWNER_USER_ID);
    if (tenantId && ownerUserId) return { tenantId, ownerUserId };
    if (environment.NODE_ENV !== 'production' && !tenantId && !ownerUserId) return developmentDemoOwner;
    return undefined;
  },
});
