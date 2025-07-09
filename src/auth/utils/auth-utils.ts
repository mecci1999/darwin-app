import crypto from 'crypto';
import { ResponseUtils } from '../../utils';
import { ResponseCode } from '../../typings/enum';
import { AuthState, RSAKeyConfig } from '../types';
import { AUTH_CONFIG, RSA_CONFIG } from '../constants';

/**
 * 认证工具类
 */
export class AuthUtils {
  /**
   * 生成RSA密钥对
   */
  static generateRSAKeyPair(config: RSAKeyConfig = RSA_CONFIG): {
    publicKey: string;
    privateKey: string;
  } {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: config.keySize,
      publicKeyEncoding: config.publicKeyEncoding,
      privateKeyEncoding: config.privateKeyEncoding,
    });

    return { publicKey, privateKey };
  }

  /**
   * 检查并生成RSA密钥对
   */
  static checkAndGenerateRSA(state: AuthState, logger?: any): void {
    if (!state.rsaKeys) {
      try {
        state.rsaKeys = AuthUtils.generateRSAKeyPair();
        logger?.info('RSA key pair generated successfully');
      } catch (error) {
        logger?.error('Failed to generate RSA key pair:', error);
        throw error;
      }
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
    if (attempts.count >= AUTH_CONFIG.maxLoginAttempts) {
      const lockedUntil = now + AUTH_CONFIG.loginAttemptWindow * 1000;
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
   * 生成验证码
   */
  static generateVerificationCode(length: number = 6): string {
    return Math.random()
      .toString()
      .slice(2, 2 + length);
  }

  /**
   * 存储验证码
   */
  static storeVerificationCode(
    identifier: string,
    code: string,
    type: 'email' | 'sms',
    state: AuthState,
  ): void {
    state.verificationCodes.set(identifier, {
      code,
      type,
      expiry: Date.now() + AUTH_CONFIG.verificationCodeExpireTime * 1000,
    });
  }

  /**
   * 验证验证码
   */
  static verifyCode(identifier: string, code: string, state: AuthState): boolean {
    const stored = state.verificationCodes.get(identifier);

    if (!stored) {
      return false;
    }

    if (stored.expiry < Date.now()) {
      state.verificationCodes.delete(identifier);
      return false;
    }

    if (stored.code !== code) {
      return false;
    }

    // 验证成功，删除验证码
    state.verificationCodes.delete(identifier);
    return true;
  }

  /**
   * 生成二维码密钥
   */
  static generateQRKey(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * 存储二维码状态
   */
  static storeQRCode(qrKey: string, state: AuthState): void {
    state.qrCodes.set(qrKey, {
      status: 'pending',
      expiry: Date.now() + 5 * 60 * 1000, // 5分钟过期
    });
  }

  /**
   * 更新二维码状态
   */
  static updateQRCodeStatus(
    qrKey: string,
    status: 'scanned' | 'confirmed' | 'expired',
    userId?: string,
    state?: AuthState,
  ): boolean {
    if (!state) return false;

    const qrCode = state.qrCodes.get(qrKey);

    if (!qrCode) {
      return false;
    }

    if (qrCode.expiry < Date.now()) {
      state.qrCodes.delete(qrKey);
      return false;
    }

    state.qrCodes.set(qrKey, {
      ...qrCode,
      status,
      userId,
    });

    return true;
  }

  /**
   * 获取二维码状态
   */
  static getQRCodeStatus(qrKey: string, state: AuthState): any {
    const qrCode = state.qrCodes.get(qrKey);

    if (!qrCode) {
      return null;
    }

    if (qrCode.expiry < Date.now()) {
      state.qrCodes.delete(qrKey);
      return { status: 'expired' };
    }

    return {
      status: qrCode.status,
      userId: qrCode.userId,
    };
  }

  /**
   * 清理过期数据
   */
  static cleanupExpiredData(state: AuthState): void {
    const now = Date.now();

    // 清理过期的验证码
    for (const [key, value] of state.verificationCodes.entries()) {
      if (value.expiry < now) {
        state.verificationCodes.delete(key);
      }
    }

    // 清理过期的二维码
    for (const [key, value] of state.qrCodes.entries()) {
      if (value.expiry < now) {
        state.qrCodes.delete(key);
      }
    }

    // 清理过期的登录锁定
    for (const [key, value] of state.loginAttempts.entries()) {
      if (value.lockedUntil && value.lockedUntil < now) {
        state.loginAttempts.delete(key);
      }
    }
  }

  /**
   * 创建成功响应
   */
  static createSuccessResponse(content: any, message: string = 'success') {
    return ResponseUtils.createResponse(200, content, message, ResponseCode.Success);
  }

  /**
   * 创建错误响应
   */
  static createErrorResponse(code: ResponseCode, message: string, status: number = 400) {
    return ResponseUtils.createResponse(status, null, message, code, false);
  }
}
