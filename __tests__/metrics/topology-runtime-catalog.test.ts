jest.mock('../../src/apps/starlight/metrics/utils/influxdb-handler', () => ({
  InfluxDBHandler: {
    getTopologyData: jest.fn(),
  },
}));

import topology from '../../src/apps/starlight/metrics/actions/topology';
import { InfluxDBHandler } from '../../src/apps/starlight/metrics/utils/influxdb-handler';

describe('system topology runtime catalog', () => {
  it('requests runtime granularity and keeps every catalog runtime node', async () => {
    (InfluxDBHandler.getTopologyData as jest.Mock).mockResolvedValue({ nodes: [], edges: [] });
    const getServicesList = jest.fn().mockResolvedValue({
      services: [
        { id: 'trails-durable-content', name: 'trails-durable-content', status: 'running', health: 'healthy', sourceType: 'darwin-system', instances: 1 },
        { id: 'trails-durable-media', name: 'trails-durable-media', status: 'running', health: 'healthy', sourceType: 'darwin-system', instances: 1 },
        { id: 'metrics-query', name: 'metrics-query', status: 'running', health: 'healthy', sourceType: 'darwin-system', instances: 1 },
      ],
    });
    const action = (topology({} as any) as any)['v1.topology'];

    const response = await action.handler.call(
      {
        getServicesList,
        metricsState: { cache: { topologyObservedEdges: new Map() } },
      },
      {
        params: { type: 'graph', timeRange: '-1h', scope: 'system' },
        meta: { adminMetrics: true },
      },
    );

    expect(getServicesList).toHaveBeenCalledWith(expect.objectContaining({
      page: 1,
      pageSize: 500,
      scope: 'system',
      granularity: 'runtime',
    }));
    expect(response.status).toBe(200);
    expect(response.data.content.nodes.map((node: any) => node.name).sort()).toEqual([
      'metrics-query',
      'trails-durable-content',
      'trails-durable-media',
    ]);
    expect(response.data.content.meta).toEqual(expect.objectContaining({ granularity: 'runtime' }));
  });
});
