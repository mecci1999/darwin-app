import { DatabaseState } from 'db/mysql';

/**
 * 认证服务状态接口
 */
export interface AuthState extends DatabaseState {
  // RSA密钥对
  rsaKeys?: {
    publicKey: string;
    privateKey: string;
  };

  // 登录尝试记录
  loginAttempts: Map<
    string,
    {
      count: number;
      lastAttempt: number;
      lockedUntil?: number;
    }
  >;
}

/**
 * 用户登录参数
 */
export interface LoginParams {
  email?: string;
  phone?: string;
  password: string;
  verificationCode?: string;
  rememberMe?: boolean;
}

/**
 * 用户注册参数
 */
export interface RegisterParams {
  email?: string;
  phone?: string;
  password: string;
  verificationCode: string;
  username?: string;
}

/**
 * 二维码登录参数
 */
export interface QRCodeParams {
  qrKey: string;
  action: 'generate' | 'scan' | 'confirm' | 'status';
  userId?: string;
}

/**
 * 密码重置参数
 */
export interface PasswordResetParams {
  email?: string;
  phone?: string;
  verificationCode: string;
  newPassword: string;
}

/**
 * 令牌刷新参数
 */
export interface TokenRefreshParams {
  refreshToken: string;
}

/**
 * 验证码发送参数
 */
export interface VerificationCodeParams {
  email?: string;
  phone?: string;
  type: 'login' | 'register' | 'reset' | 'verify';
}
