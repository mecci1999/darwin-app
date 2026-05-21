import { MetricType } from '../types';
import { MetricsClientConfig, MetricPayload } from './types';

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
