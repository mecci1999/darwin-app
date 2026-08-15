/**
 * Enables the complete local MySQL-backed Trails v2 persistence composition only
 * for the exact value "true". The category-sync flag is a temporary legacy
 * fallback; when both flags are present, disagreement fails closed.
 */
export const durableTrailsPersistenceEnabled = (environment: NodeJS.ProcessEnv = process.env): boolean => {
  const durablePersistence = environment.TRAILS_DURABLE_PERSISTENCE_ENABLED;
  const legacyCategorySync = environment.TRAILS_DURABLE_CATEGORY_SYNC;

  if (durablePersistence === undefined) return legacyCategorySync === 'true';
  if (legacyCategorySync !== undefined && (durablePersistence === 'true') !== (legacyCategorySync === 'true')) return false;
  return durablePersistence === 'true';
};
