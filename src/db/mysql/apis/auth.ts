/**
 * 登录校验方法
 */
import { DataBaseTableNames } from 'typings';
import { Transaction } from 'sequelize';
import { mainConnection } from '..';
import { IEmailAuthAttributes, EmailAuthTable } from '../models/auth/emailAuth';
import { IUserTableAttributes, UserTable } from '../models/user';

const ADMIN_POWER = 999;
const ADMIN_BOOTSTRAP_LOCK_ID = 1;

export interface RegisterEmailUserParams {
  email: string;
  passwordHash: string;
  salt: string;
  userId: string;
}

export type RegisterEmailUserResult =
  | { status: 'created'; userId: string; power: number }
  | { status: 'email_exists' };

export interface EmailRegistrationDatabase<TTransaction> {
  transaction<T>(callback: (transaction: TTransaction) => Promise<T>): Promise<T>;
  lockAdminBootstrap(transaction: TTransaction): Promise<void>;
  findEmailAuth(email: string, transaction: TTransaction): Promise<IEmailAuthAttributes | null>;
  countActiveAdmins(transaction: TTransaction): Promise<number>;
  createUser(user: IUserTableAttributes, transaction: TTransaction): Promise<void>;
  createEmailAuth(emailAuth: IEmailAuthAttributes, transaction: TTransaction): Promise<void>;
}

export const normalizeAdminEmails = (adminEmails: string): string[] =>
  adminEmails
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

export function createEmailRegistrationOperation<TTransaction>(
  database: EmailRegistrationDatabase<TTransaction>,
) {
  return async (params: RegisterEmailUserParams, adminEmails: string): Promise<RegisterEmailUserResult> =>
    database.transaction(async (transaction) => {
      await database.lockAdminBootstrap(transaction);

      const existingEmailAuth = await database.findEmailAuth(params.email, transaction);
      if (existingEmailAuth) {
        return { status: 'email_exists' };
      }

      const isAllowlisted = normalizeAdminEmails(adminEmails).includes(params.email.toLowerCase());
      const activeAdminCount = await database.countActiveAdmins(transaction);
      const power = isAllowlisted || activeAdminCount === 0 ? ADMIN_POWER : 0;
      const nickname = `星际公民${Math.floor(Math.random() * 1000000000)
        .toString()
        .padStart(9, '0')}`;

      await database.createUser(
        {
          userId: params.userId,
          nickname,
          source: 'email',
          status: 'active',
          power,
        },
        transaction,
      );
      await database.createEmailAuth(
        {
          email: params.email,
          passwordHash: params.passwordHash,
          salt: params.salt,
          userId: params.userId,
          isVerified: true,
        },
        transaction,
      );

      return { status: 'created', userId: params.userId, power };
    });
}

const mysqlEmailRegistrationDatabase: EmailRegistrationDatabase<Transaction> = {
  async transaction<T>(callback: (transaction: Transaction) => Promise<T>): Promise<T> {
    const connection = await mainConnection.getConnection();
    return connection.transaction(callback);
  },
  async lockAdminBootstrap(transaction: Transaction): Promise<void> {
    const connection = await mainConnection.getConnection();
    const [rows] = await connection.query(
      'SELECT lock_id FROM adminBootstrapLock WHERE lock_id = ? FOR UPDATE',
      { replacements: [ADMIN_BOOTSTRAP_LOCK_ID], transaction },
    );
    if (!Array.isArray(rows) || rows.length !== 1) {
      throw new Error('Admin bootstrap lock row is missing');
    }
  },
  async findEmailAuth(email: string, transaction: Transaction): Promise<IEmailAuthAttributes | null> {
    const model = await mainConnection.getModel<EmailAuthTable>(DataBaseTableNames.EmailAuth);
    const emailAuth = await model.findOne({ where: { email }, transaction });
    return emailAuth ? emailAuth.toJSON() : null;
  },
  async countActiveAdmins(transaction: Transaction): Promise<number> {
    const model = await mainConnection.getModel<UserTable>(DataBaseTableNames.User);
    return model.count({ where: { power: ADMIN_POWER }, transaction });
  },
  async createUser(user: IUserTableAttributes, transaction: Transaction): Promise<void> {
    const model = await mainConnection.getModel<UserTable>(DataBaseTableNames.User);
    await model.create(user, { transaction });
  },
  async createEmailAuth(emailAuth: IEmailAuthAttributes, transaction: Transaction): Promise<void> {
    const model = await mainConnection.getModel<EmailAuthTable>(DataBaseTableNames.EmailAuth);
    await model.create(emailAuth, { transaction });
  },
};

const registerEmailUserAtomically = createEmailRegistrationOperation(mysqlEmailRegistrationDatabase);

export async function registerEmailUser(params: RegisterEmailUserParams, adminEmails: string) {
  return registerEmailUserAtomically(params, adminEmails);
}

// 查询邮箱是否存在
export async function findEmailIsExist(email: string): Promise<boolean> {
  if (!email) return false;

  const model = await mainConnection.getModel(DataBaseTableNames.EmailAuth);

  const result = await model.findOne({ where: { email } });

  return !!result;
}

// 新增或更新邮箱验证信息
export async function saveOrUpdateEmailAuth(params: {
  email: string;
  passwordHash: string;
  salt: string;
  userId: string;
}) {
  try {
    const model = await mainConnection.getModel(DataBaseTableNames.EmailAuth);
    const data = { ...params, isVerified: true };

    return await model
      .bulkCreate([data], {
        updateOnDuplicate: ['email', 'userId', 'passwordHash', 'salt', 'isVerified'],
      })
      .then(() => true);
  } catch (error) {
    console.log(error);
    throw error;
  }
}

// 根据邮箱获取用户邮箱验证表中的信息
export async function findEmailAuthByEmail(email: string) {
  const model = await mainConnection.getModel(DataBaseTableNames.EmailAuth);

  const result = await model.findOne({
    where: { email },
    attributes: ['salt', 'passwordHash', 'userId'],
  });

  return result ? result.dataValues : null;
}

// 根据UserId获取用户邮箱验证表中的信息
export async function findEmailAuthByUserId(userId: string) {
  const model = await mainConnection.getModel(DataBaseTableNames.EmailAuth);

  const result = await model.findOne({
    where: { userId },
    attributes: ['salt', 'passwordHash', 'email'],
  });

  return result ? result.dataValues : null;
}

// 新增或更新用户扫码验证信息
export async function saveOrUpdateScanAuth(params: { userId: string; deviceInfo: any }) {
  try {
    const model = await mainConnection.getModel(DataBaseTableNames.ScanAuth);

    return await model
      .bulkCreate([params], {
        updateOnDuplicate: ['userId', 'deviceInfo'],
      })
      .then(() => true);
  } catch (error) {
    console.log(error);
    throw error;
  }
}
