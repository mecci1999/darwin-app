import { queryAllUsers, saveOrUpdateUsers } from 'db/mysql/apis/user';
import Universe from 'node-universe/dist';
import { generateUserId } from 'utils/generateUserId';
import { pinoLoggerOptions } from 'config';
import * as dbConnections from '../db/mysql/index';
import { HttpResponseItem } from '../typings/response';

// 微服务名
const appName = 'user';

pinoLoggerOptions(appName).then((pinoOptions) => {
  const star = new Universe.Star({
    namespace: 'darwin-app',
    transporter: {
      type: 'KAFKA',
      debug: true,
      host: 'localhost:9092',
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
    actions: {
      // 网关服务的 dispatch 动作将请求转发到相应的微服务
      'v1.create': {
        metadata: {
          auth: true,
        },
        async handler(ctx, route, req, res): Promise<HttpResponseItem> {
          const params = ctx.params;
          // 生成userID，生成规则，
          const userId = generateUserId();
          // 在此处理 create 动作的逻辑
          if (!params?.username || !params?.password) {
            return {
              status: 400,
              data: {
                message: 'Invalid request body',
              },
            };
          }

          const user = await saveOrUpdateUsers([
            {
              userId,
              username: params.username,
              password: params.password,
              phone: params?.phone,
              email: params?.email,
            },
          ]);

          // 例如，将接收到的参数存储到数据库中
          return {
            status: 201,
            data: {
              message: 'user is creating~',
              content: { user: user },
            },
          };
        },
      },
      'v1.list': {
        metadata: {
          auth: false,
        },
        async handler(ctx) {
          const list = await queryAllUsers();

          // 例如，将接收到的参数存储到数据库中
          return {
            status: 200,
            data: { content: { users: list } },
          };
        },
      },
    },
    async created() {
      // 连接数据库
      await dbConnections.mainConnection.bindManinConnection({
        benchmark: true,
        logging(sql, timing) {
          if (timing && timing > 1000) {
            // 如果查询时间大于1s，将进行日志打印
            star.logger.warn(`mysql operation is timeout, sql: ${sql}, timing: ${timing}`);
          }

          star.logger.info(`mysql connection is success!`);
        },
      });
    },
  });

  // 启动网关微服务
  star.start().then(() => {
    console.log(`微服务 ${appName.toUpperCase()} 启动成功`);
  });
});
