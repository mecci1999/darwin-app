/**
 * 日志导出接口
 */
import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, HttpStatusCode, Starlight } from 'typings';
import { convertToCSV, convertToJSON } from '../utils/log-utils';
import { isAdminContext, isDarwinLogRequest, resolveLogTenantId } from '../utils/access-control';

export default function exportLogs(star: Starlight) {
  return {
    'v1.export': {
      metadata: {
        auth: true,
        roles: ['admin', 'user'],
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const {
            format = 'json',
            query,
            service,
            level,
            source,
            hostname,
            containerId,
            startTime,
            endTime,
            limit = 1000,
            originType,
          } = ctx.params;

          const tenantId = resolveLogTenantId(ctx, originType);
          const apiKey = (ctx.meta as any)?.apiKey?.id || ctx.params.apiKey;

          if (isDarwinLogRequest(originType) && !isAdminContext(ctx)) {
            return {
              status: HttpStatusCode.FORBIDDEN,
              data: {
                content: null,
                message: 'Only administrators can access Darwin logs',
                code: HttpResponseCode.NoPermissionError,
                success: false,
              },
            };
          }

          if (!tenantId) {
            return {
              status: HttpStatusCode.BAD_REQUEST,
              data: {
                content: null,
                message: 'tenantId is required',
                code: HttpResponseCode.ParamsError,
                success: false,
              },
            };
          }

          // 限制导出数量
          const maxLimit = 10000;
          const validatedLimit = Math.min(limit, maxLimit);

          // 调用搜索方法获取日志数据
          const searchResult = await ctx.call('logs.v1.search', {
            tenantId,
            apiKey,
            query,
            service,
            level,
            source,
            hostname,
            containerId,
            startTime,
            endTime,
            originType,
            limit: validatedLimit,
          });

          if (!searchResult?.data?.success) {
            return {
              status: 400,
              data: {
                content: null,
                message: '日志搜索失败',
                code: HttpResponseCode.ServiceActionFaild,
                success: false,
              },
            };
          }

          const logs = searchResult.data?.content?.logs || [];

          // 过滤租户数据（多租户隔离）
          const filteredLogs = logs.filter((log: any) => log.tenantId === tenantId);

          // 根据格式处理数据
          let exportData: string;
          let contentType: string;
          let filename: string;

          if (format === 'csv') {
            exportData = convertToCSV(filteredLogs);
            contentType = 'text/csv';
            filename = `logs_export_${Date.now()}.csv`;
          } else {
            exportData = convertToJSON(filteredLogs);
            contentType = 'application/json';
            filename = `logs_export_${Date.now()}.json`;
          }

          // 设置响应头
          if (ctx.meta) {
            (ctx.meta as any).$responseHeaders = {
              'Content-Type': contentType,
              'Content-Disposition': `attachment; filename="${filename}"`,
              'Content-Length': Buffer.byteLength(exportData, 'utf8').toString(),
            };
          }

          // 记录导出日志
          star.logger?.info('日志导出完成', {
            tenantId,
            format,
            count: filteredLogs.length,
            originalCount: logs.length,
            query,
            service,
          });

          // 返回导出数据
          return {
            status: HttpStatusCode.OK,
            data: {
              content: {
                exportData,
                meta: {
                  format,
                  count: filteredLogs.length,
                  filename,
                  exportedAt: new Date().toISOString(),
                  query: {
                    service,
                    timeRange: {
                      start: startTime,
                      end: endTime,
                    },
                    searchQuery: query,
                  },
                },
                filename,
                downloadUrl: `data:${contentType};charset=utf-8,${encodeURIComponent(exportData)}`,
              },
              message: '日志导出成功',
              code: HttpResponseCode.Success,
              success: true,
            },
          };
        } catch (error: any) {
          star.logger?.error('日志导出失败', {
            error: error.message,
            tenantId: ctx.params.tenantId,
            exportParams: {
              format: ctx.params.format,
              query: ctx.params.query,
              service: ctx.params.service,
              limit: ctx.params.limit,
            },
          });

          return {
            status: HttpStatusCode.INTERNAL_SERVER_ERROR,
            data: {
              content: null,
              message: `日志导出失败: ${error.message}`,
              code: HttpResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        }
      },
    },
  };
}
