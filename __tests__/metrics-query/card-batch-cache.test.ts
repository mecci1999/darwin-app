import { buildCardBatchCacheKey } from '../../src/apps/starlight/metrics-query/utils/card-batch-cache';

describe('metrics-query card batch cache key', () => {
  const cards = [
    {
      cardId: 'latency',
      query: {
        scope: 'system',
        subject: { type: 'system' },
        metricRef: 'service.response.time',
        aggregation: 'p95'
      }
    }
  ];

  it('shares the system-scoped key independently of a requester tenant', () => {
    const first = buildCardBatchCacheKey({ scope: 'system', tenantId: 'tenant-a', cards });
    const second = buildCardBatchCacheKey({ scope: 'system', tenantId: 'tenant-b', cards });

    expect(first).toBe(second);
  });

  it('isolates tenant-scoped cache entries for identical cards', () => {
    const first = buildCardBatchCacheKey({ scope: 'tenant', tenantId: 'tenant-a', cards });
    const second = buildCardBatchCacheKey({ scope: 'tenant', tenantId: 'tenant-b', cards });

    expect(first).not.toBe(second);
  });

  it('changes the key when the card query changes', () => {
    const current = buildCardBatchCacheKey({ scope: 'system', cards });
    const different = buildCardBatchCacheKey({
      scope: 'system',
      cards: [{ ...cards[0], query: { ...cards[0].query, aggregation: 'max' } }]
    });

    expect(current).not.toBe(different);
  });
});
