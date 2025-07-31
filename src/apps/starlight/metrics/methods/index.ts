import { Star } from 'node-universe';
import { MetricsState, RawMetricsData, QuotaWarningParams } from '../types';
import { DataProcessor, InfluxDBHandler, QuotaChecker, KafkaHandler } from '../utils';
import { MAX_RETRIES } from '../constants';

/**
 * 指标数据微服务的方法
 */
const metricsMethod = (star: Star, state: MetricsState) => {
  return {
    /**
     * 摄取原始指标数据
     */
    async ingestMetrics(data: RawMetricsData) {
      try {
        return await DataProcessor.processRawData(data, star, state);
      } catch (error) {
        star.logger?.error('Failed to ingest metrics:', error);
        throw error;
      }
    },

    /**
     * 查询指标数据
     */
    async queryMetrics(params: any) {
      try {
        return await InfluxDBHandler.queryMetrics(params, star);
      } catch (error) {
        star.logger?.error('Failed to query metrics:', error);
        throw error;
      }
    },

    /**
     * 获取指标聚合数据
     */
    async getAggregatedMetrics(params: any) {
      try {
        const cacheKey = `aggregated:${JSON.stringify(params)}`;
        let result = state.cache.aggregations.get(cacheKey);

        if (!result) {
          result = await InfluxDBHandler.queryMetrics(params, star);
          state.cache.aggregations.set(cacheKey, result);

          // 设置缓存过期时间
          setTimeout(() => {
            state.cache.aggregations.delete(cacheKey);
          }, 300000); // 5分钟
        }

        return result;
      } catch (error) {
        star.logger?.error('Failed to get aggregated metrics:', error);
        throw error;
      }
    },

    /**
     * 处理配额警告
     */
    async handleQuotaWarning(params: QuotaWarningParams) {
      try {
        star.logger?.info('Handling quota warning', params);
        // Send quota alert through the quota checker system
        await star.emit('quota.alert', {
          ...params,
          severity: 'warning',
          timestamp: Date.now(),
        });

        star.logger?.warn(`Quota warning processed for user: ${params.userId}`);
        return { success: true };
      } catch (error) {
        star.logger?.error('Failed to handle quota warning:', error);
        throw error;
      }
    },

    /**
     * 获取用户配额使用情况
     */
    async getUserQuotaUsage(userId: string) {
      try {
        star.logger?.info('Getting user quota usage', { userId });
        const cacheKey = `quota:${userId}`;
        let usage = state.cache.quotas.get(cacheKey);

        if (!usage) {
          usage = await QuotaChecker.checkUserQuota(userId, star);
          state.cache.quotas.set(cacheKey, usage);

          // 设置缓存过期时间
          setTimeout(() => {
            state.cache.quotas.delete(cacheKey);
          }, 60000); // 1分钟
        }

        return usage;
      } catch (error) {
        star.logger?.error('Failed to get user quota usage:', error);
        throw error;
      }
    },

    /**
     * 获取服务健康状态
     */
    async getHealthStatus(service: any) {
      try {
        return {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          influxdb: state.influxdbConnected,
          kafka: state.kafkaConsumers.length > 0,
          database: !!service.db,
          redis: !!service.redis,
          processingQueue: state.processingQueue.length,
          lastFlushTime: state.lastFlushTime,
          uptime: process.uptime(),
        };
      } catch (error) {
        star.logger?.error('Failed to get health status:', error);
        throw error;
      }
    },

    /**
     * 获取服务统计信息
     */
    async getServiceStats() {
      try {
        return {
          processingQueue: state.processingQueue.length,
          kafkaConsumers: state.kafkaConsumers.length,
          influxdbConnected: state.influxdbConnected,
          lastFlushTime: state.lastFlushTime,
          cacheStats: {
            metrics: state.cache.metrics.size,
            quotas: state.cache.quotas.size,
            aggregations: state.cache.aggregations.size,
          },
          uptime: process.uptime(),
          memoryUsage: process.memoryUsage(),
        };
      } catch (error) {
        star.logger?.error('Failed to get service stats:', error);
        throw error;
      }
    },

    /**
     * 清理缓存
     */
    async clearCache(type?: string) {
      try {
        if (type) {
          if (state.cache[type as keyof typeof state.cache]) {
            (
              state.cache[type as keyof typeof state.cache] as Map<string, any>
            ).clear();
          }
        } else {
          state.cache.metrics.clear();
          state.cache.quotas.clear();
          state.cache.aggregations.clear();
        }

        star.logger?.info(`Cache cleared: ${type || 'all'}`);
      } catch (error) {
        star.logger?.error('Failed to clear cache:', error);
        throw error;
      }
    },

    /**
     * 处理批量指标数据
     */
    async processBatchMetrics(service: any) {
      try {
        star.logger?.info('Processing batch metrics');
        return await DataProcessor.processBatches(service, state);
      } catch (error) {
        star.logger?.error('Failed to process batch metrics:', error);
        throw error;
      }
    },

    /**
     * 重新处理失败的指标
     */
    async retryFailedMetrics() {
      try {
        const failedBatches = state.processingQueue.filter(
          (batch) => batch.retryCount < MAX_RETRIES,
        );

        for (const batch of failedBatches) {
          batch.retryCount++;
          await DataProcessor.processBatch(batch, star, state);
        }

        star.logger?.info(`Retried ${failedBatches.length} failed metric batches`);
      } catch (error) {
        star.logger?.error('Failed to retry failed metrics:', error);
        throw error;
      }
    },

    /**
     * 设置Kafka消费者
     */
    async setupKafkaConsumers(service: any) {
      try {
        const consumerConfigs = [
          {
            topic: service.settings.kafka.topics.metricsRaw,
            groupId: 'metrics-processor',
            handler: async (data: any) => {
              await this.handleMetricsEvent(data, service);
            },
          },
          {
            topic: service.settings.kafka.topics.quotaWarnings,
            groupId: 'quota-processor',
            handler: async (data: any) => {
              await this.handleQuotaEvent(data, service);
            },
          },
        ];

        await KafkaHandler.setupConsumers(consumerConfigs, star, state);
        await KafkaHandler.setupProducer(star);
        star.logger?.info('Kafka consumers setup completed');
      } catch (error) {
        star.logger?.error('Failed to setup Kafka consumers:', error);
        throw error;
      }
    },

    /**
     * 处理指标事件
     */
    async handleMetricsEvent(message: any, service: any) {
      try {
        const { type, data } = message;

        switch (type) {
          case 'metrics.raw':
            await service.onMetricsReceived(data);
            break;
          case 'metrics.processed':
            await service.onMetricsProcessed(data);
            break;
          default:
            star.logger?.warn(`Unknown metrics event type: ${type}`);
        }
      } catch (error) {
        star.logger?.error('Failed to handle metrics event:', error);
      }
    },

    /**
     * 处理配额事件
     */
    async handleQuotaEvent(message: any, service: any) {
      try {
        const { type, data } = message;

        switch (type) {
          case 'quota.warning':
            await service.onQuotaWarning(data);
            break;
          case 'quota.exceeded':
            await service.onQuotaExceeded(data);
            break;
          default:
            star.logger?.warn(`Unknown quota event type: ${type}`);
        }
      } catch (error) {
        star.logger?.error('Failed to handle quota event:', error);
      }
    },

    /**
     * 指标接收事件处理
     */
    async onMetricsReceived(data: RawMetricsData) {
      star.logger?.debug(`Metrics received from ${data.source}`);

      // 添加到处理队列
      state.processingQueue.push({
        id: `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        format: data.format,
        data: [data],
        timestamp: Date.now(),
        retryCount: 0,
      });
    },

    /**
     * 指标处理完成事件处理
     */
    async onMetricsProcessed(data: any) {
      star.logger?.debug(`Metrics batch processed: ${data.batchId}`);

      // 更新缓存
      if (data.userId) {
        state.cache.metrics.delete(data.userId);
      }
    },

    /**
     * 配额警告事件处理
     */
    async onQuotaWarning(data: QuotaWarningParams) {
      star.logger?.warn(`Quota warning for user: ${data.userId}, type: ${data.quotaType}`);

      // 发送通知
      await star.emit('notification.send', {
        userId: data.userId,
        type: 'quota_warning',
        data,
      });
    },

    /**
     * 配额超限事件处理
     */
    async onQuotaExceeded(data: any) {
      star.logger?.error(`Quota exceeded for user: ${data.userId}`);

      // 发送紧急通知
      await star.emit('notification.send', {
        userId: data.userId,
        type: 'quota_exceeded',
        priority: 'high',
        data,
      });
    },
  };
};

export default metricsMethod;