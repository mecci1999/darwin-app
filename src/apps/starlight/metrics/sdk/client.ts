import { MetricType } from '../types';
import type { InstrumentFetchOptions, MetricsClientConfig, MetricPayload, SdkFetchInput, ServiceCallPayload } from './types';

export class MetricsClient {
  private config: MetricsClientConfig;
  private queue: MetricPayload[] = [];
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(config: MetricsClientConfig) {
    this.config = {
      flushInterval: 10000,
      maxBatchSize: 100,
      enabled: true,
      debug: false,
      ...config,
    };

    if (this.config.enabled) {
      this.startFlushTimer();
    }
  }

  public async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  public async flushNow(): Promise<void> {
    await this.flush();
  }

  public gauge(name: string, value: number, tags?: Record<string, string>, unit?: string): void {
    this.record({
      metric: name,
      value,
      type: MetricType.GAUGE,
      tags,
      unit,
    });
  }

  public count(name: string, value: number = 1, tags?: Record<string, string>, unit?: string): void {
    this.record({
      metric: name,
      value,
      type: MetricType.COUNTER,
      tags,
      unit,
    });
  }

  public histogram(name: string, value: number, tags?: Record<string, string>, unit?: string): void {
    this.record({
      metric: name,
      value,
      type: MetricType.HISTOGRAM,
      tags,
      unit,
    });
  }

  public recordHttpCall(call: ServiceCallPayload): void {
    const timestamp = call.timestamp || Date.now();
    const durationMs = Math.max(0, Number(call.durationMs || 0));
    const statusCode = Number(call.statusCode || 0);
    const sourceService = call.sourceService || this.config.serviceName || this.config.defaultTags?.service || 'unknown-service';
    const targetService = call.targetService;
    if (!targetService) return;

    const sharedTags = this.buildTopologyTags({
      sourceService,
      targetService,
      method: call.method,
      route: call.route,
      statusCode,
      protocol: call.protocol || 'http',
      callType: call.callType || 'sync',
      tags: call.tags,
    });

    this.record({
      metric: 'http_requests_total',
      value: 1,
      type: MetricType.COUNTER,
      timestamp,
      tags: sharedTags,
      unit: 'count',
    });

    this.record({
      metric: 'http_request_duration_ms',
      value: durationMs,
      type: MetricType.HISTOGRAM,
      timestamp,
      tags: {
        ...sharedTags,
        phase: 'finish',
        unit: 'ms',
      },
      unit: 'ms',
    });
  }

  public instrumentFetch(fetchImpl: typeof fetch, options: InstrumentFetchOptions): typeof fetch {
    return (async (input: SdkFetchInput, init?: RequestInit) => {
      const startedAt = Date.now();
      const method = init?.method || (typeof input === 'object' && 'method' in input ? input.method : undefined) || 'GET';
      const resolveTarget = () =>
        typeof options.targetService === 'function' ? options.targetService(input, init) : options.targetService;
      const resolveRoute = () => {
        if (typeof options.route === 'function') return options.route(input, init);
        if (options.route) return options.route;
        if (typeof input === 'string') return input;
        if (input instanceof URL) return input.pathname;
        return input.url;
      };
      const resolveTags = () => (typeof options.tags === 'function' ? options.tags(input, init) : options.tags);

      try {
        const response = await fetchImpl(input as Parameters<typeof fetch>[0], init);
        this.recordHttpCall({
          sourceService: options.sourceService,
          targetService: resolveTarget(),
          method,
          route: resolveRoute(),
          statusCode: response.status,
          durationMs: Date.now() - startedAt,
          protocol: options.protocol || 'http',
          callType: options.callType || 'sync',
          tags: resolveTags(),
        });
        return response;
      } catch (error) {
        this.recordHttpCall({
          sourceService: options.sourceService,
          targetService: resolveTarget(),
          method,
          route: resolveRoute(),
          statusCode: 599,
          durationMs: Date.now() - startedAt,
          protocol: options.protocol || 'http',
          callType: options.callType || 'sync',
          tags: resolveTags(),
        });
        throw error;
      }
    }) as typeof fetch;
  }

  public record(metric: MetricPayload): void {
    if (!this.config.enabled) return;

    const payload: MetricPayload = {
      ...metric,
      timestamp: metric.timestamp || Date.now(),
      tags: {
        ...this.config.defaultTags,
        ...metric.tags,
      },
    };

    this.queue.push(payload);

    if (this.queue.length >= (this.config.maxBatchSize || 100)) {
      this.flush();
    }
  }

  private buildTopologyTags(params: {
    sourceService: string;
    targetService: string;
    method?: string;
    route?: string;
    statusCode?: number;
    protocol?: string;
    callType?: string;
    tags?: Record<string, string>;
  }): Record<string, string> {
    const status = params.statusCode ? String(params.statusCode) : '200';
    return {
      ...this.config.defaultTags,
      ...params.tags,
      service: params.sourceService,
      source_service: params.sourceService,
      target_service: params.targetService,
      targetService: params.targetService,
      destination_service: params.targetService,
      peer_service: params.targetService,
      protocol: params.protocol || 'http',
      callType: params.callType || 'sync',
      method: params.method || 'GET',
      route: params.route || '',
      status,
    };
  }

  public async sendPrometheus(data: string): Promise<void> {
    if (!this.config.enabled) return;
    await this.sendRawBatch('prometheus', data);
  }

  public async sendDatadog(data: any): Promise<void> {
    if (!this.config.enabled) return;
    await this.sendRawBatch('datadog', data);
  }

  private async flush(): Promise<void> {
    if (this.queue.length === 0) return;

    const batch = [...this.queue];
    this.queue = [];

    try {
      await this.sendRawBatch('standard', batch);
    } catch (error) {
      if (this.config.debug) {
        console.error('Failed to flush metrics:', error);
      }
      if (this.config.onError) {
        this.config.onError(error as Error);
      }
      if (this.queue.length < 1000) {
        this.queue.unshift(...batch);
      }
    }
  }

  private async sendRawBatch(dataType: 'standard' | 'prometheus' | 'datadog', data: any): Promise<void> {
    const payload = {
      appKey: this.config.appKey,
      dataType,
      data,
    };

    const response = await fetch(`${this.config.endpoint}/v1/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to send ${dataType} metrics: ${response.status} ${text}`);
    }

    if (this.config.debug) {
      console.log(`Sent ${dataType} metrics batch successfully`);
    }
  }

  private startFlushTimer(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.config.flushInterval);
  }
}
