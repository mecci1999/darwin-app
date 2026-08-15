import { HttpStatusCode } from '../../src/typings';
import { failure, success } from '../../src/apps/trails/utils/responses';
import { PublicResponseCache, publicResponseCacheKey } from '../../src/apps/trails/utils/public-response-cache';

describe('PublicResponseCache', () => {
  afterEach(() => jest.useRealTimers());

  it('returns a cloned cached successful projection without rerunning the loader', async () => {
    const cache = new PublicResponseCache();
    const load = jest.fn(async () => success({ items: ['first'] }, 'public'));
    const key = publicResponseCacheKey('tenant', 'owner', 'portfolios', 'nature');

    const first = await cache.getOrLoad(key, load);
    (first.data.content as { items: string[] }).items.push('mutated-by-caller');
    const second = await cache.getOrLoad(key, load);

    expect(load).toHaveBeenCalledTimes(1);
    expect(second.data.content).toEqual({ items: ['first'] });
  });

  it('expires entries without a timer and never caches failures', async () => {
    jest.useFakeTimers();
    const cache = new PublicResponseCache();
    const key = publicResponseCacheKey('tenant', 'owner', 'site-content');
    let revision = 0;
    const load = jest.fn(async () => success({ revision: ++revision }, 'public'));

    await cache.getOrLoad(key, load);
    jest.advanceTimersByTime(5_001);
    await cache.getOrLoad(key, load);
    const failed = jest.fn(async () => failure('missing', HttpStatusCode.NOT_FOUND));
    await cache.getOrLoad(publicResponseCacheKey('tenant', 'owner', 'missing'), failed);
    await cache.getOrLoad(publicResponseCacheKey('tenant', 'owner', 'missing'), failed);

    expect(load).toHaveBeenCalledTimes(2);
    expect(failed).toHaveBeenCalledTimes(2);
  });

  it('bounds entries and invalidates only the requested owner resource namespace', async () => {
    const cache = new PublicResponseCache();
    const load = jest.fn(async () => success({ ok: true }, 'public'));
    for (let index = 0; index < 25; index += 1) await cache.getOrLoad(publicResponseCacheKey('tenant', 'owner', 'portfolios', String(index)), load);
    await cache.getOrLoad(publicResponseCacheKey('tenant', 'owner', 'portfolios', '0'), load);
    cache.invalidate(publicResponseCacheKey('tenant', 'owner', 'portfolios'));
    await cache.getOrLoad(publicResponseCacheKey('tenant', 'owner', 'portfolios', '24'), load);
    await cache.getOrLoad(publicResponseCacheKey('tenant', 'other-owner', 'portfolios', '24'), load);

    expect(load).toHaveBeenCalledTimes(28);
  });

  it('supports invalidating media references alongside a changed public portfolio', async () => {
    const cache = new PublicResponseCache();
    const portfolioLoad = jest.fn(async () => success({ mediaIds: ['asset-1'] }, 'public'));
    const mediaLoad = jest.fn(async () => success([{ id: 'asset-1' }], 'public'));
    const portfolioKey = publicResponseCacheKey('tenant', 'owner', 'portfolios');
    const mediaKey = publicResponseCacheKey('tenant', 'owner', 'media-assets');

    await cache.getOrLoad(portfolioKey, portfolioLoad);
    await cache.getOrLoad(mediaKey, mediaLoad);
    cache.invalidate(portfolioKey);
    cache.invalidate(mediaKey);
    await cache.getOrLoad(portfolioKey, portfolioLoad);
    await cache.getOrLoad(mediaKey, mediaLoad);

    expect(portfolioLoad).toHaveBeenCalledTimes(2);
    expect(mediaLoad).toHaveBeenCalledTimes(2);
  });
});
