/**
 * 指标数据相关事件处理器
 */
import { MetricsState } from '../types'
import {
  CANONICAL_SYSTEM_METRICS_EVENT,
  LEGACY_SYSTEM_METRICS_EVENTS,
  SYSTEM_APP_KEY_ID,
  SYSTEM_TENANT_ID,
  SYSTEM_VISIBILITY_SCOPE,
  buildSystemServiceId,
  resolveSystemServiceIdentity
} from '../utils'

const resolveServiceNameFromNodeId = (nodeID?: string) => {
  const normalized = String(nodeID || '').trim()
  if (!normalized) return 'unknown'
  const segments = normalized.split('-')
  if (segments.length <= 1) return normalized
  return segments.slice(0, -1).join('-') || normalized
}

const buildSystemMetricsPayload = (ctx: any) => {
  const payload = ctx.params || {}
  if (Array.isArray(payload)) {
    return {
      nodeID: ctx.nodeID || ctx.caller || 'unknown',
      metrics: payload,
      emittedAt: Date.now()
    }
  }
  return {
    nodeID: payload.nodeID || payload.nodeId || ctx.nodeID || ctx.caller || 'unknown',
    metrics: Array.isArray(payload.metrics) ? payload.metrics : Array.isArray(payload.list) ? payload.list : [],
    emittedAt: payload.emittedAt || payload.timestamp || Date.now()
  }
}

const queueSystemMetricsBatch = (ctx: any) => {
  const { metricsState } = ctx.service as { metricsState: MetricsState }
  const { nodeID, metrics, emittedAt } = buildSystemMetricsPayload(ctx)

  if (!Array.isArray(metrics) || metrics.length === 0) {
    return
  }

  const serviceName = resolveServiceNameFromNodeId(nodeID)
  const identity = resolveSystemServiceIdentity(serviceName)

  const enrichedData = metrics.flatMap((metric: any) => {
    const values = Array.isArray(metric.values) ? metric.values : []
    if (values.length === 0) return []

    return values
      .map((entry: any) => {
        const entryValue =
          typeof entry?.value === 'number'
            ? entry.value
            : typeof entry?.lastValue === 'number'
              ? entry.lastValue
              : typeof entry?.count === 'number'
                ? entry.count
                : null

        if (entryValue === null) return null

        return {
          measurement: metric.name,
          tags: {
            nodeID,
            nodeId: nodeID,
            type: metric.type,
            unit: metric.unit,
            tenantId: SYSTEM_TENANT_ID,
            appKeyId: SYSTEM_APP_KEY_ID,
            visibilityScope: SYSTEM_VISIBILITY_SCOPE,
            sourceType: 'darwin-system',
            source: 'darwin-system',
            service: identity.serviceName,
            serviceId: identity.serviceId,
            owner: identity.owner,
            team: identity.team,
            env: identity.env,
            region: identity.region,
            runtime: identity.runtime,
            tags: identity.tags.join(','),
            ...(entry?.labels || {})
          },
          fields: {
            value: entryValue
          },
          timestamp: entry?.timestamp || emittedAt || Date.now()
        }
      })
      .filter(Boolean)
  })

  if (enrichedData.length === 0) {
    return
  }

  metricsState.processingQueue.push({
    id: `${SYSTEM_TENANT_ID}-${identity.serviceId}-${emittedAt}`,
    format: 'system',
    data: enrichedData,
    timestamp: emittedAt || Date.now(),
    retryCount: 0
  })

  ctx.service.logger.debug(`System metrics received from node: ${nodeID}`)
}

const createSystemMetricsHandler = (eventName: string) => ({
  async handler(ctx: any) {
    try {
      queueSystemMetricsBatch(ctx)
    } catch (error) {
      ctx.service.logger.error(`Failed to handle ${eventName} event:`, error)
    }
  }
})

const systemMetricsHandlers = Object.fromEntries(
  [CANONICAL_SYSTEM_METRICS_EVENT, ...LEGACY_SYSTEM_METRICS_EVENTS].map((eventName) => [
    eventName,
    createSystemMetricsHandler(eventName)
  ])
)

export default {
  // 处理原始指标数据（支持多租户）
  'metrics.raw': {
    async handler(ctx: any) {
      try {
        const { tenantId, data } = ctx.params
        const { metricsState } = ctx.service

        const enrichedData = {
          ...data,
          tenantId,
          timestamp: Date.now(),
          serviceId: ctx.service.fullName
        }

        metricsState.processingQueue.push({
          id: `${tenantId}-${Date.now()}`,
          format: data.format || 'custom',
          data: [enrichedData],
          timestamp: Date.now(),
          retryCount: 0
        })

        ctx.service.logger.debug(`Raw metrics processed for tenant: ${tenantId}`)
      } catch (error) {
        ctx.service.logger.error('Failed to handle metrics.raw event:', error)
      }
    }
  },

  // 处理指标处理完成事件
  'metrics-processed': {
    async handler(ctx: any) {
      try {
        const { tenantId, batchId, count } = ctx.params
        const { metricsState } = ctx.service

        const tenantKey = `tenant:${tenantId}`
        const currentStats = metricsState.cache.metrics.get(tenantKey) || { processed: 0 }
        currentStats.processed += count || 1
        currentStats.lastProcessed = Date.now()
        metricsState.cache.metrics.set(tenantKey, currentStats)

        metricsState.stats.processed += count || 1
        metricsState.stats.lastProcessed = Date.now()

        ctx.service.logger.debug(`Metrics batch processed for tenant: ${tenantId}, batch: ${batchId}`)
      } catch (error) {
        ctx.service.logger.error('Failed to handle metrics.processed event:', error)
      }
    }
  },

  // 处理指标聚合事件
  'metrics.aggregate': {
    async handler(ctx: any) {
      try {
        const { tenantId, timeRange, aggregationType } = ctx.params
        const { metricsState } = ctx.service

        const aggregationKey = `agg:${tenantId}:${timeRange}:${aggregationType}`
        const aggregationResult = {
          tenantId,
          timeRange,
          aggregationType,
          result: {},
          timestamp: Date.now()
        }

        metricsState.cache.aggregations.set(aggregationKey, aggregationResult)

        ctx.service.logger.debug(`Metrics aggregated for tenant: ${tenantId}, type: ${aggregationType}`)
      } catch (error) {
        ctx.service.logger.error('Failed to handle metrics.aggregate event:', error)
      }
    }
  },

  ...systemMetricsHandlers
}
