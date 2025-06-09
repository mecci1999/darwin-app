import { generateKeyPairSync } from 'crypto';
import { queryConfigs, saveOrUpdateConfigs } from 'db/mysql/apis/config';
import { ResponseCode } from 'typings/enum';
import { HttpResponseItem } from 'typings/response';
import { Star, Context } from 'node-universe';

/**
 * RSA密钥对相关动作
 */
export default function rsa(star: Star) {
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

          return {
            status: 200,
            data: {
              content: rsa ? JSON.parse(rsa) : {},
              message: '获取密钥对成功',
              code: ResponseCode.Success,
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
              code: ResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        }
      },
    },
    // 创建并更新密钥对
    'v1.rsa.save': {
      metadata: {
        auth: false,
      },
      //
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { publicKey, privateKey } = generateKeyPairSync('rsa', {
            modulusLength: 2048, // 密钥长度
          });

          // 生成RSA密钥对
          const publicKeyBuffer = publicKey.export({
            type: 'spki',
            format: 'pem',
          });
          const privateKeyBuffer = privateKey.export({
            type: 'pkcs8',
            format: 'pem',
          });

          // 将密钥对转换成字符串
          const publicKeyText = publicKeyBuffer.toString('utf-8');
          const privateKeyText = privateKeyBuffer.toString('utf-8');

          const data = { publicKey: publicKeyText, privateKey: privateKeyText };

          // 将密钥存储至config表中
          await saveOrUpdateConfigs([{ key: 'rsa', value: JSON.stringify(data) }]);

          return {
            status: 200,
            data: {
              content: data,
              message: '生成密钥对成功',
              code: ResponseCode.Success,
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error(error);
          return {
            status: 500,
            data: {
              content: null,
              message: '生成密钥对失败，请重试～',
              code: ResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        }
      },
    },
  };
}
