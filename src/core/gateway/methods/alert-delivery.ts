export type GatewayAlertPayload = {
  alertId: string
  ruleId: string
  tenantId: string
  level: 'critical' | 'warning' | 'info'
  service: string
  metric: string
  value: number
  threshold: number
  operator: '>' | '>=' | '<' | '<=' | '='
  status: 'active' | 'resolved' | 'suppressed'
  message: string
  time: string
  recipientUserId?: string
}

type ScopedClient = {
  isAuthenticated: boolean
  tenantId?: string
  userId?: string
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 500

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

export const isGatewayAlertPayload = (value: unknown): value is GatewayAlertPayload => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const payload = value as Record<string, unknown>
  return (
    isNonEmptyString(payload.alertId) &&
    isNonEmptyString(payload.ruleId) &&
    isNonEmptyString(payload.tenantId) &&
    (payload.level === 'critical' || payload.level === 'warning' || payload.level === 'info') &&
    isNonEmptyString(payload.service) &&
    isNonEmptyString(payload.metric) &&
    isFiniteNumber(payload.value) &&
    isFiniteNumber(payload.threshold) &&
    (payload.operator === '>' ||
      payload.operator === '>=' ||
      payload.operator === '<' ||
      payload.operator === '<=' ||
      payload.operator === '=') &&
    (payload.status === 'active' || payload.status === 'resolved' || payload.status === 'suppressed') &&
    isNonEmptyString(payload.message) &&
    isNonEmptyString(payload.time) &&
    (payload.recipientUserId === undefined || isNonEmptyString(payload.recipientUserId))
  )
}

export const canReceiveGatewayAlert = (client: ScopedClient, alert: GatewayAlertPayload) =>
  client.isAuthenticated &&
  client.tenantId === alert.tenantId &&
  (!alert.recipientUserId || client.userId === alert.recipientUserId)
