import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, Starlight } from 'typings';
import { validators } from '../validators';

import { ProtocolParser } from '../utils/protocol-parser';

const ingest = (star: Starlight) => {
  // 通用指标处理逻辑
  const processMetrics = async (ctx: Context, metrics: any[], format: string) => {
    const { appKey } = ctx.params;
    const userId = (ctx.meta as any).user?.userId;

    if (!userId) {
      throw { status: 401, code: HttpResponseCode.UserNotLoginError, message: '用户未认证' };
    }

    // 验证AppKey
    const appKeyValid = await (ctx.service as any).validateAppKey(appKey, userId);
    if (!appKeyValid.valid) {
      throw { status: 403, code: HttpResponseCode.ERR_INVALID_TOKEN, message: 'Invalid AppKey' };
    }

    // 检查配额
    const quotaCheck = await (ctx.service as any).checkUserQuota(userId, metrics.length);
    if (!quotaCheck.allowed) {
      throw { 
        status: 429, 
        code: HttpResponseCode.TooManyRequests, 
        message: '配额已用完',
        data: { quotaUsed: quotaCheck.used, quotaLimit: quotaCheck.limit, resetTime: quotaCheck.resetTime }
      };
    }

    // 数据清洗与验证
    const validatedMetrics = await (ctx.service as any).validateAndCleanMetrics(
      metrics,
      format,
      appKeyValid.schema,
    );

    // 获取订阅并处理
    const subscription = await (ctx.service as any).getUserSubscription(userId);
    let result;

    if (subscription.plan === 'free') {
      result = await (ctx.service as any).processMetricsDirectly({
        userId,
        appKey,
        metrics: validatedMetrics.valid,
        timestamp: Date.now(),
        format,
      });
    } else {
      result = await (ctx.service as any).sendToKafka('metrics.raw', {
        userId,
        appKey,
        metrics: validatedMetrics.valid,
        timestamp: Date.now(),
        format,
        subscription: subscription.plan,
      });
    }

    await (ctx.service as any).updateQuotaUsage(userId, validatedMetrics.valid.length);

    return {
      processed: validatedMetrics.valid.length,
      rejected: validatedMetrics.errors.length,
      quotaRemaining: quotaCheck.remaining - validatedMetrics.valid.length,
      processingId: result.processingId || result,
    };
  };

  return {
    // Prometheus 格式接收
    'v1.ingest.prometheus': {
      metadata: { auth: true },
      params: {
        appKey: { type: 'string', required: true },
        timeseries: { type: 'array', required: true },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const metrics = ProtocolParser.parsePrometheus(ctx.params);
          const result = await processMetrics(ctx, metrics, 'prometheus');
          return {
            status: 200,
            data: {
              code: HttpResponseCode.Success,
              content: result,
              message: 'Prometheus metrics received',
              success: true,
            },
          };
        } catch (err: any) {
          return {
            status: err.status || 500,
            data: {
              code: err.code || HttpResponseCode.ServiceActionFaild,
              content: err.data || null,
              message: err.message || 'Failed to process metrics',
              success: false,
            },
          };
        }
      },
    },

    // OTLP 格式接收
    'v1.ingest.otlp': {
      metadata: { auth: true },
      params: {
        appKey: { type: 'string', required: true },
        resourceMetrics: { type: 'array', required: true },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const metrics = ProtocolParser.parseOTLP(ctx.params);
          const result = await processMetrics(ctx, metrics, 'otlp');
          return {
            status: 200,
            data: {
              code: HttpResponseCode.Success,
              content: result,
              message: 'OTLP metrics received',
              success: true,
            },
          };
        } catch (err: any) {
          return {
            status: err.status || 500,
            data: {
              code: err.code || HttpResponseCode.ServiceActionFaild,
              content: err.data || null,
              message: err.message || 'Failed to process metrics',
              success: false,
            },
          };
        }
      },
    },

    // 单条指标数据接收
    'v1.ingest': {
      metadata: {
        auth: true, // 需要AppKey验证
      },
      params: {
        appKey: { type: 'string', required: true },
        metrics: { type: 'array', required: true },
        format: { type: 'string', optional: true, default: 'custom' },
        timestamp: { type: 'number', optional: true },
      },
      hooks: {
        before: [validators.rawData],
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { appKey, metrics, format, timestamp } = ctx.params;
          const userId = (ctx.meta as any).user?.userId;

          if (!userId) {
            return {
              status: 401,
              data: {
                code: HttpResponseCode.UserNotLoginError,
                content: null,
                message: '用户未认证',
                success: false,
              },
            };
          }

          // 验证AppKey
          const appKeyValid = await (this as any).validateAppKey(appKey, userId);
          if (!appKeyValid.valid) {
            return {
              status: 403,
              data: {
                code: HttpResponseCode.ERR_INVALID_TOKEN,
                content: null,
                message: 'Invalid AppKey',
                success: false,
              },
            };
          }

          // 检查用户配额
          const quotaCheck = await (this as any).checkUserQuota(userId, metrics.length);
          if (!quotaCheck.allowed) {
            return {
              status: 429,
              data: {
                code: HttpResponseCode.TooManyRequests,
                content: {
                  quotaUsed: quotaCheck.used,
                  quotaLimit: quotaCheck.limit,
                  resetTime: quotaCheck.resetTime,
                },
                message: '配额已用完，请升级订阅或等待配额重置',
                success: false,
              },
            };
          }

          // 数据清洗
          const validatedMetrics = await (this as any).validateAndCleanMetrics(
            metrics,
            format,
            appKeyValid.schema,
          );

          if (validatedMetrics.errors.length > 0) {
            star.logger?.warn('Metrics validation errors:', validatedMetrics.errors);
          }

          // 检查是否为付费用户，决定处理方式
          const subscription = await (this as any).getUserSubscription(userId);

          if (subscription.plan === 'free') {
            // 免费用户直接处理
            const result = await (this as any).processMetricsDirectly({
              userId,
              appKey,
              metrics: validatedMetrics.valid,
              timestamp: timestamp || Date.now(),
              format,
            });

            // 更新配额使用量
            await (this as any).updateQuotaUsage(userId, validatedMetrics.valid.length);

            return {
              status: 200,
              data: {
                code: HttpResponseCode.Success,
                content: {
                  processed: validatedMetrics.valid.length,
                  rejected: validatedMetrics.errors.length,
                  quotaRemaining: quotaCheck.remaining - validatedMetrics.valid.length,
                  processingId: result.processingId,
                },
                message: '指标数据接收成功',
                success: true,
              },
            };
          } else {
            // 付费用户发送到Kafka异步处理
            const messageId = await (this as any).sendToKafka('metrics.raw', {
              userId,
              appKey,
              metrics: validatedMetrics.valid,
              timestamp: timestamp || Date.now(),
              format,
              subscription: subscription.plan,
            });

            // 更新配额使用量
            await (this as any).updateQuotaUsage(userId, validatedMetrics.valid.length);

            return {
              status: 202,
              data: {
                code: HttpResponseCode.Success,
                content: {
                  processed: validatedMetrics.valid.length,
                  rejected: validatedMetrics.errors.length,
                  quotaRemaining: quotaCheck.remaining - validatedMetrics.valid.length,
                  messageId,
                  status: 'queued',
                },
                message: '指标数据已加入处理队列',
                success: true,
              },
            };
          }
        } catch (error) {
          star.logger?.error('Ingest metrics failed:', error);
          return {
            status: 500,
            data: {
              code: HttpResponseCode.ServiceActionFaild,
              content: null,
              message: '指标数据接收失败',
              success: false,
            },
          };
        }
      },
    },

    // 批量指标数据接收
    'v1.batchIngest': {
      metadata: {
        auth: true,
      },
      params: {
        appKey: { type: 'string', required: true },
        batches: { type: 'array', required: true }, // 批次数据数组
        format: { type: 'string', optional: true, default: 'custom' },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { appKey, batches, format } = ctx.params;
          const userId = (ctx.meta as any).user?.userId;

          if (!userId) {
            return {
              status: 401,
              data: {
                code: HttpResponseCode.UserNotLoginError,
                content: null,
                message: '用户未认证',
                success: false,
              },
            };
          }

          // 验证AppKey
          const appKeyValid = await (this as any).validateAppKey(appKey, userId);
          if (!appKeyValid.valid) {
            return {
              status: 403,
              data: {
                code: HttpResponseCode.ERR_INVALID_TOKEN,
                content: null,
                message: 'Invalid AppKey',
                success: false,
              },
            };
          }

          // 计算总数据点数
          const totalDataPoints = batches.reduce((sum: number, batch: any) => {
            return sum + (batch.metrics ? batch.metrics.length : 0);
          }, 0);

          // 检查用户配额
          const quotaCheck = await (this as any).checkUserQuota(userId, totalDataPoints);
          if (!quotaCheck.allowed) {
            return {
              status: 429,
              data: {
                code: HttpResponseCode.TooManyRequests,
                content: {
                  quotaUsed: quotaCheck.used,
                  quotaLimit: quotaCheck.limit,
                  resetTime: quotaCheck.resetTime,
                },
                message: '配额不足，无法处理批量数据',
                success: false,
              },
            };
          }

          // 处理批量数据
          const results: any[] = [];
          let totalProcessed = 0;
          let totalRejected = 0;

          for (const batch of batches) {
            const validatedMetrics = await (this as any).validateAndCleanMetrics(
              batch.metrics,
              format,
              appKeyValid.schema,
            );

            totalProcessed += validatedMetrics.valid.length;
            totalRejected += validatedMetrics.errors.length;

            results.push({
              batchId:
                batch.batchId || `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              processed: validatedMetrics.valid.length,
              rejected: validatedMetrics.errors.length,
              errors: validatedMetrics.errors,
            });

            // 发送到处理队列
            if (validatedMetrics.valid.length > 0) {
              await (this as any).sendToKafka('metrics.raw', {
                userId,
                appKey,
                metrics: validatedMetrics.valid,
                timestamp: batch.timestamp || Date.now(),
                format,
                batchId: batch.batchId,
              });
            }
          }

          // 更新配额使用量
          await (this as any).updateQuotaUsage(userId, totalProcessed);

          return {
            status: 202,
            data: {
              code: HttpResponseCode.Success,
              content: {
                totalBatches: batches.length,
                totalProcessed,
                totalRejected,
                quotaRemaining: quotaCheck.remaining - totalProcessed,
                results,
                status: 'queued',
              },
              message: '批量指标数据已加入处理队列',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Batch ingest metrics failed:', error);
          return {
            status: 500,
            data: {
              code: HttpResponseCode.ServiceActionFaild,
              content: null,
              message: '批量指标数据接收失败',
              success: false,
            },
          };
        }
      },
    },
  };
};

export default ingest;
