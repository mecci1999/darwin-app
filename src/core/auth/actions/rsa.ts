import { queryConfigs } from 'db/mysql/apis/config';
import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, Starlight } from 'typings';

/**
 * RSA密钥对相关动作
 */
export default function rsa(star: Starlight) {
  return {
    'v1.rsa.getKey': {
      metadata: {
        auth: false,
      },
      // 获取rsa密钥对
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const result = (await queryConfigs(['rsa'])) || [];

          const rsa = result[0].value;
          const storedKeyPair = rsa ? JSON.parse(rsa) : {};

          return {
            status: 200,
            data: {
              content: storedKeyPair.publicKey ? { publicKey: storedKeyPair.publicKey } : {},
              message: '获取密钥对成功',
              code: HttpResponseCode.Success,
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error(error);
          return {
            status: 500,
            data: {
              content: null,
              message: '获取密钥对失败，请重试～',
              code: HttpResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        }
      },
    },
  };
}
