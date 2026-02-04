export interface MetricPoint {
  name: string;
  value: number;
  timestamp: number;
  tags: Record<string, string>;
}

export class ProtocolParser {
  /**
   * 解析 Prometheus 格式数据
   * 注意：完整实现需要处理 Snappy 压缩和 Protobuf 反序列化
   * 这里仅作为示例，处理 JSON 格式的兼容数据
   */
  static parsePrometheus(data: any): MetricPoint[] {
    const metrics: MetricPoint[] = [];
    
    if (Array.isArray(data.timeseries)) {
      for (const ts of data.timeseries) {
        const tags: Record<string, string> = {};
        let name = '';
        
        // 解析标签
        if (Array.isArray(ts.labels)) {
          for (const label of ts.labels) {
            if (label.name === '__name__') {
              name = label.value;
            } else {
              tags[label.name] = label.value;
            }
          }
        }

        // 解析样本
        if (Array.isArray(ts.samples) && name) {
          for (const sample of ts.samples) {
            metrics.push({
              name,
              value: sample.value,
              timestamp: sample.timestamp,
              tags: { ...tags }
            });
          }
        }
      }
    }
    
    return metrics;
  }

  /**
   * 解析 OTLP (OpenTelemetry Protocol) JSON 格式数据
   */
  static parseOTLP(data: any): MetricPoint[] {
    const metrics: MetricPoint[] = [];

    if (Array.isArray(data.resourceMetrics)) {
      for (const rm of data.resourceMetrics) {
        const resourceTags: Record<string, string> = {};
        
        // 解析资源属性
        if (rm.resource?.attributes) {
          for (const attr of rm.resource.attributes) {
            resourceTags[attr.key] = attr.value?.stringValue || String(attr.value);
          }
        }

        if (Array.isArray(rm.scopeMetrics)) {
          for (const sm of rm.scopeMetrics) {
            if (Array.isArray(sm.metrics)) {
              for (const metric of sm.metrics) {
                const name = metric.name;
                
                // 处理 Gauge
                if (metric.gauge?.dataPoints) {
                  for (const dp of metric.gauge.dataPoints) {
                    metrics.push(this.createMetricPoint(name, dp, resourceTags));
                  }
                }
                
                // 处理 Sum
                if (metric.sum?.dataPoints) {
                  for (const dp of metric.sum.dataPoints) {
                    metrics.push(this.createMetricPoint(name, dp, resourceTags));
                  }
                }
                
                // Histogram 和 Summary 暂略
              }
            }
          }
        }
      }
    }

    return metrics;
  }

  private static createMetricPoint(name: string, dp: any, resourceTags: Record<string, string>): MetricPoint {
    const tags = { ...resourceTags };
    
    if (dp.attributes) {
      for (const attr of dp.attributes) {
        tags[attr.key] = attr.value?.stringValue || String(attr.value);
      }
    }

    return {
      name,
      value: dp.asDouble || dp.asInt || 0,
      timestamp: parseInt(dp.timeUnixNano) / 1000000, // 转换为毫秒
      tags
    };
  }
}
