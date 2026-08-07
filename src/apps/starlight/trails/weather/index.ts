import { Actor, WeatherForecast, WeatherForecastPoint, WeatherForecastRequest, WeatherProvider, WeatherProviderDescriptor, WeatherProviderResponse, WeatherService } from '../types';

const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;
const MAX_FORECAST_LOOKAHEAD_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_FORECAST_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const COORDINATE_PRECISION = 2;
const roundCoordinate = (value: number) => Number(value.toFixed(COORDINATE_PRECISION));
const isIsoInstant = (value: string) => !Number.isNaN(new Date(value).getTime()) && new Date(value).toISOString() === value;

const validateRequest = (request: WeatherForecastRequest, currentTime: number): WeatherForecastRequest => {
  if (!Number.isFinite(request.latitude) || request.latitude < -90 || request.latitude > 90) throw new Error('latitude超出有效坐标范围');
  if (!Number.isFinite(request.longitude) || request.longitude < -180 || request.longitude > 180) throw new Error('longitude超出有效坐标范围');
  if (request.forecastFor !== undefined && !isIsoInstant(request.forecastFor)) throw new Error('forecastFor必须是ISO UTC时间');
  if (request.forecastFor !== undefined) {
    const forecastTime = new Date(request.forecastFor).getTime();
    if (forecastTime < currentTime - MAX_FORECAST_LOOKBACK_MS || forecastTime > currentTime + MAX_FORECAST_LOOKAHEAD_MS) throw new Error('forecastFor超出支持的天气预报时间范围');
  }
  return {
    latitude: roundCoordinate(request.latitude),
    longitude: roundCoordinate(request.longitude),
    ...(request.forecastFor === undefined ? {} : { forecastFor: request.forecastFor }),
  };
};

const optionalPercentage = (value: unknown, name: string): number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) throw new Error(`${name}必须是0至100之间的有效数字`);
  return value;
};
const optionalNonNegative = (value: unknown, name: string): number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${name}必须是非负有效数字`);
  return value;
};
const validatePoint = (value: unknown, index: number): WeatherForecastPoint => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`天气数据点[${index}]必须是对象`);
  const point = value as Record<string, unknown>;
  if (typeof point.at !== 'string' || !isIsoInstant(point.at)) throw new Error(`天气数据点[${index}].at必须是ISO UTC时间`);
  const cloudCoverPercent = optionalPercentage(point.cloudCoverPercent, `天气数据点[${index}].cloudCoverPercent`);
  const precipitationProbabilityPercent = optionalPercentage(point.precipitationProbabilityPercent, `天气数据点[${index}].precipitationProbabilityPercent`);
  const precipitationMm = optionalNonNegative(point.precipitationMm, `天气数据点[${index}].precipitationMm`);
  const windSpeedKph = optionalNonNegative(point.windSpeedKph, `天气数据点[${index}].windSpeedKph`);
  const windGustKph = optionalNonNegative(point.windGustKph, `天气数据点[${index}].windGustKph`);
  const visibilityKm = optionalNonNegative(point.visibilityKm, `天气数据点[${index}].visibilityKm`);
  return {
    at: point.at,
    ...(cloudCoverPercent === undefined ? {} : { cloudCoverPercent }),
    ...(precipitationProbabilityPercent === undefined ? {} : { precipitationProbabilityPercent }),
    ...(precipitationMm === undefined ? {} : { precipitationMm }),
    ...(windSpeedKph === undefined ? {} : { windSpeedKph }),
    ...(windGustKph === undefined ? {} : { windGustKph }),
    ...(visibilityKm === undefined ? {} : { visibilityKm }),
  };
};
const validateProviderForecast = (forecast: WeatherProviderResponse): WeatherProviderResponse => {
  if (typeof forecast !== 'object' || forecast === null) throw new Error('天气数据源响应必须是对象');
  if (!isIsoInstant(forecast.fetchedAt) || !isIsoInstant(forecast.validUntil)) throw new Error('天气数据源必须提供ISO UTC获取和有效时间');
  if (new Date(forecast.validUntil).getTime() <= new Date(forecast.fetchedAt).getTime()) throw new Error('天气数据有效期必须晚于获取时间');
  if (!Array.isArray(forecast.points)) throw new Error('天气数据点必须为数组');
  return { fetchedAt: forecast.fetchedAt, validUntil: forecast.validUntil, points: forecast.points.map(validatePoint) };
};

interface CacheEntry {
  expiresAt: number;
  forecast: WeatherProviderResponse;
  request: WeatherForecastRequest;
}

/**
 * Coordinates are rounded before dispatch. The cache remains actor-scoped so one user's
 * private field lookup cannot affect another user's response timing or freshness indicator.
 */
export class CachedWeatherService implements WeatherService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly provider: WeatherProvider,
    private readonly descriptor: WeatherProviderDescriptor,
    private readonly now: () => number = Date.now,
    private readonly maxEntries = MAX_CACHE_ENTRIES,
  ) {
    if (!['open-meteo', 'met-no', 'windy', 'custom'].includes(descriptor.provider)) throw new Error('天气数据源标识无效');
    if (!descriptor.sourceLabel.trim()) throw new Error('天气数据源必须提供sourceLabel');
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error('天气缓存容量必须是正整数');
  }

  async getForecast(actor: Actor, request: WeatherForecastRequest): Promise<WeatherForecast> {
    const currentTime = this.now();
    this.pruneExpired(currentTime);
    const sanitized = validateRequest(request, currentTime);
    const key = [actor.tenantId, actor.userId, sanitized.latitude, sanitized.longitude, sanitized.forecastFor || 'latest'].join(':');
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > currentTime) return this.toForecast(cached.forecast, cached.request, 'cached');

    const providerForecast = validateProviderForecast(await this.provider.getForecast(sanitized));
    const sourceExpiry = new Date(providerForecast.validUntil).getTime();
    const expiresAt = Math.min(currentTime + CACHE_TTL_MS, sourceExpiry);
    if (expiresAt <= currentTime) throw new Error('天气数据源返回了已失效的数据');
    while (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) break;
      this.cache.delete(oldestKey);
    }
    this.cache.set(key, { expiresAt, forecast: providerForecast, request: sanitized });
    return this.toForecast(providerForecast, sanitized, 'fresh');
  }

  private pruneExpired(currentTime: number): void {
    for (const [key, entry] of this.cache) if (entry.expiresAt <= currentTime) this.cache.delete(key);
  }

  private toForecast(forecast: WeatherProviderResponse, request: WeatherForecastRequest, cacheStatus: WeatherForecast['cacheStatus']): WeatherForecast {
    return { ...structuredClone(forecast), ...this.descriptor, location: { latitude: request.latitude, longitude: request.longitude, precision: '0.01-degree' }, cacheStatus };
  }
}
