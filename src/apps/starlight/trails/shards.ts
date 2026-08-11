/** Node-Universe 1.7.2 checks declared action keys plus one against its nominal 30-action limit. */
export const TRAILS_ACTIONS_PER_SHARD_LIMIT = 29;

export const TRAILS_V1_SHARD_NAMES = [
  'trails-community',
  'trails-content',
  'trails-workspace',
] as const;

export const TRAILS_V2_SHARD_NAMES = [
  'trails-durable-content',
  'trails-durable-media',
  'trails-durable-workspace',
  'trails-durable-trips',
  'trails-durable-site',
  'trails-durable-site-public',
] as const;

export const TRAILS_SHARD_NAMES = [...TRAILS_V1_SHARD_NAMES, ...TRAILS_V2_SHARD_NAMES] as const;

export type TrailsShardName = (typeof TRAILS_SHARD_NAMES)[number];
export type TrailsRuntime = 'all' | 'v1' | 'v2';

type TrailsActionDefinitions = Record<string, unknown>;

const legacyV1ShardForAction = (action: string): TrailsShardName | undefined => {
  if (['overview', 'profile.public'].includes(action) || action.startsWith('comments.')) {
    return 'trails-community';
  }

  if (
    action === 'stories.public' ||
    action.startsWith('portfolio.') ||
    action.startsWith('categories.') ||
    action.startsWith('publishing-packages.')
  ) {
    return 'trails-content';
  }

  if (
    ['workspace', 'capabilities', 'weather.forecast', 'hikes', 'gear.packing-summary', 'finance.overview'].includes(action) ||
    action.startsWith('shoot-sessions.') ||
    action.startsWith('journal.') ||
    action.startsWith('shares.') ||
    action.startsWith('trips.') ||
    action.startsWith('sync.')
  ) {
    return 'trails-workspace';
  }

  return undefined;
};

const durableV2ShardForAction = (action: string): TrailsShardName | undefined => {
  if (
    action.startsWith('category-sync.') ||
    action.startsWith('categories.') ||
    action.startsWith('portfolios.') ||
    action.startsWith('journals.')
  ) {
    return 'trails-durable-content';
  }

  if (
    action.startsWith('commerce.') ||
    action.startsWith('media-assets.') ||
    action.startsWith('publishing-packages.')
  ) {
    return 'trails-durable-media';
  }

  if (
    action.startsWith('hikes.') ||
    action.startsWith('gear.') ||
    action.startsWith('packing-plans.') ||
    action.startsWith('finance.')
  ) {
    return 'trails-durable-workspace';
  }

  if (action.startsWith('analytics.') || action.startsWith('trip-registrations.') || action.startsWith('trips.')) {
    return 'trails-durable-trips';
  }

  if (
    action.startsWith('site-content.') ||
    action.startsWith('comments.') ||
    action.startsWith('video-references.') ||
    action.startsWith('locations.') ||
    action.startsWith('shooting-locations.')
  ) {
    if (action === 'site-content.public') return 'trails-durable-site-public';
    return 'trails-durable-site';
  }

  return undefined;
};

export const resolveTrailsShard = (actionName: string): TrailsShardName | undefined => {
  const [version, ...actionParts] = actionName.split('.');
  const action = actionParts.join('.');
  if (!action) return undefined;
  if (version === 'v1') return legacyV1ShardForAction(action);
  if (version === 'v2') return durableV2ShardForAction(action);
  return undefined;
};

export const remapTrailsRoute = (service: string, version: string, action: string) => {
  if (service !== 'trails') return service;
  const normalizedVersion = version === '1' ? 'v1' : version;
  return resolveTrailsShard(`${normalizedVersion}.${action.replace(/\//g, '.')}`) || service;
};

export const selectTrailsShardActions = <T extends TrailsActionDefinitions>(
  actions: T,
  shard: TrailsShardName,
): T => {
  const selected = Object.fromEntries(
    Object.entries(actions).filter(([actionName]) => resolveTrailsShard(actionName) === shard),
  );
  const unassigned = Object.keys(actions).filter((actionName) => !resolveTrailsShard(actionName));

  if (unassigned.length > 0) {
    throw new Error(`Trails actions missing shard assignment: ${unassigned.join(', ')}`);
  }
  if (Object.keys(selected).length > TRAILS_ACTIONS_PER_SHARD_LIMIT) {
    throw new Error(`Trails shard '${shard}' exceeds ${TRAILS_ACTIONS_PER_SHARD_LIMIT} actions`);
  }

  return selected as T;
};

export const isTrailsShardService = (service: string) =>
  (TRAILS_SHARD_NAMES as readonly string[]).includes(service);

export const isTrailsShardName = (shard: string): shard is TrailsShardName =>
  isTrailsShardService(shard);

export const trailsShardNamesForRuntime = (runtime: TrailsRuntime): readonly TrailsShardName[] => {
  if (runtime === 'v1') return TRAILS_V1_SHARD_NAMES;
  if (runtime === 'v2') return TRAILS_V2_SHARD_NAMES;
  return TRAILS_SHARD_NAMES;
};

export const isTrailsRuntime = (runtime: string): runtime is TrailsRuntime =>
  runtime === 'all' || runtime === 'v1' || runtime === 'v2';
