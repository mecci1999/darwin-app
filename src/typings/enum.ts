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
}

/**
 * ip黑名单状态
 */
export enum IPAddressBanStatus {
  active = 'active', // 激活中，即封禁中
  disabled = 'disabled', // 解封
}

/**
 * 错误码
 */
export enum ResponseErrorCode {
  Success = 0, // 成功
  ServiceActionFaild = 10000, // 服务操作失败
  ParamsError = 10001, // 参数错误
  UserNotExist = 20001, // 用户不存在
  UserAlreadyExist = 20002, // 用户已存在
  UserPasswordError = 20003, // 用户密码错误
  UserEmailError = 20004, // 用户邮箱错误
  UserEmailAlreadyExist = 20005, // 用户邮箱已存在
  UserEmailNotExist = 20006, // 用户邮箱不存在
  UserEmailAuthError = 20007, // 用户邮箱认证错误
  UserWechatAuthError = 20008, // 用户微信认证错误
  UserScanAuthError = 20009, // 用户扫码认证错误
  IPNotAccess = 30001, // ip被封禁
  NotLogin = 30002, // 用户未登录
  ERR_INVALID_TOKEN = 30003, // 无效token
}
