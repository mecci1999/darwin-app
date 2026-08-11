import trailsActions from '../../src/apps/starlight/trails/actions';
import { InMemoryTrailsRepository } from '../../src/apps/starlight/trails/repository';
import {
  remapTrailsRoute,
  resolveTrailsShard,
  selectTrailsShardActions,
  TRAILS_ACTIONS_PER_SHARD_LIMIT,
  TRAILS_SHARD_NAMES,
  TRAILS_V1_SHARD_NAMES,
  TRAILS_V2_SHARD_NAMES,
  trailsShardNamesForRuntime,
} from '../../src/apps/starlight/trails/shards';
import { Starlight } from '../../src/typings';

const actions = trailsActions({ emit: jest.fn() } as unknown as Starlight, {
  repository: new InMemoryTrailsRepository(),
});

describe('Trails action shards', () => {
  it('assigns every exported action to exactly one shard within the Node-Universe cap', () => {
    const assigned = TRAILS_SHARD_NAMES.flatMap((shard) => Object.keys(selectTrailsShardActions(actions, shard)));

    expect(Object.keys(actions)).toHaveLength(165);
    expect(new Set(assigned)).toEqual(new Set(Object.keys(actions)));
    expect(assigned).toHaveLength(Object.keys(actions).length);
    for (const shard of TRAILS_SHARD_NAMES) {
      expect(Object.keys(selectTrailsShardActions(actions, shard)).length).toBeLessThanOrEqual(
        TRAILS_ACTIONS_PER_SHARD_LIMIT,
      );
    }
  });

  it('remaps legacy public Trails routes to their owning internal shard', () => {
    for (const actionName of Object.keys(actions)) {
      const [version, ...actionParts] = actionName.split('.');
      const actionPath = actionParts.join('/');
      expect(remapTrailsRoute('trails', version, actionPath)).toBe(resolveTrailsShard(actionName));
    }

    expect(remapTrailsRoute('metrics', 'v1', 'overview')).toBe('metrics');
  });

  it('keeps the stateful v1 services in one runtime over one repository', async () => {
    const sharedRepository = new InMemoryTrailsRepository();
    const sharedActions = trailsActions({ emit: jest.fn() } as unknown as Starlight, {
      repository: sharedRepository,
    });
    const contentActions = selectTrailsShardActions(sharedActions, 'trails-content');
    const communityActions = selectTrailsShardActions(sharedActions, 'trails-community');
    const actor = { tenantId: 'tenant-a', userId: 'creator', isAdmin: false, creatorSpaceRole: 'creator-space-owner' as const };
    const context = (params: Record<string, unknown>) => ({ meta: { tenantId: actor.tenantId, user: actor }, params });

    const draft = await contentActions['v1.portfolio.draft'].handler(context({
      title: 'Shared portfolio', summary: 'Shared state', mediaIds: [], visibility: 'public',
    }) as never);
    await contentActions['v1.portfolio.publish'].handler(context({
      id: draft.data.content.id,
    }) as never);
    const overview = await communityActions['v1.overview'].handler(context({}) as never);

    expect(overview.data.content.publishedPortfolioCount).toBe(1);
    expect(sharedRepository.getPortfolio(draft.data.content.id)).toBeDefined();
    expect(trailsShardNamesForRuntime('v1')).toEqual(TRAILS_V1_SHARD_NAMES);
    expect(trailsShardNamesForRuntime('v2')).toEqual(TRAILS_V2_SHARD_NAMES);
  });
});
