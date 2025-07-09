// User微服务验证处理工具类
import { CreateUserParams, UpdateUserParams, UserQueryParams } from '../types';
import { VALIDATION_CONFIG, USER_CONFIG } from '../constants';
import UserUtils from './user-utils';

class ValidationHandler {
  private static instance: ValidationHandler;
  private userUtils: UserUtils;

  static getInstance(): ValidationHandler {
    if (!ValidationHandler.instance) {
      ValidationHandler.instance = new ValidationHandler();
    }
    return ValidationHandler.instance;
  }

  constructor() {
    this.userUtils = UserUtils.getInstance();
  }

  /**
   * 验证创建用户请求
   */
  validateCreateUserRequest(params: any): { valid: boolean; errors: string[]; sanitized?: CreateUserParams } {
    const errors: string[] = [];
    
    // 检查必需字段
    if (!params.userId || typeof params.userId !== 'string') {
      errors.push('用户ID是必需的且必须是字符串');
    }
    
    if (!params.source || typeof params.source !== 'string') {
      errors.push('用户来源是必需的且必须是字符串');
    }
    
    // 验证用户来源
    if (params.source) {
      const sourceValidation = this.userUtils.validateSource(params.source);
      if (!sourceValidation.valid) {
        errors.push(sourceValidation.error!);
      }
    }
    
    // 验证昵称（如果提供）
    if (params.nickname) {
      if (typeof params.nickname !== 'string') {
        errors.push('昵称必须是字符串');
      } else {
        const nicknameValidation = this.userUtils.validateNickname(params.nickname);
        if (!nicknameValidation.valid) {
          errors.push(nicknameValidation.error!);
        }
      }
    }
    
    // 验证邮箱（如果提供）
    if (params.email) {
      if (typeof params.email !== 'string') {
        errors.push('邮箱必须是字符串');
      } else {
        const emailValidation = this.userUtils.validateEmail(params.email);
        if (!emailValidation.valid) {
          errors.push(emailValidation.error!);
        }
      }
    }
    
    // 验证手机号（如果提供）
    if (params.phone) {
      if (typeof params.phone !== 'string') {
        errors.push('手机号必须是字符串');
      } else {
        const phoneValidation = this.userUtils.validatePhone(params.phone);
        if (!phoneValidation.valid) {
          errors.push(phoneValidation.error!);
        }
      }
    }
    
    // 验证头像URL（如果提供）
    if (params.avatar && typeof params.avatar !== 'string') {
      errors.push('头像URL必须是字符串');
    }
    
    // 验证元数据（如果提供）
    if (params.metadata && typeof params.metadata !== 'object') {
      errors.push('元数据必须是对象');
    }
    
    if (errors.length > 0) {
      return { valid: false, errors };
    }
    
    // 清理和标准化数据
    const sanitized: CreateUserParams = {
      userId: params.userId.trim(),
      source: params.source.trim(),
      nickname: params.nickname ? params.nickname.trim() : undefined,
      email: params.email ? params.email.trim().toLowerCase() : undefined,
      phone: params.phone ? params.phone.trim() : undefined,
      avatar: params.avatar ? params.avatar.trim() : undefined,
      metadata: params.metadata || {},
    };
    
    return { valid: true, errors: [], sanitized };
  }

  /**
   * 验证更新用户请求
   */
  validateUpdateUserRequest(params: any): { valid: boolean; errors: string[]; sanitized?: UpdateUserParams } {
    const errors: string[] = [];
    
    // 检查用户ID
    if (!params.userId || typeof params.userId !== 'string') {
      errors.push('用户ID是必需的且必须是字符串');
    }
    
    // 验证昵称（如果提供）
    if (params.nickname !== undefined) {
      if (typeof params.nickname !== 'string') {
        errors.push('昵称必须是字符串');
      } else {
        const nicknameValidation = this.userUtils.validateNickname(params.nickname);
        if (!nicknameValidation.valid) {
          errors.push(nicknameValidation.error!);
        }
      }
    }
    
    // 验证邮箱（如果提供）
    if (params.email !== undefined) {
      if (typeof params.email !== 'string') {
        errors.push('邮箱必须是字符串');
      } else {
        const emailValidation = this.userUtils.validateEmail(params.email);
        if (!emailValidation.valid) {
          errors.push(emailValidation.error!);
        }
      }
    }
    
    // 验证手机号（如果提供）
    if (params.phone !== undefined) {
      if (typeof params.phone !== 'string') {
        errors.push('手机号必须是字符串');
      } else {
        const phoneValidation = this.userUtils.validatePhone(params.phone);
        if (!phoneValidation.valid) {
          errors.push(phoneValidation.error!);
        }
      }
    }
    
    // 验证个人简介（如果提供）
    if (params.bio !== undefined) {
      if (typeof params.bio !== 'string') {
        errors.push('个人简介必须是字符串');
      } else {
        const bioValidation = this.userUtils.validateBio(params.bio);
        if (!bioValidation.valid) {
          errors.push(bioValidation.error!);
        }
      }
    }
    
    // 验证用户状态（如果提供）
    if (params.status !== undefined) {
      if (typeof params.status !== 'string') {
        errors.push('用户状态必须是字符串');
      } else if (!this.userUtils.isValidUserStatus(params.status)) {
        errors.push('无效的用户状态');
      }
    }
    
    // 验证头像URL（如果提供）
    if (params.avatar !== undefined && typeof params.avatar !== 'string') {
      errors.push('头像URL必须是字符串');
    }
    
    // 验证偏好设置（如果提供）
    if (params.preferences !== undefined) {
      const preferencesValidation = this.validatePreferences(params.preferences);
      if (!preferencesValidation.valid) {
        errors.push(...preferencesValidation.errors);
      }
    }
    
    // 验证元数据（如果提供）
    if (params.metadata !== undefined && typeof params.metadata !== 'object') {
      errors.push('元数据必须是对象');
    }
    
    if (errors.length > 0) {
      return { valid: false, errors };
    }
    
    // 清理和标准化数据
    const sanitized: UpdateUserParams = {
      userId: params.userId.trim(),
    };
    
    if (params.nickname !== undefined) {
      sanitized.nickname = params.nickname.trim();
    }
    if (params.email !== undefined) {
      sanitized.email = params.email.trim().toLowerCase();
    }
    if (params.phone !== undefined) {
      sanitized.phone = params.phone.trim();
    }
    if (params.bio !== undefined) {
      sanitized.bio = params.bio.trim();
    }
    if (params.status !== undefined) {
      sanitized.status = params.status as any;
    }
    if (params.avatar !== undefined) {
      sanitized.avatar = params.avatar.trim();
    }
    if (params.preferences !== undefined) {
      sanitized.preferences = params.preferences;
    }
    if (params.metadata !== undefined) {
      sanitized.metadata = params.metadata;
    }
    
    return { valid: true, errors: [], sanitized };
  }

  /**
   * 验证查询用户请求
   */
  validateQueryUserRequest(params: any): { valid: boolean; errors: string[]; sanitized?: UserQueryParams } {
    const errors: string[] = [];
    
    // 验证用户ID（如果提供）
    if (params.userId !== undefined && typeof params.userId !== 'string') {
      errors.push('用户ID必须是字符串');
    }
    
    // 验证邮箱（如果提供）
    if (params.email !== undefined) {
      if (typeof params.email !== 'string') {
        errors.push('邮箱必须是字符串');
      } else {
        const emailValidation = this.userUtils.validateEmail(params.email);
        if (!emailValidation.valid) {
          errors.push(emailValidation.error!);
        }
      }
    }
    
    // 验证手机号（如果提供）
    if (params.phone !== undefined) {
      if (typeof params.phone !== 'string') {
        errors.push('手机号必须是字符串');
      } else {
        const phoneValidation = this.userUtils.validatePhone(params.phone);
        if (!phoneValidation.valid) {
          errors.push(phoneValidation.error!);
        }
      }
    }
    
    // 验证状态（如果提供）
    if (params.status !== undefined) {
      if (typeof params.status !== 'string') {
        errors.push('状态必须是字符串');
      } else if (!this.userUtils.isValidUserStatus(params.status)) {
        errors.push('无效的用户状态');
      }
    }
    
    // 验证来源（如果提供）
    if (params.source !== undefined) {
      if (typeof params.source !== 'string') {
        errors.push('来源必须是字符串');
      } else {
        const sourceValidation = this.userUtils.validateSource(params.source);
        if (!sourceValidation.valid) {
          errors.push(sourceValidation.error!);
        }
      }
    }
    
    // 验证日期范围（如果提供）
    if (params.createdAfter !== undefined) {
      const date = new Date(params.createdAfter);
      if (isNaN(date.getTime())) {
        errors.push('创建时间起始日期格式不正确');
      }
    }
    
    if (params.createdBefore !== undefined) {
      const date = new Date(params.createdBefore);
      if (isNaN(date.getTime())) {
        errors.push('创建时间结束日期格式不正确');
      }
    }
    
    // 验证分页参数
    if (params.limit !== undefined) {
      const limit = parseInt(params.limit);
      if (isNaN(limit) || limit < 1 || limit > 100) {
        errors.push('限制数量必须是1-100之间的数字');
      }
    }
    
    if (params.offset !== undefined) {
      const offset = parseInt(params.offset);
      if (isNaN(offset) || offset < 0) {
        errors.push('偏移量必须是非负数字');
      }
    }
    
    if (errors.length > 0) {
      return { valid: false, errors };
    }
    
    // 清理和标准化数据
    const sanitized: UserQueryParams = {};
    
    if (params.userId !== undefined) {
      sanitized.userId = params.userId.trim();
    }
    if (params.email !== undefined) {
      sanitized.email = params.email.trim().toLowerCase();
    }
    if (params.phone !== undefined) {
      sanitized.phone = params.phone.trim();
    }
    if (params.status !== undefined) {
      sanitized.status = params.status.trim();
    }
    if (params.source !== undefined) {
      sanitized.source = params.source.trim();
    }
    if (params.createdAfter !== undefined) {
      sanitized.createdAfter = new Date(params.createdAfter);
    }
    if (params.createdBefore !== undefined) {
      sanitized.createdBefore = new Date(params.createdBefore);
    }
    if (params.limit !== undefined) {
      sanitized.limit = parseInt(params.limit);
    }
    if (params.offset !== undefined) {
      sanitized.offset = parseInt(params.offset);
    }
    
    return { valid: true, errors: [], sanitized };
  }

  /**
   * 验证用户偏好设置
   */
  private validatePreferences(preferences: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (typeof preferences !== 'object' || preferences === null) {
      errors.push('偏好设置必须是对象');
      return { valid: false, errors };
    }
    
    // 验证语言设置
    if (preferences.language !== undefined && typeof preferences.language !== 'string') {
      errors.push('语言设置必须是字符串');
    }
    
    // 验证时区设置
    if (preferences.timezone !== undefined && typeof preferences.timezone !== 'string') {
      errors.push('时区设置必须是字符串');
    }
    
    // 验证通知设置
    if (preferences.notifications !== undefined) {
      if (typeof preferences.notifications !== 'object') {
        errors.push('通知设置必须是对象');
      } else {
        const notifications = preferences.notifications;
        if (notifications.email !== undefined && typeof notifications.email !== 'boolean') {
          errors.push('邮件通知设置必须是布尔值');
        }
        if (notifications.push !== undefined && typeof notifications.push !== 'boolean') {
          errors.push('推送通知设置必须是布尔值');
        }
        if (notifications.sms !== undefined && typeof notifications.sms !== 'boolean') {
          errors.push('短信通知设置必须是布尔值');
        }
      }
    }
    
    return { valid: errors.length === 0, errors };
  }

  /**
   * 验证批量操作参数
   */
  validateBatchOperation(userIds: any): { valid: boolean; errors: string[]; sanitized?: string[] } {
    const errors: string[] = [];
    
    if (!Array.isArray(userIds)) {
      errors.push('用户ID列表必须是数组');
      return { valid: false, errors };
    }
    
    if (userIds.length === 0) {
      errors.push('用户ID列表不能为空');
      return { valid: false, errors };
    }
    
    if (userIds.length > 100) {
      errors.push('批量操作最多支持100个用户');
      return { valid: false, errors };
    }
    
    const sanitized: string[] = [];
    
    for (let i = 0; i < userIds.length; i++) {
      const userId = userIds[i];
      if (typeof userId !== 'string') {
        errors.push(`第${i + 1}个用户ID必须是字符串`);
      } else if (userId.trim().length === 0) {
        errors.push(`第${i + 1}个用户ID不能为空`);
      } else {
        sanitized.push(userId.trim());
      }
    }
    
    // 检查重复的用户ID
    const uniqueIds = new Set(sanitized);
    if (uniqueIds.size !== sanitized.length) {
      errors.push('用户ID列表中存在重复项');
    }
    
    return { valid: errors.length === 0, errors, sanitized };
  }
}

export default ValidationHandler;