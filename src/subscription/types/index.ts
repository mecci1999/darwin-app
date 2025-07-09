/**
 * Subscription微服务类型定义
 */
import { DatabaseState } from 'db/mysql/index';

// 继承数据库状态并扩展订阅服务特定状态
export interface SubscriptionState extends DatabaseState {
  // IP管理
  ips: string[];
  ipBlackList: string[];
  configs: any[];
  ipTimer: NodeJS.Timeout | null;

  // 支付网关连接状态
  paymentGateways: {
    stripe: boolean;
    paypal: boolean;
    alipay: boolean;
  };

  // 通知服务状态
  notificationServices: {
    email: boolean;
    sms: boolean;
    push: boolean;
  };

  // 订阅处理队列
  subscriptionQueue: SubscriptionQueueItem[];

  // 支付处理队列
  paymentQueue: PaymentQueueItem[];

  // 缓存状态
  cache: {
    plans: Map<string, SubscriptionPlan>;
    subscriptions: Map<string, UserSubscription>;
    lastCacheUpdate: number;
  };
}

// 订阅计划
export interface SubscriptionPlan {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  billingCycle: 'monthly' | 'yearly' | 'weekly' | 'daily';
  features: PlanFeature[];
  limits: PlanLimits;
  status: 'active' | 'inactive' | 'deprecated';
  createdAt: Date;
  updatedAt: Date;
}

// 计划功能
export interface PlanFeature {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  value?: string | number | boolean;
}

// 计划限制
export interface PlanLimits {
  apiCalls: number;
  storage: number; // GB
  bandwidth: number; // GB
  users: number;
  projects: number;
  customDomains: number;
  supportLevel: 'basic' | 'standard' | 'premium' | 'enterprise';
}

// 用户订阅
export interface UserSubscription {
  id: string;
  userId: string;
  planId: string;
  status: 'active' | 'inactive' | 'cancelled' | 'expired' | 'pending' | 'suspended';
  startDate: Date;
  endDate: Date;
  nextBillingDate: Date;
  autoRenew: boolean;
  paymentMethodId?: string;
  discountId?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

// 支付记录
export interface PaymentRecord {
  id: string;
  subscriptionId: string;
  userId: string;
  amount: number;
  currency: string;
  status: 'pending' | 'completed' | 'failed' | 'refunded' | 'cancelled';
  paymentMethod: 'stripe' | 'paypal' | 'alipay' | 'wechat' | 'bank_transfer';
  gateway?: string;
  transactionId?: string;
  gatewayTransactionId?: string;
  gatewayResponse?: Record<string, any>;
  failureReason?: string;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// 订阅队列项
export interface SubscriptionQueueItem {
  id: string;
  type: 'create' | 'update' | 'cancel' | 'renew' | 'suspend' | 'reactivate';
  subscriptionId: string;
  userId: string;
  data: Record<string, any>;
  priority: number;
  attempts: number;
  maxAttempts: number;
  scheduledAt: Date;
  createdAt: Date;
}

// 支付队列项
export interface PaymentQueueItem {
  id: string;
  type: 'charge' | 'refund' | 'capture' | 'void';
  paymentId: string;
  subscriptionId: string;
  userId: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  data: Record<string, any>;
  priority: number;
  attempts: number;
  maxAttempts: number;
  scheduledAt: Date;
  createdAt: Date;
}

// 折扣/优惠券
export interface Discount {
  id: string;
  code: string;
  name: string;
  description: string;
  type: 'percentage' | 'fixed_amount' | 'free_trial';
  value: number;
  currency?: string;
  maxUses?: number;
  usedCount: number;
  validFrom: Date;
  validTo: Date;
  applicablePlans: string[];
  status: 'active' | 'inactive' | 'expired';
  createdAt: Date;
  updatedAt: Date;
}

// 发票
export interface Invoice {
  id: string;
  subscriptionId: string;
  userId: string;
  number: string;
  amount: number;
  currency: string;
  tax: number;
  total: number;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
  dueDate: Date;
  paidAt?: Date;
  items: InvoiceItem[];
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

// 发票项目
export interface InvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  metadata?: Record<string, any>;
}

// 使用量统计
export interface UsageStats {
  userId: string;
  subscriptionId?: string;
  period?: {
    start: Date;
    end: Date;
  };
  apiCalls: {
    total: number;
    today: number;
    thisMonth: number;
    byEndpoint: Record<string, number>;
  };
  storage: {
    used: number;
    uploads: number;
    deletions: number;
  };
  bandwidth: {
    inbound: number;
    outbound: number;
    total: number;
  };
  performance: {
    averageResponseTime: number;
    errorRate: number;
  };
  limits?: PlanLimits;
  overages?: {
    apiCalls: number;
    storage: number;
    bandwidth: number;
  };
  createdAt?: Date;
  updatedAt?: Date;
}

// 通知参数
export interface NotificationParams {
  type: 'email' | 'sms' | 'push' | 'webhook';
  recipient: string;
  template: string;
  data: Record<string, any>;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  scheduledAt?: Date;
  metadata?: Record<string, any>;
}

// Webhook事件
export interface WebhookEvent {
  id: string;
  type: string;
  data: Record<string, any>;
  source: 'stripe' | 'paypal' | 'alipay' | 'internal';
  processed: boolean;
  attempts: number;
  maxAttempts: number;
  lastAttemptAt?: Date;
  failed: boolean;
  lastError?: string;
  processedAt?: Date;
  signature?: string;
  receivedAt?: Date;
  createdAt: Date;
}

// 支付网关配置
export interface PaymentGatewayConfig {
  name: string;
  enabled: boolean;
  credentials: Record<string, string>;
  settings: Record<string, any>;
  supportedCurrencies: string[];
  supportedMethods: string[];
}

// 订阅分析数据
export interface SubscriptionAnalytics {
  period: {
    start: Date;
    end: Date;
  };
  metrics: {
    totalSubscriptions: number;
    activeSubscriptions: number;
    newSubscriptions: number;
    cancelledSubscriptions: number;
    upgrades: number;
    downgrades: number;
    churnRate: number;
    mrr: number; // Monthly Recurring Revenue
    arr: number; // Annual Recurring Revenue
    averageRevenuePerUser: number;
    customerLifetimeValue: number;
  };
  revenue: {
    total: number;
    byPlan: Record<string, number>;
    byGateway: Record<string, number>;
    refunds: number;
    netRevenue: number;
  };
  plans: {
    distribution: Record<string, number>;
    conversionRates: Record<string, number>;
    popularPlans: string[];
  };
  geography: {
    byCountry: Record<string, number>;
    byRegion: Record<string, number>;
  };
  cohorts: {
    retention: Record<string, number>;
    revenue: Record<string, number>;
  };
  generatedAt: Date;
}

// 订阅事件
export interface SubscriptionEvent {
  id: string;
  subscriptionId: string;
  userId: string;
  type: 'created' | 'updated' | 'cancelled' | 'renewed' | 'suspended' | 'reactivated' | 'expired';
  data: Record<string, any>;
  metadata?: Record<string, any>;
  createdAt: Date;
}

// API响应类型
export interface SubscriptionResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  metadata?: {
    pagination?: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
    timestamp: Date;
    requestId: string;
  };
}

// 批处理操作
export interface BatchOperation {
  id: string;
  type: 'subscription_update' | 'payment_process' | 'notification_send';
  items: any[];
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: {
    total: number;
    processed: number;
    succeeded: number;
    failed: number;
  };
  results?: any[];
  errors?: any[];
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}
