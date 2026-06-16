# Logs 微服务

日志管理微服务，提供日志摄取、搜索、统计、导出和实时流式传输功能。

## 📁 目录结构

```
logs/
├── README.md            # 本文档
├── index.ts             # 微服务主入口
├── actions/             # API 接口层
│   ├── index.ts         # 动作统一导出
│   ├── ingest.ts        # 单条日志摄取
│   ├── batch-ingest.ts  # 批量日志摄取
│   ├── search.ts        # 日志搜索
│   ├── stream.ts        # 实时日志流
│   ├── export.ts        # 日志导出
│   └── stats.ts         # 日志统计
├── events/              # 事件处理层
│   ├── index.ts         # 事件管理器
│   ├── logs-events.ts   # 日志相关事件
│   └── tenant-events.ts # 租户相关事件
├── validators/          # 参数验证层
│   ├── index.ts         # 验证器统一导出
│   └── logs.ts          # 日志验证器
├── methods/             # 业务逻辑层
│   ├── log-ingest.ts    # 日志摄取逻辑
│   ├── log-search.ts    # 日志搜索逻辑
│   └── log-stats.ts     # 日志统计逻辑
├── utils/               # 工具函数
│   └── log-utils.ts     # 日志工具函数
└── types/               # 类型定义
    └── index.ts         # 类型统一导出
```

## 🚀 功能特性

### 日志摄取
- **单条摄取**: 实时接收单条日志数据
- **批量摄取**: 高效处理大量日志数据
- **格式验证**: 确保日志数据格式正确
- **配额控制**: 防止日志数据过量摄取

### 日志搜索
- **复杂查询**: 支持多条件组合搜索
- **时间范围**: 按时间段筛选日志
- **服务过滤**: 按服务名称过滤
- **级别过滤**: 按日志级别过滤
- **分页支持**: 大数据量分页展示

### 实时流式传输
- **SSE协议**: 基于Server-Sent Events
- **实时推送**: 新日志实时推送到客户端
- **过滤订阅**: 按条件订阅特定日志
- **连接管理**: 自动清理过期连接

### 日志统计
- **聚合统计**: 按时间、服务、级别聚合
- **趋势分析**: 日志量趋势分析
- **性能指标**: 系统性能相关统计

### 日志导出
- **多格式支持**: JSON、CSV格式导出
- **批量导出**: 大量数据批量导出
- **条件导出**: 按搜索条件导出

## 📋 API 接口

### 日志摄取

外部 Java、Go、Node.js SDK 统一通过网关 HTTP JSON 接入，不需要依赖 Node-Universe 内部 RPC。

认证头：
```http
Content-Type: application/json
X-Api-Key: <logs api key>
X-Tenant-Id: <tenant id>
```

也兼容旧调用方式：将 `apiKey` 和 `tenantId` 放在 JSON body 中。SDK 场景优先使用 Header，避免每条日志重复携带固定认证字段。

```http
POST /api/logs/v1/ingest
```

```json
{
  "log": {
    "message": "日志消息",
    "level": "info",
    "source": "server",
    "service": "api-server",
    "timestamp": "2024-01-01T00:00:00Z",
    "metadata": {}
  },
  "format": "json"
}
```

```http
POST /api/logs/v1/batch-ingest
```

```json
{
  "logs": [
    { "message": "日志1", "level": "info", "source": "server" },
    { "message": "日志2", "level": "error", "source": "server" }
  ],
  "format": "json",
  "batchId": "optional-batch-id"
}
```

批量限制：单次最多 1000 条日志。日志级别必须是 `trace`、`debug`、`info`、`warn`、`error`、`fatal` 之一；`source` 可选值为 `server`、`client`、`mobile`、`iot`、`system`。

内部 action 名分别是 `logs.v1.ingest` 和 `logs.v1.batch-ingest`，外部 SDK 不应直接依赖内部 action 名。

### SDK 接入示例

#### Node.js
```js
await fetch(`${baseUrl}/api/logs/v1/ingest`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Api-Key': apiKey,
    'X-Tenant-Id': tenantId,
  },
  body: JSON.stringify({
    log: {
      message: 'order created',
      level: 'info',
      source: 'server',
      service: 'order-service',
      metadata: { orderId: 'ord_123' },
    },
  }),
});
```

#### Go
```go
payload := strings.NewReader(`{
  "log": {
    "message": "order created",
    "level": "info",
    "source": "server",
    "service": "order-service"
  }
}`)

req, _ := http.NewRequest("POST", baseURL+"/api/logs/v1/ingest", payload)
req.Header.Set("Content-Type", "application/json")
req.Header.Set("X-Api-Key", apiKey)
req.Header.Set("X-Tenant-Id", tenantId)
resp, err := http.DefaultClient.Do(req)
```

#### Java
```java
HttpRequest request = HttpRequest.newBuilder()
  .uri(URI.create(baseUrl + "/api/logs/v1/ingest"))
  .header("Content-Type", "application/json")
  .header("X-Api-Key", apiKey)
  .header("X-Tenant-Id", tenantId)
  .POST(HttpRequest.BodyPublishers.ofString("""
    {
      "log": {
        "message": "order created",
        "level": "info",
        "source": "server",
        "service": "order-service"
      }
    }
  """))
  .build();

HttpResponse<String> response = HttpClient.newHttpClient()
  .send(request, HttpResponse.BodyHandlers.ofString());
```

### 日志搜索
```typescript
// 日志搜索
GET /v1.searchLogs
{
  "query": "error",
  "service": "api-server",
  "level": "error",
  "startTime": "2024-01-01T00:00:00Z",
  "endTime": "2024-01-02T00:00:00Z",
  "page": 1,
  "limit": 50
}
```

### 实时日志流
```typescript
// 建立日志流连接
GET /v1.logStream
{
  "service": "api-server",
  "level": "error"
}
```

### 日志统计
```typescript
// 获取日志统计
GET /v1.logStats
{
  "service": "api-server",
  "timeRange": "24h",
  "groupBy": "level"
}
```

### 日志导出
```typescript
// 导出日志
GET /v1.exportLogs
{
  "format": "json",
  "query": "error",
  "startTime": "2024-01-01T00:00:00Z",
  "endTime": "2024-01-02T00:00:00Z",
  "limit": 1000
}
```

## 🔧 事件系统

### 日志事件
- `logs.raw`: 原始日志数据处理
- `logs.processed`: 日志处理完成
- `quota.warning`: 配额警告
- `quota.exceeded`: 配额超限

### 租户事件
- `tenant.created`: 租户创建
- `tenant.deleted`: 租户删除
- `user.created`: 用户创建
- `subscription.updated`: 订阅更新

## ✅ 参数验证

### 验证器列表
- `validateLogIngest`: 单条日志摄取验证
- `validateLogBatchIngest`: 批量日志摄取验证
- `validateLogSearch`: 日志搜索参数验证
- `validateLogStream`: 日志流参数验证
- `validateLogStats`: 日志统计参数验证

### 验证规则
- **必填字段**: 确保关键字段不为空
- **格式验证**: 验证数据格式正确性
- **范围检查**: 验证数值在合理范围内
- **类型检查**: 确保数据类型正确

## 🏗️ 架构设计

### 分层架构
1. **API层** (actions): 处理HTTP请求和响应
2. **验证层** (validators): 参数验证和数据校验
3. **事件层** (events): 事件处理和业务逻辑解耦
4. **业务层** (methods): 核心业务逻辑实现
5. **工具层** (utils): 通用工具函数

### 设计原则
- **单一职责**: 每个模块职责明确
- **松耦合**: 模块间依赖最小化
- **可扩展**: 易于添加新功能
- **可测试**: 便于单元测试

## 🔄 数据流

```
客户端请求 → API层 → 验证层 → 业务层 → 数据存储
                ↓
            事件系统 → 异步处理
```

## 📊 性能优化

### 批处理
- 日志数据批量处理
- 减少数据库操作次数
- 提高吞吐量

### 缓存策略
- 热点数据缓存
- 查询结果缓存
- 减少重复计算

### 异步处理
- 事件驱动架构
- 非阻塞操作
- 提高响应速度

## 🛡️ 安全特性

### 认证授权
- API密钥验证
- 角色权限控制
- 租户数据隔离

### 数据保护
- 敏感信息脱敏
- 数据传输加密
- 访问日志记录

## 📈 监控指标

### 业务指标
- 日志摄取量
- 搜索请求数
- 流连接数
- 导出任务数

### 性能指标
- 响应时间
- 吞吐量
- 错误率
- 资源使用率

## 🚨 错误处理

### 错误类型
- 参数验证错误
- 业务逻辑错误
- 系统异常错误
- 网络连接错误

### 错误响应
```typescript
{
  "status": 400,
  "data": {
    "content": null,
    "message": "错误描述",
    "code": "ERROR_CODE",
    "success": false
  }
}
```

## 🔧 配置说明

### 环境变量
- `LOG_LEVEL`: 日志级别
- `BATCH_SIZE`: 批处理大小
- `CACHE_TTL`: 缓存过期时间
- `STREAM_TIMEOUT`: 流连接超时

### 配置文件
- Elasticsearch连接配置
- Kafka主题配置
- 缓存配置
- 限流配置

## 📝 使用示例

### 基本使用
```typescript
import { createLogsService } from './logs';

// 创建日志服务
const logsService = createLogsService({
  namespace: 'logs',
  // 其他配置...
});

// 启动服务
await logsService.start();
```

### 事件监听
```typescript
import { createEventHandlersManager } from './events';

// 创建事件管理器
const eventManager = createEventHandlersManager(star);

// 注册事件处理器
eventManager.registerHandlers();
```

## 🧪 测试

### 单元测试
- 验证器测试
- 业务逻辑测试
- 工具函数测试

### 集成测试
- API接口测试
- 事件处理测试
- 数据流测试

### 性能测试
- 压力测试
- 并发测试
- 内存泄漏测试

## 📚 相关文档

- [Node Universe 框架文档](../../README.md)
- [数据库设计文档](../../../ai/database-standards.md)
- [API设计规范](../../../ai/rules.md)
- [微服务架构指南](../../../ai/node-universe.md)

## 🤝 贡献指南

1. Fork 项目
2. 创建功能分支
3. 提交代码变更
4. 推送到分支
5. 创建 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](../../../../LICENSE) 文件了解详情。
