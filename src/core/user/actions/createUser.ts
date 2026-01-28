/**
 * 用户创建动作
 */
import { customAlphabet } from 'nanoid';
import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, Starlight } from 'typings';
import { EventHandler } from '../utils';

export default function createUser(star: Starlight) {
  return {
    'v1.create': {
      metadata: {
        auth: true,
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        // console.time('UserCreateAction'); // Start timing action
        const params = ctx.params;

        // 在此处理 create 动作的逻辑
        if (!params.userId || !params.source) {
          // console.timeEnd('UserCreateAction');
          return {
            status: 400,
            data: {
              content: null,
              message: 'Invalid request body',
              code: HttpResponseCode.ParamsError,
              success: false,
            },
          };
        }

        const id = customAlphabet('0123456789')(9);

        // 生成用户名
        const defaultNickname = `星际公民${id}`;

        // console.time('UserSaveDB'); // Start timing DB save
        const user = await star.db.user.saveOrUpdateUsers([
          {
            userId: params.userId,
            nickname: defaultNickname,
            source: params.source,
            status: 'active',
          },
        ]);
        // console.timeEnd('UserSaveDB'); // End timing DB save

        if (!user) {
          // console.timeEnd('UserCreateAction');
          throw new Error('Failed to save user');
        }

        // 日志打印
        star.logger?.info(`用户${id}创建成功`);

        // 发布用户创建事件
        // const eventHandler = EventHandler.getInstance();
        // eventHandler.publishUserCreated(params.userId, {
        //   nickname: defaultNickname,
        //   source: params.source,
        //   status: 'active',
        // });

        // console.timeEnd('UserCreateAction'); // End timing action
        // 将接收到的参数存储到数据库中
        return {
          status: 201,
          data: {
            message: '创建成功~',
            content: { user },
            code: HttpResponseCode.Success,
            success: true,
          },
        };
      },
    },
  };
}
