import { MetricType } from '../types';

export interface MetricsClientConfig {
  endpoint: string;
  appKey: string;
  defaultTags?: Record<string, string>;
  flushInterval?: number; // ms, default 10000
  maxBatchSize?: number; // default 100
  enabled?: boolean; // default true
  debug?: boolean; // default false
  onError?: (error: Error) => void;
}

export interface MetricPayload {
  metric: string;
  value: number;
  type: MetricType | string;
  tags?: Record<string, string>;
  timestamp?: number;
  unit?: string;
}

export interface MetricBatch {
  appKey: string;
  dataType: 'standard' | 'prometheus' | 'datadog';
  data: MetricPayload[] | string | any;
}
