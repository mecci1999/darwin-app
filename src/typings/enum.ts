/**
 * 数据表名称
 */
export enum DataBaseTableNames {
  User = 'user',
  Config = 'config',
  IPBlackList = 'ipBlackList',
  EmailAuth = 'emailAuth',
  WechatAuth = 'wechatAuth',
  ScanAuth = 'scanAuth',
  // SaaS 相关表
  SubscriptionPlan = 'SubscriptionPlan',
  UserSubscription = 'UserSubscription',
  UserQuota = 'UserQuota',
  QuotaUsageHistory = 'QuotaUsageHistory',
  ApiKey = 'ApiKey',
  ApiKeyStats = 'ApiKeyStats',
  PaymentOrder = 'PaymentOrder',
  RefundRequest = 'RefundRequest',
  PaymentProvider = 'PaymentProvider',
  Bill = 'Bill',
  BillItem = 'BillItem',
  UserBillingAddress = 'UserBillingAddress',
  BillingReminderSetting = 'BillingReminderSetting',
}

/**
 * ip黑名单状态
 */
export enum IPAddressBanStatus {
  active = 'active', // 激活中，即封禁中
  disabled = 'disabled', // 解封
}

/**
 * 请求响应码
 */
export enum ResponseCode {
  Success = 0, // 成功
  ServiceActionFaild = 10000, // 服务操作失败
  ParamsError = 10001, // 参数错误
  TooManyRequests = 10002, // 请求过于频繁
  ERR_INVALID_TOKEN = 10003, // 无效token
  UserNotExist = 20001, // 用户不存在
  UserAlreadyExist = 20002, // 用户已存在
  UserPasswordError = 20003, // 用户密码错误
  UserEmailError = 20004, // 用户邮箱错误
  UserEmailAlreadyExist = 20005, // 用户邮箱已存在
  UserEmailNotExist = 20006, // 用户邮箱不存在
  UserEmailAuthError = 20007, // 用户邮箱认证错误
  UserWechatAuthError = 20008, // 用户微信认证错误
  UserScanAuthError = 20009, // 用户扫码认证错误
  UserEmailCodeIsError = 20010, // 邮箱验证码错误
  QrCodeExpired = 20011, // 二维码过期
  UserNotLoginError = 20012, // 用户未登录
  AppKeyIsInvalid = 20013, // appKey无效
  UserQuotaExceeded = 20014, // 用户额度已超
  AppKeyIsInactive = 20015, // appKey未激活
  AppKeyIsExpired = 20016, // appKey已过期
  IPNotAccess = 30001, // ip被封禁
  NotLogin = 30002, // 用户未登录
  NoPermissionError = 30003, // 没有权限
  REFRESH_TOKEN = 40001, // 续签
}

/**
 * 配置相关的key值
 */
export enum ConfigKeysMap {
  IPAccessBlackList = 'IPAccessBlackList', // IP访问黑名单相关配置
  PinoLogger = 'PinoLogger', // pino日志模块相关配置
}
