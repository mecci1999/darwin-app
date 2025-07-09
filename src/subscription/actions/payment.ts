import { Context, Star } from 'node-universe';
import { ResponseCode } from '../../typings/enum';
import { HttpResponseItem } from '../../typings/response';

const payment = (star: Star) => {
  return {
    // 创建支付订单
    'payment.createOrder': {
      metadata: {
        auth: true,
      },
      params: {
        planName: { type: 'string', required: true },
        billingCycle: { type: 'string', optional: true, default: 'monthly' },
        paymentMethod: { type: 'string', required: true }, // alipay, wechatpay
        promoCode: { type: 'string', optional: true },
        returnUrl: { type: 'string', optional: true },
        notifyUrl: { type: 'string', optional: true },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { planName, billingCycle, paymentMethod, promoCode, returnUrl, notifyUrl } = ctx.params;
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
          
          // 检查计划是否存在
          const plan = await (this as any).getPlanByName(planName);
          if (!plan) {
            return {
              status: 404,
              data: {
                code: ResponseCode.ParamsError,
                content: null,
                message: '订阅计划不存在',
                success: false,
              },
            };
          }
          
          // 检查支付方式是否支持
          const paymentProvider = await (this as any).getPaymentProvider(paymentMethod);
          if (!paymentProvider || !paymentProvider.enabled) {
            return {
              status: 400,
              data: {
                code: ResponseCode.ParamsError,
                content: null,
                message: '不支持的支付方式',
                success: false,
              },
            };
          }
          
          // 计算订单金额
          const pricing = await (this as any).calculatePlanPricing({
            plan,
            billingCycle,
            promoCode,
          });
          
          // 创建支付订单
          const order = await (this as any).createPaymentOrder({
            userId,
            planName,
            billingCycle,
            paymentMethod,
            pricing,
            returnUrl: returnUrl || `${process.env.FRONTEND_URL}/subscription/success`,
            notifyUrl: notifyUrl || `${process.env.API_URL}/subscription/payment/notify`,
          });
          
          // 生成支付链接
          const paymentUrl = await (this as any).generatePaymentUrl(order, paymentProvider);
          
          return {
            status: 201,
            data: {
              code: ResponseCode.Success,
              content: {
                orderId: order.id,
                orderNumber: order.orderNumber,
                planName,
                billingCycle,
                pricing,
                paymentMethod,
                paymentUrl,
                qrCode: paymentMethod === 'alipay' || paymentMethod === 'wechatpay' ? 
                       await (this as any).generateQRCode(paymentUrl) : null,
                expiresAt: order.expiresAt,
                status: order.status,
              },
              message: '支付订单创建成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Create payment order failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '创建支付订单失败',
              success: false,
            },
          };
        }
      },
    },
    
    // 查询支付订单状态
    'payment.queryOrder': {
      metadata: {
        auth: true,
      },
      params: {
        orderId: { type: 'string', required: true },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { orderId } = ctx.params;
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
          
          // 查询订单
          const order = await (this as any).getPaymentOrderById(orderId);
          if (!order || order.userId !== userId) {
            return {
              status: 404,
              data: {
                code: ResponseCode.ParamsError,
                content: null,
                message: '支付订单不存在',
                success: false,
              },
            };
          }
          
          // 如果订单状态为pending，查询第三方支付状态
          if (order.status === 'pending') {
            const paymentStatus = await (this as any).queryThirdPartyPaymentStatus(order);
            if (paymentStatus.status !== order.status) {
              // 更新订单状态
              await (this as any).updatePaymentOrderStatus(orderId, paymentStatus);
              order.status = paymentStatus.status;
              order.paidAt = paymentStatus.paidAt;
              order.transactionId = paymentStatus.transactionId;
            }
          }
          
          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                order: {
                  id: order.id,
                  orderNumber: order.orderNumber,
                  planName: order.planName,
                  amount: order.amount,
                  currency: order.currency,
                  status: order.status,
                  paymentMethod: order.paymentMethod,
                  createdAt: order.createdAt,
                  paidAt: order.paidAt,
                  expiresAt: order.expiresAt,
                  transactionId: order.transactionId,
                },
                statusDescription: (this as any).getOrderStatusDescription(order.status),
                nextAction: (this as any).getOrderNextAction(order),
              },
              message: '查询支付订单成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Query payment order failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '查询支付订单失败',
              success: false,
            },
          };
        }
      },
    },
    
    // 取消支付订单
    'payment.cancelOrder': {
      metadata: {
        auth: true,
      },
      params: {
        orderId: { type: 'string', required: true },
        reason: { type: 'string', optional: true },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { orderId, reason } = ctx.params;
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
          
          // 查询订单
          const order = await (this as any).getPaymentOrderById(orderId);
          if (!order || order.userId !== userId) {
            return {
              status: 404,
              data: {
                code: ResponseCode.ParamsError,
                content: null,
                message: '支付订单不存在',
                success: false,
              },
            };
          }
          
          // 检查订单是否可以取消
          if (!['pending', 'created'].includes(order.status)) {
            return {
              status: 400,
              data: {
                code: ResponseCode.ParamsError,
                content: {
                  currentStatus: order.status,
                },
                message: '订单状态不允许取消',
                success: false,
              },
            };
          }
          
          // 取消订单
          await (this as any).cancelPaymentOrder(orderId, reason);
          
          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                orderId,
                status: 'cancelled',
                cancelledAt: new Date(),
                reason,
              },
              message: '支付订单取消成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Cancel payment order failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '取消支付订单失败',
              success: false,
            },
          };
        }
      },
    },
    
    // 支付回调处理
    'payment.notify': {
      params: {
        provider: { type: 'string', required: true }, // alipay, wechatpay
        data: { type: 'object', required: true },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { provider, data } = ctx.params;
          
          // 验证回调签名
          const isValid = await (this as any).verifyPaymentNotification(provider, data);
          if (!isValid) {
            star.logger?.warn('Invalid payment notification:', { provider, data });
            return {
              status: 400,
              data: {
                code: ResponseCode.ParamsError,
                content: null,
                message: '无效的支付回调',
                success: false,
              },
            };
          }
          
          // 解析回调数据
          const notificationData = await (this as any).parsePaymentNotification(provider, data);
          
          // 查找对应的订单
          const order = await (this as any).getPaymentOrderByNumber(notificationData.orderNumber);
          if (!order) {
            star.logger?.warn('Payment order not found:', notificationData.orderNumber);
            return {
              status: 404,
              data: {
                code: ResponseCode.ParamsError,
                content: null,
                message: '支付订单不存在',
                success: false,
              },
            };
          }
          
          // 检查订单状态
          if (order.status !== 'pending') {
            star.logger?.info('Order already processed:', order.id);
            return {
              status: 200,
              data: {
                code: ResponseCode.Success,
                content: { processed: true },
                message: '订单已处理',
                success: true,
              },
            };
          }
          
          // 处理支付成功
          if (notificationData.status === 'success') {
            await (this as any).processPaymentSuccess({
              orderId: order.id,
              transactionId: notificationData.transactionId,
              paidAmount: notificationData.amount,
              paidAt: notificationData.paidAt,
            });
            
            // 发送支付成功事件
            await star.emit('payment.success', {
              userId: order.userId,
              orderId: order.id,
              planName: order.planName,
              amount: order.amount,
              currency: order.currency,
            });
          } else if (notificationData.status === 'failed') {
            // 处理支付失败
            await (this as any).processPaymentFailure({
              orderId: order.id,
              failureReason: notificationData.failureReason,
            });
          }
          
          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                orderId: order.id,
                status: notificationData.status,
                processed: true,
              },
              message: '支付回调处理成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Process payment notification failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '支付回调处理失败',
              success: false,
            },
          };
        }
      },
    },
    
    // 申请退款
    'payment.refund': {
      metadata: {
        auth: true,
      },
      params: {
        orderId: { type: 'string', required: true },
        amount: { type: 'number', optional: true }, // 部分退款金额
        reason: { type: 'string', required: true },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { orderId, amount, reason } = ctx.params;
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
          
          // 查询订单
          const order = await (this as any).getPaymentOrderById(orderId);
          if (!order || order.userId !== userId) {
            return {
              status: 404,
              data: {
                code: ResponseCode.ParamsError,
                content: null,
                message: '支付订单不存在',
                success: false,
              },
            };
          }
          
          // 检查订单是否可以退款
          if (order.status !== 'paid') {
            return {
              status: 400,
              data: {
                code: ResponseCode.ParamsError,
                content: {
                  currentStatus: order.status,
                },
                message: '订单状态不允许退款',
                success: false,
              },
            };
          }
          
          // 检查退款金额
          const refundAmount = amount || order.amount;
          if (refundAmount > order.amount) {
            return {
              status: 400,
              data: {
                code: ResponseCode.ParamsError,
                content: null,
                message: '退款金额不能超过订单金额',
                success: false,
              },
            };
          }
          
          // 检查退款政策
          const refundPolicy = await (this as any).checkRefundPolicy(order);
          if (!refundPolicy.allowed) {
            return {
              status: 400,
              data: {
                code: ResponseCode.ParamsError,
                content: {
                  policy: refundPolicy,
                },
                message: refundPolicy.reason,
                success: false,
              },
            };
          }
          
          // 创建退款申请
          const refund = await (this as any).createRefundRequest({
            orderId,
            userId,
            amount: refundAmount,
            reason,
            refundPolicy,
          });
          
          // 如果符合自动退款条件，直接处理
          if (refundPolicy.autoApprove) {
            const refundResult = await (this as any).processRefund(refund.id);
            
            return {
              status: 200,
              data: {
                code: ResponseCode.Success,
                content: {
                  refundId: refund.id,
                  status: 'approved',
                  amount: refundAmount,
                  currency: order.currency,
                  processTime: '3-5个工作日',
                  refundResult,
                },
                message: '退款申请已自动批准并处理',
                success: true,
              },
            };
          }
          
          return {
            status: 201,
            data: {
              code: ResponseCode.Success,
              content: {
                refundId: refund.id,
                status: 'pending',
                amount: refundAmount,
                currency: order.currency,
                reason,
                estimatedProcessTime: '1-3个工作日',
              },
              message: '退款申请提交成功，等待审核',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Create refund request failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '申请退款失败',
              success: false,
            },
          };
        }
      },
    },
    
    // 获取支付方式列表
    'payment.methods': {
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const paymentMethods = await (this as any).getAvailablePaymentMethods();
          
          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                methods: paymentMethods.map((method: any) => ({
                  id: method.id,
                  name: method.name,
                  displayName: method.displayName,
                  icon: method.icon,
                  enabled: method.enabled,
                  supportedCurrencies: method.supportedCurrencies,
                  fees: method.fees,
                  description: method.description,
                })),
                total: paymentMethods.length,
              },
              message: '获取支付方式成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Get payment methods failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '获取支付方式失败',
              success: false,
            },
          };
        }
      },
    },
    
    // 获取用户支付历史
    'payment.history': {
      metadata: {
        auth: true,
      },
      params: {
        status: { type: 'string', optional: true }, // paid, pending, cancelled, failed
        limit: { type: 'number', optional: true, default: 20 },
        offset: { type: 'number', optional: true, default: 0 },
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { status, limit, offset } = ctx.params;
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
          
          const payments = await (this as any).getUserPaymentHistory({
            userId,
            status,
            limit,
            offset,
          });
          
          return {
            status: 200,
            data: {
              code: ResponseCode.Success,
              content: {
                payments: payments.data.map((payment: any) => ({
                  id: payment.id,
                  orderNumber: payment.orderNumber,
                  planName: payment.planName,
                  amount: payment.amount,
                  currency: payment.currency,
                  status: payment.status,
                  paymentMethod: payment.paymentMethod,
                  createdAt: payment.createdAt,
                  paidAt: payment.paidAt,
                  description: payment.description,
                })),
                total: payments.total,
                limit,
                offset,
                hasMore: payments.total > offset + limit,
              },
              message: '获取支付历史成功',
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('Get payment history failed:', error);
          return {
            status: 500,
            data: {
              code: ResponseCode.ServiceActionFaild,
              content: null,
              message: '获取支付历史失败',
              success: false,
            },
          };
        }
      },
    },
  };
};

export default payment;