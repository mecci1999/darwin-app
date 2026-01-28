import crypto from 'crypto';
import { queryConfigs, saveOrUpdateConfigs } from 'db/mysql/apis/config';
import { AuthState } from '../types';

/**
 * 认证工具类
 */
export class AuthUtils {
  /**¨
   * 生成RSA密钥对
   */
  static generateRSAKeyPair(): {
    publicKey: string;
    privateKey: string;
  } {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });

    const publicKeyBuffer = publicKey.export({ type: 'spki', format: 'pem' });
    const privateKeyBuffer = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const publicKeyText = publicKeyBuffer.toString('utf-8');
    const privateKeyText = privateKeyBuffer.toString('utf-8');

    return { publicKey: publicKeyText, privateKey: privateKeyText };
  }

  /**
   * 检查并生成RSA密钥对
   */
  static async checkAndGenerateRSA(state: AuthState, logger?: any): Promise<void> {
    try {
      const result = (await queryConfigs(['rsa'])) || [];
      if (result.length > 0) {
        const rsaData = JSON.parse(result[0].value);
        if (rsaData.publicKey && rsaData.privateKey) {
          logger?.info('RSA密钥对已存在，跳过生成', rsaData.privateKey);
          return;
        }
      }

      logger?.info('RSA密钥对不存在，开始生成...');
      const keyPair = AuthUtils.generateRSAKeyPair();

      await saveOrUpdateConfigs([{ key: 'rsa', value: JSON.stringify(keyPair) }]);
      logger?.info('RSA密钥对生成并保存成功');
    } catch (error) {
      logger?.error('检查或生成RSA密钥对时发生错误:', error);
      throw error;
    }
  }

  /**
   * 验证密码强度
   */
  static validatePasswordStrength(password: string): { valid: boolean; message: string } {
    if (password.length < 8) {
      return { valid: false, message: '密码长度至少8位' };
    }

    if (!/(?=.*[a-z])/.test(password)) {
      return { valid: false, message: '密码必须包含小写字母' };
    }

    if (!/(?=.*[A-Z])/.test(password)) {
      return { valid: false, message: '密码必须包含大写字母' };
    }

    if (!/(?=.*\d)/.test(password)) {
      return { valid: false, message: '密码必须包含数字' };
    }

    if (!/(?=.*[!@#$%^&*])/.test(password)) {
      return { valid: false, message: '密码必须包含特殊字符(!@#$%^&*)' };
    }

    return { valid: true, message: '密码强度符合要求' };
  }

  /**
   * 检查登录尝试次数
   */
  static checkLoginAttempts(
    identifier: string,
    state: AuthState,
  ): { allowed: boolean; lockedUntil?: number } {
    const attempts = state.loginAttempts.get(identifier);

    if (!attempts) {
      return { allowed: true };
    }

    const now = Date.now();

    // 检查是否还在锁定期内
    if (attempts.lockedUntil && attempts.lockedUntil > now) {
      return { allowed: false, lockedUntil: attempts.lockedUntil };
    }

    // 如果锁定期已过，重置尝试次数
    if (attempts.lockedUntil && attempts.lockedUntil <= now) {
      state.loginAttempts.delete(identifier);
      return { allowed: true };
    }

    // 检查尝试次数
    if (attempts.count >= 5) {
      // 最大尝试次数
      const lockedUntil = now + 900 * 1000; // 15分钟锁定
      state.loginAttempts.set(identifier, {
        ...attempts,
        lockedUntil,
      });
      return { allowed: false, lockedUntil };
    }

    return { allowed: true };
  }

  /**
   * 记录登录尝试
   */
  static recordLoginAttempt(identifier: string, success: boolean, state: AuthState): void {
    if (success) {
      // 登录成功，清除尝试记录
      state.loginAttempts.delete(identifier);
      return;
    }

    const attempts = state.loginAttempts.get(identifier) || {
      count: 0,
      lastAttempt: 0,
    };

    state.loginAttempts.set(identifier, {
      count: attempts.count + 1,
      lastAttempt: Date.now(),
      lockedUntil: attempts.lockedUntil,
    });
  }

  /**
   * 清理过期数据
   */
  static cleanupExpiredData(state: AuthState): void {
    const now = Date.now();

    // 清理过期的登录锁定
    for (const [key, value] of state.loginAttempts.entries()) {
      if (value.lockedUntil && value.lockedUntil < now) {
        state.loginAttempts.delete(key);
      }
    }
  }
}
