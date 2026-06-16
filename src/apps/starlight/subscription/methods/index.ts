/**
 * 订阅微服务内部方法
 * 这些方法仅供服务内部使用，不对外暴露
 */
import { Context } from 'node-universe';
import { SubscriptionPlan, UserSubscription } from '../types';
import { SubscriptionPlanAttributes } from 'db/mysql/models/subscription/subscriptionPlan';
import { UserSubscriptionAttributes } from 'db/mysql/models/subscription/userSubscription';
import { Starlight } from 'typings';
import {
  findBillById,
  findBillItemsByBillId,
  findBillsByStatus,
  findBillsByUserId,
  getUserBillingStats,
} from 'db/mysql/apis/billing';
import {
  createUserSubscription,
  findUserSubscriptionHistory,
  findUserSubscriptionsByStatus,
  findTrialUserSubscriptions,
  updateUserSubscription,
} from 'db/mysql/apis/subscription';
import {
  createPaymentOrder as savePaymentOrder,
  findPaymentOrderById,
  findPaymentOrderByNumber,
  findPaymentOrdersByUserId,
  createRefundRequest as saveRefundRequest,
  findRefundRequestById,
  updatePaymentOrder,
  updatePaymentOrderStatus as persistPaymentOrderStatus,
  updateRefundRequestStatus,
} from 'db/mysql/apis/payment';
import { PaymentHandler } from '../utils/payment-handler';
import { PAYMENT_GATEWAY_CONFIG } from '../constants';

const PAYMENT_ORDER_TTL_MS = 30 * 60 * 1000;

const buildExpiresAt = (createdAt?: Date | string) => {
  const baseTime = createdAt ? new Date(createdAt).getTime() : Date.now();
  return new Date(baseTime + PAYMENT_ORDER_TTL_MS).toISOString();
};

const normalizePaymentOrder = (order: any) => {
  const metadata = order?.metadata || {};

  return {
    ...order,
    orderNumber: order?.orderNo,
    planName: metadata.planName || order?.planName,
    expiresAt: metadata.expiresAt || buildExpiresAt(order?.createdAt),
    paymentUrl: metadata.paymentUrl,
    transactionId: order?.providerOrderId,
  };
};

type PaymentStatusSnapshot = {
  status: string;
  paidAt?: string;
  transactionId?: string;
  failureReason?: string;
};

/**
 * 创建订阅微服务的内部方法
 */
export function createMethods(star: Starlight) {
  return {
    /**
     * 根据名称获取订阅计划
     */
    async getPlanByName(planName: string): Promise<SubscriptionPlan | null> {
      try {
        // 从缓存或数据库获取计划
        const plans = await star.db.subscription.queryAllSubscriptionPlans();
        const plan = plans.find((p) => p.name === planName);

        if (!plan) return null;

        // 转换为内部类型
        return {
          id: plan.id,
          name: plan.name,
          description: plan.description || '',
          price: plan.price,
          currency: plan.currency,
          billingCycle: plan.billingCycle as any,
          features: (plan.features as any) || [],
          limits: (plan.limits as any) || {
            apiCalls: 0,
            storage: 0,
            bandwidth: 0,
            users: 0,
            projects: 0,
            customDomains: 0,
            supportLevel: 'basic' as const,
          },
          status: plan.isActive ? 'active' : 'inactive',
          createdAt: plan.createdAt || new Date(),
          updatedAt: plan.updatedAt || new Date(),
        };
      } catch (error) {
        star.logger?.error('Failed to get plan by name:', error);
        return null;
      }
    },

    /**
     * 获取用户的活跃订阅
     */
    async getUserActiveSubscription(userId: string): Promise<UserSubscription | null> {
      try {
        const subscription = await star.db.subscription.findActiveUserSubscription(userId);

        if (!subscription) return null;
        const plan = await this.getPlanByName(subscription.planName);

        // 转换为内部类型
        return {
          id: subscription.id,
          userId: subscription.userId,
          planId: subscription.planName,
          planName: subscription.planName,
          planDisplayName: plan?.name || subscription.planName,
          status: subscription.status as any,
          startDate: subscription.startedAt,
          endDate: subscription.expiresAt || new Date(),
          expiresAt: subscription.expiresAt || new Date(),
          nextBillingDate: subscription.expiresAt || new Date(),
          billingCycle: subscription.billingCycle,
          price: plan?.price,
          currency: plan?.currency,
          autoRenew: !subscription.cancelAtPeriodEnd,
          paymentMethodId: undefined,
          discountId: undefined,
          metadata: subscription.metadata,
          createdAt: subscription.createdAt || new Date(),
          updatedAt: subscription.updatedAt || new Date(),
        } as any;
      } catch (error) {
        star.logger?.error('Failed to get user active subscription:', error);
        return null;
      }
    },

    async getUserCurrentSubscription(userId: string) {
      try {
        const subscription = await star.db.subscription.findActiveUserSubscription(userId);
        return subscription || null;
      } catch (error) {
        star.logger?.error('Failed to get user current subscription:', error);
        return null;
      }
    },

    async getUserCurrentUsage(userId: string) {
      try {
        const stats = await getUserBillingStats(userId);
        return {
          totalBills: stats.totalBills,
          paidBills: stats.paidBills,
          unpaidBills: stats.unpaidBills,
          totalAmount: stats.totalAmount,
          unpaidAmount: stats.unpaidAmount,
        };
      } catch (error) {
        star.logger?.error('Failed to get user current usage:', error);
        return null;
      }
    },

    async getSubscriptionsByStatus(status: string) {
      try {
        return await findUserSubscriptionsByStatus(status as any);
      } catch (error) {
        star.logger?.error('Failed to get subscriptions by status:', error);
        return [];
      }
    },

    async getTrialSubscriptions() {
      try {
        return await findTrialUserSubscriptions();
      } catch (error) {
        star.logger?.error('Failed to get trial subscriptions:', error);
        return [];
      }
    },

    async getCurrentUsage(userId: string, quotaType: string) {
      try {
        const stats = await getUserBillingStats(userId);
        switch (quotaType) {
          case 'maxAppKeys':
            return stats.totalBills;
          case 'maxMetricsPerHour':
            return stats.paidBills;
          case 'maxMetricsPerDay':
            return stats.unpaidBills;
          case 'maxMetricsPerMonth':
            return Math.round(stats.totalAmount);
          case 'maxCustomSchemas':
            return Math.round(stats.unpaidAmount);
          case 'maxDashboards':
            return stats.paidBills;
          case 'maxAlerts':
            return stats.unpaidBills;
          default:
            return 0;
        }
      } catch (error) {
        star.logger?.error('Failed to get current usage:', error);
        return 0;
      }
    },

    async getQuotaUsageHistory(params: {
      userId: string;
      quotaType?: string;
      timeRange?: string;
      limit?: number;
      offset?: number;
    }) {
      return {
        data: [],
        total: 0,
      };
    },

    async generateQuotaStats(
      history: Array<{ current: number; percentage?: number }>,
      timeRange: string,
    ) {
      const values = history.map((item) => Number(item.current || 0));
      const max = values.length ? Math.max(...values) : 0;
      const min = values.length ? Math.min(...values) : 0;
      const average = values.length
        ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
        : 0;
      const latest = values.length ? values[values.length - 1] : 0;

      return {
        timeRange,
        count: history.length,
        latest,
        max,
        min,
        average,
      };
    },

    async createFreeSubscription(userId: string, planName: string) {
      const startedAt = new Date();
      const expiresAt = new Date(startedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
      const saved = await createUserSubscription({
        id: crypto.randomUUID(),
        userId,
        planName,
        billingCycle: 'monthly',
        status: 'active',
        startedAt,
        expiresAt,
        cancelledAt: undefined,
        cancelAtPeriodEnd: false,
        trialEndsAt: undefined,
        metadata: {
          source: 'free-plan-create',
        },
      } as any);

      const subscription = saved?.toJSON ? saved.toJSON() : saved;

      return {
        id: subscription.id,
        planName: subscription.planName,
        status: subscription.status,
        startDate: subscription.startedAt,
        expiresAt: subscription.expiresAt,
        autoRenew: !subscription.cancelAtPeriodEnd,
      };
    },

    async getUserSubscriptionHistory(params: {
      userId: string;
      limit?: number;
      offset?: number;
      status?: string;
    }) {
      const allSubscriptions = await findUserSubscriptionHistory(params.userId);
      const filtered = params.status
        ? allSubscriptions.filter((subscription) => subscription.status === params.status)
        : allSubscriptions;
      const offset = Number(params.offset || 0);
      const limit = Number(params.limit || 20);
      const data = filtered.slice(offset, offset + limit).map((subscription) => ({
        id: subscription.id,
        planName: subscription.planName,
        planDisplayName: subscription.planName,
        status: subscription.status,
        startDate: subscription.startedAt,
        expiresAt: subscription.expiresAt,
        cancelledAt: subscription.cancelledAt,
        price: null,
        currency: null,
        billingCycle: subscription.billingCycle,
        autoRenew: !subscription.cancelAtPeriodEnd,
      }));

      return {
        data,
        total: filtered.length,
      };
    },

    async canUpgradePlan(currentPlanName: string, targetPlanName: string) {
      if (currentPlanName === targetPlanName) {
        return { allowed: false, reason: '当前已是目标套餐' };
      }

      const currentPlan = await this.getPlanByName(currentPlanName);
      const targetPlan = await this.getPlanByName(targetPlanName);

      if (!currentPlan || !targetPlan) {
        return { allowed: false, reason: '订阅计划不存在' };
      }

      if (Number(targetPlan.price || 0) < Number(currentPlan.price || 0)) {
        return { allowed: false, reason: '当前仅支持升级到更高价格套餐' };
      }

      return { allowed: true };
    },

    async calculateUpgradeCost(
      currentSubscription: any,
      targetPlanData: any,
      billingCycle: string,
      upgradeType: string,
    ) {
      const currentPlan = await this.getPlanByName(
        currentSubscription.planName || currentSubscription.planId,
      );
      const currentPrice = Number(currentPlan?.price || currentSubscription.price || 0);
      const targetPrice = Number(targetPlanData?.price || 0);
      const immediateDelta = Math.max(targetPrice - currentPrice, 0);

      return {
        amount: upgradeType === 'scheduled' ? 0 : immediateDelta,
        currency: targetPlanData?.currency || currentSubscription.currency || 'CNY',
        billingCycle,
        effectiveDate: new Date().toISOString(),
      };
    },

    async upgradeSubscriptionDirect(
      subscriptionId: string,
      targetPlan: string,
      upgradeType: string,
    ) {
      const targetPlanData = await this.getPlanByName(targetPlan);
      const effectiveDate = new Date();
      const updated = await updateUserSubscription(subscriptionId, {
        planName: targetPlan,
        billingCycle: targetPlanData?.billingCycle || 'monthly',
        metadata: {
          upgradeType,
          effectiveDate: effectiveDate.toISOString(),
        },
      } as any);

      return {
        id: updated?.id || subscriptionId,
        planName: updated?.planName || targetPlan,
        status: updated?.status || 'active',
        effectiveDate,
      };
    },

    async createUpgradeOrder(params: {
      userId: string;
      currentSubscriptionId: string;
      targetPlan: string;
      billingCycle: string;
      upgradeCost: { amount: number; currency?: string; effectiveDate?: string };
      paymentMethodId?: string;
      upgradeType: string;
    }) {
      const paymentOrder = await this.createPaymentOrder({
        userId: params.userId,
        planName: params.targetPlan,
        billingCycle: params.billingCycle,
        paymentMethod: params.paymentMethodId,
        paymentMethodId: params.paymentMethodId,
        pricing: {
          finalAmount: params.upgradeCost.amount,
          originalAmount: params.upgradeCost.amount,
          currency: params.upgradeCost.currency || 'CNY',
        },
      });

      const updated = await updatePaymentOrder(paymentOrder.id, {
        metadata: {
          ...(paymentOrder.metadata || {}),
          currentSubscriptionId: params.currentSubscriptionId,
          upgradeType: params.upgradeType,
          effectiveDate: params.upgradeCost.effectiveDate || new Date().toISOString(),
        },
      } as any);

      const order = updated ? normalizePaymentOrder(updated) : paymentOrder;

      return {
        ...order,
        effectiveDate: params.upgradeCost.effectiveDate || new Date().toISOString(),
      };
    },

    async checkRefundPolicy(order: any) {
      if (!order || order.status !== 'paid') {
        return { allowed: false, reason: '仅已支付订单可退款', autoApprove: false };
      }

      const paidAt = order.paidAt ? new Date(order.paidAt).getTime() : null;
      const withinAutoWindow = paidAt ? Date.now() - paidAt <= 7 * 24 * 60 * 60 * 1000 : false;

      return {
        allowed: true,
        autoApprove: withinAutoWindow,
        reviewRequired: !withinAutoWindow,
      };
    },

    async createRefundRequest(params: {
      orderId: string;
      userId: string;
      amount: number;
      reason: string;
      refundPolicy?: Record<string, any>;
    }) {
      const saved = await saveRefundRequest({
        id: crypto.randomUUID(),
        paymentOrderId: params.orderId,
        userId: params.userId,
        refundAmount: params.amount,
        refundReason: params.reason || '用户申请退款',
        status: params.refundPolicy?.autoApprove ? 'approved' : 'pending',
        adminNotes: undefined,
        processedAt: undefined,
      } as any);

      return saved?.toJSON ? saved.toJSON() : saved;
    },

    async processRefund(refundId: string) {
      const refund = await findRefundRequestById(refundId);
      if (!refund) {
        throw new Error('Refund request not found');
      }

      const refundResult = await PaymentHandler.processRefund(
        refund.paymentOrderId,
        Number(refund.refundAmount),
        refund.refundReason,
        star,
      );

      if (!refundResult || refundResult.status === 'failed' || refundResult.supported === false) {
        await updateRefundRequestStatus(refundId, 'failed');
        return {
          refundId,
          status: 'failed',
          amount: Number(refund.refundAmount),
          processedAt: refundResult?.processedAt,
          failureReason: refundResult?.failureReason || 'refund_processing_not_available',
        };
      }

      await updateRefundRequestStatus(refundId, 'processed');
      await updatePaymentOrder(refund.paymentOrderId, {
        status: 'refunded',
      } as any);

      return {
        refundId,
        status: 'processed',
        amount: Number(refund.refundAmount),
        processedAt: refundResult.processedAt,
      };
    },

    async calculateRefundAmount(subscription: any, cancelType: string) {
      if (cancelType !== 'immediate') {
        return 0;
      }

      const expiresAt = subscription.endDate || subscription.expiresAt;
      if (!expiresAt) {
        return 0;
      }

      const totalCycleMs = 30 * 24 * 60 * 60 * 1000;
      const remainingMs = Math.max(new Date(expiresAt).getTime() - Date.now(), 0);
      const ratio = Math.min(remainingMs / totalCycleMs, 1);
      const estimatedAmount = Number(subscription.price || subscription.amount || 0);
      return Number((estimatedAmount * ratio).toFixed(2));
    },

    async cancelSubscription(params: {
      subscriptionId: string;
      reason?: string;
      cancelType: string;
      refundAmount?: number;
    }) {
      const now = new Date();
      const effectiveDate = params.cancelType === 'immediate' ? now : now;
      const updated = await updateUserSubscription(params.subscriptionId, {
        status: 'cancelled',
        cancelledAt: now,
        cancelAtPeriodEnd: params.cancelType !== 'immediate',
        metadata: {
          cancelReason: params.reason,
          refundAmount: params.refundAmount || 0,
          effectiveDate: effectiveDate.toISOString(),
        },
      } as any);

      return {
        status: updated?.status || 'cancelled',
        cancelledAt: updated?.cancelledAt || now,
        effectiveDate,
        accessUntil: params.cancelType === 'immediate' ? now : updated?.expiresAt || now,
      };
    },

    async recordCancellationFeedback(params: Record<string, any>) {
      star.logger?.info('Cancellation feedback recorded', params);
      return true;
    },

    async getUserCancelledSubscription(userId: string) {
      const history = await findUserSubscriptionHistory(userId);
      const now = Date.now();
      const cancelled = history.find((subscription) => {
        const expiresAt = subscription.expiresAt ? new Date(subscription.expiresAt).getTime() : now;
        return subscription.status === 'cancelled' && expiresAt >= now;
      });

      if (!cancelled) {
        return null;
      }

      return {
        id: cancelled.id,
        planName: cancelled.planName,
        status: cancelled.status,
        expiresAt: cancelled.expiresAt,
        autoRenew: !cancelled.cancelAtPeriodEnd,
      };
    },

    async canResumeSubscription(subscription: any) {
      if (!subscription) {
        return { allowed: false, reason: '订阅不存在' };
      }

      if (subscription.status !== 'cancelled') {
        return { allowed: false, reason: '只有已取消订阅可以恢复' };
      }

      if (subscription.expiresAt && new Date(subscription.expiresAt).getTime() < Date.now()) {
        return { allowed: false, reason: '订阅已过期，无法恢复' };
      }

      return { allowed: true };
    },

    async resumeSubscription(subscriptionId: string) {
      const updated = await updateUserSubscription(subscriptionId, {
        status: 'active',
        cancelledAt: undefined,
        cancelAtPeriodEnd: false,
      } as any);

      return {
        id: updated?.id || subscriptionId,
        planName: updated?.planName,
        status: updated?.status || 'active',
        resumedAt: new Date(),
        expiresAt: updated?.expiresAt,
        autoRenew: !(updated?.cancelAtPeriodEnd ?? false),
      };
    },

    async getUserBills(params: {
      userId: string;
      year?: number;
      month?: number;
      status?: string;
      limit?: number;
      offset?: number;
    }) {
      try {
        const allBills = await findBillsByUserId(params.userId);
        const filtered = allBills.filter((bill: any) => {
          const billDate = bill.billDate
            ? new Date(bill.billDate)
            : bill.createdAt
              ? new Date(bill.createdAt)
              : null;
          if (params.status && bill.status !== params.status) return false;
          if (params.year && billDate && billDate.getFullYear() !== params.year) return false;
          if (params.month && billDate && billDate.getMonth() + 1 !== params.month) return false;
          return true;
        });

        const offset = Number(params.offset || 0);
        const limit = Number(params.limit || 20);
        const data = filtered.slice(offset, offset + limit);

        return {
          data,
          total: filtered.length,
          summary: {
            totalAmount: filtered.reduce(
              (sum: number, bill: any) => sum + Number(bill.amount || bill.total || 0),
              0,
            ),
            paidAmount: filtered
              .filter((bill: any) => bill.status === 'paid')
              .reduce((sum: number, bill: any) => sum + Number(bill.amount || bill.total || 0), 0),
            pendingAmount: filtered
              .filter((bill: any) => bill.status === 'pending')
              .reduce((sum: number, bill: any) => sum + Number(bill.amount || bill.total || 0), 0),
            overdueAmount: filtered
              .filter((bill: any) => bill.status === 'overdue')
              .reduce((sum: number, bill: any) => sum + Number(bill.amount || bill.total || 0), 0),
          },
        };
      } catch (error) {
        star.logger?.error('Failed to get user bills:', error);
        return {
          data: [],
          total: 0,
          summary: {
            totalAmount: 0,
            paidAmount: 0,
            pendingAmount: 0,
            overdueAmount: 0,
          },
        };
      }
    },

    async getBillsByStatus(status: string) {
      try {
        if (status === 'pending') {
          const [draftBills, sentBills] = await Promise.all([
            findBillsByStatus('draft'),
            findBillsByStatus('sent'),
          ]);
          return [...draftBills, ...sentBills];
        }
        return await findBillsByStatus(status);
      } catch (error) {
        star.logger?.error('Failed to get bills by status:', error);
        return [];
      }
    },

    async getBillById(billId: string) {
      try {
        return await findBillById(billId);
      } catch (error) {
        star.logger?.error('Failed to get bill by id:', error);
        return null;
      }
    },

    async getBillItems(billId: string) {
      try {
        return await findBillItemsByBillId(billId);
      } catch (error) {
        star.logger?.error('Failed to get bill items:', error);
        return [];
      }
    },

    async generateInvoice(bill: any, format: string) {
      return {
        url:
          bill.invoiceUrl ||
          `/api/subscription/v1/billing/downloadInvoice?billId=${bill.id}&format=${format}`,
        fileName: `${bill.billNumber || bill.id}.${format}`,
        fileSize: 0,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      };
    },

    async logInvoiceDownload(params: {
      billId: string;
      userId: string;
      format: string;
      downloadedAt: Date;
    }) {
      star.logger?.info('Invoice download logged', params);
      return true;
    },

    async calculatePlanPricing(params: { plan: any; billingCycle?: string; promoCode?: string }) {
      const billingCycle = params.billingCycle || params.plan?.billingCycle || 'monthly';
      const baseAmount = Number(params.plan?.price || 0);

      return {
        billingCycle,
        currency: params.plan?.currency || 'CNY',
        originalAmount: baseAmount,
        discountAmount: 0,
        finalAmount: baseAmount,
        promoCode: params.promoCode || null,
      };
    },

    async getAvailablePaymentMethods() {
      return [
        {
          id: 'stripe',
          name: 'stripe',
          displayName: 'Stripe',
          icon: 'credit-card',
          enabled: PAYMENT_GATEWAY_CONFIG.STRIPE.ENABLED,
          supportedCurrencies: ['USD', 'EUR', 'GBP', 'CNY'],
          fees: {
            type: 'percentage',
            value: 2.9,
            fixed: 0.3,
          },
          description: PAYMENT_GATEWAY_CONFIG.STRIPE.ENABLED
            ? '支持国际银行卡与订阅扣费。'
            : '当前环境未启用 Stripe 配置。',
        },
        {
          id: 'paypal',
          name: 'paypal',
          displayName: 'PayPal',
          icon: 'wallet',
          enabled: PAYMENT_GATEWAY_CONFIG.PAYPAL.ENABLED,
          supportedCurrencies: ['USD', 'EUR', 'GBP'],
          fees: {
            type: 'percentage',
            value: 3.49,
            fixed: 0.49,
          },
          description: PAYMENT_GATEWAY_CONFIG.PAYPAL.ENABLED
            ? '适合跨境支付与 PayPal 账户结算。'
            : '当前环境未启用 PayPal 配置。',
        },
        {
          id: 'alipay',
          name: 'alipay',
          displayName: '支付宝',
          icon: 'qr-code',
          enabled: PAYMENT_GATEWAY_CONFIG.ALIPAY.ENABLED,
          supportedCurrencies: ['CNY'],
          fees: {
            type: 'percentage',
            value: 0.6,
            fixed: 0,
          },
          description: PAYMENT_GATEWAY_CONFIG.ALIPAY.ENABLED
            ? '适合国内扫码与企业收款场景。'
            : '当前环境未启用支付宝配置。',
        },
      ];
    },

    async getPaymentProvider(paymentMethod: string) {
      const methods = await this.getAvailablePaymentMethods();
      return (
        methods.find(
          (method: any) => method.id === paymentMethod || method.name === paymentMethod,
        ) || null
      );
    },

    async createPaymentOrder(params: {
      userId: string;
      planName: string;
      billingCycle?: string;
      paymentMethod?: string;
      paymentMethodId?: string;
      returnUrl?: string;
      notifyUrl?: string;
      pricing?: {
        finalAmount?: number;
        originalAmount?: number;
        currency?: string;
      };
      autoRenew?: boolean;
    }) {
      const selectedMethod = params.paymentMethod || params.paymentMethodId;
      const fallbackMethod = (await this.getAvailablePaymentMethods()).find(
        (method: any) => method.enabled,
      )?.id;
      const paymentMethod = selectedMethod || fallbackMethod;

      if (!paymentMethod) {
        throw new Error('No available payment method');
      }

      const provider = await this.getPaymentProvider(paymentMethod);
      if (!provider?.enabled) {
        throw new Error(`Payment method is not enabled: ${paymentMethod}`);
      }

      const orderId = crypto.randomUUID();
      const orderNumber = `PO${Date.now()}${Math.floor(Math.random() * 1000)
        .toString()
        .padStart(3, '0')}`;
      const expiresAt = buildExpiresAt();
      const returnUrl =
        params.returnUrl ||
        `${process.env.FRONTEND_URL || ''}/home/billing?tab=payment&orderId=${orderId}`;
      const saved = await savePaymentOrder({
        id: orderId,
        userId: params.userId,
        subscriptionId: undefined,
        orderNo: orderNumber,
        amount: Number(params.pricing?.finalAmount ?? params.pricing?.originalAmount ?? 0),
        currency: params.pricing?.currency || 'CNY',
        paymentMethod,
        paymentProvider: provider.name,
        providerOrderId: undefined,
        status: 'pending',
        paidAt: undefined,
        failedReason: undefined,
        metadata: {
          planName: params.planName,
          billingCycle: params.billingCycle || 'monthly',
          autoRenew: params.autoRenew ?? true,
          expiresAt,
          returnUrl,
          notifyUrl: params.notifyUrl,
        },
      } as any);

      return normalizePaymentOrder(saved?.toJSON ? saved.toJSON() : saved);
    },

    async generatePaymentUrl(order: any, paymentProvider: any) {
      const providerName = paymentProvider?.id || paymentProvider?.name;
      throw new Error(`Unsupported payment provider for checkout URL: ${providerName}`);
    },

    async generateQRCode(paymentUrl: string) {
      return `qr://${Buffer.from(paymentUrl).toString('base64')}`;
    },

    async getPaymentOrderById(orderId: string) {
      const order = await findPaymentOrderById(orderId);
      return order ? normalizePaymentOrder(order) : null;
    },

    async getPaymentOrderByNumber(orderNumber: string) {
      const order = await findPaymentOrderByNumber(orderNumber);
      return order ? normalizePaymentOrder(order) : null;
    },

    async queryStripePaymentStatus(order: any) {
      const providerTransactionId =
        order.transactionId || order.providerOrderId || order.metadata?.providerOrderId;
      const externalStatus = order.metadata?.externalStatus || order.metadata?.providerStatus;

      if (externalStatus === 'succeeded' || externalStatus === 'paid' || providerTransactionId) {
        return {
          status: 'paid',
          paidAt: order.paidAt || new Date().toISOString(),
          transactionId: providerTransactionId || `stripe-${order.orderNumber || order.id}`,
        };
      }

      if (externalStatus === 'failed' || externalStatus === 'canceled') {
        return {
          status: 'failed',
          paidAt: undefined,
          transactionId: providerTransactionId,
          failureReason: order.failureReason || `stripe reported ${externalStatus}`,
        };
      }

      return null;
    },

    async queryPayPalPaymentStatus(order: any) {
      const providerTransactionId =
        order.transactionId || order.providerOrderId || order.metadata?.providerOrderId;
      const externalStatus = order.metadata?.externalStatus || order.metadata?.providerStatus;

      if (externalStatus === 'completed' || externalStatus === 'paid' || providerTransactionId) {
        return {
          status: 'paid',
          paidAt: order.paidAt || new Date().toISOString(),
          transactionId: providerTransactionId || `paypal-${order.orderNumber || order.id}`,
        };
      }

      if (
        externalStatus === 'denied' ||
        externalStatus === 'failed' ||
        externalStatus === 'voided'
      ) {
        return {
          status: 'failed',
          paidAt: undefined,
          transactionId: providerTransactionId,
          failureReason: order.failureReason || `paypal reported ${externalStatus}`,
        };
      }

      return null;
    },

    async queryAlipayPaymentStatus(order: any) {
      const providerTransactionId =
        order.transactionId || order.providerOrderId || order.metadata?.providerOrderId;
      const externalStatus = order.metadata?.externalStatus || order.metadata?.providerStatus;

      if (
        externalStatus === 'TRADE_SUCCESS' ||
        externalStatus === 'TRADE_FINISHED' ||
        providerTransactionId
      ) {
        return {
          status: 'paid',
          paidAt: order.paidAt || new Date().toISOString(),
          transactionId: providerTransactionId || `alipay-${order.orderNumber || order.id}`,
        };
      }

      if (externalStatus === 'TRADE_CLOSED' || externalStatus === 'failed') {
        return {
          status: 'failed',
          paidAt: undefined,
          transactionId: providerTransactionId,
          failureReason: order.failureReason || `alipay reported ${externalStatus}`,
        };
      }

      return null;
    },

    async queryThirdPartyPaymentStatus(order: any) {
      if (!order) {
        return {
          status: 'failed',
          paidAt: undefined,
          transactionId: undefined,
          failureReason: 'payment order not found',
        };
      }

      const provider = order.paymentMethod || order.paymentProvider;
      const expiresAt = order.expiresAt ? new Date(order.expiresAt).getTime() : null;
      const now = Date.now();
      const providerTransactionId =
        order.transactionId || order.providerOrderId || order.metadata?.providerOrderId;
      let providerResult: PaymentStatusSnapshot | null = null;

      if (['paid', 'refunded', 'failed', 'cancelled'].includes(order.status)) {
        return {
          status: order.status,
          paidAt: order.paidAt,
          transactionId: providerTransactionId,
          failureReason: order.failureReason,
        };
      }

      switch (provider) {
        case 'stripe':
          providerResult = await this.queryStripePaymentStatus(order);
          break;
        case 'paypal':
          providerResult = await this.queryPayPalPaymentStatus(order);
          break;
        case 'alipay':
          providerResult = await this.queryAlipayPaymentStatus(order);
          break;
        default:
          providerResult = null;
      }

      if (providerResult) {
        return providerResult;
      }

      if (expiresAt && expiresAt < now) {
        return {
          status: 'failed',
          paidAt: undefined,
          transactionId: providerTransactionId,
          failureReason: 'payment session expired',
        };
      }

      return {
        status: 'pending',
        paidAt: undefined,
        transactionId: providerTransactionId,
      };
    },

    async verifyPaymentNotification(provider: string, data: Record<string, any>) {
      const supported = ['stripe', 'paypal', 'alipay'];
      if (!supported.includes(provider)) {
        return false;
      }

      return Boolean(
        data && typeof data.orderNumber === 'string' && typeof data.status === 'string',
      );
    },

    async parsePaymentNotification(provider: string, data: Record<string, any>) {
      return {
        provider,
        orderNumber: data.orderNumber,
        status: data.status,
        transactionId: data.transactionId || data.paymentId || data.providerOrderId,
        amount: Number(data.amount || 0),
        paidAt: data.paidAt || new Date().toISOString(),
        failureReason: data.failureReason || data.reason,
      };
    },

    async processPaymentSuccess(params: {
      orderId: string;
      transactionId?: string;
      paidAmount?: number;
      paidAt?: string;
    }) {
      const order = await this.getPaymentOrderById(params.orderId);
      if (!order) {
        return null;
      }

      let subscriptionId = order.subscriptionId;

      if (!subscriptionId) {
        const startedAt = params.paidAt ? new Date(params.paidAt) : new Date();
        const billingCycle = order.metadata?.billingCycle || 'monthly';
        const durationMs =
          billingCycle === 'yearly' ? 365 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
        const expiresAt = new Date(startedAt.getTime() + durationMs);
        const created = await createUserSubscription({
          id: crypto.randomUUID(),
          userId: order.userId,
          planName: order.planName,
          billingCycle,
          status: 'active',
          startedAt,
          expiresAt,
          cancelledAt: undefined,
          cancelAtPeriodEnd: false,
          trialEndsAt: undefined,
          metadata: {
            source: 'payment-success',
            orderId: order.id,
          },
        } as any);
        const subscription = created?.toJSON ? created.toJSON() : created;
        subscriptionId = subscription.id;

        await star.emit('subscription.created', {
          userId: order.userId,
          planId: order.planName,
          subscriptionId,
        });
      }

      const updated = await updatePaymentOrder(params.orderId, {
        status: 'paid',
        subscriptionId,
        providerOrderId: params.transactionId,
        paidAt: params.paidAt ? new Date(params.paidAt) : new Date(),
      } as any);

      return updated ? normalizePaymentOrder(updated) : this.getPaymentOrderById(params.orderId);
    },

    async processPaymentFailure(params: { orderId: string; failureReason?: string }) {
      await persistPaymentOrderStatus(params.orderId, 'failed');
      const order = await this.getPaymentOrderById(params.orderId);
      return order
        ? {
            ...order,
            failureReason: params.failureReason,
          }
        : null;
    },

    async updatePaymentOrderStatus(orderId: string, paymentStatus: any) {
      const nextStatus = typeof paymentStatus === 'string' ? paymentStatus : paymentStatus?.status;
      const normalizedStatus = nextStatus === 'completed' ? 'paid' : nextStatus;
      await persistPaymentOrderStatus(orderId, normalizedStatus, paymentStatus?.transactionId);
      return this.getPaymentOrderById(orderId);
    },

    async cancelPaymentOrder(orderId: string, reason?: string) {
      await persistPaymentOrderStatus(orderId, 'cancelled');
      if (reason) {
        star.logger?.info('Payment order cancelled', { orderId, reason });
      }
      return this.getPaymentOrderById(orderId);
    },

    getOrderStatusDescription(status: string) {
      switch (status) {
        case 'paid':
          return '支付已完成';
        case 'failed':
          return '支付失败';
        case 'cancelled':
          return '订单已取消';
        case 'refunded':
          return '订单已退款';
        default:
          return '等待支付确认';
      }
    },

    async getOrderNextAction(order: any) {
      if (order?.status === 'pending') {
        const paymentProvider = await this.getPaymentProvider(order.paymentMethod);
        return {
          type: 'open_payment',
          label: '继续支付',
          target: paymentProvider ? await this.generatePaymentUrl(order, paymentProvider) : null,
        };
      }

      if (order?.status === 'failed') {
        return {
          type: 'retry',
          label: '重新发起支付',
        };
      }

      return null;
    },

    async getUserPaymentHistory(params: {
      userId: string;
      status?: string;
      limit?: number;
      offset?: number;
    }) {
      const orders = await findPaymentOrdersByUserId(params.userId);
      const normalized = orders.map((order) => normalizePaymentOrder(order));
      const filtered = params.status
        ? normalized.filter((order) => order.status === params.status)
        : normalized;
      const offset = Number(params.offset || 0);
      const limit = Number(params.limit || 20);

      return {
        data: filtered.slice(offset, offset + limit).map((order) => ({
          ...order,
          description: order.planName ? `${order.planName} 订阅订单` : '订阅支付订单',
        })),
        total: filtered.length,
      };
    },

    /**
     * 检查是否可以取消订阅
     */
    async canCancelSubscription(
      subscription: UserSubscription,
    ): Promise<{ allowed: boolean; reason?: string }> {
      try {
        // 检查订阅状态
        if (subscription.status !== 'active') {
          return { allowed: false, reason: '订阅状态不允许取消' };
        }

        // 检查是否在宽限期内
        const now = new Date();
        const gracePeriodEnd = new Date(subscription.startDate.getTime() + 3 * 24 * 60 * 60 * 1000); // 3天宽限期

        if (now < gracePeriodEnd) {
          return { allowed: true };
        }

        // 其他业务逻辑检查
        return { allowed: true };
      } catch (error) {
        star.logger?.error('Failed to check cancellation eligibility:', error);
        return { allowed: false, reason: '系统错误' };
      }
    },

    /**
     * 处理订阅取消
     */
    async handleCancellation(ctx: Context) {
      const { tenantId, userId, subscriptionId, reason } = ctx.params;

      try {
        // 更新订阅状态
        await star.db.subscription.updateSubscriptionStatus(subscriptionId, 'cancelled');

        // 记录取消日志
        star.logger?.info(`Subscription cancelled: ${subscriptionId}`, {
          reason,
          tenantId,
          userId,
          timestamp: new Date().toISOString(),
        });

        star.logger?.info(`Subscription cancelled: ${subscriptionId}`);
      } catch (error) {
        star.logger?.error('Failed to handle cancellation:', error);
        throw error;
      }
    },

    /**
     * 清理租户订阅数据
     */
    async cleanupTenantSubscriptions(ctx: Context) {
      const { tenantId } = ctx.params;

      try {
        // 获取租户相关的所有用户订阅并取消
        // 这里需要根据实际的租户-用户关系来实现
        star.logger?.warn(
          'cleanupTenantSubscriptions needs implementation based on tenant-user relationship',
        );
        star.logger?.info(`Tenant subscriptions cleanup requested: ${tenantId}`);
      } catch (error) {
        star.logger?.error('Failed to cleanup tenant subscriptions:', error);
        throw error;
      }
    },

    /**
     * 获取所有计划
     */
    async getAllPlans(currency: string = 'CNY') {
      try {
        const result = await star.db.subscription.queryAllSubscriptionPlans();

        return result || [];
      } catch (error) {
        star.logger?.error('Failed to get all plans:', error);
        return [];
      }
    },
  };
}

export default createMethods;
