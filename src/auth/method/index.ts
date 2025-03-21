import { queryConfigs } from 'db/mysql/apis/config';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { verifyCodeOptions } from 'typings/auth';

/**
 * 验证微服务的方法
 */
const authMethod = (star: any) => {
  return {
    // 生成token
    async generateToken(options: { userId: string }) {
      try {
        if (!options.userId) return;

        const payload = { userId: options.userId };

        // 获取密钥
        const result = (await queryConfigs(['rsa'])) || [];
        const rsa = JSON.parse(result[0].value);

        if (!rsa) return;

        const privateKey = rsa.privateKey;

        return jwt.sign(payload, privateKey, {
          expiresIn: '2h',
          algorithm: 'RS256',
        });
      } catch (error) {
        star.logger.error('generateToken', '生成token失败', error);
      }
    },
    // 验证token
    async resolveToken(token: string) {
      try {
        if (!token) return;

        // 获取公钥
        const result = (await queryConfigs(['rsa'])) || [];
        const rsa = JSON.parse(result[0].value);

        if (!rsa) return;

        const publicKey = rsa.publicKey;

        const decoded = jwt.verify(token, publicKey, {
          algorithms: ['RS256'],
        }) as {
          userId: string;
          exp: number;
        };

        // 获取过期时间
        const expirationTime = decoded.exp * 1000; // 转换为毫秒
        const currentTime = Date.now();

        return {
          userId: decoded.userId,
          expirationTime,
          isExpired: currentTime > expirationTime,
        };
      } catch (error: any) {
        if (error.name === 'TokenExpiredError') {
          star.logger.error('resolveToken', 'token已过期', error);
          // 处理 token 过期的逻辑，例如返回特定的错误信息
          return { error: 'Token has expired' };
        } else {
          star.logger.error('resolveToken', '验证token失败', error);
        }
      }
    },
    // 发送验证码
    sendVerifyCodeEmail(params: {
      email: string;
      type: string;
      options: verifyCodeOptions;
      code: string;
    }) {
      return new Promise((resolve, reject) => {
        // 创建邮箱发送对象
        const transporter = nodemailer.createTransport({
          service: '163',
          auth: {
            user: 'mecci1999@163.com',
            pass: 'YEVimrR6xg6pNYKK',
          },
        });

        star.cacher
          .get(`verifyCode:${params.email};type:${params.type}`)
          .then((cacheCode: string) => {
            // 获取redis缓存
            if (cacheCode) {
              // 存在缓存
              star.logger.info(`验证码存在缓存`, `email: ${params.email}`);
              resolve({
                code: 200,
                message:
                  '验证码已发送至您的邮箱，请留意。若没收到，请确认邮箱地址是否正确。',
              });
            } else {
              // 缓存不存在或者已过期，将邮箱作为redis的key存储验证码，并设置过期时间为5分钟
              star.cacher.set(
                `verifyCode:${params.email};type:${params.type}`,
                params.code,
                5 * 60,
              );

              transporter.sendMail(params.options as any, (error) => {
                if (error) {
                  star.logger.error('发送邮件失败', params, error);
                  reject(error);
                } else {
                  resolve({ code: 200, message: '验证码已发送' });
                }
              });
            }
          });
      });
    },
  };
};

export default authMethod;
