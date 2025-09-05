# Metrics 微服务文档

## 概述

Metrics 微服务是 Darwin-App 系统中的核心数据处理服务，专门负责处理多种格式的指标数据收集、存储、查询和分析。该服务支持 SaaS 化多租户架构，提供高性能的时序数据处理能力。

## 🏗️ 架构设计

### 核心组件

```
metrics/
├── index.ts              # 服务入口和配置
├── actions/              # API 接口层
│   ├── appkey.ts        # API Key 管理
│   ├── ingest.ts        # 数据摄取接口
│   ├── query.ts         # 数据查询接口
│   ├── schema.ts        # 数据格式定义
│   └── index.ts         # 接口统一导出
├── events/              # 事件处理层
│   ├── metrics.ts       # 指标数据事件
│   ├── quota.ts         # 配额管理事件
│   ├── tenant.ts        # 租户管理事件
│   ├── user.ts          # 用户管理事件
│   ├── subscription.ts  # 订阅管理事件
│   └── index.ts         # 事件统一导出
├── validators/          # 参数验证层
│   ├── common.ts        # 通用验证器
│   ├── metrics.ts       # 指标数据验证
│   ├── quota.ts         # 配额验证
│   ├── tenant.ts        # 租户验证
│   ├── user.ts          # 用户验证
│   └── index.ts         # 验证器统一导出
├── utils/               # 工具类层
│   ├── metrics-utils.ts # 指标工具类
│   ├── influxdb-handler.ts # InfluxDB 处理器
│   ├── kafka-handler.ts # Kafka 处理器
│   ├── data-processor.ts # 数据处理器
│   ├── quota-checker.ts # 配额检查器
│   └── index.ts         # 工具类统一导出
├── types/               # 类型定义
│   └── index.ts         # TypeScript 类型定义
├── constants/           # 常量定义
│   └── index.ts         # 服务常量
└── methods/             # 内部方法
    └── index.ts         # 内部业务逻辑
```

### 技术栈

- **框架**: Node Universe (基于 Moleculer)
- **数据库**: InfluxDB (时序数据) + MySQL (元数据)
- **消息队列**: Kafka
- **缓存**: Redis
- **序列化**: NotePack
- **语言**: TypeScript

## 📊 支持的数据格式

### 1. Prometheus 格式
```json
{
  "metric_name": "http_requests_total",
  "labels": { "method": "GET", "status": "200" },
  "value": 1027,
  "timestamp": 1609459200000
}
```

### 2. StatsD 格式
```json
{
  "metric": "api.response_time",
  "value": 234.5,
  "type": "histogram",
  "tags": ["env:prod", "service:api"],
  "timestamp": 1609459200000
}
```

### 3. DataDog 格式
```json
{
  "series": [{
    "metric": "system.cpu.usage",
    "points": [[1609459200, 0.85]],
    "tags": ["host:web01", "env:production"],
    "type": "gauge"
  }]
}
```

### 4. OpenTelemetry (OTLP) 格式
```json
{
  "resourceMetrics": [{
    "resource": {
      "attributes": [{ "key": "service.name", "value": { "stringValue": "my-service" } }]
    },
    "scopeMetrics": [{
      "metrics": [{
        "name": "http_request_duration",
        "histogram": {
          "dataPoints": [{
            "timeUnixNano": "1609459200000000000",
            "count": "100",
            "sum": 1234.5
          }]
        }
      }]
    }]
  }]
}
```

### 5. 自定义格式
```json
{
  "measurement": "custom_metric",
  "tags": { "env": "prod", "service": "api" },
  "fields": { "value": 123.45, "count": 1 },
  "timestamp": 1609459200000
}
```

## 🚀 API 接口

### 数据摄取接口

#### POST /metrics/ingest
摄取指标数据

**请求参数:**
```json
{
  "appKey": "string",
  "format": "prometheus|statsd|datadog|otlp|custom|official",
  "rawData": "object|array",
  "timestamp": "number (optional)"
}
```

**响应:**
```json
{
  "code": 200,
  "content": {
    "batchId": "batch_1609459200_abc123",
    "processed": 100,
    "timestamp": 1609459200000
  },
  "message": "数据摄取成功",
  "success": true
}
```

### 数据查询接口

#### GET /metrics/query
查询指标数据

**请求参数:**
```json
{
  "appKey": "string",
  "metric": "string (optional)",
  "tags": "object (optional)",
  "timeRange": {
    "start": "number",
    "end": "number"
  },
  "aggregation": "sum|avg|min|max|count (optional)",
  "limit": "number (optional, default: 1000)",
  "offset": "number (optional, default: 0)"
}
```

**响应:**
```json
{
  "code": 200,
  "content": {
    "metrics": [
      {
        "measurement": "http_requests_total",
        "tags": { "method": "GET", "status": "200" },
        "fields": { "value": 1027 },
        "timestamp": 1609459200000
      }
    ],
    "total": 1,
    "hasMore": false
  },
  "message": "查询成功",
  "success": true
}
```

#### GET /metrics/listMetrics
获取指标列表

**请求参数:**
```json
{
  "appKey": "string",
  "search": "string (optional)",
  "limit": "number (optional, default: 100)",
  "offset": "number (optional, default: 0)"
}
```

### API Key 管理接口

#### POST /metrics/appkey/generate
生成 API Key

**请求参数:**
```json
{
  "name": "string",
  "description": "string (optional)",
  "permissions": "array",
  "expiresAt": "Date (optional)",
  "rateLimit": "number (optional)"
}
```

**响应:**
```json
{
  "code": 200,
  "content": {
    "appKey": "ak_1609459200_xyz789",
    "name": "Production API Key",
    "permissions": ["metrics:read", "metrics:write"],
    "expiresAt": "2024-12-31T23:59:59.999Z",
    "createdAt": "2024-01-01T00:00:00.000Z"
  },
  "message": "API Key 生成成功",
  "success": true
}
```

### 数据格式接口

#### GET /metrics/schema/listFormats
获取支持的数据格式列表

**响应:**
```json
{
  "code": 200,
  "content": [
    {
      "type": "prometheus",
      "name": "Prometheus",
      "description": "Prometheus监控系统格式",
      "features": ["标签支持", "时间序列", "聚合查询"]
    }
  ],
  "message": "格式列表获取成功",
  "success": true
}
```

### 系统接口

#### GET /metrics/health
健康检查

#### GET /metrics/stats
获取服务统计信息

## 🔧 配置说明

### 环境变量

```bash
# InfluxDB 配置
INFLUXDB_URL=http://localhost:8086
INFLUXDB_TOKEN=your_influxdb_token
INFLUXDB_ORG=darwin-monitoring
INFLUXDB_BUCKET=metrics

# Kafka 配置
KAFKA_BROKERS=localhost:9092

# Redis 配置
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password

# 服务配置
NODE_ENV=production
PORT=6667
```

### 常量配置

```typescript
// 数据处理配置
export const BATCH_SIZE = 1000;        // 批处理大小
export const FLUSH_INTERVAL = 5000;     // 刷新间隔(ms)
export const MAX_RETRIES = 3;           // 最大重试次数

// 支持的指标格式
export const SUPPORTED_FORMATS = [
  'prometheus', 'statsd', 'datadog', 'otlp', 'custom', 'official'
];
```

## 📈 核心功能

### 1. 多租户支持
- 基于 tenantId 的数据隔离
- 独立的配额管理
- 租户级别的统计和监控

### 2. 数据处理流程
1. **数据摄取**: 接收多种格式的原始数据
2. **格式转换**: 统一转换为内部格式
3. **数据验证**: 参数验证和数据完整性检查
4. **批量处理**: 批量写入 InfluxDB
5. **事件通知**: 发送处理完成事件

### 3. 配额管理
- 实时配额检查
- 多级别配额限制（小时/日/月）
- 配额预警和通知
- 自动配额调整

### 4. 性能优化
- 批量数据处理
- Redis 缓存机制
- 连接池管理
- 异步事件处理

## 🔍 事件系统

### 指标数据事件
- `metrics.raw`: 原始数据处理
- `metrics.processed`: 数据处理完成
- `metrics.aggregate`: 数据聚合

### 配额管理事件
- `quota.warning`: 配额警告
- `quota.exceeded`: 配额超限
- `quota.reset`: 配额重置

### 用户管理事件
- `user.created`: 用户创建
- `user.updated`: 用户更新
- `user.activity`: 用户活动

### 租户管理事件
- `tenant.created`: 租户创建
- `tenant.updated`: 租户更新
- `tenant.deleted`: 租户删除

### 订阅管理事件
- `subscription.created`: 订阅创建
- `subscription.updated`: 订阅更新
- `subscription.cancelled`: 订阅取消

## 🛠️ 工具类

### MetricsUtils
- 数据格式验证
- 批次ID生成
- 数据转换工具
- 统计计算

### InfluxDBHandler
- 数据库连接管理
- 批量数据写入
- 查询执行
- 连接状态检查

### KafkaHandler
- 消息生产者
- 消息消费者
- 主题管理
- 错误处理

### DataProcessor
- 数据格式转换
- 批量处理
- 重试机制
- 性能监控

### QuotaChecker
- 配额实时检查
- 使用量统计
- 预警通知
- 自动调整

## 📊 数据模型

### MetricsState
```typescript
interface MetricsState {
  influxdbConnected: boolean;
  kafkaConsumers: any[];
  processingQueue: MetricsBatch[];
  lastFlushTime: number;
  serviceId?: string;
  startTime?: number;
  timers: {
    dataProcessor: NodeJS.Timeout | null;
    quotaChecker: NodeJS.Timeout | null;
    batchProcessor: NodeJS.Timeout | null;
  };
  cache: {
    metrics: Map<string, any>;
    quotas: Map<string, any>;
    aggregations: Map<string, any>;
  };
  stats: {
    processed: number;
    lastProcessed: number;
  };
}
```

### RawMetricsData
```typescript
interface RawMetricsData {
  source: string;
  format: 'prometheus' | 'statsd' | 'datadog' | 'otlp' | 'custom' | 'official';
  timestamp: number;
  data: any;
  metadata?: {
    userId?: string;
    appKeyId?: string;
    tags?: Record<string, string>;
  };
}
```

### ProcessedMetricsData
```typescript
interface ProcessedMetricsData {
  measurement: string;
  tags: Record<string, string>;
  fields: Record<string, number | string | boolean>;
  timestamp: number;
}
```

## 🚀 部署和运行

### 开发环境
```bash
# 安装依赖
npm install

# 启动开发服务
npm run dev

# 运行测试
npm test
```

### 生产环境
```bash
# 构建项目
npm run build

# 启动服务
npm start

# 使用 PM2 管理
pm2 start ecosystem.config.js
```

### Docker 部署
```bash
# 构建镜像
docker build -t darwin-metrics .

# 运行容器
docker run -d -p 6667:6667 darwin-metrics

# 使用 docker-compose
docker-compose up -d
```

## 📝 使用示例

### 数据摄取示例
```javascript
// 发送 Prometheus 格式数据
const response = await fetch('/metrics/ingest', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer your_app_key'
  },
  body: JSON.stringify({
    appKey: 'your_app_key',
    format: 'prometheus',
    rawData: {
      metric_name: 'http_requests_total',
      labels: { method: 'GET', status: '200' },
      value: 1027,
      timestamp: Date.now()
    }
  })
});
```

### 数据查询示例
```javascript
// 查询指标数据
const response = await fetch('/metrics/query?' + new URLSearchParams({
  appKey: 'your_app_key',
  metric: 'http_requests_total',
  'timeRange.start': Date.now() - 3600000, // 1小时前
  'timeRange.end': Date.now(),
  aggregation: 'sum',
  limit: 100
}));
```

## 🔒 安全考虑

- API Key 认证机制
- 请求频率限制
- 数据加密传输
- 访问日志记录
- 权限控制

## 📊 监控和日志

- 服务健康状态监控
- 性能指标收集
- 错误日志记录
- 配额使用监控
- 数据处理统计

## 🔄 版本历史

- **v1.0.0**: 初始版本，支持基础指标数据处理
- 支持多种数据格式
- 实现多租户架构
- 添加配额管理功能
- 优化性能和稳定性

## 🤝 贡献指南

1. Fork 项目
2. 创建功能分支
3. 提交更改
4. 推送到分支
5. 创建 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

---

**注意**: 本文档会随着项目的发展持续更新，请定期查看最新版本。