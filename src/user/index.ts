import { queryAllUsers, saveOrUpdateUsers } from 'db/mysql/apis/user';
import { Star } from 'node-universe/dist';
import { pinoLoggerOptions } from 'config';
import * as dbConnections from '../db/mysql/index';
import { HttpResponseItem } from '../typings/response';
import { ResponseCode } from 'typings/enum';
import { customAlphabet } from 'nanoid';
import userActions from './actions';

// 微服务名
const appName = 'user';

pinoLoggerOptions(appName).then((pinoOptions) => {
  const star = new Star({
    namespace: 'darwin-app',
    transporter: {
      type: 'KAFKA',
      debug: true,
      host: 'localhost:9092',
    },
    serializer: {
      type: 'NotePack',
    },
    // 日志模块
    // logger: pinoOptions,
    cacher: {
      type: 'Redis',
      clone: true,
      options: {
        port: 6379, // Redis port
        host: 'localhost',
      },
    },
    // cacher: {
    //   type: "Redis",
    //   clone: true,
    //   options: {
    //     port: 6379, // Redis port
    //     host: "localhost",
    //   },
    // },
    // logger: pinoOptions,
    // metrics: {
    //   enabled: true,
    //   reporter: {
    //     type: "Prometheus",
    //     options: {
    //       port: 3031,
    //     },
    //   },
    // },
  });

  star.createService({
    name: appName,
    methods: {},
    actions: userActions(star),
    async created() {
      try {
        // 连接数据库
        await dbConnections.mainConnection.bindManinConnection({
          benchmark: true,
          logging(sql, timing) {
            if (timing && timing > 1000) {
              // 如果查询时间大于1s，将进行日志打印
              star.logger?.warn(`mysql operation is timeout, sql: ${sql}, timing: ${timing}`);
            }
          },
        });

        star.logger?.info('Mysql connection is success!');
      } catch (error) {
        star.logger?.error('user_app is created fail~, error:', error);
      }
    },
    // 结束时操作
    async stopped() {
      // 断开数据库连接
      await dbConnections.mainConnection.destroy();
    },
  });

  // 启动网关微服务
  star.start().then(() => {
    star.logger?.info(`微服务 ${appName.toUpperCase()} 启动成功`);
  });
});
