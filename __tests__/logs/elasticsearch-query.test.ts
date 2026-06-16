import { ElasticsearchClient } from '../../src/apps/starlight/logs/utils/elasticsearch';
import { LogLevel, LogSource } from '../../src/apps/starlight/logs/types';

describe('Elasticsearch log query builder', () => {
  it('excludes collector node noise when excludeNodeIDs is provided', () => {
    const client = new ElasticsearchClient({ node: 'http://localhost:9200', index: 'logs-system' });

    const query = client.buildSearchQuery({
      tenantId: 'system',
      originType: 'darwin-app',
      visibility: 'admin',
      excludeNodeIDs: ['logs-development'],
    });

    expect(query.bool.must).toEqual(
      expect.arrayContaining([
        { term: { originType: 'darwin-app' } },
        { term: { visibility: 'admin' } },
        {
          bool: {
            must_not: [
              { terms: { nodeID: ['logs-development'] } },
            ],
          },
        },
      ]),
    );
  });

  it('builds the exact Darwin explorer overview filter without excluding gateway logs', () => {
    const client = new ElasticsearchClient({ node: 'http://localhost:9200', index: 'logs-system' });

    const query = client.buildSearchQuery({
      tenantId: 'system',
      page: 1,
      pageSize: 200,
      limit: 200,
      sortBy: 'timestamp',
      sortOrder: 'desc',
      originType: 'darwin-app',
      visibility: 'admin',
      excludeServices: ['logs'],
      excludeNodeIDs: ['logs-development'],
      levels: [LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR, LogLevel.FATAL],
    });

    expect(query.bool.must).toEqual(
      expect.arrayContaining([
        { term: { originType: 'darwin-app' } },
        { term: { visibility: 'admin' } },
        { terms: { level: ['info', 'warn', 'error', 'fatal'] } },
        {
          bool: {
            must_not: [
              { terms: { service: ['logs'] } },
            ],
          },
        },
        {
          bool: {
            must_not: [
              { terms: { nodeID: ['logs-development'] } },
            ],
          },
        },
      ]),
    );
  });

  it('normalizes framework service buckets from nodeID in stats runtime mappings', () => {
    const client = new ElasticsearchClient({ node: 'http://localhost:9200', index: 'logs-system' });
    const mappings = (client as unknown as {
      buildStatsRuntimeMappings(params: { tenantId: string; timeRange: string; groupBy: 'service' }): Record<string, any>;
    }).buildStatsRuntimeMappings({ tenantId: 'system', timeRange: '24h', groupBy: 'service' });

    expect(mappings.stats_service.script.source).toContain("params._source['nodeID']");
    expect(mappings.stats_service.script.params.frameworkServices).toEqual(
      expect.arrayContaining(['star', 'transit']),
    );
  });

  it('uses aggregation totals when Elasticsearch hit total is capped at 10000', async () => {
    const client = new ElasticsearchClient({ node: 'http://localhost:9200', index: 'logs-system' });
    const mockedSearch = jest.fn(async () => ({
      hits: { total: { value: 10000, relation: 'gte' } },
      aggregations: {
        breakdown: {
          buckets: [
            { key: 'debug', doc_count: 32132 },
            { key: 'info', doc_count: 329 },
            { key: 'warn', doc_count: 36 },
          ],
        },
        levels: {
          buckets: [
            { key: 'debug', doc_count: 32132 },
            { key: 'info', doc_count: 329 },
            { key: 'warn', doc_count: 36 },
          ],
        },
        services: {
          buckets: [
            { key: 'gateway', doc_count: 12000 },
            { key: 'auth', doc_count: 9000 },
          ],
        },
      },
    }));
    (client as unknown as { client: { search: jest.Mock }, ensureIndexInitialized: jest.Mock }).client = {
      search: mockedSearch,
    };
    (client as unknown as { ensureIndexInitialized: jest.Mock }).ensureIndexInitialized = jest.fn(async () => undefined);

    const result = await client.getLogStats({
      tenantId: 'system',
      timeRange: '24h',
      groupBy: 'level',
    }, 'system');

    expect(mockedSearch).toHaveBeenCalledWith(expect.objectContaining({ track_total_hits: true }));
    expect(result.total).toBe(32497);
    expect(result.levelBreakdown.debug).toBe(32132);
  });

  it('passes refresh options through bulk indexing for immediately searchable logs', async () => {
    const client = new ElasticsearchClient({ node: 'http://localhost:9200', index: 'logs-system' });
    const mockedBulk = jest.fn(async () => ({ errors: false, items: [{ index: { status: 201 } }] }));
    (client as unknown as { client: { bulk: jest.Mock }, ensureIndexInitialized: jest.Mock }).client = {
      bulk: mockedBulk,
    };
    (client as unknown as { ensureIndexInitialized: jest.Mock }).ensureIndexInitialized = jest.fn(async () => undefined);

    await client.bulkIndex([
      {
        id: 'gateway-explorer-log',
        tenantId: 'system',
        timestamp: '2026-06-15T10:27:28.202Z',
        level: LogLevel.INFO,
        message: '<= 200 POST /api/logs/v1/explorer/search [+153.753 ms]',
        service: 'gateway',
        source: LogSource.SYSTEM,
        originType: 'darwin-app',
        visibility: 'admin',
        nodeID: 'gateway-development',
        namespace: 'darwin-app',
        mod: 'gateway',
        svc: 'gateway',
        metadata: {},
        apiKeyId: '',
        indexed: false,
        createdAt: '2026-06-15T10:27:28.202Z',
        updatedAt: '2026-06-15T10:27:28.202Z',
        receivedAt: '2026-06-15T10:27:28.202Z',
      },
    ], { refresh: 'wait_for' });

    expect(mockedBulk).toHaveBeenCalledWith(expect.objectContaining({ refresh: 'wait_for' }));
  });

  it('tracks total hits for log searches beyond Elasticsearch default caps', async () => {
    const client = new ElasticsearchClient({ node: 'http://localhost:9200', index: 'logs-system' });
    const mockedSearch = jest.fn(async () => ({
      hits: {
        total: { value: 9831, relation: 'eq' },
        hits: [],
      },
    }));
    (client as unknown as { client: { search: jest.Mock }, ensureIndexInitialized: jest.Mock }).client = {
      search: mockedSearch,
    };
    (client as unknown as { ensureIndexInitialized: jest.Mock }).ensureIndexInitialized = jest.fn(async () => undefined);

    await client.searchLogs({
      tenantId: 'system',
      originType: 'darwin-app',
      visibility: 'admin',
      excludeServices: ['logs'],
      excludeNodeIDs: ['logs-development'],
      levels: [LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR, LogLevel.FATAL],
      page: 1,
      limit: 200,
      sortBy: 'timestamp',
      sortOrder: 'desc',
    });

    expect(mockedSearch).toHaveBeenCalledWith(expect.objectContaining({ track_total_hits: true }));
  });
});
