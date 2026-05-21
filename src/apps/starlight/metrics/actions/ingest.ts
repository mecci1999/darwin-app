import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, Starlight } from 'typings';
import { validators } from '../validators';
import { ProtocolParser } from '../utils/protocol-parser';
import { MetricProtocol } from '../types';
import { IngestionService } from '../services/ingestion';

const ingest = (star: Starlight) => {
  const ingestionService = new IngestionService(star);

  return {
    // 统一数据接入接口 (支持多种格式)
    'v1.ingest': {
      metadata: {
        auth: true,
      },
      params: {
        appKey: { type: 'string', required: true },
        // dataType 必填，默认为 standard
        dataType: {
          type: 'string',
          optional: true,
          default: MetricProtocol.STANDARD,
          enum: [MetricProtocol.STANDARD, MetricProtocol.PROMETHEUS, MetricProtocol.DATADOG],
        },
        // data 字段可以是 JSON (Standard/Datadog) 或 string (Prometheus)
        data: { type: 'any', required: true },
      },
      // 移除参数校验，因为 data 字段类型不确定，由 handler 内部处理
      // hooks: {
      //   before: [validators.ingestParams],
      // },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { appKey, dataType, data } = ctx.params;
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

          // 1. 格式解析 (Parser)
          // 将 Prometheus/Datadog/Standard 统一转换为 MetricItem[]
          const parsedMetrics = ProtocolParser.parse(data, dataType);

          if (parsedMetrics.length === 0) {
            return {
              status: 400,
              data: {
                code: HttpResponseCode.ParamsError,
                content: null,
                message: 'No valid metrics found in payload',
                success: false,
              },
            };
          }

          // 2. 权限验证 (AppKey)
          const appKeyValid = await ingestionService.validateAppKey(appKey, userId);
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

          // 3. 配额检查
          const quotaCheck = await ingestionService.checkUserQuota(userId, parsedMetrics.length);
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
                message: `配额已用完 (剩余: ${quotaCheck.remaining})`,
                success: false,
              },
            };
          }

          // 4. 数据清洗与验证 (Validator)
          // 复用现有的校验逻辑，因为 parsedMetrics 已经是标准格式
          const validatedMetrics = await ingestionService.validateAndCleanMetrics(
            parsedMetrics,
            dataType, // 记录原始格式
            appKeyValid.schema,
          );

          if (validatedMetrics.valid.length === 0) {
            return {
              status: 400,
              data: {
                code: HttpResponseCode.ParamsError,
                content: { errors: validatedMetrics.errors },
                message: 'All metrics failed validation',
                success: false,
              },
            };
          }

          // 5. 异步处理 (Kafka/Direct)
          const subscription = await ingestionService.getUserSubscription(userId);
          let result;

          if (subscription.plan === 'free') {
            // 免费用户直接写入 (低优先级)
            result = await ingestionService.processMetricsDirectly({
              userId,
              appKey,
              metrics: validatedMetrics.valid,
              timestamp: Date.now(),
              format: dataType,
            });
          } else {
            // 付费用户走 Kafka 缓冲
            result = await ingestionService.sendToKafka('metrics.raw', {
              userId,
              appKey,
              metrics: validatedMetrics.valid,
              timestamp: Date.now(),
              format: dataType,
              subscription: subscription.plan,
            });
          }

          // 6. 更新配额
          await ingestionService.updateQuotaUsage(userId, validatedMetrics.valid.length);

          return {
            status: 200,
            data: {
              code: HttpResponseCode.Success,
              content: {
                processed: validatedMetrics.valid.length,
                rejected: validatedMetrics.errors.length,
                quotaRemaining: quotaCheck.uncertain
                  ? null
                  : Math.max(quotaCheck.remaining - validatedMetrics.valid.length, 0),
                quotaKnown: !quotaCheck.uncertain,
                processingId: result?.processingId || result,
              },
              message: 'Metrics ingested successfully',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Ingest action failed:', error);
          return {
            status: 500,
            data: {
              code: HttpResponseCode.ServiceActionFaild,
              content: null,
              message: 'Internal server error',
              success: false,
            },
          };
        }
      },
    },
  };
};

export default ingest;
