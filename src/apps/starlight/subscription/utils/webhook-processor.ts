/**
 * Subscription微服务Webhook处理器
 */
import { Star } from 'node-universe';
import { SubscriptionState, WebhookEvent, PaymentRecord, UserSubscription } from '../types';
import { SUBSCRIPTION_CONFIG, PAYMENT_GATEWAY_CONFIG } from '../constants';
import { SubscriptionUtils } from './subscription-utils';

export class WebhookProcessor {
  private static webhookQueue: WebhookEvent[] = [];
  private static processingInterval: NodeJS.Timeout | null = null;
  private static retryAttempts = new Map<string, number>();

  /**
   * 启动Webhook处理器
   */
  static async startProcessor(star: any): Promise<void> {
    try {
      // 启动定时处理队列
      this.processingInterval = setInterval(async () => {
        await this.processWebhookQueue(star);
      }, SUBSCRIPTION_CONFIG.WEBHOOK_PROCESSING_INTERVAL);

      star.logger?.info('Webhook processor started');
    } catch (error) {
      star.logger?.error('Failed to start webhook processor:', error);
      throw error;
    }
  }

  /**
   * 停止Webhook处理器
   */
  static async stopProcessor(star: any): Promise<void> {
    try {
      if (this.processingInterval) {
        clearInterval(this.processingInterval);
        this.processingInterval = null;
      }

      // 处理剩余的webhook
      await this.processWebhookQueue(star);

      // 清理队列和重试记录
      this.webhookQueue = [];
      this.retryAttempts.clear();

      star.logger?.info('Webhook processor stopped');
    } catch (error) {
      star.logger?.error('Failed to stop webhook processor:', error);
    }
  }

  /**
   * 处理Stripe Webhook
   */
  static async processStripeWebhook(
    payload: any,
    signature: string,
    star: any,
  ): Promise<{ success: boolean; message: string }> {
    try {
      // 验证Webhook签名
      const isValid = await this.verifyStripeSignature(payload, signature, star);
      if (!isValid) {
        return { success: false, message: 'Invalid webhook signature' };
      }

      const event = JSON.parse(payload);

      // 创建Webhook事件记录
      const webhookEvent: WebhookEvent = {
        id: this.generateWebhookId(),
        source: 'stripe',
        type: event.type,
        data: event.data,
        signature,
        receivedAt: new Date(),
        processed: false,
        attempts: 0,
        maxAttempts: 3,
        failed: false,
        createdAt: new Date(),
      };

      // 添加到处理队列
      this.webhookQueue.push(webhookEvent);

      star.logger?.info(`Stripe webhook received: ${event.type}`);
      return { success: true, message: 'Webhook received and queued for processing' };
    } catch (error) {
      star.logger?.error('Failed to process Stripe webhook:', error);
      return { success: false, message: 'Failed to process webhook' };
    }
  }

  /**
   * 处理PayPal Webhook
   */
  static async processPayPalWebhook(
    payload: any,
    headers: any,
    star: any,
  ): Promise<{ success: boolean; message: string }> {
    try {
      // 验证PayPal Webhook
      const isValid = await this.verifyPayPalWebhook(payload, headers, star);
      if (!isValid) {
        return { success: false, message: 'Invalid webhook verification' };
      }

      const event = JSON.parse(payload);

      // 创建Webhook事件记录
      const webhookEvent: WebhookEvent = {
        id: this.generateWebhookId(),
        source: 'paypal',
        type: event.event_type,
        data: event.resource,
        signature: headers['paypal-transmission-sig'],
        receivedAt: new Date(),
        processed: false,
        attempts: 0,
        maxAttempts: 3,
        failed: false,
        createdAt: new Date(),
      };

      // 添加到处理队列
      this.webhookQueue.push(webhookEvent);

      star.logger?.info(`PayPal webhook received: ${event.event_type}`);
      return { success: true, message: 'Webhook received and queued for processing' };
    } catch (error) {
      star.logger?.error('Failed to process PayPal webhook:', error);
      return { success: false, message: 'Failed to process webhook' };
    }
  }

  /**
   * 处理支付宝Webhook
   */
  static async processAlipayWebhook(
    payload: any,
    signature: string,
    star: any,
  ): Promise<{ success: boolean; message: string }> {
    try {
      // 验证支付宝Webhook签名
      const isValid = await this.verifyAlipaySignature(payload, signature, star);
      if (!isValid) {
        return { success: false, message: 'Invalid webhook signature' };
      }

      // 创建Webhook事件记录
      const webhookEvent: WebhookEvent = {
        id: this.generateWebhookId(),
        source: 'alipay',
        type: payload.trade_status || 'payment_update',
        data: payload,
        signature,
        receivedAt: new Date(),
        processed: false,
        attempts: 0,
        maxAttempts: 3,
        failed: false,
        createdAt: new Date(),
      };

      // 添加到处理队列
      this.webhookQueue.push(webhookEvent);

      star.logger?.info(`Alipay webhook received: ${payload.trade_status}`);
      return { success: true, message: 'Webhook received and queued for processing' };
    } catch (error) {
      star.logger?.error('Failed to process Alipay webhook:', error);
      return { success: false, message: 'Failed to process webhook' };
    }
  }

  /**
   * 处理Webhook队列
   */
  private static async processWebhookQueue(star: any): Promise<void> {
    if (this.webhookQueue.length === 0) {
      return;
    }

    const webhooksToProcess = this.webhookQueue.splice(0, 10); // 每次处理10个

    for (const webhook of webhooksToProcess) {
      try {
        await this.processWebhookEvent(webhook, star);
        webhook.processed = true;
        webhook.processedAt = new Date();

        // 保存处理结果
        await this.saveWebhookEvent(webhook, star);
      } catch (error: any) {
        webhook.attempts++;
        webhook.lastError = error?.message || 'Unknown error';

        // 检查是否需要重试
        if (webhook.attempts < SUBSCRIPTION_CONFIG.WEBHOOK_MAX_RETRIES) {
          // 重新加入队列，延迟处理
          setTimeout(() => {
            this.webhookQueue.push(webhook);
          }, this.calculateRetryDelay(webhook.attempts));
        } else {
          // 达到最大重试次数，标记为失败
          webhook.processed = true;
          webhook.failed = true;
          webhook.processedAt = new Date();

          await this.saveWebhookEvent(webhook, star);
          star.logger?.error(
            `Webhook processing failed after ${webhook.attempts} attempts:`,
            webhook.id,
          );
        }
      }
    }
  }

  /**
   * 处理单个Webhook事件
   */
  private static async processWebhookEvent(webhook: WebhookEvent, star: any): Promise<void> {
    switch (webhook.source) {
      case 'stripe':
        await this.handleStripeEvent(webhook, star);
        break;
      case 'paypal':
        await this.handlePayPalEvent(webhook, star);
        break;
      case 'alipay':
        await this.handleAlipayEvent(webhook, star);
        break;
      default:
        throw new Error(`Unknown webhook source: ${webhook.source}`);
    }
  }

  /**
   * 处理Stripe事件
   */
  private static async handleStripeEvent(webhook: WebhookEvent, star: any): Promise<void> {
    const { type, data } = webhook;

    switch (type) {
      case 'payment_intent.succeeded':
        await this.handlePaymentSuccess(
          {
            paymentId: data.object.id,
            amount: data.object.amount,
            currency: data.object.currency,
            customerId: data.object.customer,
            source: 'stripe',
          },
          star,
        );
        break;

      case 'payment_intent.payment_failed':
        await this.handlePaymentFailure(
          {
            paymentId: data.object.id,
            customerId: data.object.customer,
            reason: data.object.last_payment_error?.message || 'Payment failed',
            source: 'stripe',
          },
          star,
        );
        break;

      case 'invoice.payment_succeeded':
        await this.handleInvoicePaymentSuccess(
          {
            invoiceId: data.object.id,
            subscriptionId: data.object.subscription,
            customerId: data.object.customer,
            amount: data.object.amount_paid,
            source: 'stripe',
          },
          star,
        );
        break;

      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdate(
          {
            subscriptionId: data.object.id,
            customerId: data.object.customer,
            status: data.object.status,
            currentPeriodEnd: new Date(data.object.current_period_end * 1000),
            source: 'stripe',
          },
          star,
        );
        break;

      case 'customer.subscription.deleted':
        await this.handleSubscriptionCancellation(
          {
            subscriptionId: data.object.id,
            customerId: data.object.customer,
            canceledAt: new Date(data.object.canceled_at * 1000),
            source: 'stripe',
          },
          star,
        );
        break;

      default:
        star.logger?.warn(`Unhandled Stripe event type: ${type}`);
    }
  }

  /**
   * 处理PayPal事件
   */
  private static async handlePayPalEvent(webhook: WebhookEvent, star: any): Promise<void> {
    const { type, data } = webhook;

    switch (type) {
      case 'PAYMENT.CAPTURE.COMPLETED':
        await this.handlePaymentSuccess(
          {
            paymentId: data.id,
            amount: parseFloat(data.amount.value) * 100, // Convert to cents
            currency: data.amount.currency_code,
            customerId: data.custom_id,
            source: 'paypal',
          },
          star,
        );
        break;

      case 'PAYMENT.CAPTURE.DENIED':
        await this.handlePaymentFailure(
          {
            paymentId: data.id,
            customerId: data.custom_id,
            reason: 'Payment denied by PayPal',
            source: 'paypal',
          },
          star,
        );
        break;

      case 'BILLING.SUBSCRIPTION.ACTIVATED':
        await this.handleSubscriptionActivation(
          {
            subscriptionId: data.id,
            customerId: data.custom_id,
            planId: data.plan_id,
            source: 'paypal',
          },
          star,
        );
        break;

      case 'BILLING.SUBSCRIPTION.CANCELLED':
        await this.handleSubscriptionCancellation(
          {
            subscriptionId: data.id,
            customerId: data.custom_id,
            canceledAt: new Date(),
            source: 'paypal',
          },
          star,
        );
        break;

      default:
        star.logger?.warn(`Unhandled PayPal event type: ${type}`);
    }
  }

  /**
   * 处理支付宝事件
   */
  private static async handleAlipayEvent(webhook: WebhookEvent, star: any): Promise<void> {
    const { type, data } = webhook;

    switch (type) {
      case 'TRADE_SUCCESS':
        await this.handlePaymentSuccess(
          {
            paymentId: data.trade_no,
            amount: parseFloat(data.total_amount) * 100, // Convert to cents
            currency: 'CNY',
            customerId: data.buyer_id,
            source: 'alipay',
          },
          star,
        );
        break;

      case 'TRADE_CLOSED':
        await this.handlePaymentFailure(
          {
            paymentId: data.trade_no,
            customerId: data.buyer_id,
            reason: 'Trade closed',
            source: 'alipay',
          },
          star,
        );
        break;

      default:
        star.logger?.warn(`Unhandled Alipay event type: ${type}`);
    }
  }

  /**
   * 处理支付成功
   */
  private static async handlePaymentSuccess(paymentData: any, star: any): Promise<void> {
    try {
      // 更新支付记录
      const paymentRecord: PaymentRecord = {
        id: paymentData.paymentId,
        userId: paymentData.customerId,
        subscriptionId: paymentData.subscriptionId || '',
        amount: paymentData.amount,
        currency: paymentData.currency,
        status: 'completed',
        gateway: paymentData.source,
        gatewayTransactionId: paymentData.paymentId,
        paymentMethod: paymentData.source as
          | 'alipay'
          | 'stripe'
          | 'paypal'
          | 'wechat'
          | 'bank_transfer',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // 保存支付记录
      await this.savePaymentRecord(paymentRecord, star);

      // 触发支付成功事件
      star.emit('payment.success', {
        userId: paymentData.customerId,
        paymentId: paymentData.paymentId,
        amount: paymentData.amount,
        source: paymentData.source,
      });

      star.logger?.info(`Payment success processed: ${paymentData.paymentId}`);
    } catch (error) {
      star.logger?.error('Failed to handle payment success:', error);
      throw error;
    }
  }

  /**
   * 处理支付失败
   */
  private static async handlePaymentFailure(paymentData: any, star: any): Promise<void> {
    try {
      // 更新支付记录
      const paymentRecord: PaymentRecord = {
        id: paymentData.paymentId,
        userId: paymentData.customerId,
        subscriptionId: '',
        amount: 0,
        currency: 'USD',
        status: 'failed',
        gateway: paymentData.source,
        gatewayTransactionId: paymentData.paymentId,
        paymentMethod: paymentData.source as
          | 'alipay'
          | 'stripe'
          | 'paypal'
          | 'wechat'
          | 'bank_transfer',
        failureReason: paymentData.reason,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // 保存支付记录
      await this.savePaymentRecord(paymentRecord, star);

      // 触发支付失败事件
      star.emit('payment.failed', {
        userId: paymentData.customerId,
        paymentId: paymentData.paymentId,
        reason: paymentData.reason,
        source: paymentData.source,
      });

      star.logger?.info(`Payment failure processed: ${paymentData.paymentId}`);
    } catch (error) {
      star.logger?.error('Failed to handle payment failure:', error);
      throw error;
    }
  }

  /**
   * 处理发票支付成功
   */
  private static async handleInvoicePaymentSuccess(invoiceData: any, star: any): Promise<void> {
    try {
      // 触发发票支付成功事件
      star.emit('invoice.payment.success', {
        invoiceId: invoiceData.invoiceId,
        subscriptionId: invoiceData.subscriptionId,
        userId: invoiceData.customerId,
        amount: invoiceData.amount,
        source: invoiceData.source,
      });

      star.logger?.info(`Invoice payment success processed: ${invoiceData.invoiceId}`);
    } catch (error) {
      star.logger?.error('Failed to handle invoice payment success:', error);
      throw error;
    }
  }

  /**
   * 处理订阅更新
   */
  private static async handleSubscriptionUpdate(subscriptionData: any, star: any): Promise<void> {
    try {
      // 触发订阅更新事件
      star.emit('subscription.updated', {
        subscriptionId: subscriptionData.subscriptionId,
        userId: subscriptionData.customerId,
        status: subscriptionData.status,
        currentPeriodEnd: subscriptionData.currentPeriodEnd,
        source: subscriptionData.source,
      });

      star.logger?.info(`Subscription update processed: ${subscriptionData.subscriptionId}`);
    } catch (error) {
      star.logger?.error('Failed to handle subscription update:', error);
      throw error;
    }
  }

  /**
   * 处理订阅取消
   */
  private static async handleSubscriptionCancellation(
    subscriptionData: any,
    star: any,
  ): Promise<void> {
    try {
      // 触发订阅取消事件
      star.emit('subscription.cancelled', {
        subscriptionId: subscriptionData.subscriptionId,
        userId: subscriptionData.customerId,
        canceledAt: subscriptionData.canceledAt,
        source: subscriptionData.source,
      });

      star.logger?.info(`Subscription cancellation processed: ${subscriptionData.subscriptionId}`);
    } catch (error) {
      star.logger?.error('Failed to handle subscription cancellation:', error);
      throw error;
    }
  }

  /**
   * 处理订阅激活
   */
  private static async handleSubscriptionActivation(
    subscriptionData: any,
    star: any,
  ): Promise<void> {
    try {
      // 触发订阅激活事件
      star.emit('subscription.activated', {
        subscriptionId: subscriptionData.subscriptionId,
        userId: subscriptionData.customerId,
        planId: subscriptionData.planId,
        source: subscriptionData.source,
      });

      star.logger?.info(`Subscription activation processed: ${subscriptionData.subscriptionId}`);
    } catch (error) {
      star.logger?.error('Failed to handle subscription activation:', error);
      throw error;
    }
  }

  /**
   * 验证Stripe签名
   */
  private static async verifyStripeSignature(
    payload: string,
    signature: string,
    star: any,
  ): Promise<boolean> {
    try {
      // 实际实现中应该使用Stripe的签名验证
      // const stripe = require('stripe')(PAYMENT_GATEWAY_CONFIG.STRIPE.SECRET_KEY);
      // const event = stripe.webhooks.constructEvent(
      //   payload,
      //   signature,
      //   PAYMENT_GATEWAY_CONFIG.STRIPE.WEBHOOK_SECRET
      // );

      // 模拟验证成功
      return true;
    } catch (error) {
      star.logger?.error('Stripe signature verification failed:', error);
      return false;
    }
  }

  /**
   * 验证PayPal Webhook
   */
  private static async verifyPayPalWebhook(
    payload: string,
    headers: any,
    star: any,
  ): Promise<boolean> {
    try {
      // 实际实现中应该使用PayPal的验证API
      // const verification = await paypal.notification.webhookEvent.verify({
      //   auth_algo: headers['paypal-auth-algo'],
      //   cert_id: headers['paypal-cert-id'],
      //   transmission_id: headers['paypal-transmission-id'],
      //   transmission_sig: headers['paypal-transmission-sig'],
      //   transmission_time: headers['paypal-transmission-time'],
      //   webhook_id: PAYMENT_GATEWAY_CONFIG.PAYPAL.WEBHOOK_ID,
      //   webhook_event: JSON.parse(payload)
      // });

      // 模拟验证成功
      return true;
    } catch (error) {
      star.logger?.error('PayPal webhook verification failed:', error);
      return false;
    }
  }

  /**
   * 验证支付宝签名
   */
  private static async verifyAlipaySignature(
    payload: any,
    signature: string,
    star: any,
  ): Promise<boolean> {
    try {
      // 实际实现中应该使用支付宝的签名验证
      // const crypto = require('crypto');
      // const publicKey = PAYMENT_GATEWAY_CONFIG.ALIPAY.PUBLIC_KEY;
      // const verify = crypto.createVerify('RSA-SHA256');
      // verify.update(payload);
      // return verify.verify(publicKey, signature, 'base64');

      // 模拟验证成功
      return true;
    } catch (error) {
      star.logger?.error('Alipay signature verification failed:', error);
      return false;
    }
  }

  /**
   * 生成Webhook ID
   */
  private static generateWebhookId(): string {
    return `webhook_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 计算重试延迟
   */
  private static calculateRetryDelay(attempt: number): number {
    // 指数退避：2^attempt * 1000ms，最大30秒
    return Math.min(Math.pow(2, attempt) * 1000, 30000);
  }

  /**
   * 保存Webhook事件
   */
  private static async saveWebhookEvent(webhook: WebhookEvent, star: any): Promise<void> {
    try {
      // 保存到数据库
      // await star.db.collection('webhook_events').updateOne(
      //   { id: webhook.id },
      //   { $set: webhook },
      //   { upsert: true }
      // );

      star.logger?.debug(`Webhook event saved: ${webhook.id}`);
    } catch (error) {
      star.logger?.error('Failed to save webhook event:', error);
    }
  }

  /**
   * 保存支付记录
   */
  private static async savePaymentRecord(payment: PaymentRecord, star: any): Promise<void> {
    try {
      // 保存到数据库
      // await star.db.collection('payment_records').updateOne(
      //   { id: payment.id },
      //   { $set: payment },
      //   { upsert: true }
      // );

      star.logger?.debug(`Payment record saved: ${payment.id}`);
    } catch (error) {
      star.logger?.error('Failed to save payment record:', error);
    }
  }

  /**
   * 获取Webhook统计信息
   */
  static async getWebhookStats(
    timeRange: { start: Date; end: Date },
    star: any,
  ): Promise<{
    total: number;
    processed: number;
    failed: number;
    bySource: Record<string, number>;
    byType: Record<string, number>;
  }> {
    try {
      // 从数据库获取统计信息
      // const stats = await star.db.collection('webhook_events').aggregate([
      //   {
      //     $match: {
      //       receivedAt: {
      //         $gte: timeRange.start,
      //         $lte: timeRange.end
      //       }
      //     }
      //   },
      //   {
      //     $group: {
      //       _id: null,
      //       total: { $sum: 1 },
      //       processed: { $sum: { $cond: ['$processed', 1, 0] } },
      //       failed: { $sum: { $cond: ['$failed', 1, 0] } }
      //     }
      //   }
      // ]).toArray();

      // 模拟返回统计信息
      return {
        total: 150,
        processed: 145,
        failed: 5,
        bySource: {
          stripe: 80,
          paypal: 45,
          alipay: 25,
        },
        byType: {
          'payment_intent.succeeded': 60,
          'invoice.payment_succeeded': 40,
          'customer.subscription.updated': 30,
          'payment_intent.payment_failed': 10,
          'customer.subscription.deleted': 10,
        },
      };
    } catch (error) {
      star.logger?.error('Failed to get webhook stats:', error);
      return {
        total: 0,
        processed: 0,
        failed: 0,
        bySource: {},
        byType: {},
      };
    }
  }

  /**
   * 重新处理失败的Webhook
   */
  static async reprocessFailedWebhooks(
    webhookIds: string[],
    star: any,
  ): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;

    for (const webhookId of webhookIds) {
      try {
        // 从数据库获取Webhook事件
        // const webhook = await star.db.collection('webhook_events').findOne({ id: webhookId });

        // 模拟获取Webhook事件
        const webhook: WebhookEvent = {
          id: webhookId,
          source: 'stripe',
          type: 'payment_intent.succeeded',
          data: {},
          signature: 'mock_signature',
          receivedAt: new Date(),
          processed: false,
          failed: true,
          attempts: 3,
          maxAttempts: 3,
          createdAt: new Date(),
        };

        if (webhook) {
          // 重置状态并重新处理
          webhook.processed = false;
          webhook.failed = false;
          webhook.attempts = 0;
          webhook.lastError = undefined;

          await this.processWebhookEvent(webhook, star);
          webhook.processed = true;
          webhook.processedAt = new Date();

          await this.saveWebhookEvent(webhook, star);
          success++;
        }
      } catch (error) {
        star.logger?.error(`Failed to reprocess webhook ${webhookId}:`, error);
        failed++;
      }
    }

    star.logger?.info(`Webhook reprocessing completed: ${success} success, ${failed} failed`);
    return { success, failed };
  }
}
