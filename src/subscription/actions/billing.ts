import { Context, Star } from 'node-universe';
import { ResponseCode } from '../../typings/enum';
import { HttpResponseItem } from '../../typings/response';

const billing = (star: Star) => {
  return {
    // 获取账单列表
    'billing.list': {
      metadata: {
        auth: true,
      },
      params: {
        year: { type: 'number', optional: true },
        month: { type: 'number', optional: true },
        status: { type: 'string', optional: true }, // paid, pending, overdue
        limit: { type: 'number', optional: true, default: 20 },
        offset: { type: 'number', optional: true, default: 0 },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { year, month, status, limit, offset } = ctx.params;
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
          
          const bills = await (this as any).getUserBills({
            userId,
            year,
            month,
            status,
            limit,
            offset,
          });
          
          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                bills: bills.data.map((bill: any) => ({
                  id: bill.id,
                  billNumber: bill.billNumber,
                  planName: bill.planName,
                  billingPeriod: {
                    start: bill.periodStart,
                    end: bill.periodEnd,
                  },
                  amount: bill.amount,
                  currency: bill.currency,
                  status: bill.status,
                  dueDate: bill.dueDate,
                  paidAt: bill.paidAt,
                  createdAt: bill.createdAt,
                  downloadUrl: bill.invoiceUrl,
                })),
                total: bills.total,
                limit,
                offset,
                hasMore: bills.total > offset + limit,
                summary: {
                  totalAmount: bills.summary.totalAmount,
                  paidAmount: bills.summary.paidAmount,
                  pendingAmount: bills.summary.pendingAmount,
                  overdueAmount: bills.summary.overdueAmount,
                },
              },
              message: '获取账单列表成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Get billing list failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '获取账单列表失败',
              success: false,
            },
          };
        }
      },
    },
    
    // 获取账单详情
    'billing.get': {
      metadata: {
        auth: true,
      },
      params: {
        billId: { type: 'string', required: true },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { billId } = ctx.params;
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
          
          const bill = await (this as any).getBillById(billId);
          if (!bill || bill.userId !== userId) {
            return {
              status: 404,
              data: {
                code: ResponseCode.ParamsError,
                content: null,
                message: '账单不存在',
                success: false,
              },
            };
          }
          
          // 获取账单详细项目
          const billItems = await (this as any).getBillItems(billId);
          
          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                bill: {
                  id: bill.id,
                  billNumber: bill.billNumber,
                  planName: bill.planName,
                  billingPeriod: {
                    start: bill.periodStart,
                    end: bill.periodEnd,
                  },
                  amount: bill.amount,
                  currency: bill.currency,
                  status: bill.status,
                  dueDate: bill.dueDate,
                  paidAt: bill.paidAt,
                  createdAt: bill.createdAt,
                  items: billItems.map((item: any) => ({
                    description: item.description,
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                    amount: item.amount,
                    type: item.type, // subscription, usage, addon
                  })),
                  taxes: bill.taxes || [],
                  discounts: bill.discounts || [],
                  downloadUrl: bill.invoiceUrl,
                  paymentHistory: bill.paymentHistory || [],
                },
                userInfo: {
                  name: bill.userName,
                  email: bill.userEmail,
                  company: bill.userCompany,
                  address: bill.billingAddress,
                },
              },
              message: '获取账单详情成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Get bill details failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '获取账单详情失败',
              success: false,
            },
          };
        }
      },
    },
    
    // 下载发票
    'billing.downloadInvoice': {
      metadata: {
        auth: true,
      },
      params: {
        billId: { type: 'string', required: true },
        format: { type: 'string', optional: true, default: 'pdf' }, // pdf, excel
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { billId, format } = ctx.params;
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
          
          const bill = await (this as any).getBillById(billId);
          if (!bill || bill.userId !== userId) {
            return {
              status: 404,
              data: {
                code: ResponseCode.ParamsError,
                content: null,
                message: '账单不存在',
                success: false,
              },
            };
          }
          
          // 生成发票文件
          const invoice = await (this as any).generateInvoice(bill, format);
          
          // 记录下载日志
          await (this as any).logInvoiceDownload({
            billId,
            userId,
            format,
            downloadedAt: new Date(),
          });
          
          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                downloadUrl: invoice.url,
                fileName: invoice.fileName,
                fileSize: invoice.fileSize,
                format,
                expiresAt: invoice.expiresAt, // 下载链接过期时间
              },
              message: '发票生成成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Download invoice failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '下载发票失败',
              success: false,
            },
          };
        }
      },
    },
    
    // 更新账单地址
    'billing.updateAddress': {
      metadata: {
        auth: true,
      },
      params: {
        company: { type: 'string', optional: true },
        address: { type: 'string', required: true },
        city: { type: 'string', required: true },
        state: { type: 'string', optional: true },
        zipCode: { type: 'string', required: true },
        country: { type: 'string', required: true },
        taxId: { type: 'string', optional: true },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { company, address, city, state, zipCode, country, taxId } = ctx.params;
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
          
          // 验证税号格式（如果提供）
          if (taxId && !(await (this as any).validateTaxId(taxId, country))) {
            return {
              status: 400,
              data: {
                code: ResponseCode.ParamsError,
                content: null,
                message: '税号格式不正确',
                success: false,
              },
            };
          }
          
          // 更新账单地址
          const billingAddress = await (this as any).updateUserBillingAddress(userId, {
            company,
            address,
            city,
            state,
            zipCode,
            country,
            taxId,
          });
          
          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                billingAddress: {
                  company: billingAddress.company,
                  address: billingAddress.address,
                  city: billingAddress.city,
                  state: billingAddress.state,
                  zipCode: billingAddress.zipCode,
                  country: billingAddress.country,
                  taxId: billingAddress.taxId,
                  updatedAt: billingAddress.updatedAt,
                },
              },
              message: '账单地址更新成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Update billing address failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '更新账单地址失败',
              success: false,
            },
          };
        }
      },
    },
    
    // 获取使用量账单
    'billing.usage': {
      metadata: {
        auth: true,
      },
      params: {
        year: { type: 'number', required: true },
        month: { type: 'number', required: true },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { year, month } = ctx.params;
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
          
          // 获取用户订阅信息
          const subscription = await (this as any).getUserCurrentSubscription(userId);
          if (!subscription) {
            return {
              status: 404,
              data: {
                code: ResponseCode.ParamsError,
                content: null,
                message: '用户没有有效订阅',
                success: false,
              },
            };
          }
          
          // 获取使用量数据
          const usage = await (this as any).getUserUsageForMonth(userId, year, month);
          
          // 计算费用
          const billing = await (this as any).calculateUsageBilling(subscription, usage);
          
          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                period: {
                  year,
                  month,
                  start: new Date(year, month - 1, 1),
                  end: new Date(year, month, 0),
                },
                subscription: {
                  planName: subscription.planName,
                  billingCycle: subscription.billingCycle,
                },
                usage: {
                  metrics: {
                    total: usage.metricsCount,
                    included: billing.includedMetrics,
                    overage: Math.max(0, usage.metricsCount - billing.includedMetrics),
                    rate: billing.metricsOverageRate,
                  },
                  storage: {
                    total: usage.storageGB,
                    included: billing.includedStorageGB,
                    overage: Math.max(0, usage.storageGB - billing.includedStorageGB),
                    rate: billing.storageOverageRate,
                  },
                  apiCalls: {
                    total: usage.apiCalls?.total || usage.apiCalls || 0,
                    included: billing.includedApiCalls,
                    overage: Math.max(0, (usage.apiCalls?.total || usage.apiCalls || 0) - billing.includedApiCalls),
                    rate: billing.apiCallsOverageRate,
                  },
                },
                billing: {
                  baseAmount: billing.baseAmount,
                  overageAmount: billing.overageAmount,
                  totalAmount: billing.totalAmount,
                  currency: billing.currency,
                  breakdown: billing.breakdown,
                },
                dailyUsage: usage.dailyBreakdown,
              },
              message: '获取使用量账单成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Get usage billing failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '获取使用量账单失败',
              success: false,
            },
          };
        }
      },
    },
    
    // 预估下月账单
    'billing.estimate': {
      metadata: {
        auth: true,
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
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
          
          // 获取用户订阅信息
          const subscription = await (this as any).getUserCurrentSubscription(userId);
          if (!subscription) {
            return {
              status: 404,
              data: {
                code: ResponseCode.ParamsError,
                content: null,
                message: '用户没有有效订阅',
                success: false,
              },
            };
          }
          
          // 获取当前月使用量
          const currentUsage = await (this as any).getCurrentMonthUsage(userId);
          
          // 预估下月使用量
          const estimatedUsage = await (this as any).estimateNextMonthUsage(userId, currentUsage);
          
          // 计算预估费用
          const estimatedBilling = await (this as any).calculateUsageBilling(subscription, estimatedUsage);
          
          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                subscription: {
                  planName: subscription.planName,
                  baseAmount: estimatedBilling.baseAmount,
                },
                estimatedUsage: {
                  metrics: estimatedUsage.metricsCount,
                  storage: estimatedUsage.storageGB,
                  apiCalls: estimatedUsage.apiCalls?.total || estimatedUsage.apiCalls || 0,
                },
                estimatedBilling: {
                  baseAmount: estimatedBilling.baseAmount,
                  overageAmount: estimatedBilling.overageAmount,
                  totalAmount: estimatedBilling.totalAmount,
                  currency: estimatedBilling.currency,
                  breakdown: estimatedBilling.breakdown,
                },
                currentUsage: {
                  metrics: currentUsage.metricsCount,
                  storage: currentUsage.storageGB,
                  apiCalls: currentUsage.apiCalls?.total || currentUsage.apiCalls || 0,
                  progressPercent: currentUsage.progressPercent,
                },
                recommendations: await (this as any).getBillingRecommendations(userId, estimatedBilling),
              },
              message: '获取账单预估成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Get billing estimate failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '获取账单预估失败',
              success: false,
            },
          };
        }
      },
    },
    
    // 设置账单提醒
    'billing.setReminder': {
      metadata: {
        auth: true,
      },
      params: {
        enabled: { type: 'boolean', required: true },
        daysBefore: { type: 'number', optional: true, default: 3 },
        email: { type: 'boolean', optional: true, default: true },
        sms: { type: 'boolean', optional: true, default: false },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { enabled, daysBefore, email, sms } = ctx.params;
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
          
          // 更新提醒设置
          const reminder = await (this as any).updateBillingReminder(userId, {
            enabled,
            daysBefore,
            email,
            sms,
          });
          
          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                reminder: {
                  enabled: reminder.enabled,
                  daysBefore: reminder.daysBefore,
                  email: reminder.email,
                  sms: reminder.sms,
                  updatedAt: reminder.updatedAt,
                },
              },
              message: '账单提醒设置更新成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Set billing reminder failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '设置账单提醒失败',
              success: false,
            },
          };
        }
      },
    },
  };
};

export default billing;