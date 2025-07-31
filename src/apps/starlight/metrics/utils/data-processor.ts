/**
 * 数据处理器
 */
import { Star } from 'node-universe';
import { MetricsState, RawMetricsData, ProcessedMetricsData, MetricsBatch } from '../types';
import { BATCH_SIZE, FLUSH_INTERVAL } from '../constants';
import { MetricsUtils } from './metrics-utils';
import { InfluxDBHandler } from './influxdb-handler';

export class DataProcessor {
  private static processingTimer: NodeJS.Timeout | null = null;

  /**
   * 启动数据处理器
   */
  static start(star: Star, state: MetricsState): void {
    if (this.processingTimer) {
      return;
    }

    this.processingTimer = setInterval(async () => {
      await this.processBatches(star, state);
    }, FLUSH_INTERVAL);

    star.logger?.info('Data processor started');
  }

  /**
   * 停止数据处理器
   */
  static stop(star: Star): void {
    if (this.processingTimer) {
      clearInterval(this.processingTimer);
      this.processingTimer = null;
      star.logger?.info('Data processor stopped');
    }
  }

  /**
   * 处理原始指标数据
   */
  static async processRawData(
    rawData: RawMetricsData,
    star: Star,
    state: MetricsState,
  ): Promise<void> {
    try {
      // 验证数据格式
      if (!MetricsUtils.validateMetricsFormat(rawData.format)) {
        throw new Error(`Unsupported metrics format: ${rawData.format}`);
      }

      // 解析数据
      let processedMetrics: ProcessedMetricsData[] = [];

      switch (rawData.format) {
        case 'prometheus':
          processedMetrics = MetricsUtils.parsePrometheusData(rawData.data);
          break;
        case 'statsd':
          processedMetrics = MetricsUtils.parseStatsDData(rawData.data);
          break;
        case 'custom':
        case 'official':
          // 假设自定义格式已经是处理后的格式
          processedMetrics = Array.isArray(rawData.data) ? rawData.data : [rawData.data];
          break;
        default:
          // 其他格式的处理逻辑
          processedMetrics = this.parseGenericFormat(rawData.data);
          break;
      }

      // 添加元数据
      if (rawData.metadata) {
        processedMetrics = processedMetrics.map((metric) => {
          const newTags: Record<string, string> = {
            ...metric.tags,
            ...rawData.metadata?.tags,
          };

          // 只添加非空的元数据字段
          if (rawData.metadata?.userId) {
            newTags.userId = rawData.metadata.userId;
          }
          if (rawData.metadata?.appKeyId) {
            newTags.appKeyId = rawData.metadata.appKeyId;
          }

          return {
            ...metric,
            tags: newTags,
          };
        });
      }

      // 添加到处理队列
      await this.addToBatch(processedMetrics, rawData.format, star, state);

      star.logger?.debug(`Processed ${processedMetrics.length} metrics from ${rawData.source}`);
    } catch (error) {
      star.logger?.error('Failed to process raw metrics data:', error);
      throw error;
    }
  }

  /**
   * 添加到批处理队列
   */
  private static async addToBatch(
    metrics: ProcessedMetricsData[],
    format: string,
    star: Star,
    state: MetricsState,
  ): Promise<void> {
    // 查找现有批次或创建新批次
    let batch = state.processingQueue.find(
      (b) => b.format === format && b.data.length < BATCH_SIZE,
    );

    if (!batch) {
      batch = {
        id: MetricsUtils.generateBatchId(),
        format,
        data: [],
        timestamp: Date.now(),
        retryCount: 0,
      };
      state.processingQueue.push(batch);
    }

    // 添加指标到批次
    batch.data.push(...metrics);

    // 如果批次已满，立即处理
    if (batch.data.length >= BATCH_SIZE) {
      await this.processBatch(batch, star, state);
    }
  }

  /**
   * 处理所有批次
   */
  public static async processBatches(star: Star, state: MetricsState): Promise<void> {
    const now = Date.now();
    const batchesToProcess = state.processingQueue.filter(
      (batch) => now - batch.timestamp >= FLUSH_INTERVAL || batch.data.length >= BATCH_SIZE,
    );

    for (const batch of batchesToProcess) {
      await this.processBatch(batch, star, state);
    }

    state.lastFlushTime = now;
  }

  /**
   * 处理单个批次
   */
  public static async processBatch(
    batch: MetricsBatch,
    star: Star,
    state: MetricsState,
  ): Promise<void> {
    try {
      if (batch.data.length === 0) {
        return;
      }

      // 写入InfluxDB
      await InfluxDBHandler.writeMetrics(batch.data, star);

      // 发送处理完成事件
      await star.emit('metrics.processed', {
        batchId: batch.id,
        count: batch.data.length,
        format: batch.format,
        timestamp: Date.now(),
      });

      // 从队列中移除已处理的批次
      const index = state.processingQueue.indexOf(batch);
      if (index > -1) {
        state.processingQueue.splice(index, 1);
      }

      star.logger?.debug(`Processed batch ${batch.id} with ${batch.data.length} metrics`);
    } catch (error) {
      star.logger?.error(`Failed to process batch ${batch.id}:`, error);

      // 重试逻辑
      batch.retryCount++;
      if (batch.retryCount >= 3) {
        // 移除失败的批次
        const index = state.processingQueue.indexOf(batch);
        if (index > -1) {
          state.processingQueue.splice(index, 1);
        }
        star.logger?.error(`Batch ${batch.id} failed after 3 retries, discarding`);
      } else {
        // 重新安排处理时间
        batch.timestamp = Date.now() + batch.retryCount * 5000;
      }
    }
  }

  /**
   * 解析通用格式数据
   */
  private static parseGenericFormat(data: any): ProcessedMetricsData[] {
    try {
      if (Array.isArray(data)) {
        return data.map((item) => this.normalizeMetric(item));
      } else {
        return [this.normalizeMetric(data)];
      }
    } catch (error) {
      throw new Error(`Failed to parse generic format data: ${error}`);
    }
  }

  /**
   * 标准化指标数据
   */
  private static normalizeMetric(item: any): ProcessedMetricsData {
    return {
      measurement: item.measurement || item.name || 'unknown',
      tags: item.tags || {},
      fields: item.fields || item.values || { value: item.value || 0 },
      timestamp: item.timestamp || Date.now(),
    };
  }

  /**
   * 获取处理器统计信息
   */
  static getStats(state: MetricsState): {
    queueLength: number;
    totalBatches: number;
    lastFlushTime: number;
    avgBatchSize: number;
  } {
    const totalMetrics = state.processingQueue.reduce((sum, batch) => sum + batch.data.length, 0);
    const avgBatchSize =
      state.processingQueue.length > 0 ? totalMetrics / state.processingQueue.length : 0;

    return {
      queueLength: totalMetrics,
      totalBatches: state.processingQueue.length,
      lastFlushTime: state.lastFlushTime,
      avgBatchSize,
    };
  }
}
