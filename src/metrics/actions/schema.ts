import { Context, Star } from 'node-universe';
import { ResponseCode } from '../../typings/enum';
import { HttpResponseItem } from '../../typings/response';

const schema = (star: Star) => {
  return {
    // 获取支持的指标格式列表
    listFormats: {
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const formats = [
            {
              type: 'prometheus',
              name: 'Prometheus',
              description: 'Prometheus监控系统格式',
              example: {
                metric_name: 'http_requests_total',
                labels: { method: 'GET', status: '200' },
                value: 1027,
                timestamp: 1609459200000,
              },
              features: ['标签支持', '时间序列', '聚合查询'],
            },
            {
              type: 'statsd',
              name: 'StatsD',
              description: 'StatsD统计数据格式',
              example: {
                metric: 'api.response_time',
                value: 234.5,
                type: 'histogram',
                tags: ['env:prod', 'service:api'],
                timestamp: 1609459200000,
              },
              features: ['计数器', '计时器', '直方图', '集合'],
            },
            {
              type: 'datadog',
              name: 'DataDog',
              description: 'DataDog监控平台格式',
              example: {
                series: [
                  {
                    metric: 'system.cpu.usage',
                    points: [[1609459200, 0.85]],
                    tags: ['host:web01', 'env:production'],
                    type: 'gauge',
                  },
                ],
              },
              features: ['多指标批量', '丰富标签', '多种数据类型'],
            },
            {
              type: 'otlp',
              name: 'OpenTelemetry',
              description: 'OpenTelemetry协议格式',
              example: {
                resourceMetrics: [
                  {
                    resource: {
                      attributes: [{ key: 'service.name', value: { stringValue: 'my-service' } }],
                    },
                    scopeMetrics: [
                      {
                        metrics: [
                          {
                            name: 'http_request_duration',
                            unit: 'ms',
                            histogram: {
                              dataPoints: [
                                {
                                  timeUnixNano: '1609459200000000000',
                                  count: '100',
                                  sum: 12345.67,
                                },
                              ],
                            },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
              features: ['标准化协议', '分布式追踪', '资源属性'],
            },
            {
              type: 'custom',
              name: '自定义格式',
              description: '用户自定义的指标数据格式',
              example: {
                name: 'custom_metric',
                value: 42,
                unit: 'count',
                dimensions: { region: 'us-east-1', service: 'api' },
                timestamp: '2021-01-01T00:00:00Z',
              },
              features: ['灵活定义', '自定义字段', '个性化标签'],
            },
            {
              type: 'official',
              name: '官方推荐格式',
              description: '系统官方推荐的标准格式',
              example: {
                metric: 'application.performance.response_time',
                value: 156.78,
                type: 'gauge',
                tags: {
                  environment: 'production',
                  service: 'user-api',
                  version: 'v1.2.3',
                },
                timestamp: 1609459200000,
                metadata: {
                  unit: 'milliseconds',
                  description: 'API响应时间',
                },
              },
              features: ['最佳实践', '性能优化', '标准化命名'],
            },
          ];

          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                formats,
                total: formats.length,
              },
              message: '获取支持格式列表成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('List formats failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '获取格式列表失败',
              success: false,
            },
          };
        }
      },
    },

    // 获取指定格式的详细信息
    getFormat: {
      params: {
        type: { type: 'string', required: true },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { type } = ctx.params;

          const formatDetail = await (this as any).getFormatDetail(type);
          if (!formatDetail) {
            return {
              status: 404,
              data: {
                code: ResponseCode.ParamsError,
                content: null,
                message: '不支持的格式类型',
                success: false,
              },
            };
          }

          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: formatDetail,
              message: '获取格式详情成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Get format failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '获取格式详情失败',
              success: false,
            },
          };
        }
      },
    },

    // 创建自定义指标结构
    createCustomSchema: {
      metadata: {
        auth: true,
      },
      params: {
        name: { type: 'string', required: true },
        description: { type: 'string', optional: true },
        schema: { type: 'object', required: true },
        isPublic: { type: 'boolean', optional: true, default: false },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { name, description, schema, isPublic } = ctx.params;
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

          // 验证schema格式
          const validation = await (this as any).validateCustomSchema(schema);
          if (!validation.valid) {
            return {
              status: 400,
              data: {
                code: ResponseCode.ParamsError,
                content: {
                  errors: validation.errors,
                },
                message: 'Schema格式验证失败',
                success: false,
              },
            };
          }

          // 检查名称是否已存在
          const existing = await (this as any).checkSchemaNameExists(name, userId);
          if (existing) {
            return {
              status: 409,
              data: {
                code: ResponseCode.ParamsError,
                content: null,
                message: 'Schema名称已存在',
                success: false,
              },
            };
          }

          // 创建自定义schema
          const customSchema = await (this as any).createCustomSchema({
            name,
            description,
            schema,
            isPublic,
            userId,
          });

          return {
            status: 201,
            data: {
              code: ResponseCode.Success,
              content: {
                schemaId: customSchema.id,
                name: customSchema.name,
                description: customSchema.description,
                isPublic: customSchema.isPublic,
                createdAt: customSchema.createdAt,
              },
              message: '自定义Schema创建成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Create custom schema failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '创建自定义Schema失败',
              success: false,
            },
          };
        }
      },
    },

    // 获取用户的自定义schema列表
    listCustomSchemas: {
      metadata: {
        auth: true,
      },
      params: {
        includePublic: { type: 'boolean', optional: true, default: true },
        search: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 20 },
        offset: { type: 'number', optional: true, default: 0 },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { includePublic, search, limit, offset } = ctx.params;
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

          const schemas = await (this as any).getUserCustomSchemas({
            userId,
            includePublic,
            search,
            limit,
            offset,
          });

          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                schemas: schemas.data,
                total: schemas.total,
                limit,
                offset,
                hasMore: schemas.total > offset + limit,
              },
              message: '获取自定义Schema列表成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('List custom schemas failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '获取自定义Schema列表失败',
              success: false,
            },
          };
        }
      },
    },

    // 验证指标数据格式
    validate: {
      params: {
        data: { type: 'any', required: true },
        format: { type: 'string', required: true },
        schemaId: { type: 'string', optional: true }, // 自定义schema ID
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { data, format, schemaId } = ctx.params;

          let validationResult;
          if (schemaId) {
            // 使用自定义schema验证
            const customSchema = await (this as any).getCustomSchemaById(schemaId);
            if (!customSchema) {
              return {
                status: 404,
                data: {
                  code: ResponseCode.ParamsError,
                  content: null,
                  message: '自定义Schema不存在',
                  success: false,
                },
              };
            }
            validationResult = await (this as any).validateWithCustomSchema(data, customSchema.schema);
          } else {
            // 使用标准格式验证
            validationResult = await (this as any).validateWithStandardFormat(data, format);
          }

          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                valid: validationResult.valid,
                errors: validationResult.errors,
                warnings: validationResult.warnings,
                suggestions: validationResult.suggestions,
              },
              message: validationResult.valid ? '数据格式验证通过' : '数据格式验证失败',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Validate format failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '格式验证失败',
              success: false,
            },
          };
        }
      },
    },

    // 格式转换
    transform: {
      params: {
        data: { type: 'any', required: true },
        fromFormat: { type: 'string', required: true },
        toFormat: { type: 'string', required: true },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { data, fromFormat, toFormat } = ctx.params;

          // 检查是否支持转换
          const conversionSupported = await (this as any).isConversionSupported(fromFormat, toFormat);
          if (!conversionSupported) {
            return {
              status: 400,
              data: {
                code: ResponseCode.ParamsError,
                content: null,
                message: `不支持从 ${fromFormat} 转换到 ${toFormat}`,
                success: false,
              },
            };
          }

          // 执行格式转换
          const transformedData = await (this as any).transformFormat(data, fromFormat, toFormat);

          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                originalFormat: fromFormat,
                targetFormat: toFormat,
                transformedData,
                transformedAt: Date.now(),
              },
              message: '格式转换成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Transform format failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '格式转换失败',
              success: false,
            },
          };
        }
      },
    },
  };
};

export default schema;