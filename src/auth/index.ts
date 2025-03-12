/**
 * 登陆校验微服务
 * @author darwin
 * 关于登录验证服务
 * 本服务提供三种登录验证方式
 * 1、账号密码登录，需要验证码进行二次校验（验证码可以是邮箱验证或是短信验证）
 * 2、扫码登录，二维码key由服务端生成下发给客户端，客户端扫描后将二维码key传给服务端进行验证
 * 3、第三方登录验证，微信、QQ等第三方登录验证（需要结合客户端）也是二维码登录
 * 4、注册服务
 */
import { pinoLoggerOptions } from 'config';
import Universe from 'node-universe';
import authMethod from './method/index';
import authAction from './action/index';
// import authEvent from './event/index';
import * as dbConnections from '../db/mysql/index';

// 微服务名
const appName = 'auth';

pinoLoggerOptions(appName).then((pinoOptions) => {
  const star = new Universe.Star({
    namespace: 'darwin-app',
    transporter: {
      type: 'KAFKA',
      debug: true,
      host: 'localhost:9092',
    },
    cacher: {
      type: 'Redis',
      clone: true,
      options: {
        port: 6379, // Redis port
        host: 'localhost',
      },
    },
    serializer: {
      type: 'NotePack',
    },
    // logger: pinoOptions,
    // metrics: {
    //   enabled: true,
    //   reporter: {
    //     type: 'Prometheus',
    //     options: {},
    //   },
    // },
  });

  star.createService({
    name: appName,
    methods: authMethod(star),
    actions: authAction(star),
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
        star.logger?.error('auth_app is created fail~, error:', error);
      }
    },
  });

  // 启动身份校验微服务
  star.start().then(() => {
    star.logger?.info(`微服务 ${appName.toUpperCase()} 启动成功`);
  });
});
