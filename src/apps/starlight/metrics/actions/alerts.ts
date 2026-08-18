import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, Starlight } from 'typings';
import { queryAllUsers } from 'db/mysql/apis/user';
import { normalizeMetricsScope } from '../utils/system-telemetry';
import { InfluxDBHandler } from '../utils/influxdb-handler';
import { AlertOutboxRepository, DeliveryChannel } from '../../metrics-alerts/alert-outbox';
import { RegistryMissingAlertRepository, normalizeEmailRecipients, normalizeRegistryMissingRule } from '../../metrics-alerts/registry-missing';
import {
  RESPONSE_DURATION_COMPLETED_REQUEST_FILTER,
  RESPONSE_DURATION_FIELD_FILTER,
  RESPONSE_DURATION_MEASUREMENT_FILTER,
  RESPONSE_DURATION_MS_NORMALIZATION_FLUX,
} from '../utils/duration-metrics';

const ALERT_STATE_PREFIX = 'metrics:alerts:state:';
const ALERT_NOTIFICATION_PREFIX = 'metrics:alerts:notification:';
const ALERT_RULE_PREFIX = 'metrics:alerts:rule:';

type AlertLevel = 'critical' | 'warning' | 'info';
type AlertStatus = 'active' | 'resolved' | 'suppressed' | 'pending';
type AlertOperator = '>' | '<' | '=' | '>=' | '<=';

type StoredAlertRule = {
  id: string;
  name: string;
  service: string;
  metric: string;
  operator: AlertOperator;
  threshold: number;
  unit: string;
  duration: number;
  level: AlertLevel;
  enabled: boolean;
  channels: string[];
  emailRecipients: string[];
  notifyOnRecovery: boolean;
  updatedAt: number;
};

type AlertEvaluationState = Record<string, unknown> & {
  id: string;
  ruleId: string;
  source: 'rule';
  status: AlertStatus;
  level: AlertLevel;
  serviceId: string;
  service: string;
  metric: string;
  metricLabel: string;
  operator: AlertOperator;
  threshold: number;
  unit: string;
  value: number;
  duration: string;
  durationMinutes: number;
  channels: string[];
  message: string;
  time: string;
  firstTriggeredAt: number | null;
  lastTriggeredAt: number | null;
  conditionStartedAt: number | null;
  lastEvaluatedAt: number;
  lastNotificationAt?: number;
  assigneeUserId?: string;
  assigneeName?: string;
};

type AlertNotification = {
  id: string;
  alertId: string;
  ruleId: string;
  type: AlertLevel;
  channel: string;
  status: 'pending' | 'processing' | 'delivered' | 'retrying' | 'failed';
  target: string;
  content: string;
  sentAt: string;
  serviceId: string;
  service: string;
  metric: string;
  value: number;
  threshold: number;
  operator: AlertOperator;
  mobileTitle: string;
  mobileBody: string;
  updatedAt: number;
};

const ALERT_EVALUATION_INTERVAL_MS = 60 * 1000;
const ALERT_NOTIFICATION_COOLDOWN_MS = 5 * 60 * 1000;
// Alert lists are read by the page, badge and notification host at the same time.
// Keep a very short local snapshot so those reads do not rebuild the same catalog.
const ALERT_SNAPSHOT_CACHE_TTL_MS = 5_000;

type AlertSnapshotCacheEntry = {
  expiresAt: number;
  value?: any[];
  inFlight?: Promise<any[]>;
};

const alertSnapshotCache = new WeakMap<object, Map<string, AlertSnapshotCacheEntry>>();

const metricAliases: Record<string, string> = {
  错误率: 'service.error.rate',
  CPU: 'service.cpu.usage',
  内存: 'service.memory.usage.percent',
  响应时间: 'service.response.time',
};

const operatorMap: Record<string, AlertOperator> = {
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  eq: '=',
  '>': '>',
  '>=': '>=',
  '<': '<',
  '<=': '<=',
  '=': '=',
};

const toFixed = (value: number, digits = 2) => Number(value.toFixed(digits));

const escapeFluxString = (value: string) =>
  String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');

const normalizeServiceId = (serviceId?: string) =>
  serviceId?.startsWith('system:') ? serviceId.slice('system:'.length) : serviceId;

const buildServiceFilter = (serviceId?: string) => {
  const normalized = normalizeServiceId(serviceId || '');
  if (!normalized || normalized === 'all') return '';
  return `|> filter(fn: (r) => r["service"] == "${escapeFluxString(normalized)}")`;
};

const compareValue = (value: number, operator: AlertOperator, threshold: number) => {
  switch (operator) {
    case '>':
      return value > threshold;
    case '>=':
      return value >= threshold;
    case '<':
      return value < threshold;
    case '<=':
      return value <= threshold;
    case '=':
      return value === threshold;
    default:
      return false;
  }
};

const formatDuration = (minutes: number) => `${Math.max(1, Math.round(minutes || 5))}m`;

const formatAlertMessage = (params: {
  rule: StoredAlertRule;
  value: number;
  serviceName: string;
  status: AlertStatus;
}) =>
  params.status === 'resolved'
    ? `${params.serviceName} ${params.rule.metric} 已恢复，当前值 ${toFixed(params.value)}${params.rule.unit || ''}`
    : `${params.serviceName} ${params.rule.metric} 当前值 ${toFixed(params.value)}${params.rule.unit || ''} ${params.rule.operator} ${params.rule.threshold}${params.rule.unit || ''}，级别 ${params.rule.level}`;

const normalizeNotificationChannel = (channel: unknown): string => {
  const value = String(channel || '').trim();
  const normalized = value.toLowerCase();
  if (normalized === 'webhook') return 'Webhook';
  if (normalized === 'inapp' || normalized === 'in-app' || normalized === '站内通知')
    return 'InApp';
  if (normalized === 'email' || normalized === 'mail' || normalized === '邮件') return 'Email';
  return value || 'Email';
};

const normalizeNotificationChannels = (rule: any): string[] => {
  const channels = Array.isArray(rule.channels)
    ? rule.channels
    : Array.isArray(rule.notificationChannels)
      ? rule.notificationChannels
       : ['InApp'];
  const normalizedChannels = channels.map(normalizeNotificationChannel).filter(Boolean) as string[];
  return normalizedChannels.length
    ? (Array.from(new Set<string>(normalizedChannels)) as string[])
    : ['InApp'];
};

const validateMetricRuleDelivery = (channels: string[], emailRecipients: string[]) => {
  if (channels.includes('Email') && emailRecipients.length === 0) {
    throw new Error('Email rules require at least one valid email recipient');
  }
};

const metricRuleChannels = (rule: StoredAlertRule): Array<{ channel: DeliveryChannel; target: unknown }> => {
  const targets: Array<{ channel: DeliveryChannel; target: unknown }> = [];
  if (rule.channels.includes('InApp')) targets.push({ channel: 'InApp', target: 'in-app' });
  if (rule.channels.includes('Email')) {
    rule.emailRecipients.forEach(target => targets.push({ channel: 'Email', target }));
  }
  return targets;
};

const resolveNotificationTarget = (channel: string) => {
  const normalizedChannel = normalizeNotificationChannel(channel);
  if (normalizedChannel === 'Webhook') return '';
  if (normalizedChannel === 'InApp') return 'in-app';
  return '';
};

const levelFromHealth = (health: string) => {
  if (health === 'critical' || health === 'unhealthy') return 'critical';
  if (health === 'degraded' || health === 'warning') return 'warning';
  return 'info';
};

const statusFromHealth = (health: string) => {
  if (health === 'healthy') return 'resolved';
  if (health === 'critical' || health === 'unhealthy') return 'active';
  return 'suppressed';
};

const getRedisStore = (serviceContext: any) =>
  serviceContext.redis?.client || serviceContext.redis?.redis || serviceContext.redis;

const getDurableRedisStore = (serviceContext: any) =>
  serviceContext.redis?.client || serviceContext.redis?.redis || null;

const getDurableRedisKey = (serviceContext: any, key: string) => {
  const prefix = String(serviceContext.redis?.prefix || '');
  if (!prefix) return key;
  return `${prefix}${prefix.endsWith(':') ? '-' : ':'}${key}`;
};

const getRedisKeys = async (serviceContext: any, pattern: string): Promise<string[]> => {
  const logicalPrefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
  const resolvedKeys = new Set<string>();
  const redisPrefix = serviceContext.redis?.prefix || '';

  if (typeof serviceContext.redis?.getCacheKeys === 'function') {
    const cacheKeys = await serviceContext.redis.getCacheKeys();
    cacheKeys
      .map((item: { key?: string } | string) => (typeof item === 'string' ? item : item.key || ''))
      .filter((key: string) => key.startsWith(logicalPrefix))
      .forEach((key: string) => resolvedKeys.add(key));
  }

  const store = getRedisStore(serviceContext);
  if (!store || typeof store.keys !== 'function') return Array.from(resolvedKeys);
  const searchPattern = `${redisPrefix}${pattern}`;
  const keys = await store.keys(searchPattern);
  if (Array.isArray(keys)) {
    keys
      .map((key: string) =>
        redisPrefix && key.startsWith(redisPrefix) ? key.slice(redisPrefix.length) : key,
      )
      .forEach((key: string) => resolvedKeys.add(key));
  }
  return Array.from(resolvedKeys);
};

const redisGetJson = async (serviceContext: any, key: string) => {
  try {
    const raw = await serviceContext.redis?.get?.(key);
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
};

const redisSetJson = async (serviceContext: any, key: string, value: any) => {
  try {
    await serviceContext.redis?.set?.(key, value);
    return true;
  } catch {
    return false;
  }
};

const redisDelete = async (serviceContext: any, key: string) => {
  try {
    if (typeof serviceContext.redis?.delete === 'function') {
      await serviceContext.redis.delete(key);
    } else {
      await serviceContext.redis?.del?.(key);
    }
    return true;
  } catch {
    return false;
  }
};

const loadAlertState = async (serviceContext: any, alertId: string) => {
  return redisGetJson(serviceContext, `${ALERT_STATE_PREFIX}${alertId}`);
};

const loadAllAlertStates = async (serviceContext: any) => {
  const keys = await getRedisKeys(serviceContext, `${ALERT_STATE_PREFIX}*`);
  const values = await Promise.all(keys.map((key: string) => redisGetJson(serviceContext, key)));
  return values.filter(Boolean);
};

const saveAlertState = async (serviceContext: any, alertId: string, payload: any) => {
  return redisSetJson(serviceContext, `${ALERT_STATE_PREFIX}${alertId}`, payload);
};

const loadNotificationState = async (serviceContext: any, notificationId: string) => {
  return redisGetJson(serviceContext, `${ALERT_NOTIFICATION_PREFIX}${notificationId}`);
};

const loadAllNotificationStates = async (serviceContext: any) => {
  const keys = await getRedisKeys(serviceContext, `${ALERT_NOTIFICATION_PREFIX}*`);
  const values = await Promise.all(keys.map((key: string) => redisGetJson(serviceContext, key)));
  return values.filter(Boolean);
};

const saveNotificationState = async (serviceContext: any, notificationId: string, payload: any) => {
  return redisSetJson(serviceContext, `${ALERT_NOTIFICATION_PREFIX}${notificationId}`, payload);
};

const loadAlertRules = async (serviceContext: any) => {
  const durableStore = getDurableRedisStore(serviceContext);
  if (durableStore && typeof durableStore.scan === 'function') {
    const durablePrefix = getDurableRedisKey(serviceContext, ALERT_RULE_PREFIX);
    const keys: string[] = [];
    let cursor = '0';
    do {
      const result = await durableStore.scan(cursor, 'MATCH', `${durablePrefix}*`, 'COUNT', 100);
      cursor = String(result?.[0] || '0');
      if (Array.isArray(result?.[1])) keys.push(...result[1]);
    } while (cursor !== '0');

    const values = await Promise.all(
      keys.map(async (key) => {
        const raw = await durableStore.get(key);
        if (!raw) return null;
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
      }),
    );
    return values.filter(Boolean);
  }

  const keys = await getRedisKeys(serviceContext, `${ALERT_RULE_PREFIX}*`);
  const values = await Promise.all(keys.map((key: string) => redisGetJson(serviceContext, key)));
  return values.filter(Boolean);
};

const loadAlertRule = async (serviceContext: any, ruleId: string) => {
  const durableStore = getDurableRedisStore(serviceContext);
  if (durableStore && typeof durableStore.get === 'function') {
    try {
      const raw = await durableStore.get(getDurableRedisKey(serviceContext, `${ALERT_RULE_PREFIX}${ruleId}`));
      if (raw) return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return null;
    }
  }
  return redisGetJson(serviceContext, `${ALERT_RULE_PREFIX}${ruleId}`);
};

const saveAlertRule = async (serviceContext: any, rule: any) => {
  const durableStore = getDurableRedisStore(serviceContext);
  if (durableStore && typeof durableStore.set === 'function') {
    try {
      await durableStore.set(getDurableRedisKey(serviceContext, `${ALERT_RULE_PREFIX}${rule.id}`), JSON.stringify(rule));
      return true;
    } catch {
      return false;
    }
  }
  return redisSetJson(serviceContext, `${ALERT_RULE_PREFIX}${rule.id}`, rule);
};

const deleteAlertRule = async (serviceContext: any, ruleId: string) => {
  const durableStore = getDurableRedisStore(serviceContext);
  if (durableStore && typeof durableStore.del === 'function') {
    try {
      await durableStore.del(getDurableRedisKey(serviceContext, `${ALERT_RULE_PREFIX}${ruleId}`));
      return true;
    } catch {
      return false;
    }
  }
  return redisDelete(serviceContext, `${ALERT_RULE_PREFIX}${ruleId}`);
};

const normalizeAlertRule = (rule: any): StoredAlertRule => {
  const channels = normalizeNotificationChannels(rule);
  const emailRecipients = normalizeEmailRecipients(rule.emailRecipients);
  return {
    id: rule.id || `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: rule.name || '未命名规则',
    service: rule.service || 'all',
    metric: metricAliases[rule.metric] || rule.metric || 'service.error.rate',
    operator: operatorMap[String(rule.operator || rule.condition || '>')] || '>',
    threshold: Number(rule.threshold || 0),
    unit: rule.unit || '',
    duration: Number(rule.duration || 5),
    level: ['critical', 'warning', 'info'].includes(String(rule.level)) ? rule.level : 'warning',
    enabled: rule.enabled !== false,
    channels,
    emailRecipients,
    notifyOnRecovery: rule.notifyOnRecovery !== false,
    updatedAt: Number(rule.updatedAt || Date.now()),
  };
};

const loadNormalizedAlertRules = async (serviceContext: any): Promise<StoredAlertRule[]> => {
  const rules = await loadAlertRules(serviceContext);
  return rules.map(normalizeAlertRule).filter((rule: StoredAlertRule) => rule.enabled);
};

const normalizeImportedRule = (rule: any): StoredAlertRule =>
  normalizeAlertRule({
    ...rule,
    id: rule.id || `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    metric: rule.metric || '错误率',
    updatedAt: Date.now(),
  });

const queryLatestSeriesValue = async (params: {
  star: Starlight;
  metricRef: string;
  serviceId?: string;
  aggregateFn?: 'mean' | 'max' | 'last' | 'sum';
  timeRange?: string;
  normalizeValue?: (value: number) => number;
}) => {
  const bucket = InfluxDBHandler.getBucketName();
  if (!bucket) return null;
  const aggregateFn = params.aggregateFn || 'mean';
  const timeRange = params.timeRange || '-5m';
  const fluxQuery = `
    from(bucket: "${bucket}")
      |> range(start: ${timeRange})
      |> filter(fn: (r) => r["_measurement"] == "${escapeFluxString(params.metricRef)}")
      ${buildServiceFilter(params.serviceId)}
      |> filter(fn: (r) => r["_field"] == "value" or r["_field"] == "count" or r["_field"] == "total" or r["_field"] == "duration" or r["_field"] == "latency" or r["_field"] == "response_time" or r["_field"] == "time" or r["_field"] == "cpu_usage" or r["_field"] == "memory_usage" or r["_field"] == "memory_total")
      |> aggregateWindow(every: 5m, fn: ${aggregateFn}, createEmpty: false)
      |> last()
  `;
  const rows = await InfluxDBHandler.queryMetrics(fluxQuery, params.star);
  const value = Number(rows[rows.length - 1]?._value);
  if (!Number.isFinite(value)) return null;
  return params.normalizeValue ? params.normalizeValue(value) : value;
};

const queryErrorRateValue = async (star: Starlight, serviceId?: string) => {
  const bucket = InfluxDBHandler.getBucketName();
  if (!bucket) return null;
  const serviceFilter = buildServiceFilter(serviceId);
  const totalQuery = `
    from(bucket: "${bucket}")
      |> range(start: -5m)
      |> filter(fn: (r) => r["_measurement"] == "universe.request.total" or r["_measurement"] == "http_requests_total" or r["_measurement"] == "rpc_requests_total" or r["_measurement"] == "messaging_requests_total")
      ${serviceFilter}
      |> filter(fn: (r) => r["_field"] == "value" or r["_field"] == "count" or r["_field"] == "total")
      |> group()
      |> sum()
  `;
  const errorQuery = `
    from(bucket: "${bucket}")
      |> range(start: -5m)
      |> filter(fn: (r) => r["_measurement"] == "universe.request.error.total" or r["_measurement"] == "http_requests_total" or r["_measurement"] == "rpc_requests_total" or r["_measurement"] == "messaging_requests_total")
      ${serviceFilter}
      |> filter(fn: (r) => r["_measurement"] == "universe.request.error.total" or (exists r.status and string(v: r.status) =~ /5../) or (exists r.status_code and string(v: r.status_code) =~ /5../) or (exists r.http_status_code and string(v: r.http_status_code) =~ /5../) or (exists r.code and string(v: r.code) =~ /5../))
      |> filter(fn: (r) => r["_field"] == "value" or r["_field"] == "count" or r["_field"] == "total")
      |> group()
      |> sum()
  `;
  const [totalRows, errorRows] = await Promise.all([
    InfluxDBHandler.queryMetrics(totalQuery, star),
    InfluxDBHandler.queryMetrics(errorQuery, star).catch(() => []),
  ]);
  const total = Number(totalRows[totalRows.length - 1]?._value || 0);
  const errors = Number(errorRows[errorRows.length - 1]?._value || 0);
  return total > 0 ? toFixed((errors / total) * 100, 2) : 0;
};

const queryMemoryUsagePercentValue = async (star: Starlight, serviceId?: string) => {
  return queryLatestSeriesValue({
    star,
    metricRef: 'process.memory.heap.utilization',
    serviceId,
    normalizeValue: (value) => toFixed(value > 1 ? value : value * 100, 2),
  });
};

const queryResponseTimeValue = async (star: Starlight, serviceId?: string) => {
  const bucket = InfluxDBHandler.getBucketName();
  if (!bucket) {
    star.logger?.warn('[AlertEval] queryResponseTime: no InfluxDB bucket configured');
    return null;
  }
  const fluxQuery = `
    from(bucket: "${bucket}")
      |> range(start: -5m)
      |> filter(fn: (r) => ${RESPONSE_DURATION_MEASUREMENT_FILTER})
      ${buildServiceFilter(serviceId)}
      |> filter(fn: (r) => ${RESPONSE_DURATION_FIELD_FILTER})
      ${RESPONSE_DURATION_MS_NORMALIZATION_FLUX}
      ${RESPONSE_DURATION_COMPLETED_REQUEST_FILTER}
      |> group()
      |> max()
  `;
  const rows = await InfluxDBHandler.queryMetrics(fluxQuery, star);
  const value = Number(rows[rows.length - 1]?._value);
  return Number.isFinite(value) ? toFixed(value, 2) : null;
};

const queryRuleMetricValue = async (rule: StoredAlertRule, star: Starlight) => {
  const metricRef = metricAliases[rule.metric] || rule.metric;
  const serviceId = rule.service === 'all' ? undefined : rule.service;

  if (metricRef === 'service.error.rate') return queryErrorRateValue(star, serviceId);
  if (metricRef === 'service.memory.usage.percent')
    return queryMemoryUsagePercentValue(star, serviceId);
  if (metricRef === 'service.cpu.usage') {
    return queryLatestSeriesValue({
      star,
      metricRef: 'os.cpu.utilization',
      serviceId,
      normalizeValue: (value) => toFixed(value > 1 ? value : value * 100, 2),
    });
  }
  if (metricRef === 'service.memory.usage') {
    return queryLatestSeriesValue({ star, metricRef: 'process.memory.rss', serviceId });
  }
  if (metricRef === 'service.response.time') {
    return queryResponseTimeValue(star, serviceId);
  }
  if (metricRef === 'service.qps') {
    const values = await Promise.all([
      queryLatestSeriesValue({
        star,
        metricRef: 'universe.request.total',
        serviceId,
        aggregateFn: 'sum',
        timeRange: '-1m',
      }).catch(() => null),
      queryLatestSeriesValue({
        star,
        metricRef: 'http_requests_total',
        serviceId,
        aggregateFn: 'sum',
        timeRange: '-1m',
      }).catch(() => null),
      queryLatestSeriesValue({
        star,
        metricRef: 'rpc_requests_total',
        serviceId,
        aggregateFn: 'sum',
        timeRange: '-1m',
      }).catch(() => null),
      queryLatestSeriesValue({
        star,
        metricRef: 'messaging_requests_total',
        serviceId,
        aggregateFn: 'sum',
        timeRange: '-1m',
      }).catch(() => null),
    ]);
    const numericValues = values.filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value),
    );
    if (!numericValues.length) return null;
    return toFixed(numericValues.reduce((sum, value) => sum + value, 0) / 60, 2);
  }

  return queryLatestSeriesValue({
    star,
    metricRef,
    serviceId,
    normalizeValue: metricRef.includes('utilization')
      ? (value) => toFixed(value > 1 ? value : value * 100, 2)
      : undefined,
  });
};

const createNotificationPayloads = (
  alert: AlertEvaluationState,
  now: number,
): AlertNotification[] =>
  alert.channels.map((channel) => ({
    id: `notification-${alert.id}-${channel}-${now}`,
    alertId: alert.id,
    ruleId: alert.ruleId,
    type: alert.level,
    channel,
    status: 'pending',
    target: resolveNotificationTarget(channel),
    content: alert.message,
    sentAt: new Date(now).toISOString(),
    serviceId: alert.serviceId,
    service: alert.service,
    metric: alert.metric,
    value: alert.value,
    threshold: alert.threshold,
    operator: alert.operator,
    mobileTitle: `${alert.level === 'critical' ? '严重告警' : alert.level === 'warning' ? '警告告警' : '提示告警'} · ${alert.service}`,
    mobileBody: alert.message,
    updatedAt: now,
  }));

export const evaluateAlertRules = async (serviceContext: any, star: Starlight) => {
  const tenantId = String(serviceContext.tenantId || serviceContext.meta?.tenantId || '').trim();
  const rules = await loadNormalizedAlertRules(serviceContext);
  const now = Date.now();
  const results: AlertEvaluationState[] = [];

  if (rules.length === 0) return results;

  for (const rule of rules) {
    const alertId = `alert-rule-${rule.id}`;
    const previous = (await loadAlertState(serviceContext, alertId)) || {};
    try {
      const value = await queryRuleMetricValue(rule, star);
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        continue;
      }
      const matched = compareValue(value, rule.operator, rule.threshold);
      const conditionStartedAt = matched ? Number(previous.conditionStartedAt || now) : null;
      const durationMs = Math.max(1, Number(rule.duration || 5)) * 60 * 1000;
      const sustained =
        matched && conditionStartedAt !== null && now - conditionStartedAt >= durationMs;
      const previousStatus = previous.status as AlertStatus | undefined;
      const nextStatus: AlertStatus = sustained
        ? 'active'
        : matched
          ? 'pending'
          : previousStatus === 'suppressed'
            ? 'suppressed'
            : 'resolved';
      if (matched || sustained || nextStatus !== (previousStatus || 'resolved')) {
      }
      const serviceName =
        rule.service === 'all' ? '全系统' : normalizeServiceId(rule.service) || rule.service;
      const nextAlert: AlertEvaluationState = {
        ...previous,
        id: alertId,
        ruleId: rule.id,
        source: 'rule',
        status: nextStatus,
        level: rule.level,
        serviceId: rule.service,
        service: serviceName,
        metric: rule.metric,
        metricLabel: rule.metric,
        operator: rule.operator,
        threshold: rule.threshold,
        unit: rule.unit,
        value: toFixed(value, 2),
        duration: formatDuration(rule.duration),
        durationMinutes: Math.max(1, Number(rule.duration || 5)),
        channels: rule.channels,
        emailRecipients: rule.emailRecipients,
        notifyOnRecovery: rule.notifyOnRecovery,
        message: formatAlertMessage({ rule, value, serviceName, status: nextStatus }),
        time: new Date(sustained ? Number(previous.firstTriggeredAt || now) : now).toISOString(),
        firstTriggeredAt: sustained
          ? Number(previous.firstTriggeredAt || now)
          : previous.firstTriggeredAt || null,
        lastTriggeredAt: sustained ? now : previous.lastTriggeredAt || null,
        conditionStartedAt,
        lastEvaluatedAt: now,
        assigneeUserId: previous.assigneeUserId || '',
        assigneeName: previous.assigneeName || '',
      };

      if (previousStatus === 'suppressed' && matched) {
        nextAlert.status = 'suppressed';
      }

       const repository = serviceContext.alertOutboxRepository as AlertOutboxRepository | undefined;
       const shouldQueueActiveNotification = nextAlert.status === 'active' &&
         (!previous.lastNotificationAt || now - Number(previous.lastNotificationAt) >= ALERT_NOTIFICATION_COOLDOWN_MS);
       const shouldQueueRecoveryNotification = previousStatus === 'active' &&
         nextAlert.status === 'resolved' && rule.notifyOnRecovery;
       if (repository && !shouldQueueActiveNotification && !shouldQueueRecoveryNotification) {
         await repository.saveInstance({
           tenantId: String(serviceContext.tenantId || 'default'),
           alertId,
           ruleId: rule.id,
           status: nextAlert.status,
           payload: nextAlert,
           lastNotificationAt: previous.lastNotificationAt ? Number(previous.lastNotificationAt) : undefined,
         });
         const stateSaved = await saveAlertState(serviceContext, alertId, nextAlert);
         if (!stateSaved) star.logger?.warn(`[AlertEval] rule=${rule.id} Redis state projection failed`);
       }
       if (!repository) {
         const stateSaved = await saveAlertState(serviceContext, alertId, nextAlert);
         if (!stateSaved) star.logger?.warn(`[AlertEval] rule=${rule.id} saveAlertState FAILED (Redis write error)`);
       }

       if (shouldQueueActiveNotification || shouldQueueRecoveryNotification) {
        if (repository) {
          const recovery = shouldQueueRecoveryNotification;
          const created = await repository.saveInstanceAndCreateNotificationEvent({
            tenantId: String(serviceContext.tenantId || 'default'),
            alertId,
            ruleId: rule.id,
            status: nextAlert.status,
            payload: nextAlert,
            lastNotificationAt: recovery ? Number(previous.lastNotificationAt) || undefined : now,
            eventKey: recovery
              ? `recovered:${rule.id}:${Number(previous.firstTriggeredAt || previous.conditionStartedAt || now)}`
              : `${rule.id}:${Math.floor(now / ALERT_NOTIFICATION_COOLDOWN_MS)}`,
            channels: metricRuleChannels(rule),
          });
          await saveAlertState(serviceContext, alertId, recovery ? nextAlert : { ...nextAlert, lastNotificationAt: now });
          star.logger?.info(`[AlertEval] rule=${rule.id} durable ${recovery ? 'recovery' : 'active'} delivery event ${created ? 'created' : 'already exists'}`);
        } else {
          const notifications = createNotificationPayloads(nextAlert, now).filter(notification => notification.channel === 'InApp');
          await Promise.all(notifications.map(notification => saveNotificationState(serviceContext, notification.id, notification)));
          await saveAlertState(serviceContext, alertId, { ...nextAlert, lastNotificationAt: now });
        }

      } else if (nextAlert.status === 'active') {
      }

      results.push(nextAlert);
    } catch (error) {
      star.logger?.error(`Failed to evaluate alert rule ${rule.id}:`, error);
    }
  }

  return results;
};

const buildAlertSnapshot = async (serviceContext: any, params: any, loadedServices?: any[]) => {
  const scope = normalizeMetricsScope(params?.scope);
  const storedAlerts = await loadAllAlertStates(serviceContext);
  const ruleAlerts = storedAlerts
    .filter((alert: any) => alert?.source === 'rule')
    .map((alert: any) => ({
      id: alert.id,
      ruleId: alert.ruleId,
      source: 'rule',
      time: alert.time || new Date(alert.lastEvaluatedAt || Date.now()).toISOString(),
      serviceId: alert.serviceId,
      service: alert.service,
      level: alert.level || 'warning',
      message: alert.message,
      status: alert.status || 'active',
      duration: alert.duration || '5m',
      metric: alert.metric,
      value: alert.value,
      threshold: alert.threshold,
      operator: alert.operator,
      unit: alert.unit,
      channels: alert.channels || [],
      assigneeUserId: alert.assigneeUserId || '',
      assigneeName: alert.assigneeName || '',
      mobileTitle: `${alert.level === 'critical' ? '严重告警' : alert.level === 'warning' ? '警告告警' : '提示告警'} · ${alert.service}`,
      mobileBody: alert.message,
    }));
  const servicesResult = Array.isArray(loadedServices)
    ? null
    : await serviceContext.getServicesList({
        page: 1,
        pageSize: 200,
        keyword: params?.keyword,
        scope,
      });
  const services = Array.isArray(loadedServices)
    ? loadedServices
    : Array.isArray(servicesResult?.services)
      ? servicesResult.services
      : [];
  const healthAlerts = await Promise.all(
    services
      .filter((service: any) => service.health !== 'healthy' || Number(service.errorRate || 0) > 0)
      .slice(0, 50)
      .map(async (service: any) => {
        const id = `alert-${service.id}`;
        const stored = await loadAlertState(serviceContext, id);
        const time = stored?.updatedAt
          ? new Date(stored.updatedAt).toISOString()
          : new Date().toISOString();
        return {
          id,
          time,
          serviceId: service.id,
          service: service.name,
          level: levelFromHealth(service.health),
          message: `服务 ${service.name} 当前错误率 ${Number(service.errorRate || 0).toFixed(2)}%，延迟 ${Math.round(Number(service.latency || 0))}ms`,
          status: stored?.status || statusFromHealth(service.health),
          duration: '5m',
          assigneeUserId: stored?.assigneeUserId || '',
          assigneeName: stored?.assigneeName || '',
        };
      }),
  );

  return [...ruleAlerts, ...healthAlerts];
};

const getAlertSnapshot = async (serviceContext: any, params: any, loadedServices?: any[]) => {
  // A caller-provided catalog can be a different filtered view, so it must not
  // populate the shared cache used by independent HTTP requests.
  if (Array.isArray(loadedServices) || !serviceContext || typeof serviceContext !== 'object') {
    return buildAlertSnapshot(serviceContext, params, loadedServices);
  }

  const scope = normalizeMetricsScope(params?.scope);
  const keyword = String(params?.keyword || '').trim();
  const tenantId = String(serviceContext.tenantId || params?.tenantId || 'default');
  const key = `${tenantId}:${scope}:${keyword}`;
  let entries = alertSnapshotCache.get(serviceContext);
  if (!entries) {
    entries = new Map<string, AlertSnapshotCacheEntry>();
    alertSnapshotCache.set(serviceContext, entries);
  }

  const now = Date.now();
  const cached = entries.get(key);
  if (cached?.value && cached.expiresAt > now) return cached.value;
  if (cached?.inFlight) return cached.inFlight;

  const entry: AlertSnapshotCacheEntry = cached || { expiresAt: 0 };
  entry.inFlight = buildAlertSnapshot(serviceContext, { ...params, scope })
    .then((value) => {
      entry.value = value;
      entry.expiresAt = Date.now() + ALERT_SNAPSHOT_CACHE_TTL_MS;
      return value;
    })
    .finally(() => {
      entry.inFlight = undefined;
    });
  entries.set(key, entry);
  return entry.inFlight;
};

export const buildAlerts = async (serviceContext: any, params: any, loadedServices?: any[]) => {
  const alerts = await getAlertSnapshot(serviceContext, params, loadedServices);
  const startTime = params?.startTime ? Number(params.startTime) : null;
  const endTime = params?.endTime ? Number(params.endTime) : null;

  return alerts
    .filter((alert: any) => {
      const timestamp = new Date(alert.time).getTime();
      if (params?.serviceId && alert.serviceId !== params.serviceId) return false;
      if (params?.level && alert.level !== params.level) return false;
      if (params?.status && alert.status !== params.status) return false;
      if (params?.assigneeUserId && alert.assigneeUserId !== params.assigneeUserId) return false;
      if (startTime && timestamp < startTime) return false;
      if (endTime && timestamp > endTime) return false;
      return true;
    })
    .sort(
      (left: any, right: any) => new Date(right.time).getTime() - new Date(left.time).getTime(),
    );
};

const buildAlertAssignees = async () => {
  const users = (await queryAllUsers()) || [];
  return users.map((user: any) => ({
    userId: user.userId,
    nickname: user.nickname || user.userId,
    isAdmin: user.power === 999,
  }));
};

const registryRuleRepository = (serviceContext: unknown): RegistryMissingAlertRepository | undefined => (serviceContext as { registryMissingAlertRepository?: RegistryMissingAlertRepository }).registryMissingAlertRepository;
export const isSystemAdministrator = (meta: unknown) => {
  const user = (meta as { user?: { isAdmin?: boolean; power?: number } } | undefined)?.user;
  return Boolean(user?.isAdmin || user?.power === 999);
};
const isSystemAdmin = (ctx: Context) => isSystemAdministrator(ctx.meta);
const forbidden = (): HttpResponseItem => ({ status: 403, data: { code: HttpResponseCode.NoPermissionError, content: null, message: 'System administrator permission required', success: false } });
const unavailable = (): HttpResponseItem => ({ status: 503, data: { code: HttpResponseCode.ServiceActionFaild, content: null, message: 'Registry alert persistence is unavailable', success: false } });

const buildAlertRules = async (serviceContext: any, params: any) => {
  const scope = normalizeMetricsScope(params?.scope);
  const servicesResult = await serviceContext.getServicesList({ page: 1, pageSize: 20, scope });
  const services = Array.isArray(servicesResult?.services) ? servicesResult.services : [];
  const existingRules = await loadAlertRules(serviceContext);

  if (existingRules.length === 0) {
    await Promise.all(
      services.slice(0, 5).map((service: any, index: number) =>
        saveAlertRule(serviceContext, {
          id: `rule-${index + 1}`,
          name: `${service.name} 错误率告警`,
          service: service.id,
          metric: '错误率',
          operator: '>',
          threshold: 5,
          unit: '%',
          duration: 5,
          level:
            service.health === 'critical' || service.health === 'unhealthy'
              ? 'critical'
              : 'warning',
          enabled: true,
           channels: ['InApp'],
          updatedAt: Date.now(),
        }),
      ),
    );
  }

  const rules = ((await loadAlertRules(serviceContext)) || []).map(normalizeAlertRule);
  const startTime = params?.startTime ? Number(params.startTime) : null;
  const endTime = params?.endTime ? Number(params.endTime) : null;
  return rules.filter((rule: any) => {
    if (params?.serviceId && rule.service !== params.serviceId) return false;
    if (startTime && Number(rule.updatedAt || 0) < startTime) return false;
    if (endTime && Number(rule.updatedAt || 0) > endTime) return false;
    return true;
  });
};

export const buildNotifications = async (serviceContext: any, params: any) => {
  const normalizedParams = {
    keyword: String(params?.keyword || '').trim(),
    channel: String(params?.channel || '').trim(),
    status: String(params?.status || '').trim(),
    serviceId: String(params?.serviceId || '').trim(),
    startTime: params?.startTime ? Number(params.startTime) : null,
    endTime: params?.endTime ? Number(params.endTime) : null,
  };
  const repository = serviceContext.alertOutboxRepository as AlertOutboxRepository | undefined;
  const storedNotifications = repository
    ? await repository.listNotifications(200)
    : await loadAllNotificationStates(serviceContext);
  return storedNotifications
    .filter((notification: any) => notification?.alertId)
    .filter((notification: any) => {
      const timestamp = Number(
        notification.updatedAt || new Date(notification.sentAt || 0).getTime(),
      );
      if (normalizedParams.serviceId && notification.serviceId !== normalizedParams.serviceId)
        return false;
      if (normalizedParams.channel && notification.channel !== normalizedParams.channel)
        return false;
      if (normalizedParams.status && notification.status !== normalizedParams.status) return false;
      if (
        normalizedParams.keyword &&
        !String(notification.content || '').includes(normalizedParams.keyword)
      )
        return false;
      if (normalizedParams.startTime && timestamp < normalizedParams.startTime) return false;
      if (normalizedParams.endTime && timestamp > normalizedParams.endTime) return false;
      return true;
    })
    .sort((left: any, right: any) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
    .slice(0, 50);
};

const alerts = (star: Starlight) => ({
  'internal.evaluate-rules': {
    async handler(ctx: Context): Promise<any> {
      const content = await evaluateAlertRules(
        Object.assign(Object.create(this), { tenantId: String(ctx.meta?.tenantId || '') }),
        star,
      );
      return { evaluated: content.length, items: content };
    },
  },
  'v1.alerts': {
    metadata: { auth: true },
    params: {
      level: { type: 'string', optional: true },
      status: { type: 'string', optional: true },
      serviceId: { type: 'string', optional: true },
      assigneeUserId: { type: 'string', optional: true },
      scope: { type: 'string', optional: true },
      keyword: { type: 'string', optional: true },
      startTime: { type: 'number', optional: true, convert: true },
      endTime: { type: 'number', optional: true, convert: true },
    },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      try {
        const content = await buildAlerts(this as any, ctx.params || {});
        return {
          status: 200,
          data: {
            code: HttpResponseCode.Success,
            content,
            message: '获取告警列表成功',
            success: true,
          },
        };
      } catch (error) {
        star.logger?.error('Get alerts failed:', error);
        return {
          status: 500,
          data: {
            code: HttpResponseCode.ServiceActionFaild,
            content: null,
            message: '获取告警列表失败',
            success: false,
          },
        };
      }
    },
  },
  'v1.alerts/assignees': {
    metadata: { auth: true },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      try {
        const content = await buildAlertAssignees();
        const fallbackUserId = (ctx.meta as any)?.user?.userId || '';
        const fallbackNickname = (ctx.meta as any)?.user?.nickname || fallbackUserId;
        const finalContent =
          content.length > 0
            ? content
            : fallbackUserId
              ? [
                  {
                    userId: fallbackUserId,
                    nickname: fallbackNickname,
                    isAdmin: Boolean((ctx.meta as any)?.user?.isAdmin),
                  },
                ]
              : [];
        return {
          status: 200,
          data: {
            code: HttpResponseCode.Success,
            content: finalContent,
            message: '获取告警指派人成功',
            success: true,
          },
        };
      } catch (error) {
        star.logger?.error('Get alert assignees failed:', error);
        return {
          status: 500,
          data: {
            code: HttpResponseCode.ServiceActionFaild,
            content: null,
            message: '获取告警指派人失败',
            success: false,
          },
        };
      }
    },
  },
  'v1.alert-rules': {
    metadata: { auth: true },
    params: {
      serviceId: { type: 'string', optional: true },
      scope: { type: 'string', optional: true },
      startTime: { type: 'number', optional: true, convert: true },
      endTime: { type: 'number', optional: true, convert: true },
    },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      try {
        const content = await buildAlertRules(this as any, ctx.params || {});
        return {
          status: 200,
          data: {
            code: HttpResponseCode.Success,
            content,
            message: '获取告警规则成功',
            success: true,
          },
        };
      } catch (error) {
        star.logger?.error('Get alert rules failed:', error);
        return {
          status: 500,
          data: {
            code: HttpResponseCode.ServiceActionFaild,
            content: null,
            message: '获取告警规则失败',
            success: false,
          },
        };
      }
    },
  },
  'v1.registry-missing-alert-rules': {
    metadata: { auth: true },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      if (!isSystemAdmin(ctx)) return forbidden();
      const repository = registryRuleRepository(this);
      if (!repository) return unavailable();
      return { status: 200, data: { code: HttpResponseCode.Success, content: await repository.listRules(), message: '获取注册缺失告警规则成功', success: true } };
    },
  },
  'v1.registry-missing-alert-rules/create': {
    metadata: { auth: true },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      if (!isSystemAdmin(ctx)) return forbidden();
      const repository = registryRuleRepository(this);
      if (!repository) return unavailable();
      try {
        const rule = normalizeRegistryMissingRule(ctx.params as Record<string, unknown>);
        await repository.saveRule(rule);
        return { status: 200, data: { code: HttpResponseCode.Success, content: rule, message: '创建注册缺失告警规则成功', success: true } };
      } catch (error) {
        return { status: 400, data: { code: HttpResponseCode.ParamsError, content: null, message: error instanceof Error ? error.message : '告警规则参数无效', success: false } };
      }
    },
  },
  'v1.registry-missing-alert-rules/:id': {
    metadata: { auth: true },
    params: { id: { type: 'string', required: true } },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      if (!isSystemAdmin(ctx)) return forbidden();
      const repository = registryRuleRepository(this);
      if (!repository) return unavailable();
      const previous = await repository.getRule(ctx.params.id);
      if (!previous) return { status: 404, data: { code: HttpResponseCode.BAD_REQUEST, content: null, message: '告警规则不存在', success: false } };
      try {
        const rule = normalizeRegistryMissingRule({ ...previous, ...(ctx.params as Record<string, unknown>), ruleId: previous.ruleId });
        await repository.saveRule(rule);
        return { status: 200, data: { code: HttpResponseCode.Success, content: rule, message: '更新注册缺失告警规则成功', success: true } };
      } catch (error) {
        return { status: 400, data: { code: HttpResponseCode.ParamsError, content: null, message: error instanceof Error ? error.message : '告警规则参数无效', success: false } };
      }
    },
  },
  'v1.registry-missing-alert-rules/:id/delete': {
    metadata: { auth: true },
    params: { id: { type: 'string', required: true } },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      if (!isSystemAdmin(ctx)) return forbidden();
      const repository = registryRuleRepository(this);
      if (!repository) return unavailable();
      const deleted = await repository.deleteRule(ctx.params.id);
      return deleted ? { status: 200, data: { code: HttpResponseCode.Success, content: { id: ctx.params.id }, message: '删除注册缺失告警规则成功', success: true } } : { status: 404, data: { code: HttpResponseCode.BAD_REQUEST, content: null, message: '告警规则不存在', success: false } };
    },
  },
  'v1.alert-rules/create': {
    metadata: { auth: true },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      let payload: StoredAlertRule;
      try {
        payload = normalizeImportedRule({ ...(ctx.params || {}), id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
        validateMetricRuleDelivery(payload.channels, payload.emailRecipients);
      } catch (error) {
        return { status: 400, data: { code: HttpResponseCode.ParamsError, content: null, message: error instanceof Error ? error.message : '告警规则参数无效', success: false } };
      }
      const success = await saveAlertRule(this as any, payload);
      if (!success) {
        return {
          status: 500,
          data: {
            code: HttpResponseCode.ServiceActionFaild,
            content: null,
            message: '创建告警规则失败',
            success: false,
          },
        };
      }
      return {
        status: 200,
        data: {
          code: HttpResponseCode.Success,
          content: payload,
          message: '创建告警规则成功',
          success: true,
        },
      };
    },
  },
  'v1.alert-rules/bulk-update': {
    metadata: { auth: true },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      const { ids = [], enabled } = (ctx.params || {}) as { ids?: string[]; enabled: boolean };
      const updated: any[] = [];

      for (const id of ids) {
        const prev = (await loadAlertRule(this as any, id)) || {};
        const next = { ...prev, enabled, updatedAt: Date.now() };
        const success = await saveAlertRule(this as any, next);
        if (success) updated.push(next);
      }

      return {
        status: 200,
        data: {
          code: HttpResponseCode.Success,
          content: updated,
          message: '批量更新告警规则成功',
          success: true,
        },
      };
    },
  },
  'v1.alert-rules/export': {
    metadata: { auth: true },
    params: {
      serviceId: { type: 'string', optional: true },
      scope: { type: 'string', optional: true },
      startTime: { type: 'number', optional: true, convert: true },
      endTime: { type: 'number', optional: true, convert: true },
    },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      const rules = await buildAlertRules(this as any, ctx.params || {});
      return {
        status: 200,
        data: {
          code: HttpResponseCode.Success,
          content: { rules, exportedAt: new Date().toISOString() },
          message: '导出告警规则成功',
          success: true,
        },
      };
    },
  },
  'v1.alert-rules/import': {
    metadata: { auth: true },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      const rules = Array.isArray((ctx.params as any)?.rules) ? (ctx.params as any).rules : [];
      let normalizedRules: StoredAlertRule[];
      try {
        normalizedRules = rules.map(normalizeImportedRule);
        normalizedRules.forEach(rule => validateMetricRuleDelivery(rule.channels, rule.emailRecipients));
      } catch (error) {
        return { status: 400, data: { code: HttpResponseCode.ParamsError, content: null, message: error instanceof Error ? error.message : '告警规则参数无效', success: false } };
      }
      const imported: StoredAlertRule[] = [];
      for (const normalized of normalizedRules) {
        const success = await saveAlertRule(this as any, normalized);
        if (success) imported.push(normalized);
      }
      return {
        status: 200,
        data: {
          code: HttpResponseCode.Success,
          content: imported,
          message: '导入告警规则成功',
          success: true,
        },
      };
    },
  },
  'v1.alert-rules/:id': {
    metadata: { auth: true },
    params: { id: { type: 'string', required: true } },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      const prev = (await loadAlertRule(this as any, ctx.params.id)) || {};
      let next: StoredAlertRule;
      try {
        next = normalizeImportedRule({ ...prev, ...(ctx.params || {}), id: ctx.params.id });
        validateMetricRuleDelivery(next.channels, next.emailRecipients);
      } catch (error) {
        return { status: 400, data: { code: HttpResponseCode.ParamsError, content: null, message: error instanceof Error ? error.message : '告警规则参数无效', success: false } };
      }
      const success = await saveAlertRule(this as any, next);
      if (!success) {
        return {
          status: 500,
          data: {
            code: HttpResponseCode.ServiceActionFaild,
            content: null,
            message: '更新告警规则失败',
            success: false,
          },
        };
      }
      return {
        status: 200,
        data: {
          code: HttpResponseCode.Success,
          content: next,
          message: '更新告警规则成功',
          success: true,
        },
      };
    },
  },
  'v1.alert-rules/:id/delete': {
    metadata: { auth: true },
    params: { id: { type: 'string', required: true } },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      const success = await deleteAlertRule(this as any, ctx.params.id);
      if (!success) {
        return {
          status: 500,
          data: {
            code: HttpResponseCode.ServiceActionFaild,
            content: null,
            message: '删除告警规则失败',
            success: false,
          },
        };
      }
      return {
        status: 200,
        data: {
          code: HttpResponseCode.Success,
          content: { success: true, id: ctx.params.id },
          message: '删除告警规则成功',
          success: true,
        },
      };
    },
  },
  'v1.notifications': {
    metadata: { auth: true },
    params: {
      keyword: { type: 'string', optional: true },
      channel: { type: 'string', optional: true },
      status: { type: 'string', optional: true },
      serviceId: { type: 'string', optional: true },
      scope: { type: 'string', optional: true },
      startTime: { type: 'number', optional: true, convert: true },
      endTime: { type: 'number', optional: true, convert: true },
    },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      try {
        const content = await buildNotifications(this as any, ctx.params || {});
        return {
          status: 200,
          data: {
            code: HttpResponseCode.Success,
            content,
            message: '获取通知列表成功',
            success: true,
          },
        };
      } catch (error) {
        star.logger?.error('Get notifications failed:', error);
        return {
          status: 500,
          data: {
            code: HttpResponseCode.ServiceActionFaild,
            content: null,
            message: '获取通知列表失败',
            success: false,
          },
        };
      }
    },
  },
  'v1.alerts/:id/resolve': {
    metadata: { auth: true },
    params: { id: { type: 'string', required: true } },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      const prev = (await loadAlertState(this as any, ctx.params.id)) || {};
      const success = await saveAlertState(this as any, ctx.params.id, {
        ...prev,
        status: 'resolved',
        updatedAt: Date.now(),
      });
      if (!success) {
        return {
          status: 500,
          data: {
            code: HttpResponseCode.ServiceActionFaild,
            content: null,
            message: '告警状态更新失败',
            success: false,
          },
        };
      }
      return {
        status: 200,
        data: {
          code: HttpResponseCode.Success,
          content: { success: true, id: ctx.params.id, status: 'resolved' },
          message: '告警已标记为已解决',
          success: true,
        },
      };
    },
  },
  'v1.alerts/:id/ack': {
    metadata: { auth: true },
    params: { id: { type: 'string', required: true } },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      const prev = (await loadAlertState(this as any, ctx.params.id)) || {};
      const success = await saveAlertState(this as any, ctx.params.id, {
        ...prev,
        status: 'acknowledged',
        updatedAt: Date.now(),
      });
      if (!success) {
        return {
          status: 500,
          data: {
            code: HttpResponseCode.ServiceActionFaild,
            content: null,
            message: '告警状态更新失败',
            success: false,
          },
        };
      }
      return {
        status: 200,
        data: {
          code: HttpResponseCode.Success,
          content: { success: true, id: ctx.params.id, status: 'acknowledged' },
          message: '告警已确认',
          success: true,
        },
      };
    },
  },
  'v1.alerts/:id/suppress': {
    metadata: { auth: true },
    params: { id: { type: 'string', required: true } },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      const prev = (await loadAlertState(this as any, ctx.params.id)) || {};
      const success = await saveAlertState(this as any, ctx.params.id, {
        ...prev,
        status: 'suppressed',
        updatedAt: Date.now(),
      });
      if (!success) {
        return {
          status: 500,
          data: {
            code: HttpResponseCode.ServiceActionFaild,
            content: null,
            message: '告警状态更新失败',
            success: false,
          },
        };
      }
      return {
        status: 200,
        data: {
          code: HttpResponseCode.Success,
          content: { success: true, id: ctx.params.id, status: 'suppressed' },
          message: '告警已静默',
          success: true,
        },
      };
    },
  },
  'v1.alerts/:id/assign': {
    metadata: { auth: true },
    params: {
      id: { type: 'string', required: true },
      assigneeUserId: { type: 'string', optional: true },
      assigneeName: { type: 'string', optional: true },
    },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      const prev = (await loadAlertState(this as any, ctx.params.id)) || {};
      const next = {
        ...prev,
        assigneeUserId: ctx.params.assigneeUserId || '',
        assigneeName: ctx.params.assigneeName || '',
        updatedAt: Date.now(),
      };
      const success = await saveAlertState(this as any, ctx.params.id, next);
      if (!success) {
        return {
          status: 500,
          data: {
            code: HttpResponseCode.ServiceActionFaild,
            content: null,
            message: '指派告警失败',
            success: false,
          },
        };
      }
      return {
        status: 200,
        data: {
          code: HttpResponseCode.Success,
          content: next,
          message: '告警已更新指派人',
          success: true,
        },
      };
    },
  },
  'v1.notifications/:id/resend': {
    metadata: { auth: true },
    params: { id: { type: 'string', required: true } },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      const repository = (this as { alertOutboxRepository?: AlertOutboxRepository }).alertOutboxRepository;
      const success = repository
        ? await repository.requeueDelivery(ctx.params.id)
        : await saveNotificationState(this as any, ctx.params.id, { status: 'pending', updatedAt: Date.now() });
      if (!success) {
        return {
          status: 500,
          data: {
            code: HttpResponseCode.ServiceActionFaild,
            content: null,
            message: '通知重发失败',
            success: false,
          },
        };
      }
      return {
        status: 200,
        data: {
          code: HttpResponseCode.Success,
            content: { success: true, id: ctx.params.id, status: 'pending' },
            message: '通知已重新排队发送',
          success: true,
        },
      };
    },
  },
});

export default alerts;
