# StarLight 指标数据统一接入标准

为了支持 Prometheus、Datadog 及自定义数据的统一接入与展示，StarLight 定义了以下标准指标数据格式。所有进入存储层的指标数据必须符合此规范。

## 1. 核心数据模型 (Standard Metric Model)

所有指标数据在经过接入层 (Ingest Layer) 清洗后，必须转换为以下结构：

```typescript
interface StandardMetric {
  metric: string;       // 指标名称 (e.g., "http.request.duration")
  timestamp: number;    // 毫秒级 Unix 时间戳
  value: number;        // 指标数值
  type: MetricType;     // 指标类型
  tags: Record<string, string>; // 标签键值对
  unit?: string;        // 单位 (e.g., "ms", "byte", "percent")
}

enum MetricType {
  GAUGE = 'gauge',       // 瞬时值 (CPU, 内存)
  COUNTER = 'counter',   // 累加值 (请求数)
  HISTOGRAM = 'histogram', // 直方图 (Prometheus 风格)
  SUMMARY = 'summary'    // 摘要 (Prometheus 风格)
}
```

## 2. 接入接口规范

### HTTP 接口

`POST /api/metrics/v1/ingest`

**Headers:**
- `Content-Type`: `application/json` (Standard/Datadog) 或 `text/plain` (Prometheus)
- `X-App-Key`: 应用标识

**Query Params / Body Fields:**
- `dataType`: `standard` | `prometheus` | `datadog` (必填，默认为 `standard`)

### 格式详解

#### A. Standard (默认格式)

最精简的 JSON 数组格式，适用于自定义 SDK 上报。

```json
[
  {
    "metric": "system.cpu.usage",
    "timestamp": 1630000000000,
    "value": 45.2,
    "type": "gauge",
    "tags": {
      "host": "server-01",
      "env": "prod"
    }
  }
]
```

#### B. Prometheus (Text Format)

遵循 Prometheus 文本协议，通过 `dataType=prometheus` 上报。服务端负责解析。

```text
# HELP http_requests_total The total number of HTTP requests.
# TYPE http_requests_total counter
http_requests_total{method="post",code="200"} 1024 1630000000000
http_requests_total{method="post",code="400"} 5 1630000000000
```

#### C. Datadog (JSON Format)

兼容 Datadog Agent 的 `v1/series` 格式，通过 `dataType=datadog` 上报。

```json
{
  "series": [
    {
      "metric": "system.load.1",
      "points": [[1630000000, 0.5]],
      "type": "gauge",
      "host": "test.example.com",
      "tags": ["environment:test"]
    }
  ]
}
```

## 3. 转换逻辑 (Transformation Logic)

服务端接收到非 Standard 格式数据时，需执行以下转换：

1. **Prometheus -> Standard**:
   - 解析指标名、Labels (转换为 Tags)、Value、Timestamp。
   - 识别 `# TYPE` 注释确定 MetricType。

2. **Datadog -> Standard**:
   - 提取 `metric` 为 `metric`。
   - 扁平化 `points` 数组为多条记录。
   - 将 `host` 字段合并入 `tags`。
   - 将 `tags` 数组 (["k:v"]) 转换为对象 ({"k":"v"})。

## 4. 存储规范 (InfluxDB Schema)

- **Measurement**: `metrics`
- **Tags**: `appKey`, `metric_type`, 以及所有自定义 tags。
- **Fields**: `value` (float)
- **Time**: `timestamp`
