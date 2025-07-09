import { DataBaseTableNames } from 'typings/enum';
import { mainConnection } from '..';
import { PaymentOrderAttributes, PaymentOrderTable } from '../models/payment/PaymentOrder';
import { RefundRequestAttributes, RefundRequestTable } from '../models/payment/RefundRequest';
import { PaymentProviderAttributes, PaymentProviderTable } from '../models/payment/PaymentProvider';

/**
 * 支付订单相关数据库操作
 */

/**
 * 创建支付订单
 */
export async function createPaymentOrder(order: PaymentOrderAttributes) {
  try {
    const model = await mainConnection.getModel<PaymentOrderTable>(DataBaseTableNames.PaymentOrder);
    return await model.create(order);
  } catch (error) {
    console.log('createPaymentOrder error:', error);
    throw error;
  }
}

/**
 * 根据订单ID查询支付订单
 */
export async function findPaymentOrderById(
  orderId: string,
): Promise<PaymentOrderAttributes | null> {
  try {
    const model = await mainConnection.getModel<PaymentOrderTable>(DataBaseTableNames.PaymentOrder);
    if (!model) return null;

    const order = await model.findOne({
      where: { id: orderId },
    });

    return order ? order.toJSON() : null;
  } catch (error) {
    console.log('findPaymentOrderById error:', error);
    return null;
  }
}

/**
 * 根据用户ID查询支付订单列表
 */
export async function findPaymentOrdersByUserId(userId: string): Promise<PaymentOrderAttributes[]> {
  try {
    const model = await mainConnection.getModel<PaymentOrderTable>(DataBaseTableNames.PaymentOrder);
    if (!model) return [];

    const orders = await model.findAll({
      where: { userId },
      order: [['createdAt', 'DESC']],
    });

    return orders.map((order) => order.toJSON());
  } catch (error) {
    console.log('findPaymentOrdersByUserId error:', error);
    return [];
  }
}

/**
 * 更新支付订单状态
 */
export async function updatePaymentOrderStatus(
  orderId: string,
  status: string,
  transactionId?: string,
) {
  try {
    const model = await mainConnection.getModel<PaymentOrderTable>(DataBaseTableNames.PaymentOrder);
    const updateData: any = { status };

    if (transactionId) {
      updateData.transactionId = transactionId;
    }

    if (status === 'completed') {
      updateData.paidAt = new Date();
    }

    return await model.update(updateData, {
      where: { id: orderId },
    });
  } catch (error) {
    console.log('updatePaymentOrderStatus error:', error);
    throw error;
  }
}

/**
 * 根据状态查询支付订单
 */
export async function findPaymentOrdersByStatus(status: string): Promise<PaymentOrderAttributes[]> {
  try {
    const model = await mainConnection.getModel<PaymentOrderTable>(DataBaseTableNames.PaymentOrder);
    if (!model) return [];

    const orders = await model.findAll({
      where: { status },
      order: [['createdAt', 'DESC']],
    });

    return orders.map((order) => order.toJSON());
  } catch (error) {
    console.log('findPaymentOrdersByStatus error:', error);
    return [];
  }
}

/**
 * 退款请求相关数据库操作
 */

/**
 * 创建退款请求
 */
export async function createRefundRequest(refund: RefundRequestAttributes) {
  try {
    const model = await mainConnection.getModel<RefundRequestTable>(
      DataBaseTableNames.RefundRequest,
    );
    return await model.create(refund);
  } catch (error) {
    console.log('createRefundRequest error:', error);
    throw error;
  }
}

/**
 * 根据退款ID查询退款请求
 */
export async function findRefundRequestById(
  refundId: string,
): Promise<RefundRequestAttributes | null> {
  try {
    const model = await mainConnection.getModel<RefundRequestTable>(
      DataBaseTableNames.RefundRequest,
    );
    if (!model) return null;

    const refund = await model.findOne({
      where: { id: refundId },
    });

    return refund ? refund.toJSON() : null;
  } catch (error) {
    console.log('findRefundRequestById error:', error);
    return null;
  }
}

/**
 * 根据订单ID查询退款请求
 */
export async function findRefundRequestsByOrderId(
  orderId: string,
): Promise<RefundRequestAttributes[]> {
  try {
    const model = await mainConnection.getModel<RefundRequestTable>(
      DataBaseTableNames.RefundRequest,
    );
    if (!model) return [];

    const refunds = await model.findAll({
      where: { id: orderId },
      order: [['createdAt', 'DESC']],
    });

    return refunds.map((refund) => refund.toJSON());
  } catch (error) {
    console.log('findRefundRequestsByOrderId error:', error);
    return [];
  }
}

/**
 * 更新退款请求状态
 */
export async function updateRefundRequestStatus(
  refundId: string,
  status: string,
  processedBy?: string,
  processNote?: string,
) {
  try {
    const model = await mainConnection.getModel<RefundRequestTable>(
      DataBaseTableNames.RefundRequest,
    );
    const updateData: any = { status };

    if (processedBy) {
      updateData.processedBy = processedBy;
    }

    if (processNote) {
      updateData.processNote = processNote;
    }

    if (status === 'completed') {
      updateData.processedAt = new Date();
    }

    return await model.update(updateData, {
      where: { id: refundId },
    });
  } catch (error) {
    console.log('updateRefundRequestStatus error:', error);
    throw error;
  }
}

/**
 * 支付提供商相关数据库操作
 */

/**
 * 创建或更新支付提供商
 */
export async function saveOrUpdatePaymentProvider(provider: PaymentProviderAttributes) {
  try {
    const model = await mainConnection.getModel<PaymentProviderTable>(
      DataBaseTableNames.PaymentProvider,
    );
    return await model.upsert(provider);
  } catch (error) {
    console.log('saveOrUpdatePaymentProvider error:', error);
    throw error;
  }
}

/**
 * 获取所有可用的支付提供商
 */
export async function findActivePaymentProviders(): Promise<PaymentProviderAttributes[]> {
  try {
    const model = await mainConnection.getModel<PaymentProviderTable>(
      DataBaseTableNames.PaymentProvider,
    );
    if (!model) return [];

    const providers = await model.findAll({
      where: { isEnabled: true },
      order: [['sortOrder', 'ASC']],
    });

    return providers.map((provider) => provider.toJSON());
  } catch (error) {
    console.log('findActivePaymentProviders error:', error);
    return [];
  }
}

/**
 * 根据提供商代码查询支付提供商
 */
export async function findPaymentProviderByCode(
  providerCode: string,
): Promise<PaymentProviderAttributes | null> {
  try {
    const model = await mainConnection.getModel<PaymentProviderTable>(
      DataBaseTableNames.PaymentProvider,
    );
    if (!model) return null;

    const provider = await model.findOne({
      where: { providerName: providerCode },
    });

    return provider ? provider.toJSON() : null;
  } catch (error) {
    console.log('findPaymentProviderByCode error:', error);
    return null;
  }
}

/**
 * 更新支付提供商状态
 */
export async function updatePaymentProviderStatus(providerId: string, status: string) {
  try {
    const model = await mainConnection.getModel<PaymentProviderTable>(
      DataBaseTableNames.PaymentProvider,
    );
    return await model.update({ isEnabled: status === 'active' }, { where: { id: providerId } });
  } catch (error) {
    console.log('updatePaymentProviderStatus error:', error);
    throw error;
  }
}
