/**
 * 指标数据微服务核心工具类
 */
import { Star } from 'node-universe';
import { MetricsState, RawMetricsData, ProcessedMetricsData } from '../types';
import { SUPPORTED_FORMATS } from '../constants';

export class MetricsUtils {
  /**
   * 验证指标数据格式
   */
  static validateMetricsFormat(format: string): boolean {
    return SUPPORTED_FORMATS.includes(format);
  }

  /**
   * 生成批次ID
   */
  static generateBatchId(): string {
    return `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 格式化时间戳
   */
  static formatTimestamp(timestamp: number): string {
    return new Date(timestamp).toISOString();
  }

  /**
   * 解析Prometheus格式数据
   */
  static parsePrometheusData(data: string): ProcessedMetricsData[] {
    const lines = data.split('\n').filter((line) => line.trim() && !line.startsWith('#'));
    const metrics: ProcessedMetricsData[] = [];

    for (const line of lines) {
      const match = line.match(
        /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+([0-9.-]+)(?:\s+([0-9]+))?$/,
      );
      if (match) {
        const [, measurement, tagsStr, value, timestamp] = match;
        const tags: Record<string, string> = {};

        if (tagsStr) {
          const tagMatches = tagsStr.slice(1, -1).match(/([a-zA-Z_][a-zA-Z0-9_]*)="([^"]*)"/g);
          if (tagMatches) {
            for (const tagMatch of tagMatches) {
              const [, key, val] = tagMatch.match(/([a-zA-Z_][a-zA-Z0-9_]*)="([^"]*)"/!) || [];
              if (key && val !== undefined) {
                tags[key] = val;
              }
            }
          }
        }

        metrics.push({
          measurement,
          tags,
          fields: { value: parseFloat(value) },
          timestamp: timestamp ? parseInt(timestamp) * 1000 : Date.now(),
        });
      }
    }

    return metrics;
  }

  /**
   * 解析StatsD格式数据
   */
  static parseStatsDData(data: string): ProcessedMetricsData[] {
    const lines = data.split('\n').filter((line) => line.trim());
    const metrics: ProcessedMetricsData[] = [];

    for (const line of lines) {
      const match = line.match(/^([^:]+):([0-9.-]+)\|([a-z]+)(?:\|@([0-9.]+))?(?:\|#(.+))?$/);
      if (match) {
        const [, measurement, value, type, sampleRate, tagsStr] = match;
        const tags: Record<string, string> = { type };

        if (tagsStr) {
          const tagPairs = tagsStr.split(',');
          for (const pair of tagPairs) {
            const [key, val] = pair.split(':');
            if (key && val) {
              tags[key] = val;
            }
          }
        }

        if (sampleRate) {
          tags.sample_rate = sampleRate;
        }

        metrics.push({
          measurement,
          tags,
          fields: { value: parseFloat(value) },
          timestamp: Date.now(),
        });
      }
    }

    return metrics;
  }

  /**
   * 计算指标统计信息
   */
  static calculateMetricsStats(metrics: ProcessedMetricsData[]): {
    count: number;
    measurements: string[];
    timeRange: { start: number; end: number };
    avgValue: number;
  } {
    if (metrics.length === 0) {
      return {
        count: 0,
        measurements: [],
        timeRange: { start: 0, end: 0 },
        avgValue: 0,
      };
    }

    const measurements = [...new Set(metrics.map((m) => m.measurement))];
    const timestamps = metrics.map((m) => m.timestamp);
    const values = metrics.map((m) => {
      const value = m.fields.value;
      return typeof value === 'number' ? value : 0;
    });

    return {
      count: metrics.length,
      measurements,
      timeRange: {
        start: Math.min(...timestamps),
        end: Math.max(...timestamps),
      },
      avgValue: values.reduce((sum, val) => sum + val, 0) / values.length,
    };
  }
}
