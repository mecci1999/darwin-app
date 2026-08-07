import { Starlight } from '../../src/typings';
import trailsActions from '../../src/apps/starlight/trails/actions';
import { InMemoryTrailsRepository } from '../../src/apps/starlight/trails/repository';
import { Actor, TrailsState, WeatherProvider } from '../../src/apps/starlight/trails/types';
import { CachedWeatherService } from '../../src/apps/starlight/trails/weather';

const actor: Actor = { tenantId: 'tenant-owner', userId: 'owner', isAdmin: false };
const star = { emit: jest.fn() } as unknown as Starlight;
const context = (actionParams: Record<string, unknown>, authenticated = true) => ({
  meta: authenticated ? { tenantId: actor.tenantId, user: actor } : {}, params: actionParams,
});

describe('photography weather boundary', () => {
  it('fails closed when a deployment has not configured a provider', async () => {
    const actions = trailsActions(star, { repository: new InMemoryTrailsRepository() } satisfies TrailsState);
    const result = await actions['v1.weather.forecast'].handler(context({ latitude: 30, longitude: 120 }) as never);

    expect(result.data.success).toBe(false);
    expect(result.data.message).toContain('未配置');
  });

  it('requires trusted authentication before looking up weather', async () => {
    const provider: WeatherProvider = { getForecast: jest.fn() };
    const actions = trailsActions(star, { repository: new InMemoryTrailsRepository(), weather: new CachedWeatherService(provider, { provider: 'custom', sourceLabel: 'Test provider' }) } satisfies TrailsState);
    const result = await actions['v1.weather.forecast'].handler(context({ latitude: 30, longitude: 120 }, false) as never);

    expect(result.data.success).toBe(false);
    expect(provider.getForecast).not.toHaveBeenCalled();
  });

  it('rounds provider coordinates, scopes the cache to the actor, and reports provenance', async () => {
    let clock = Date.parse('2026-07-30T00:00:00.000Z');
    const getForecast = jest.fn().mockResolvedValue({
      fetchedAt: '2026-07-30T00:00:00.000Z', validUntil: '2026-07-30T01:00:00.000Z',
      points: [{ at: '2026-07-30T01:00:00.000Z', cloudCoverPercent: 40, windSpeedKph: 12, precipitationMm: 0 }],
    });
    const provider: WeatherProvider = {
      getForecast,
    };
    const weather = new CachedWeatherService(provider, { provider: 'open-meteo', sourceLabel: 'Open-Meteo' }, () => clock);
    const first = await weather.getForecast(actor, { latitude: 30.123456, longitude: 120.654321 });
    const second = await weather.getForecast(actor, { latitude: 30.123499, longitude: 120.654399 });
    const otherActor = await weather.getForecast({ ...actor, userId: 'other-user' }, { latitude: 30.123499, longitude: 120.654399 });

    expect(getForecast).toHaveBeenCalledTimes(2);
    expect(getForecast.mock.calls[0]).toEqual([{ latitude: 30.12, longitude: 120.65 }]);
    expect(first).toEqual(expect.objectContaining({ cacheStatus: 'fresh', sourceLabel: 'Open-Meteo', location: { latitude: 30.12, longitude: 120.65, precision: '0.01-degree' } }));
    expect(second.cacheStatus).toBe('cached');
    expect(otherActor.cacheStatus).toBe('fresh');
    clock += 1;
  });

  it('rejects malformed points and never lets provider-controlled data define provenance', async () => {
    const provider: WeatherProvider = {
      getForecast: jest.fn().mockResolvedValue({
        fetchedAt: '2026-07-30T00:00:00.000Z', validUntil: '2026-07-30T01:00:00.000Z',
        points: [{ at: 'not-an-instant', cloudCoverPercent: 101 }],
      }),
    };
    const weather = new CachedWeatherService(provider, { provider: 'met-no', sourceLabel: 'MET Norway' }, () => Date.parse('2026-07-30T00:00:00.000Z'));

    await expect(weather.getForecast(actor, { latitude: 30, longitude: 120 })).rejects.toThrow('天气数据点');
  });

  it('validates an action request before dispatching it to a provider', async () => {
    const provider: WeatherProvider = { getForecast: jest.fn() };
    const actions = trailsActions(star, {
      repository: new InMemoryTrailsRepository(),
      weather: new CachedWeatherService(provider, { provider: 'custom', sourceLabel: 'Test provider' }),
    } satisfies TrailsState);
    const result = await actions['v1.weather.forecast'].handler(context({ latitude: 91, longitude: 120 }) as never);

    expect(result.data.success).toBe(false);
    expect(provider.getForecast).not.toHaveBeenCalled();
  });

  it('prunes expired cache entries and evicts the oldest entry at its configured capacity', async () => {
    let clock = Date.parse('2026-07-30T00:00:00.000Z');
    const getForecast = jest.fn().mockResolvedValue({
      fetchedAt: '2026-07-30T00:00:00.000Z', validUntil: '2026-07-30T01:00:00.000Z', points: [],
    });
    const weather = new CachedWeatherService({ getForecast }, { provider: 'custom', sourceLabel: 'Test provider' }, () => clock, 2);

    await weather.getForecast(actor, { latitude: 10, longitude: 10 });
    await weather.getForecast(actor, { latitude: 20, longitude: 20 });
    await weather.getForecast(actor, { latitude: 30, longitude: 30 });
    await weather.getForecast(actor, { latitude: 10, longitude: 10 });
    clock += 16 * 60 * 1000;
    await weather.getForecast(actor, { latitude: 20, longitude: 20 });

    expect(getForecast).toHaveBeenCalledTimes(5);
  });

  it('rejects expired or malformed provider responses rather than caching them', async () => {
    const provider: WeatherProvider = {
      getForecast: jest.fn().mockResolvedValue({
        fetchedAt: '2026-07-30T01:00:00.000Z', validUntil: '2026-07-30T00:00:00.000Z', points: [],
      }),
    };

    await expect(new CachedWeatherService(provider, { provider: 'custom', sourceLabel: 'Test feed' }, () => Date.parse('2026-07-30T00:00:00.000Z')).getForecast(actor, { latitude: 30, longitude: 120 })).rejects.toThrow('有效期');
  });
});
