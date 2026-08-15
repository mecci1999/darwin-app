import { HttpResponseItem, HttpStatusCode } from 'typings';

const PUBLIC_RESPONSE_CACHE_MAX_ENTRIES = 24;
const PUBLIC_RESPONSE_CACHE_TTL_MS = 5_000;

type CachedResponse = {
  expiresAt: number;
  response: HttpResponseItem;
};

const cloneResponse = (response: HttpResponseItem): HttpResponseItem => structuredClone(response);

/**
 * A deliberately tiny per-process cache for final anonymous public projections.
 * Entries expire on access so no timer or background work is required.
 */
export class PublicResponseCache {
  private readonly entries = new Map<string, CachedResponse>();

  getOrLoad(key: string, load: () => Promise<HttpResponseItem>): Promise<HttpResponseItem> {
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return Promise.resolve(cloneResponse(cached.response));
    }
    if (cached) this.entries.delete(key);

    return load().then((response) => {
      if (response.status === HttpStatusCode.OK && response.data.success) {
        this.entries.set(key, { expiresAt: Date.now() + PUBLIC_RESPONSE_CACHE_TTL_MS, response: cloneResponse(response) });
        while (this.entries.size > PUBLIC_RESPONSE_CACHE_MAX_ENTRIES) {
          const oldest = this.entries.keys().next();
          if (!oldest.done) this.entries.delete(oldest.value);
        }
      }
      return response;
    });
  }

  invalidate(prefix: string): void {
    for (const key of this.entries.keys()) if (key.startsWith(prefix)) this.entries.delete(key);
  }
}

export const publicResponseCacheKey = (tenantId: string, ownerUserId: string, resource: string, parameters = '') =>
  `trails:v2:public:${tenantId}:${ownerUserId}:${resource}:${parameters}`;
