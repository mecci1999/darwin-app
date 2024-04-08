/**
 * 数据表名称
 */
export enum DataBaseTableNames {
  User = "user",
  Config = "config",
  IPBlackList = "ipBlackList",
}

/**
 * ip黑名单状态
 */
export enum IPAddressBanStatus {
  active = "active", // 激活中，即封禁中
  disabled = "disabled", // 解封
}

/**
 * 错误码
 */
export enum ResponseErrorCode {
  IPNotAccess = 30001, // ip被封禁
}
