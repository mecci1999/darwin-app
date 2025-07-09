import { Context, Star } from 'node-universe';
import { ResponseCode } from '../../typings/enum';
import { HttpResponseItem } from '../../typings/response';

const query = (star: Star) => {
  return {
    // 查询指标数据
    query: {
      metadata: {
        auth: true,
      },
      params: {
        appKey: { type: 'string', required: true },
        metric: { type: 'string', optional: true }, // 指标名称
        tags: { type: 'object', optional: true }, // 标签过滤
        timeRange: {
          type: 'object',
          required: true,
          props: {
            start: { type: 'string', required: true }, // ISO时间字符串或相对时间
            end: { type: 'string', required: true },
          },
        },
        aggregation: {
          type: 'object',
          optional: true,
          props: {
            function: { type: 'string', enum: ['mean', 'sum', 'count', 'min', 'max', 'last', 'first'] },
            window: { type: 'string', optional: true }, // 时间窗口，如 '1m', '5m', '1h'
          },
        },
        limit: { type: 'number', optional: true, default: 1000 },
        offset: { type: 'number', optional: true, default: 0 },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { appKey, metric, tags, timeRange, aggregation, limit, offset } = ctx.params;
          const userId = (ctx.meta as any).user?.userId;

          if (!userId) {
            return {
              status: 401,
              data: {
                code: ResponseCode.UserNotLoginError,
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
                code: ResponseCode.ERR_INVALID_TOKEN,
                content: null,
                message: 'Invalid AppKey',
                success: false,
              },
            };
          }

          // 构建查询参数
          const queryParams = {
            userId,
            appKey,
            metric,
            tags,
            timeRange: {
              start: (this as any).parseTimeString(timeRange.start),
              end: (this as any).parseTimeString(timeRange.end),
            },
            aggregation,
            limit,
            offset,
          };

          // 执行查询
          const result = await (this as any).queryInfluxDB(queryParams);

          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                data: result.data,
                total: result.total,
                limit,
                offset,
                hasMore: result.total > offset + limit,
                queryTime: result.queryTime,
                timeRange: queryParams.timeRange,
              },
              message: '查询成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Query metrics failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '查询指标数据失败',
              success: false,
            },
          };
        }
      },
    },

    // 获取指标列表
    listMetrics: {
      metadata: {
        auth: true,
      },
      params: {
        appKey: { type: 'string', required: true },
        search: { type: 'string', optional: true }, // 搜索关键词
        limit: { type: 'number', optional: true, default: 100 },
        offset: { type: 'number', optional: true, default: 0 },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { appKey, search, limit, offset } = ctx.params;
          const userId = (ctx.meta as any).user?.userId;

          if (!userId) {
            return {
              status: 401,
              data: {
                code: ResponseCode.UserNotLoginError,
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
                code: ResponseCode.ERR_INVALID_TOKEN,
                content: null,
                message: 'Invalid AppKey',
                success: false,
              },
            };
          }

          // 获取指标列表
          const metrics = await (this as any).getMetricsList({
            userId,
            appKey,
            search,
            limit,
            offset,
          });

          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                metrics: metrics.data,
                total: metrics.total,
                limit,
                offset,
                hasMore: metrics.total > offset + limit,
              },
              message: '获取指标列表成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('List metrics failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '获取指标列表失败',
              success: false,
            },
          };
        }
      },
    },

    // 获取标签值
    getTagValues: {
      metadata: {
        auth: true,
      },
      params: {
        appKey: { type: 'string', required: true },
        metric: { type: 'string', required: true },
        tagKey: { type: 'string', required: true },
        search: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 100 },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { appKey, metric, tagKey, search, limit } = ctx.params;
          const userId = (ctx.meta as any).user?.userId;

          if (!userId) {
            return {
              status: 401,
              data: {
                code: ResponseCode.UserNotLoginError,
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
                code: ResponseCode.ERR_INVALID_TOKEN,
                content: null,
                message: 'Invalid AppKey',
                success: false,
              },
            };
          }

          // 获取标签值
          const tagValues = await (this as any).getTagValues({
            userId,
            appKey,
            metric,
            tagKey,
            search,
            limit,
          });

          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                tagKey,
                values: tagValues,
                total: tagValues.length,
              },
              message: '获取标签值成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Get tag values failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '获取标签值失败',
              success: false,
            },
          };
        }
      },
    },

    // 导出数据
    export: {
      metadata: {
        auth: true,
      },
      params: {
        appKey: { type: 'string', required: true },
        format: { type: 'string', enum: ['csv', 'json', 'prometheus'], default: 'json' },
        timeRange: {
          type: 'object',
          required: true,
          props: {
            start: { type: 'string', required: true },
            end: { type: 'string', required: true },
          },
        },
        metrics: { type: 'array', optional: true }, // 指定要导出的指标
        compression: { type: 'boolean', optional: true, default: false },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { appKey, format, timeRange, metrics, compression } = ctx.params;
          const userId = (ctx.meta as any).user?.userId;

          if (!userId) {
            return {
              status: 401,
              data: {
                code: ResponseCode.UserNotLoginError,
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
                code: ResponseCode.ERR_INVALID_TOKEN,
                content: null,
                message: 'Invalid AppKey',
                success: false,
              },
            };
          }

          // 检查用户订阅是否支持导出功能
          const subscription = await (this as any).getUserSubscription(userId);
          if (subscription.plan === 'free') {
            return {
              status: 403,
              data: {
                code: ResponseCode.NoPermissionError,
                content: null,
                message: '免费用户不支持数据导出功能，请升级订阅',
                success: false,
              },
            };
          }

          // 创建导出任务
          const exportTask = await (this as any).createExportTask({
            userId,
            appKey,
            format,
            timeRange: {
              start: (this as any).parseTimeString(timeRange.start),
              end: (this as any).parseTimeString(timeRange.end),
            },
            metrics,
            compression,
          });

          return {
            status: 202,
            data: {
              code: ResponseCode.Success,
              content: {
                taskId: exportTask.taskId,
                status: 'processing',
                estimatedTime: exportTask.estimatedTime,
                downloadUrl: null, // 任务完成后会有下载链接
              },
              message: '导出任务已创建，请稍后查看进度',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Export metrics failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '创建导出任务失败',
              success: false,
            },
          };
        }
      },
    },
  };
};

export default query;