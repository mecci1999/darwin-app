import { DataBaseTableNames } from 'typings/enum';
import { mainConnection } from '..';
import { BillAttributes, BillTable } from '../models/billing/Bill';
import { BillItemAttributes, BillItemTable } from '../models/billing/BillItem';
import {
  UserBillingAddressAttributes,
  UserBillingAddressTable,
} from '../models/billing/UserBillingAddress';
import {
  BillingReminderSettingAttributes,
  BillingReminderSettingTable,
} from '../models/billing/BillingReminderSetting';

/**
 * 账单相关数据库操作
 */

/**
 * 创建账单
 */
export async function createBill(bill: BillAttributes) {
  try {
    const model = await mainConnection.getModel<BillTable>(DataBaseTableNames.Bill);
    return await model.create(bill as any);
  } catch (error) {
    console.log('createBill error:', error);
    throw error;
  }
}

/**
 * 根据账单ID查询账单
 */
export async function findBillById(billId: string): Promise<BillAttributes | null> {
  try {
    const model = await mainConnection.getModel<BillTable>(DataBaseTableNames.Bill);
    if (!model) return null;

    const bill = await model.findOne({
      where: { id: billId },
    });

    return bill ? bill.toJSON() : null;
  } catch (error) {
    console.log('findBillById error:', error);
    return null;
  }
}

/**
 * 根据用户ID查询账单列表
 */
export async function findBillsByUserId(userId: string): Promise<BillAttributes[]> {
  try {
    const model = await mainConnection.getModel<BillTable>(DataBaseTableNames.Bill);
    if (!model) return [];

    const bills = await model.findAll({
      where: { userId },
      order: [['billDate', 'DESC']],
    });

    return bills.map((bill) => bill.toJSON());
  } catch (error) {
    console.log('findBillsByUserId error:', error);
    return [];
  }
}

/**
 * 根据状态查询账单
 */
export async function findBillsByStatus(status: string): Promise<BillAttributes[]> {
  try {
    const model = await mainConnection.getModel<BillTable>(DataBaseTableNames.Bill);
    if (!model) return [];

    const bills = await model.findAll({
      where: { status },
      order: [['billDate', 'DESC']],
    });

    return bills.map((bill) => bill.toJSON());
  } catch (error) {
    console.log('findBillsByStatus error:', error);
    return [];
  }
}

/**
 * 更新账单状态
 */
export async function updateBillStatus(billId: string, status: string) {
  try {
    const model = await mainConnection.getModel<BillTable>(DataBaseTableNames.Bill);
    const updateData: any = { status };

    if (status === 'paid') {
      updateData.paidAt = new Date();
    }

    return await model.update(updateData, {
      where: { id: billId },
    });
  } catch (error) {
    console.log('updateBillStatus error:', error);
    throw error;
  }
}

/**
 * 账单项相关数据库操作
 */

/**
 * 创建账单项
 */
export async function createBillItem(billItem: BillItemAttributes) {
  try {
    const model = await mainConnection.getModel<BillItemTable>(DataBaseTableNames.BillItem);
    return await model.create(billItem as any);
  } catch (error) {
    console.log('createBillItem error:', error);
    throw error;
  }
}

/**
 * 批量创建账单项
 */
export async function createBillItems(billItems: BillItemAttributes[]) {
  try {
    const model = await mainConnection.getModel<BillItemTable>(DataBaseTableNames.BillItem);
    return await model.bulkCreate(billItems as any);
  } catch (error) {
    console.log('createBillItems error:', error);
    throw error;
  }
}

/**
 * 根据账单ID查询账单项
 */
export async function findBillItemsByBillId(billId: string): Promise<BillItemAttributes[]> {
  try {
    const model = await mainConnection.getModel<BillItemTable>(DataBaseTableNames.BillItem);
    if (!model) return [];

    const billItems = await model.findAll({
      where: { billId },
      order: [['createdAt', 'ASC']],
    });

    return billItems.map((item) => item.toJSON());
  } catch (error) {
    console.log('findBillItemsByBillId error:', error);
    return [];
  }
}

/**
 * 用户账单地址相关数据库操作
 */

/**
 * 创建或更新用户账单地址
 */
export async function saveOrUpdateUserBillingAddress(address: UserBillingAddressAttributes) {
  try {
    const model = await mainConnection.getModel<UserBillingAddressTable>(
      DataBaseTableNames.UserBillingAddress,
    );
    return await model.upsert(address as any);
  } catch (error) {
    console.log('saveOrUpdateUserBillingAddress error:', error);
    throw error;
  }
}

/**
 * 根据用户ID查询账单地址
 */
export async function findUserBillingAddressByUserId(
  userId: string,
): Promise<UserBillingAddressAttributes | null> {
  try {
    const model = await mainConnection.getModel<UserBillingAddressTable>(
      DataBaseTableNames.UserBillingAddress,
    );
    if (!model) return null;

    const address = await model.findOne({
      where: { userId },
    });

    return address ? address.toJSON() : null;
  } catch (error) {
    console.log('findUserBillingAddressByUserId error:', error);
    return null;
  }
}

/**
 * 账单提醒设置相关数据库操作
 */

/**
 * 创建或更新账单提醒设置
 */
export async function saveOrUpdateBillingReminderSetting(
  setting: BillingReminderSettingAttributes,
) {
  try {
    const model = await mainConnection.getModel<BillingReminderSettingTable>(
      DataBaseTableNames.BillingReminderSetting,
    );
    return await model.upsert(setting as any);
  } catch (error) {
    console.log('saveOrUpdateBillingReminderSetting error:', error);
    throw error;
  }
}

/**
 * 根据用户ID查询账单提醒设置
 */
export async function findBillingReminderSettingByUserId(
  userId: string,
): Promise<BillingReminderSettingAttributes | null> {
  try {
    const model = await mainConnection.getModel<BillingReminderSettingTable>(
      DataBaseTableNames.BillingReminderSetting,
    );
    if (!model) return null;

    const setting = await model.findOne({
      where: { userId },
    });

    return setting ? setting.toJSON() : null;
  } catch (error) {
    console.log('findBillingReminderSettingByUserId error:', error);
    return null;
  }
}

/**
 * 获取需要发送提醒的用户设置
 */
export async function findUsersNeedingBillingReminder(): Promise<
  BillingReminderSettingAttributes[]
> {
  try {
    const model = await mainConnection.getModel<BillingReminderSettingTable>(
      DataBaseTableNames.BillingReminderSetting,
    );
    if (!model) return [];

    const settings = await model.findAll({
      where: {
        reminderType: 'email',
        isEnabled: true,
      },
    });

    return settings.map((setting) => setting.toJSON());
  } catch (error) {
    console.log('findUsersNeedingBillingReminder error:', error);
    return [];
  }
}

/**
 * 综合查询：获取账单及其详细项目
 */
export async function findBillWithItems(billId: string): Promise<{
  bill: BillAttributes | null;
  items: BillItemAttributes[];
}> {
  try {
    const [bill, items] = await Promise.all([findBillById(billId), findBillItemsByBillId(billId)]);

    return { bill, items };
  } catch (error) {
    console.log('findBillWithItems error:', error);
    return { bill: null, items: [] };
  }
}

/**
 * 获取用户账单统计信息
 */
export async function getUserBillingStats(userId: string): Promise<{
  totalBills: number;
  paidBills: number;
  unpaidBills: number;
  totalAmount: number;
  unpaidAmount: number;
}> {
  try {
    const model = await mainConnection.getModel<BillTable>(DataBaseTableNames.Bill);
    if (!model) {
      return {
        totalBills: 0,
        paidBills: 0,
        unpaidBills: 0,
        totalAmount: 0,
        unpaidAmount: 0,
      };
    }

    const [totalStats, unpaidStats] = await Promise.all([
      model.findOne({
        where: { userId },
        attributes: [
          [
            mainConnection.Sequelize.fn('COUNT', mainConnection.Sequelize.col('id')),
            'totalBills',
          ],
          [
            mainConnection.Sequelize.fn('SUM', mainConnection.Sequelize.col('total')),
            'totalAmount',
          ],
          [
            mainConnection.Sequelize.fn(
              'SUM',
              mainConnection.Sequelize.literal("CASE WHEN status = 'paid' THEN 1 ELSE 0 END"),
            ),
            'paidBills',
          ],
        ],
        raw: true,
      }),
      model.findOne({
        where: {
          userId,
          status: { [mainConnection.Sequelize.Op.ne]: 'paid' },
        },
        attributes: [
          [
            mainConnection.Sequelize.fn('COUNT', mainConnection.Sequelize.col('id')),
            'unpaidBills',
          ],
          [
            mainConnection.Sequelize.fn('SUM', mainConnection.Sequelize.col('total')),
            'unpaidAmount',
          ],
        ],
        raw: true,
      }),
    ]);

    return {
      totalBills: Number((totalStats as any)?.totalBills) || 0,
      paidBills: Number((totalStats as any)?.paidBills) || 0,
      unpaidBills: Number((unpaidStats as any)?.unpaidBills) || 0,
      totalAmount: Number((totalStats as any)?.totalAmount) || 0,
      unpaidAmount: Number((unpaidStats as any)?.unpaidAmount) || 0,
    };
  } catch (error) {
    console.log('getUserBillingStats error:', error);
    return {
      totalBills: 0,
      paidBills: 0,
      unpaidBills: 0,
      totalAmount: 0,
      unpaidAmount: 0,
    };
  }
}
