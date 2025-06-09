/**
 * 用户退出登录接口
 */
import { saveOrUpdateUsers } from 'db/mysql/apis/user';
import { customAlphabet } from 'nanoid';
import { Context, Star } from 'node-universe';
import { ResponseCode } from 'typings/enum';
import { HttpResponseItem } from 'typings/response';

export default function createUser(star: Star) {
  return {
    'v1.create': {
      metadata: {
        auth: true,
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const params = ctx.params;

        // 在此处理 create 动作的逻辑
        if (!params.userId || !params.source) {
          return {
            status: 400,
            data: {
              content: null,
              message: 'Invalid request body',
              code: ResponseCode.ParamsError,
              success: false,
            },
          };
        }

        const id = customAlphabet('0123456789')(9);

        // 生成用户名
        const defaultNickname = `星际公民1${id}`;

        const user = await saveOrUpdateUsers([
          {
            userId: params.userId,
            nickname: defaultNickname,
            source: params.source,
            status: 'active',
          },
        ]);

        // 日志打印
        star.logger?.info(`用户${id}创建成功`);

        // 将接收到的参数存储到数据库中
        return {
          status: 201,
          data: {
            message: '创建成功~',
            content: { user },
            code: ResponseCode.Success,
            success: true,
          },
        };
      },
    },
  };
}
