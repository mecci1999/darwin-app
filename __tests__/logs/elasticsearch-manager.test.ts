import {
  buildRetentionQuery,
  isLogIndex,
  responseBody,
} from '../../src/apps/starlight/logs/utils/elasticsearch-manager';

describe('Elasticsearch cleanup helpers', () => {
  it('normalizes direct and wrapped Elasticsearch responses', () => {
    const rows = [{ index: 'logs-tenant-a' }];

    expect(responseBody(rows)).toBe(rows);
    expect(responseBody({ body: rows })).toBe(rows);
  });

  it('only allows application log indices', () => {
    expect(isLogIndex('logs')).toBe(true);
    expect(isLogIndex('logs-tenant-a')).toBe(true);
    expect(isLogIndex('.kibana')).toBe(false);
    expect(isLogIndex('metrics-tenant-a')).toBe(false);
  });

  it('builds a received-time retention query that excludes missing dates', () => {
    expect(buildRetentionQuery('2026-07-19T00:00:00.000Z')).toEqual({
      bool: {
        must: [
          { exists: { field: 'receivedAt' } },
          { range: { receivedAt: { lt: '2026-07-19T00:00:00.000Z' } } },
        ],
      },
    });
  });
});
