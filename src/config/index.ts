/**
 * 配置相关的方法
 */
import { rotate } from 'pino-rotate-file';
import moment from 'moment-timezone';
import dotenv from 'dotenv';

dotenv.config({ path: `.env.${process.env.NODE_ENV}` });

// 相关配置
export const {
  MYSQL_HOST,
  MYSQL_PORT,
  MYSQL_DATABASE,
  MYSQL_USERNAME,
  MYSQL_PASSWORD,
  PASSWORD_SECRET_KEY,
  TOKEN_SECRET_KET,
  QR_CODE_EXPIRE,
  TOKEN_EXIPRE_TIME,
  REFRESH_TOKEN_EXIPRE_TIME,
} = process.env;

/**
 * pino日志配置
 */
export function pinoLoggerOptions(appName: string): Promise<any> {
  return new Promise((resolve, reject) => {
    rotate({
      maxAgeDays: 30, // 按照1天的作为分割，分别存储目录
      path: `./logs/${appName}`, // 日志文件存储目录
      mkdir: true,
      prettyOptions: {
        colorize: true,
        // [2019-08-31 08:40:53.481] INFO STAR: Universe is creating...
        customPrettifiers: {
          time: () => `[${moment().tz('Asia/Shanghai').format('YYYY-MM-DD HH:mm:ss:SSS')}]`,
          level: (inputData, key, log, extras) => `${extras.labelColorized}`,
          name: (value) => `${value}`,
          pid: (value) => `PID-${value}`,
          mod: (value, key, log, extras) =>
            `${extras.colors ? extras.colors.green(value.toLocaleUpperCase()) : value.toLocaleUpperCase()}`,
          nodeID: (value, key, log, extras) =>
            `${extras.colors ? extras.colors.green(value) : value}`,
          namespace: (value, key, log, extras) =>
            `${extras.colors ? extras.colors.green(value) : value}`,
          svc: (value, key, log, extras) => `${extras.colors ? extras.colors.green(value) : value}`,
          version: (value, key, log, extras) =>
            `${extras.colors ? extras.colors.green(value) : value}`,
          // messageKey: (inputData, key, log, extras) => `${inputData}`,
          // errorKey: (inputData, key, log, extras) => `${inputData}`,
        } as any,
      },
    })
      .then((_destination) => {
        const options = {
          name: appName,
          type: 'pino',
          options: {
            pino: {
              options: {
                name: appName.toLocaleUpperCase(),
                customLevels: {
                  fatal: 60,
                  error: 50,
                  warn: 40,
                  debug: 30,
                  customLevel: 25,
                  info: 20,
                  trace: 10,
                },
                flushInterval: 30 * 1000,
                useOnlyCustomLevels: true,
                useLevelLabels: true,
                formatters: {
                  level(lable: string, number: number) {
                    return { level: lable };
                  },
                },
                hooks: {
                  logMethod(inputArgs: any[], method, level) {
                    if (inputArgs.length > 1) {
                      let result: any = {
                        msg: '',
                      };

                      for (const arg of inputArgs) {
                        // 排除undefined和null类型
                        if (!arg) {
                          continue;
                        } else if (typeof arg === 'object') {
                          result.err = arg;
                        } else {
                          result.msg = result.msg + arg;
                        }
                      }

                      return method.apply(this, [result]);
                    }
                    return method.apply(this, inputArgs);
                  },
                },
              },
              destination: _destination,
            },
          },
        };

        resolve(options);
      })
      .catch((error) => {
        reject(error);
      });
  });
}
