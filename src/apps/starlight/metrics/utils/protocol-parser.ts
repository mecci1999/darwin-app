/**
 * Protocol Parser
 * 负责解析不同格式的指标数据 (Standard, Prometheus, Datadog)
 * 并转换为统一的 MetricItem 格式
 */
import { MetricItem, MetricProtocol } from '../types';

export class ProtocolParser {
  /**
   * 解析入口
   */
  static parse(data: any, protocol: string = MetricProtocol.STANDARD): MetricItem[] {
    switch (protocol) {
      case MetricProtocol.PROMETHEUS:
        return this.parsePrometheus(data);
      case MetricProtocol.DATADOG:
        return this.parseDatadog(data);
      case MetricProtocol.STANDARD:
      default:
        return this.parseStandard(data);
    }
  }

  /**
   * 解析标准格式
   * 已经是 MetricItem[] 结构，只需简单校验
   */
  private static parseStandard(data: any): MetricItem[] {
    if (Array.isArray(data)) {
      return data.map((item) => ({
        metric: item.metric || item.name, // 兼容 name/metric 字段
        timestamp: item.timestamp || Date.now(),
        value: Number(item.value),
        type: item.type || 'gauge',
        tags: item.tags || {},
        unit: item.unit,
      }));
    }
    return [];
  }

  /**
   * 解析 Prometheus 文本格式
   * 简单实现：解析行协议
   * 示例: http_requests_total{method="post",code="200"} 1024 1630000000000
   */
  private static parsePrometheus(data: string): MetricItem[] {
    if (typeof data !== 'string') return [];
    const lines = data.split('\n');
    const results: MetricItem[] = [];
    const now = Date.now();

    // 暂存指标类型定义
    const typeMap: Record<string, string> = {};

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // 解析注释
      if (trimmed.startsWith('#')) {
        if (trimmed.startsWith('# TYPE')) {
          const parts = trimmed.split(/\s+/);
          if (parts.length >= 3) {
            typeMap[parts[2]] = parts[3]; // e.g., http_requests_total -> counter
          }
        }
        continue;
      }

      // 解析数据行
      // 简单正则匹配: metric_name{labels} value timestamp
      try {
        const match = trimmed.match(/^([a-zA-Z0-9_:]+)(\{.*?\})?\s+([0-9eE.-]+)(\s+(\d+))?$/);
        if (match) {
          const [, name, labelStr, valueStr, , timestampStr] = match;
          const tags: Record<string, string> = {};

          // 解析标签
          if (labelStr) {
            // 去除 {}
            const content = labelStr.slice(1, -1);
            // 简单分割 k="v", ...
            // 注意：这里简单分割不支持 value 中包含逗号的情况，生产环境建议用更健壮的 parser
            content.split(',').forEach((pair) => {
              const [k, v] = pair.split('=');
              if (k && v) {
                tags[k.trim()] = v.trim().replace(/^"|"$/g, ''); // 去除引号
              }
            });
          }

          results.push({
            metric: name,
            value: Number(valueStr),
            timestamp: timestampStr ? Number(timestampStr) : now,
            type: (typeMap[name] as any) || 'gauge', // 默认为 gauge
            tags,
          });
        }
      } catch (e) {
        // 忽略解析失败的行
        console.warn('Failed to parse prometheus line:', trimmed);
      }
    }

    return results;
  }

  /**
   * 解析 Datadog JSON 格式
   * 结构: { series: [{ metric, points: [[ts, val]], type, host, tags: ["k:v"] }] }
   */
  private static parseDatadog(data: any): MetricItem[] {
    const results: MetricItem[] = [];
    const series = data?.series;

    if (!Array.isArray(series)) return [];

    for (const item of series) {
      const { metric, points, type, host, tags: rawTags } = item;
      const tags: Record<string, string> = {};

      // 处理 Host
      if (host) tags['host'] = host;

      // 处理 Tags 数组 ["env:prod"] -> { env: "prod" }
      if (Array.isArray(rawTags)) {
        rawTags.forEach((tag: string) => {
          const [k, v] = tag.split(':');
          if (k && v) tags[k] = v;
        });
      }

      // 处理 Points (Datadog 时间戳通常是秒，需转毫秒)
      if (Array.isArray(points)) {
        points.forEach((point: [number, number]) => {
          const [ts, val] = point;
          results.push({
            metric,
            value: val,
            timestamp: ts < 10000000000 ? ts * 1000 : ts, // 智能判断秒/毫秒
            type: type || 'gauge',
            tags: { ...tags },
          });
        });
      }
    }

    return results;
  }
}
