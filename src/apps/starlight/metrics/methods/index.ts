import { findApiKeyByKey } from 'db/mysql/apis/apiKey';
import { Star } from 'node-universe';
import { MAX_RETRIES } from '../constants';
import { MetricsState, QuotaWarningParams, RawMetricsData } from '../types';
import { DataProcessor, InfluxDBHandler, KafkaHandler, MetricsUtils, QuotaChecker } from '../utils';
import { buildSystemServiceId, normalizeMetricsScope } from '../utils/system-telemetry';
import { buildServiceCatalogSnapshot } from '../utils/service-catalog';
import { enqueueMetricsBatch } from '../utils/processing-queue';

/**
 * 指标数据微服务的方法
 */
const metricsMethod = (star: Star, state: MetricsState) => {
  return {
    /**
     * 验证 AppKey
     */
    async validateAppKey(appKey: string, userId: string) {
      try {
        const keyData = await findApiKeyByKey(appKey);
        if (!keyData) {
          return { valid: false };
        }

        if (keyData.userId !== userId) {
          return { valid: false };
        }

        if (!keyData.isActive) {
          return { valid: false };
        }

        if (keyData.expiresAt && new Date(keyData.expiresAt) < new Date()) {
          return { valid: false };
        }

        return { valid: true, schema: (keyData as any).schema };
      } catch (error) {
        star.logger?.error('Failed to validate AppKey:', error);
        return { valid: false, error };
      }
    },

    /**
     * 检查用户配额
     */
    async checkUserQuota(userId: string, count: number) {
      try {
        // 获取用户当前使用量
        const usage = await QuotaChecker.getUserUsage(userId, star);
        const current = usage.metrics?.hourly || 0;

        // 获取用户订阅计划限制
        // 尝试从订阅服务获取限制，如果失败则使用默认值
        let limit = 10000;
        try {
          const subscription = await star.call('subscription.1.getUserSubscription', { userId });
          if (subscription && subscription.plan) {
            const planLimits = await star.call('subscription.1.getPlanLimits', {
              planName: subscription.plan,
            });
            if (planLimits && planLimits.metrics && planLimits.metrics.hourly) {
              limit = planLimits.metrics.hourly;
            }
          }
        } catch (e) {
          star.logger?.warn('Failed to fetch plan limits, using default:', e);
        }

        if (current + count > limit) {
          return {
            allowed: false,
            used: current,
            limit,
            resetTime: Date.now() + 3600000,
          };
        }

        return {
          allowed: true,
          used: current,
          limit,
          resetTime: Date.now() + 3600000,
        };
      } catch (error) {
        star.logger?.error('Failed to check user quota:', error);
        // 失败时默认允许，避免阻塞业务
        return { allowed: true, used: 0, limit: 10000, resetTime: Date.now() };
      }
    },

    /**
     * 验证并清洗指标数据
     */
    async validateAndCleanMetrics(metrics: any[], format: string, schema: any) {
      try {
        if (!MetricsUtils.validateMetricsFormat(format)) {
          return { valid: [], errors: [`Unsupported format: ${format}`] };
        }
        // 简单透传，实际应进行 Schema 验证
        return { valid: metrics, errors: [] };
      } catch (error) {
        return { valid: [], errors: [String(error)] };
      }
    },

    /**
     * 获取用户订阅信息
     */
    async getUserSubscription(userId: string) {
      try {
        // 尝试从订阅服务获取
        try {
          const sub = await star.call('subscription.1.getUserSubscription', { userId });
          return sub || { plan: 'free' };
        } catch (e) {
          return { plan: 'free' };
        }
      } catch (error) {
        star.logger?.error('Failed to get user subscription:', error);
        return { plan: 'free' };
      }
    },

    /**
     * 直接处理指标数据
     */
    async processMetricsDirectly(params: {
      userId: string;
      appKey: string;
      metrics: any[];
      timestamp: number;
      format: string;
    }) {
      try {
        return await this.ingestMetrics({
          data: params.metrics,
          format: params.format as any,
          source: 'direct',
          timestamp: params.timestamp,
          metadata: { userId: params.userId, appKeyId: params.appKey },
        });
      } catch (error) {
        throw error;
      }
    },

    /**
     * 更新配额使用情况
     */
    async updateQuotaUsage(userId: string, count: number) {
      try {
        // 发送事件，异步更新
        star.emit('metrics.usage.update', { userId, count, timestamp: Date.now() });
      } catch (error) {
        star.logger?.error('Failed to update quota usage:', error);
      }
    },

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
     * 获取服务目录列表（按 scope 过滤）
     */
    async getServicesList(params: {
      page?: number;
      pageSize?: number;
      status?: string[] | string;
      keyword?: string;
      scope?: 'tenant' | 'system';
      granularity?: 'logical' | 'runtime';
    }) {
      return await buildServiceCatalogSnapshot(
        {
          page: Number(params?.page || 1),
          pageSize: Number(params?.pageSize || 10),
          status: params?.status,
          keyword: params?.keyword,
          scope: normalizeMetricsScope(params?.scope),
          granularity: params?.granularity === 'runtime' ? 'runtime' : 'logical',
        },
        star,
      );
    },

    /**
     * 获取服务实例列表（按 scope 处理 system:serviceId）
     */
    async getInstancesList(params: { serviceId: string; scope?: 'tenant' | 'system' }) {
      const rawServiceId = String(params?.serviceId || '').trim();
      const scope = normalizeMetricsScope(params?.scope);
      const serviceId = rawServiceId.startsWith('system:')
        ? rawServiceId.slice('system:'.length)
        : rawServiceId;
      if (!serviceId || serviceId.startsWith('$')) {
        return [];
      }

      const nodes = star.registry?.getNodeList({ onlyAvaiable: true, withServices: true }) || [];
      const instances: any[] = [];
      nodes.forEach((node: any) => {
        const services = Array.isArray(node.services)
          ? node.services
              .map((item: any) => item?.name)
              .filter((name: string) => Boolean(name) && !String(name).startsWith('$'))
          : [];
        if (services.includes(serviceId)) {
          instances.push({
            id: `${node.id}-${serviceId}`,
            serviceId: scope === 'system' ? buildSystemServiceId(serviceId) : serviceId,
            node: node.hostname || node.id,
            status: node.available ? 'running' : 'error',
            cpu: typeof node.cpu === 'number' ? Math.min(100, Math.max(0, Number(node.cpu))) : 0,
            memory: null,
            startTime: null,
          });
        }
      });
      return instances;
    },

    /**
     * 获取服务健康状态
     */
    async getHealthStatus(service: any) {
      try {
        const healthy =
          Boolean(state.influxdbConnected) &&
          state.kafkaConsumers.length > 0 &&
          state.processingQueue.length < 1000;
        return {
          status: healthy ? 'healthy' : 'unknown',
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
     * 获取用户指标使用量
     */
    async getMetricsUsage(userId: string, timeRanges: any) {
      return await InfluxDBHandler.getMetricsUsage(userId, timeRanges, star);
    },

    /**
     * 获取用户API密钥数量
     */
    async getApiKeysCount(userId: string) {
      try {
        // 实际上应该查询数据库
        // 这里暂时模拟
        return 0;
      } catch (error) {
        star.logger?.error('Failed to get API keys count:', error);
        return 0;
      }
    },

    /**
     * 获取用户存储使用量
     */
    async getStorageUsage(userId: string) {
      return await InfluxDBHandler.getStorageUsage(userId, star);
    },

    /**
     * 触发配额超限处理
     */
    async onQuotaExceeded(data: any) {
      try {
        star.logger?.warn('Quota exceeded:', data);
        // 可以发送通知邮件或短信
      } catch (error) {
        star.logger?.error('Failed to handle quota exceeded:', error);
      }
    },

    /**
     * 清理缓存
     */
    async clearCache(type?: string) {
      try {
        if (type) {
          if (state.cache[type as keyof typeof state.cache]) {
            (state.cache[type as keyof typeof state.cache] as Map<string, any>).clear();
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
      enqueueMetricsBatch(state, {
        id: `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        format: data.format,
        data: [data],
        timestamp: Date.now(),
        retryCount: 0,
      });
    },

    async onMetricsProcessed(data: any) {
      // no-op
    },

    async onQuotaWarning(data: any) {
      // no-op
    },
  };
};

export default metricsMethod;
