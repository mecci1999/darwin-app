const { remapTrailsRoute, resolveTrailsShard } = require('../../../shared/trails-contract');

describe('Trails public route remapping', () => {
  it.each(['v2', 'v3', 'v4', 'v5'])('sends %s field plans to the durable sales shard', (version) => {
    expect(resolveTrailsShard(`${version}.field-plans.workspace`)).toBe('trails-durable-sales');
    expect(remapTrailsRoute('trails', version, 'field-plans/workspace')).toBe('trails-durable-sales');
  });

  it('routes current shooting workbench companion APIs to the durable sales shard', () => {
    expect(remapTrailsRoute('trails', 'v2', 'shooting-knowledge/workspace')).toBe('trails-durable-sales');
    expect(remapTrailsRoute('trails', 'v1', 'shooting-scenes/workspace')).toBe('trails-durable-sales');
    expect(remapTrailsRoute('trails', 'v1', 'field-record-events/workspace')).toBe('trails-durable-sales');
  });
});
