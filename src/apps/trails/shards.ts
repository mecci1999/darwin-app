import {
  isTrailsShardService,
  projectTrailsCatalogService,
  remapTrailsRoute,
  resolveTrailsShard,
  TRAILS_EXTERNAL_SERVICE,
  TRAILS_SHARD_NAMES,
  trailsCatalogServiceMembers,
  trailsShardNamesForRuntime,
  TrailsShardName,
} from '../../../../shared/trails-contract';

export { isTrailsShardService, projectTrailsCatalogService, remapTrailsRoute, resolveTrailsShard, TRAILS_EXTERNAL_SERVICE, TRAILS_SHARD_NAMES, trailsCatalogServiceMembers, trailsShardNamesForRuntime, TrailsShardName };

/** Node-Universe 1.7.2 checks declared action keys plus one against its nominal 30-action limit. */
export const TRAILS_ACTIONS_PER_SHARD_LIMIT = 29;

type TrailsActionDefinitions = Record<string, unknown>;


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

export const isTrailsShardName = (shard: string): shard is TrailsShardName => isTrailsShardService(shard);
