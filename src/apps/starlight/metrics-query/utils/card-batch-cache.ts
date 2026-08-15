export const buildCardBatchCacheKey = (params: {
  scope: 'tenant' | 'system';
  tenantId?: string;
  cards: unknown[];
}) =>
  `metrics-query:cards:${JSON.stringify({
    scope: params.scope,
    tenant: params.scope === 'system' ? 'system' : String(params.tenantId || ''),
    cards: params.cards,
  })}`;
