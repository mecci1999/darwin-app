import { queryAllUsers, saveOrUpdateUsers } from "db/mysql/apis/user";
import Universe from "node-universe/dist";
import { generateUserId } from "utils/generateUserId";
import * as dbConnections from "../db/mysql/index";

const star = new Universe.Star({
  namespace: "darwin-app",
  transporter: {
    type: "KAFKA",
    debug: true,
    host: "localhost:9092",
  },
  // cacher: {
  //   type: "Redis",
  //   clone: true,
  //   options: {
  //     port: 6379, // Redis port
  //     host: "localhost",
  //   },
  // },
});

star.createService({
  name: "user",
  actions: {
    // 网关服务的 dispatch 动作将请求转发到相应的微服务
    "v1.create": {
      async handler(ctx) {
        const params = ctx.params;
        // 生成userID，生成规则，
        const userId = generateUserId();
        // 在此处理 create 动作的逻辑
        if (!params?.username || !params?.password) {
          return { code: 500, result: "params is error!" };
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
          code: 201,
          result: {
            status: "user is creating~",
            user: user,
          },
        };
      },
    },
    "v1.list": {
      async handler(ctx) {
        const list = await queryAllUsers();

        // 例如，将接收到的参数存储到数据库中
        return {
          code: 200,
          result: { content: { users: list } },
        };
      },
    },
  },

  async started() {
    // 启动时连接数据库
    // await dbConnections.mainConnection.bindManinConnection({
    //   benchmark: true,
    //   logging(sql, timing) {
    //     if (timing && timing > 1000) {
    //       // 如果查询时间大于1s，将进行日志打印
    //       star.logger.warn(
    //         `mysql operation is timeout, sql: ${sql}, timing: ${timing}`
    //       );
    //     }
    //   },
    // });
  },
});

// 启动网关微服务
star.start();
