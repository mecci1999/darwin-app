/**
 * 配置相关的key值
 */
export enum ConfigKeysMap {
  IPAccessBlackList = "IPAccessBlackList", // IP访问黑名单相关配置
  PinoLogger = "PinoLogger", // pino日志模块相关配置
}

export interface IConfig {
  key: string | ConfigKeysMap;
  value: any;
}
