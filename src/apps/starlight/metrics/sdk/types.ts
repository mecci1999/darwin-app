import { MetricType } from '../types';

export type SdkFetchInput = string | URL | { url: string; method?: string };

export interface MetricsClientConfig {
  endpoint: string;
  appKey: string;
  serviceName?: string;
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

export interface ServiceCallPayload {
  sourceService?: string;
  targetService: string;
  method?: string;
  route?: string;
  statusCode?: number;
  durationMs?: number;
  protocol?: 'http' | 'grpc' | 'mq' | 'database' | string;
  callType?: 'sync' | 'async' | 'mq' | string;
  timestamp?: number;
  tags?: Record<string, string>;
}

export interface InstrumentFetchOptions {
  targetService: string | ((input: SdkFetchInput, init?: RequestInit) => string);
  route?: string | ((input: SdkFetchInput, init?: RequestInit) => string);
  sourceService?: string;
  protocol?: string;
  callType?: string;
  tags?: Record<string, string> | ((input: SdkFetchInput, init?: RequestInit) => Record<string, string> | undefined);
}

export interface MetricBatch {
  appKey: string;
  dataType: 'standard' | 'prometheus' | 'datadog';
  data: MetricPayload[] | string | any;
}
