// User微服务工具类
import { customAlphabet } from 'nanoid';
import { UserInfo, UserProfile, CreateUserParams, UpdateUserParams } from '../types';
import { USER_CONFIG, VALIDATION_CONFIG } from '../constants';

class UserUtils {
  private static instance: UserUtils;
  private nanoid = customAlphabet('0123456789', USER_CONFIG.NICKNAME_ID_LENGTH);

  static getInstance(): UserUtils {
    if (!UserUtils.instance) {
      UserUtils.instance = new UserUtils();
    }
    return UserUtils.instance;
  }

  /**
   * 生成默认昵称
   */
  generateDefaultNickname(): string {
    const id = this.nanoid();
    return `${USER_CONFIG.DEFAULT_NICKNAME_PREFIX}${id}`;
  }

  /**
   * 验证用户昵称
   */
  validateNickname(nickname: string): { valid: boolean; error?: string } {
    if (!nickname || nickname.trim().length === 0) {
      return { valid: false, error: '昵称不能为空' };
    }

    const trimmed = nickname.trim();
    if (trimmed.length < VALIDATION_CONFIG.NICKNAME_MIN_LENGTH) {
      return {
        valid: false,
        error: `昵称长度不能少于${VALIDATION_CONFIG.NICKNAME_MIN_LENGTH}个字符`,
      };
    }

    if (trimmed.length > VALIDATION_CONFIG.NICKNAME_MAX_LENGTH) {
      return {
        valid: false,
        error: `昵称长度不能超过${VALIDATION_CONFIG.NICKNAME_MAX_LENGTH}个字符`,
      };
    }

    // 检查特殊字符
    const invalidChars = /[<>"'&]/;
    if (invalidChars.test(trimmed)) {
      return { valid: false, error: '昵称包含非法字符' };
    }

    return { valid: true };
  }

  /**
   * 验证邮箱格式
   */
  validateEmail(email: string): { valid: boolean; error?: string } {
    if (!email) {
      return { valid: true }; // 邮箱是可选的
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return { valid: false, error: '邮箱格式不正确' };
    }

    return { valid: true };
  }

  /**
   * 验证手机号格式
   */
  validatePhone(phone: string): { valid: boolean; error?: string } {
    if (!phone) {
      return { valid: true }; // 手机号是可选的
    }

    const phoneRegex = /^1[3-9]\d{9}$/;
    if (!phoneRegex.test(phone)) {
      return { valid: false, error: '手机号格式不正确' };
    }

    return { valid: true };
  }

  /**
   * 验证用户来源
   */
  validateSource(source: string): { valid: boolean; error?: string } {
    if (!source) {
      return { valid: false, error: '用户来源不能为空' };
    }

    if (!VALIDATION_CONFIG.ALLOWED_SOURCES.includes(source)) {
      return { valid: false, error: '无效的用户来源' };
    }

    return { valid: true };
  }

  /**
   * 验证个人简介
   */
  validateBio(bio: string): { valid: boolean; error?: string } {
    if (!bio) {
      return { valid: true }; // 个人简介是可选的
    }

    if (bio.length > VALIDATION_CONFIG.BIO_MAX_LENGTH) {
      return {
        valid: false,
        error: `个人简介长度不能超过${VALIDATION_CONFIG.BIO_MAX_LENGTH}个字符`,
      };
    }

    return { valid: true };
  }

  /**
   * 验证创建用户参数
   */
  validateCreateUserParams(params: CreateUserParams): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!params.userId) {
      errors.push('用户ID不能为空');
    }

    const sourceValidation = this.validateSource(params.source);
    if (!sourceValidation.valid) {
      errors.push(sourceValidation.error!);
    }

    if (params.nickname) {
      const nicknameValidation = this.validateNickname(params.nickname);
      if (!nicknameValidation.valid) {
        errors.push(nicknameValidation.error!);
      }
    }

    if (params.email) {
      const emailValidation = this.validateEmail(params.email);
      if (!emailValidation.valid) {
        errors.push(emailValidation.error!);
      }
    }

    if (params.phone) {
      const phoneValidation = this.validatePhone(params.phone);
      if (!phoneValidation.valid) {
        errors.push(phoneValidation.error!);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * 验证更新用户参数
   */
  validateUpdateUserParams(params: UpdateUserParams): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!params.userId) {
      errors.push('用户ID不能为空');
    }

    if (params.nickname) {
      const nicknameValidation = this.validateNickname(params.nickname);
      if (!nicknameValidation.valid) {
        errors.push(nicknameValidation.error!);
      }
    }

    if (params.email) {
      const emailValidation = this.validateEmail(params.email);
      if (!emailValidation.valid) {
        errors.push(emailValidation.error!);
      }
    }

    if (params.phone) {
      const phoneValidation = this.validatePhone(params.phone);
      if (!phoneValidation.valid) {
        errors.push(phoneValidation.error!);
      }
    }

    if (params.bio) {
      const bioValidation = this.validateBio(params.bio);
      if (!bioValidation.valid) {
        errors.push(bioValidation.error!);
      }
    }

    if (params.status && !Object.values(USER_CONFIG.STATUS).includes(params.status)) {
      errors.push('无效的用户状态');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * 清理用户数据（移除敏感信息）
   */
  sanitizeUserInfo(user: UserInfo): Partial<UserInfo> {
    return {
      userId: user.userId,
      nickname: user.nickname,
      avatar: user.avatar,
      bio: user.bio,
      status: user.status,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    };
  }

  /**
   * 格式化用户资料
   */
  formatUserProfile(user: UserInfo): UserProfile {
    return {
      userId: user.userId,
      nickname: user.nickname,
      avatar: user.avatar || USER_CONFIG.AVATAR_DEFAULT_URL,
      bio: user.bio || '',
      preferences: {
        language: 'zh-CN',
        timezone: 'Asia/Shanghai',
        notifications: {
          email: true,
          push: true,
          sms: false,
        },
      },
      metadata: {},
    };
  }

  /**
   * 生成缓存键
   */
  generateCacheKey(type: string, identifier: string): string {
    return `user:${type}:${identifier}`;
  }

  /**
   * 检查用户状态是否有效
   */
  isValidUserStatus(status: string): boolean {
    return Object.values(USER_CONFIG.STATUS).includes(status);
  }

  /**
   * 检查用户是否活跃
   */
  isActiveUser(user: UserInfo): boolean {
    return user.status === USER_CONFIG.STATUS.ACTIVE;
  }

  /**
   * 计算用户年龄（基于创建时间）
   */
  calculateUserAge(createdAt: Date): number {
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - createdAt.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24)); // 返回天数
  }
}

export default UserUtils;
