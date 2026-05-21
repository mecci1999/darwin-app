# darwin-app 后端 API 契约文档 v1

这份文档按可实施版本定义：

- 路径
- 方法
- 请求参数
- 响应结构
- 错误模型

## 说明
1. 这不是最终 OpenAPI 文件，但已经接近可直接转换为 OpenAPI/TS schema
2. 所有接口返回都统一包裹成标准响应结构
3. 前端页面以后只依赖这些 read model / action 契约

---

## 1. 统一响应模型

### Success
```ts
type ApiSuccess<T> = {
  status: 200
  data: {
    code: 0
    success: true
    message: string
    content: T
    meta?: {
      requestId?: string
      timestamp?: number
      pagination?: {
        page: number
        pageSize: number
        total: number
      }
    }
  }
}
```

### Error
```ts
type ApiError = {
  status: number
  data: {
    code: string | number
    success: false
    message: string
    content: null
    error?: {
      type: string
      details?: Record<string, any>
    }
    meta?: {
      requestId?: string
      timestamp?: number
    }
  }
}
```

---

## 2. 通用模型

### 2.1 ScopeFilter
```ts
type ScopeFilter = {
  tenantId?: string
  env?: string[]
  region?: string[]
  serviceId?: string[]
  appKey?: string[]
  instanceId?: string[]
  tags?: string[]
}
```

### 2.2 TimeRange
```ts
type TimeRange = {
  startTime: number
  endTime: number
  preset?: string
}
```

### 2.3 ServiceIdentity
```ts
type ServiceIdentity = {
  id: string
  name: string
  displayName?: string
  owner?: string
  team?: string
  env?: string
  region?: string
  runtime?: string
  appKey?: string
  tags?: string[]
  repoUrl?: string
  runbookUrl?: string
  healthStatus: 'healthy' | 'degraded' | 'critical' | 'muted' | 'unknown'
}
```

---

# 3. Overview API

---

## 3.1 获取全局概览摘要

### `GET /api/overview/v1/summary`

### Query
```ts
type Query = ScopeFilter & TimeRange
```

### Response
```ts
type OverviewSummary = {
  totals: {
    serviceCount: number
    healthyServiceCount: number
    activeIncidents: number
    totalQps: number
    errorRate: number
    p95Latency: number
    ingestSuccessRate: number
    quotaBurnRate: number
  }
  topRiskServices: Array<{
    serviceId: string
    service: string
    healthStatus: string
    errorRate: number
    p95Latency: number
    activeIncidentCount: number
  }>
}
```

---

## 3.2 获取概览趋势

### `GET /api/overview/v1/trends`

### Query
```ts
type Query = ScopeFilter & TimeRange & {
  groupBy?: 'overall' | 'env' | 'team'
}
```

### Response
```ts
type OverviewTrendResponse = {
  requests: TimeSeriesPoint[]
  errors: TimeSeriesPoint[]
  latency: TimeSeriesPoint[]
}
```

---

## 3.3 获取最近事件

### `GET /api/overview/v1/incidents`

### Response
```ts
type OverviewIncidentItem = {
  id: string
  title: string
  severity: 'warning' | 'critical'
  source: 'metrics' | 'logs' | 'trace' | 'alert' | 'quota' | 'ingest'
  serviceId?: string
  service?: string
  startedAt: number
  status: string
  summary?: string
}
```

---

# 4. Catalog API

---

## 4.1 获取服务列表

### `GET /api/catalog/v1/services`

### Query
```ts
type Query = ScopeFilter & {
  keyword?: string
  owner?: string[]
  team?: string[]
  status?: string[]
  page?: number
  pageSize?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}
```

### Response
```ts
type ServiceCatalogRow = {
  identity: ServiceIdentity
  instanceCount: number
  qps: number
  errorRate: number
  p95Latency: number
  activeIncidentCount: number
  lastDeployAt?: number
}
```

---

## 4.2 获取服务详情元数据

### `GET /api/catalog/v1/services/:serviceId`

### Response
```ts
type ServiceCatalogDetail = {
  identity: ServiceIdentity
  deployment: {
    lastDeployAt?: number
    version?: string
  }
  metadata: {
    description?: string
    language?: string
    repoUrl?: string
    runbookUrl?: string
  }
}
```

---

## 4.3 获取服务 quick view

### `GET /api/catalog/v1/services/:serviceId/quick-view`

### Response
```ts
type ServiceQuickView = {
  identity: ServiceIdentity
  redSummary: {
    qps: number
    errorRate: number
    p95Latency: number
  }
  activeIncidentCount: number
  instanceCount: number
}
```

---

# 5. Service Detail API

---

## 5.1 获取服务总览

### `GET /api/service/v1/:serviceId/overview`

### Query
```ts
type Query = TimeRange & ScopeFilter
```

### Response
```ts
type ServiceOverviewResponse = {
  identity: ServiceIdentity
  redSummary: {
    qps: number
    errorRate: number
    p50Latency: number
    p95Latency: number
    p99Latency: number
  }
  healthTimeline: TimeSeriesPoint[]
  dependencies: {
    upstream: number
    downstream: number
  }
  incidents: OverviewIncidentItem[]
  recentExceptions: Array<{
    clusterId: string
    title: string
    count: number
  }>
}
```

---

## 5.2 获取服务 metrics

### `GET /api/service/v1/:serviceId/metrics`

### Response
```ts
type ServiceMetricsResponse = {
  requestRate: TimeSeriesPoint[]
  errorRate: TimeSeriesPoint[]
  latency: {
    p50: TimeSeriesPoint[]
    p95: TimeSeriesPoint[]
    p99: TimeSeriesPoint[]
  }
  resources: {
    cpu: TimeSeriesPoint[]
    memory: TimeSeriesPoint[]
    gc?: TimeSeriesPoint[]
    threads?: TimeSeriesPoint[]
  }
}
```

---

## 5.3 获取服务依赖拓扑

### `GET /api/service/v1/:serviceId/topology`

### Response
```ts
type ServiceTopologyResponse = {
  nodes: TopologyNode[]
  edges: TopologyEdge[]
}
```

---

## 5.4 获取服务运行时信息

### `GET /api/service/v1/:serviceId/runtime`

### Response
```ts
type ServiceRuntimeResponse = {
  instances: Array<{
    instanceId: string
    host?: string
    ip?: string
    status: string
    cpu?: number
    memory?: number
    uptime?: number
    restartCount?: number
  }>
  appKey?: string
  env?: string
  region?: string
  ingestStatus?: {
    metrics: boolean
    logs: boolean
    traces: boolean
  }
}
```

---

# 6. Metrics API

---

## 6.1 查询指标

### `POST /api/metrics/v1/query/execute`

### Body
```ts
type MetricsQueryRequest = {
  timeRange: TimeRange
  scope?: ScopeFilter
  metrics: string[]
  aggregation?: 'avg' | 'sum' | 'max' | 'min' | 'last'
  groupBy?: string[]
  interval?: string
  filters?: Record<string, any>
}
```

### Response
```ts
type MetricsQueryResponse = {
  series: Array<{
    metric: string
    labels?: Record<string, string>
    points: TimeSeriesPoint[]
  }>
}
```

---

## 6.2 指标对比查询

### `POST /api/metrics/v1/query/compare`

### Body
```ts
type MetricsCompareRequest = {
  timeRange: TimeRange
  left: MetricsQueryRequest
  right: MetricsQueryRequest
}
```

### Response
```ts
type MetricsCompareResponse = {
  left: MetricsQueryResponse
  right: MetricsQueryResponse
}
```

---

## 6.3 获取 tag values

### `GET /api/metrics/v1/query/tag-values`

### Query
```ts
type Query = {
  metric: string
  tag: string
}
```

### Response
```ts
type TagValuesResponse = {
  values: string[]
}
```

---

## 6.4 获取实时概览

### `GET /api/metrics/v1/realtime/overview`

### Response
```ts
type RealtimeOverviewResponse = {
  totals: {
    qps: number
    errorRate: number
    p95Latency: number
  }
  topServices: Array<{
    serviceId: string
    service: string
    qps: number
    errorRate: number
    p95Latency: number
  }>
}
```

---

## 6.5 获取全局拓扑图

### `GET /api/metrics/v1/topology/graph`

### Query
```ts
type Query = TimeRange & ScopeFilter & {
  mode?: 'service' | 'instance'
  overlay?: 'health' | 'traffic' | 'latency' | 'error'
}
```

### Response
```ts
type TopologyGraphResponse = {
  nodes: TopologyNode[]
  edges: TopologyEdge[]
}
```

---

# 7. Trace API

---

## 7.1 Trace 搜索

### `POST /api/trace/v1/search/execute`

### Body
```ts
type TraceSearchRequest = {
  timeRange: TimeRange
  scope?: ScopeFilter
  serviceId?: string
  operation?: string[]
  status?: string[]
  minDurationMs?: number
  maxDurationMs?: number
  keyword?: string
  page?: number
  pageSize?: number
}
```

### Response
```ts
type TraceSearchResponse = {
  histogram: Array<{ bucket: string; count: number }>
  items: Array<{
    traceId: string
    rootService: string
    operation: string
    status: string
    durationMs: number
    startTime: number
    spanCount: number
    errorCount: number
  }>
}
```

---

## 7.2 获取 trace 详情

### `GET /api/trace/v1/trace/:traceId`

### Response
```ts
type TraceDetailResponse = {
  traceId: string
  summary: {
    rootService: string
    durationMs: number
    startTime: number
    errorCount: number
  }
  spans: SpanModel[]
}
```

---

## 7.3 获取 trace 相关日志

### `GET /api/trace/v1/trace/:traceId/related-logs`

### Response
```ts
type RelatedLogsResponse = {
  items: Array<{
    id: string
    timestamp: number
    service: string
    level: string
    message: string
  }>
}
```

---

# 8. Logs API

---

## 8.1 搜索日志

### `POST /api/logs/v1/search/execute`

### Body
```ts
type LogSearchRequest = {
  timeRange: TimeRange
  scope?: ScopeFilter
  query?: string
  levels?: string[]
  traceId?: string
  page?: number
  pageSize?: number
  sortOrder?: 'asc' | 'desc'
}
```

### Response
```ts
type LogSearchResponse = {
  items: Array<{
    id: string
    timestamp: number
    service: string
    instanceId?: string
    level: string
    traceId?: string
    message: string
    tags?: string[]
  }>
}
```

---

## 8.2 获取 facets

### `POST /api/logs/v1/search/facets`

### Body
同 `LogSearchRequest`

### Response
```ts
type LogFacetResponse = {
  levels: Array<{ key: string; count: number }>
  services: Array<{ key: string; count: number }>
  tags: Array<{ key: string; count: number }>
}
```

---

## 8.3 获取模式列表

### `GET /api/logs/v1/patterns/list`

### Query
```ts
type Query = TimeRange & ScopeFilter & {
  serviceId?: string
}
```

### Response
```ts
type LogPatternListResponse = {
  items: Array<{
    patternId: string
    title: string
    count: number
    sample: string
    services: string[]
  }>
}
```

---

## 8.4 获取异常聚类

### `GET /api/logs/v1/exceptions/list`

### Query
```ts
type Query = TimeRange & ScopeFilter & {
  serviceId?: string
}
```

### Response
```ts
type ExceptionClusterResponse = {
  items: Array<{
    clusterId: string
    title: string
    count: number
    lastSeenAt: number
    services: string[]
  }>
}
```

---

# 9. Alerts API

---

## 9.1 获取事件列表

### `GET /api/alerts/v1/incidents`

### Query
```ts
type Query = TimeRange & ScopeFilter & {
  severity?: string[]
  status?: string[]
  assignee?: string[]
  page?: number
  pageSize?: number
}
```

### Response
```ts
type IncidentListResponse = {
  items: Array<{
    id: string
    title: string
    serviceId?: string
    service?: string
    severity: string
    status: string
    source: string
    startedAt: number
    assignedTo?: string
  }>
}
```

---

## 9.2 获取事件详情

### `GET /api/alerts/v1/incidents/:id`

### Response
```ts
type IncidentDetailResponse = {
  id: string
  title: string
  summary?: string
  severity: string
  status: string
  source: string
  serviceId?: string
  startedAt: number
  timeline: Array<{
    timestamp: number
    action: string
    actor?: string
  }>
}
```

---

## 9.3 ACK 事件

### `POST /api/alerts/v1/incidents/:id/ack`

### Response
```ts
type AckIncidentResponse = {
  success: true
}
```

---

## 9.4 Resolve 事件

### `POST /api/alerts/v1/incidents/:id/resolve`

### Response
```ts
type ResolveIncidentResponse = {
  success: true
}
```

---

## 9.5 规则列表

### `GET /api/alerts/v1/rules`

### Response
```ts
type AlertRuleListResponse = {
  items: Array<{
    id: string
    name: string
    type: string
    enabled: boolean
    scopeSummary: string
  }>
}
```

---

## 9.6 创建规则

### `POST /api/alerts/v1/rules`

### Body
```ts
type AlertRuleCreateRequest = {
  name: string
  type: 'metric' | 'logs' | 'trace' | 'quota' | 'ingest'
  scope: ScopeFilter
  condition: Record<string, any>
  evaluationWindow: string
  channels: string[]
}
```

### Response
```ts
type AlertRuleCreateResponse = {
  id: string
}
```

---

# 10. Subscription / Billing API

---

## 10.1 当前订阅详情

### `GET /api/subscription/v1/current/detail`

### Response
```ts
type CurrentSubscriptionResponse = {
  plan: {
    id: string
    name: string
    price: number
  }
  quota: {
    metrics: { used: number; total: number }
    logs: { used: number; total: number }
    traces: { used: number; total: number }
  }
}
```

---

## 10.2 Usage Summary

### `GET /api/subscription/v1/usage/summary`

### Response
```ts
type UsageSummaryResponse = {
  metrics: { used: number; total: number }
  logs: { used: number; total: number }
  traces: { used: number; total: number }
  projectedOverage?: number
}
```

---

## 10.3 Billing History

### `GET /api/subscription/v1/billing/history`

### Response
```ts
type BillingHistoryResponse = {
  items: Array<{
    id: string
    period: string
    amount: number
    status: string
    createdAt: number
  }>
}
```

---

# 11. Ingestion / AppKey API

---

## 11.1 获取 AppKey 列表

### `GET /api/metrics/v1/appkey/list`

### Response
```ts
type AppKeyListResponse = {
  appKeys: Array<{
    id: string
    appKey: string
    name?: string
    env?: string
    createdAt: number
    lastUsedAt?: number
  }>
}
```

---

## 11.2 生成 AppKey

### `POST /api/metrics/v1/appkey/generate`

### Body
```ts
type GenerateAppKeyRequest = {
  name: string
  env?: string
  tags?: string[]
}
```

### Response
```ts
type GenerateAppKeyResponse = {
  id: string
  appKey: string
}
```

---

## 11.3 校验 AppKey

### `POST /api/metrics/v1/appkey/verify`

### Body
```ts
type VerifyAppKeyRequest = {
  appKey: string
}
```

### Response
```ts
type VerifyAppKeyResponse = {
  valid: boolean
  service?: string
}
```

---

# 12. 常见错误码建议

```ts
AUTH_UNAUTHORIZED
AUTH_FORBIDDEN
RESOURCE_NOT_FOUND
VALIDATION_ERROR
SERVICE_UNAVAILABLE
QUOTA_EXCEEDED
INGEST_PIPELINE_FAILED
TRACE_NOT_FOUND
RULE_CONFLICT
APPKEY_INVALID
```

---

# 13. API 实施优先级

## 第一批必须先做
1. `/overview/v1/summary`
2. `/catalog/v1/services`
3. `/catalog/v1/services/:serviceId`
4. `/service/v1/:serviceId/overview`
5. `/metrics/v1/topology/graph`
6. `/logs/v1/search/execute`
7. `/trace/v1/search/execute`
8. `/alerts/v1/incidents`

## 第二批
1. `/service/v1/:serviceId/runtime`
2. `/logs/v1/patterns/list`
3. `/logs/v1/exceptions/list`
4. `/alerts/v1/rules`
5. `/subscription/v1/usage/summary`
