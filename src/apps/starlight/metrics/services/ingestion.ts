import { Star } from 'node-universe';
import { MetricItem, ProcessedMetricsData } from '../types';
import { QuotaChecker } from '../utils/quota-checker';
import { KafkaHandler } from '../utils/kafka-handler';
import { InfluxDBHandler } from '../utils/influxdb-handler';
import { findApiKeyByKey } from 'db/mysql/apis/apiKey';

export class IngestionService {
  private star: Star;

  constructor(star: Star) {
    this.star = star;
  }

  /**
   * Validate AppKey
   */
  async validateAppKey(appKey: string, userId: string): Promise<{ valid: boolean; schema?: any }> {
    try {
      const keyData = await findApiKeyByKey(appKey);
      if (!keyData) return { valid: false };
      if (keyData.userId !== userId) return { valid: false };
      if (!keyData.isActive) return { valid: false };
      if (keyData.expiresAt && new Date(keyData.expiresAt) < new Date()) return { valid: false };
      return { valid: true, schema: (keyData as any).schema };
    } catch (error) {
      this.star.logger?.error('AppKey validation failed:', error);
      return { valid: false };
    }
  }

  /**
   * Check User Quota
   */
  async checkUserQuota(
    userId: string,
    count: number,
  ): Promise<{
    allowed: boolean;
    used: number;
    limit: number;
    remaining: number;
    resetTime: number;
    uncertain?: boolean;
  }> {
    try {
      // Use QuotaChecker to get usage
      const usage = await QuotaChecker.getUserUsage(userId, this.star);
      // Get limits (mocking or calling subscription service)
      const limits = await this.getUserLimits(userId);

      const used = usage.metrics.hourly;
      const limit = limits.metrics.hourly;
      const remaining = Math.max(0, limit - used);

      if (remaining < count) {
        return {
          allowed: false,
          used,
          limit,
          remaining,
          resetTime: Date.now() + 3600000, // Roughly next hour
        };
      }

      return {
        allowed: true,
        used,
        limit,
        remaining,
        resetTime: 0,
      };
    } catch (error) {
      this.star.logger?.error('Quota check failed:', error);
      return {
        allowed: true,
        used: 0,
        limit: 0,
        remaining: 0,
        resetTime: 0,
        uncertain: true,
      };
    }
  }

  /**
   * Get User Limits
   */
  private async getUserLimits(userId: string): Promise<any> {
    try {
      const detail = await this.star.call('subscription.v1.current.detail', {}, {
        meta: {
          user: { userId },
        },
      } as any);

      const content = (detail as any)?.data?.content || (detail as any)?.content || detail;
      const limits = content?.limits || {};

      return {
        metrics: {
          hourly: Number(limits.maxMetricsPerHour || 1000),
          daily: Number(limits.maxMetricsPerDay || 10000),
          monthly: Number(limits.maxMetricsPerMonth || 100000),
        },
      };
    } catch (error) {
      return { metrics: { hourly: 1000, daily: 10000, monthly: 100000 } };
    }
  }

  /**
   * Get User Subscription
   */
  async getUserSubscription(userId: string): Promise<{ plan: string }> {
    try {
      const detail = await this.star.call('subscription.v1.current.detail', {}, {
        meta: {
          user: { userId },
        },
      } as any);
      const content = (detail as any)?.data?.content || (detail as any)?.content || detail;
      return { plan: content?.plan?.name || 'free' };
    } catch (error) {
      return { plan: 'free' };
    }
  }

  /**
   * Validate and Clean Metrics
   */
  async validateAndCleanMetrics(
    metrics: MetricItem[],
    format: string,
    schema?: any,
  ): Promise<{ valid: MetricItem[]; errors: any[] }> {
    const valid: MetricItem[] = [];
    const errors: any[] = [];

    for (const metric of metrics) {
      // Basic validation
      if (!metric.metric || typeof metric.value !== 'number') {
        errors.push({ metric, error: 'Invalid metric structure' });
        continue;
      }

      // Schema validation if provided
      if (schema) {
        // TODO: Implement schema validation
      }

      valid.push(metric);
    }

    return { valid, errors };
  }

  /**
   * Process Metrics Directly (Write to InfluxDB)
   */
  async processMetricsDirectly(params: {
    userId: string;
    appKey: string;
    metrics: MetricItem[];
    timestamp: number;
    format: string;
  }): Promise<{ processingId: string }> {
    const processedMetrics: ProcessedMetricsData[] = params.metrics.map((m) => ({
      measurement: m.metric,
      tags: {
        ...m.tags,
        userId: params.userId,
        appKey: params.appKey,
        source_format: params.format,
      },
      fields: { value: m.value },
      timestamp: m.timestamp,
    }));

    await InfluxDBHandler.writeMetrics(processedMetrics, this.star);
    return { processingId: `direct-${Date.now()}` };
  }

  /**
   * Send to Kafka
   */
  async sendToKafka(topic: string, message: any): Promise<{ processingId: string }> {
    const kafka = KafkaHandler.getInstance();
    await kafka.send(topic, [message]);
    return { processingId: `kafka-${Date.now()}` };
  }

  /**
   * Update Quota Usage
   */
  async updateQuotaUsage(userId: string, count: number): Promise<void> {
    try {
      await this.star.emit('metrics.usage.update', { userId, count, timestamp: Date.now() });
    } catch (error) {
      this.star.logger?.warn('Failed to update quota usage:', error);
    }
  }
}
