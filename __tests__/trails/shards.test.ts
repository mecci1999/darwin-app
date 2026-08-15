import trailsActions from '../../src/apps/trails/actions';
import { InMemoryTrailsRepository } from '../../src/apps/trails/repository';
import {
  remapTrailsRoute,
  resolveTrailsShard,
  selectTrailsShardActions,
  TRAILS_ACTIONS_PER_SHARD_LIMIT,
  TRAILS_SHARD_NAMES,
  trailsShardNamesForRuntime,
} from '../../src/apps/trails/shards';
import { Starlight } from 'typings';

const actions = trailsActions({ emit: jest.fn() } as unknown as Starlight, {
  repository: new InMemoryTrailsRepository(),
});

describe('Trails action shards', () => {
  it('assigns every exported action to exactly one shard within the Node-Universe cap', () => {
    const assigned = TRAILS_SHARD_NAMES.flatMap((shard) => Object.keys(selectTrailsShardActions(actions, shard)));

    expect(Object.keys(actions)).toHaveLength(164);
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

  it('keeps stateful actions in one unified runtime over one repository', async () => {
    const sharedRepository = new InMemoryTrailsRepository();
    const sharedActions = trailsActions({ emit: jest.fn() } as unknown as Starlight, {
      repository: sharedRepository,
    });
    const contentActions = selectTrailsShardActions(sharedActions, 'trails-durable-workspace');
    const publicActions = selectTrailsShardActions(sharedActions, 'trails-durable-site-public');
    const actor = { tenantId: 'tenant-a', userId: 'creator', isAdmin: false, creatorSpaceRole: 'creator-space-owner' as const };
    const context = (params: Record<string, unknown>) => ({ meta: { tenantId: actor.tenantId, user: actor }, params });

    const draft = await contentActions['v1.portfolio.draft'].handler(context({
      title: 'Shared portfolio', summary: 'Shared state', mediaIds: [], visibility: 'public',
    }) as never);
    await contentActions['v1.portfolio.publish'].handler(context({
      id: draft.data.content.id,
    }) as never);
    const overview = await publicActions['v1.overview'].handler(context({}) as never);

    expect(overview.data.content.publishedPortfolioCount).toBe(1);
    expect(sharedRepository.getPortfolio(draft.data.content.id)).toBeDefined();
    expect(trailsShardNamesForRuntime()).toEqual(TRAILS_SHARD_NAMES);
  });

  it('retains each action definition and handler by reference after sharding', () => {
    for (const shard of TRAILS_SHARD_NAMES) {
      const selected = selectTrailsShardActions(actions, shard);
      for (const [actionName, actionDefinition] of Object.entries(selected)) {
        expect(actionDefinition).toBe(actions[actionName]);
        expect(actionDefinition.handler).toBe(actions[actionName].handler);
      }
    }
  });
});
