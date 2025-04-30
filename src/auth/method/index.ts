import { REFRESH_TOKEN_EXIPRE_TIME, TOKEN_EXIPRE_TIME } from 'config';
import { queryConfigs } from 'db/mysql/apis/config';
import jwt from 'jsonwebtoken';
import { Star } from 'node-universe';
import nodemailer from 'nodemailer';
import { verifyCodeOptions } from 'typings/auth';

/**
 * 验证微服务的方法
 */
const authMethod = (star: Star) => {
  return {
    // 生成token
    async generateToken(params: { userId: string }) {
      try {
        if (!params.userId) return;

        const payload = { userId: params.userId };

        // 获取密钥
        const result = (await queryConfigs(['rsa'])) || [];

        if (result.length === 0) {
          star.logger?.error('generateToken', '获取rsa密钥对失败');
          return;
        }

        const rsa = JSON.parse(result[0].value);

        if (!rsa) return;

        const privateKey = rsa.privateKey;

        return jwt.sign(payload, privateKey, {
          expiresIn: (TOKEN_EXIPRE_TIME as any) || '2h', // TOKEN过期时间
          algorithm: 'RS256',
        });
      } catch (error) {
        star.logger?.error('generateToken', '生成token失败', error);
      }
    },
    // 生成续签token
    async generateRefreshToken(params: { userId: string }) {
      try {
        if (!params.userId) return;

        const payload = { userId: params.userId };

        // 获取密钥
        const result = (await queryConfigs(['rsa'])) || [];

        if (result.length === 0) {
          star.logger?.error('generateRefreshToken', '获取rsa密钥对失败');
          return;
        }

        const rsa = JSON.parse(result[0].value);

        if (!rsa) return;

        const privateKey = rsa.privateKey;

        return jwt.sign(payload, privateKey, {
          expiresIn: (REFRESH_TOKEN_EXIPRE_TIME as any) || '3d', // TOKEN过期时间
          algorithm: 'RS256',
        });
      } catch (error) {
        star.logger?.error('generateRefreshToken', '生成refresh_token失败', error);
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
          star.logger?.error('resolveToken', 'token已过期', error);
          // 处理 token 过期的逻辑，例如返回特定的错误信息
          return { error: 'Token has expired', code: 40001 };
        } else {
          star.logger?.error('resolveToken', '验证token失败', error);
        }
      }
    },
    // 发送验证码
    async sendVerifyCodeEmail(params: {
      email: string;
      type: string;
      options: verifyCodeOptions;
      code: string;
    }) {
      try {
        // 创建邮箱发送对象
        const transporter = nodemailer.createTransport({
          service: '163',
          auth: {
            user: 'mecci1999@163.com',
            pass: 'YEVimrR6xg6pNYKK',
          },
        });

        const cacheCode = await star.cacher.get(`verifyCode:${params.email};type:${params.type}`);

        // 获取redis缓存
        if (cacheCode) {
          // 存在缓存
          return {
            code: 200,
            message: '验证码已发送至您的邮箱，请留意。若没收到，请确认邮箱地址是否正确。',
          };
        } else {
          // 缓存不存在或者已过期，将邮箱作为redis的key存储验证码，并设置过期时间为5分钟
          await star.cacher.set(
            `verifyCode:${params.email};type:${params.type}`,
            params.code,
            5 * 60,
          );

          transporter.sendMail(params.options as any, (error) => {
            if (error) {
              star.logger?.error('发送邮件失败', params, error);
              return { code: 500, error };
            } else {
              return { code: 200, message: '验证码已发送' };
            }
          });
        }
      } catch (error) {
        return { code: 500, error };
      }
    },
  };
};

export default authMethod;
