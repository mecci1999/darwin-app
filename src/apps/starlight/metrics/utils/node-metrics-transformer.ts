/**
 * Node Universe Metrics Transformer
 * Converts node-universe metrics format to Standard MetricItem format
 */

export interface MetricItem {
  metric: string;
  // Use array for values to support time series
  values: Array<{ timestamp: number; value: number }>;
  type: string;
  tags: Record<string, string>;
  unit?: string;
  description?: string;
}

export interface NodeUniverseMetricValue {
  key: string;
  value: number | string;
  labels: Record<string, string>;
  timestamp: number;
  // Histogram fields
  count?: number;
  sum?: number;
  buckets?: Record<string, number>;
  [key: string]: any;
}

export interface NodeUniverseMetric {
  type: string;
  name: string;
  description?: string;
  labelNames: string[];
  unit?: string;
  values: NodeUniverseMetricValue[];
}

export class NodeMetricsTransformer {
  /**
   * Transform a list of node-universe metrics to standard format
   * @param metrics Raw metrics from node-universe
   * @param extraTags Extra tags to append to all metrics (e.g. node info)
   */
  static transform(
    metrics: NodeUniverseMetric[],
    extraTags: Record<string, string> = {},
  ): MetricItem[] {
    if (!Array.isArray(metrics)) return [];

    const results: MetricItem[] = [];

    for (const metric of metrics) {
      if (!metric.values || !Array.isArray(metric.values)) continue;

      // Group values by unique label combination
      const timeSeries = new Map<string, Array<{ timestamp: number; value: any; original: any }>>();

      for (const val of metric.values) {
        // Create a unique key based on labels
        const labelStr = val.labels
          ? Object.entries(val.labels)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => `${k}:${v}`)
              .join('|')
          : '';

        if (!timeSeries.has(labelStr)) {
          timeSeries.set(labelStr, []);
        }
        timeSeries.get(labelStr)?.push({
          timestamp: val.timestamp || Date.now(),
          value: val,
          original: val,
        });
      }

      for (const [labelStr, points] of timeSeries.entries()) {
        // We use the first point to extract common metadata like labels
        const firstPoint = points[0];
        const val = firstPoint.original;

        const baseItem: Omit<MetricItem, 'metric' | 'values'> = {
          type: metric.type,
          unit: metric.unit,
          description: metric.description,
          tags: {
            ...extraTags,
            ...(val.labels || {}),
          },
        };

        if (metric.type === 'histogram') {
          // Handle Histogram: flatten to sum, count, buckets
          // For histogram, we need to create separate MetricItems for count, sum, buckets
          // Each MetricItem will have its own time series

          // 1. Count
          const countValues = points
            .filter((p) => typeof p.original.count === 'number')
            .map((p) => ({ timestamp: p.timestamp, value: p.original.count }));

          if (countValues.length > 0) {
            results.push({
              ...baseItem,
              metric: `${metric.name}_count`,
              values: countValues,
            });
          }

          // 2. Sum
          const sumValues = points
            .filter((p) => typeof p.original.sum === 'number')
            .map((p) => ({ timestamp: p.timestamp, value: p.original.sum }));

          if (sumValues.length > 0) {
            results.push({
              ...baseItem,
              metric: `${metric.name}_sum`,
              values: sumValues,
            });
          }

          // 3. Buckets
          // We need to collect all unique 'le' buckets across all points
          const allLe = new Set<string>();
          points.forEach((p) => {
            if (p.original.buckets) Object.keys(p.original.buckets).forEach((le) => allLe.add(le));
          });

          allLe.forEach((le) => {
            const bucketValues = points.map((p) => ({
              timestamp: p.timestamp,
              value: p.original.buckets?.[le] || 0,
            }));

            results.push({
              ...baseItem,
              metric: `${metric.name}_bucket`,
              tags: { ...baseItem.tags, le },
              values: bucketValues,
            });
          });

          // Add +Inf bucket (same as count)
          if (countValues.length > 0) {
            results.push({
              ...baseItem,
              metric: `${metric.name}_bucket`,
              tags: { ...baseItem.tags, le: '+Inf' },
              values: countValues, // Same as count
            });
          }

          // 4. Quantiles (if present in val as keys)
          // Simplified: assume quantiles are consistent across points
          const knownKeys = [
            'key',
            'labels',
            'count',
            'sum',
            'lastValue',
            'timestamp',
            'buckets',
            'rate',
            'value',
          ];

          // Find all quantile keys from the first point (approximation)
          Object.keys(val).forEach((k) => {
            if (!knownKeys.includes(k) && !isNaN(Number(k))) {
              const quantileValues = points.map((p) => ({
                timestamp: p.timestamp,
                value: Number(p.original[k]) || 0,
              }));

              results.push({
                ...baseItem,
                metric: metric.name,
                tags: { ...baseItem.tags, quantile: k },
                values: quantileValues,
              });
            }
          });
        } else {
          // Handle Counter, Gauge, Info
          const values = points.map((p) => {
            let v = 0;
            if (typeof p.original.value === 'number') {
              v = p.original.value;
            } else {
              // For string values (info type), move value to tags?
              v = 1;
            }
            return {
              timestamp: p.timestamp,
              value: v,
              // Expose rate (RPM -> QPS) if available
              rate: typeof p.original.rate === 'number' ? p.original.rate / 60 : undefined,
            };
          });

          if (typeof val.value !== 'number') {
            baseItem.tags.info_content = String(val.value);
          }

          results.push({
            ...baseItem,
            metric: metric.name,
            values,
          });

          // Extract rate (QPS) if available
          // node-universe rate is RPM (requests per minute), so we divide by 60 to get QPS
          // Merge QPS into the main metric as a value in values array or just rely on rate being present in tags?
          // User wants to use universe.request.total directly.
          // The transformer previously created a separate metric. Now we will remove that.
          // Instead, we ensure the rate is available in the original metric's values if possible,
          // or just rely on the user selecting universe.request.total and having the visualization handle it?
          // The user said: "I use universe.request.total data directly to display system qps".
          // universe.request.total is a COUNTER.
          // If we want to show QPS from a COUNTER, we usually need to calculate rate from time series,
          // OR if the source already provides rate (which it does, as 'rate' property), we should expose it.

          // But wait, the user specifically asked to REMOVE universe.request.total_qps.
          // And use universe.request.total.
          // So I will just revert the change that added _qps.
        }
      }
    }

    return results;
  }

  /**
   * Mask sensitive labels
   * @param labels Labels object
   * @param maskSensitive Whether to mask sensitive fields
   */
  static maskLabels(labels: Record<string, any>, maskSensitive: boolean): Record<string, any> {
    if (!maskSensitive || !labels || typeof labels !== 'object') return labels;
    const masked: Record<string, any> = {};
    Object.keys(labels).forEach((key) => {
      const value = labels[key];
      if (/token|password|secret|email|phone|user|uid/i.test(key)) {
        masked[key] = '***';
        return;
      }
      masked[key] = value;
    });
    return masked;
  }
}
