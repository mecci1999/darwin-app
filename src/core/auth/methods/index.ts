import { generateKeyPairSync } from 'crypto';
import { saveOrUpdateConfigs } from 'db/mysql/apis/config';
import jwt from 'jsonwebtoken';
import { Star } from 'node-universe';
import nodemailer from 'nodemailer';
import { verifyCodeOptions } from 'typings';
import { AuthState } from '../types';
import { AuthUtils } from '../utils';

const VERIFY_CODE_EMAIL_TIMEOUT_MS = Number(process.env.VERIFY_CODE_EMAIL_TIMEOUT_MS || 5000);

/**
 * 验证微服务的方法
 */
const authMethods = (star: Star, state?: AuthState) => ({
  // 生成token
  async generateToken(params: { userId: string }) {
    try {
      if (!params.userId) return;

      const payload = { userId: params.userId };

      const rsa = await AuthUtils.getRSAKeys(state, star.logger);

      if (!rsa) return;

      const { privateKey } = rsa;

      return jwt.sign(payload, privateKey, {
        expiresIn: '2h', // token过期时间
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

      const rsa = await AuthUtils.getRSAKeys(state, star.logger);

      if (!rsa) return;

      const { privateKey } = rsa;

      return jwt.sign(payload, privateKey, {
        expiresIn: '3d',
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

      const rsa = await AuthUtils.getRSAKeys(state, star.logger);

      if (!rsa) return;

      const { publicKey } = rsa;

      const decoded = jwt.verify(token, publicKey, {
        algorithms: ['RS256'],
      }) as {
        userId: string;
        exp: number;
      };

      const expirationTime = decoded.exp * 1000;
      const currentTime = Date.now();

      let tenantId: string | undefined;
      let isAdmin = false;
      try {
        const userInfo = await (star as any).db?.user?.findUserByUserId?.(decoded.userId);
        tenantId = userInfo?.tenantId ? String(userInfo.tenantId) : undefined;
        isAdmin = userInfo?.power === 999;
      } catch (userLookupError) {
        tenantId = undefined;
        isAdmin = false;
      }

      return {
        userId: decoded.userId,
        tenantId: tenantId || decoded.userId,
        isAdmin,
        expirationTime,
        isExpired: currentTime > expirationTime,
      };
    } catch (error: any) {
      if (error.name === 'TokenExpiredError') {
        star.logger?.error('resolveToken', 'token已过期', error);
        return { error: 'Token has expired', code: 40001 };
      }
      star.logger?.error('resolveToken', '验证token失败', error);
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
      const cacheKey = `verifyCode:${params.email};type:${params.type}`;
      const cacheCode = await star.cacher.get(cacheKey);

      // 获取redis缓存
      if (cacheCode) {
        // 存在缓存
        return {
          code: 200,
          message: '验证码已发送至您的邮箱，请留意。若没收到，请确认邮箱地址是否正确。',
        };
      }

      // 缓存不存在或者已过期，将邮箱作为redis的key存储验证码，并设置过期时间
      await star.cacher.set(
        cacheKey,
        params.code,
        300, // 验证码过期时间5分钟
      );

      // 创建邮箱发送对象。SMTP 网络不可控，必须设置上限，避免接口一直等待到客户端超时。
      const transporter = nodemailer.createTransport({
        service: '163',
        connectionTimeout: VERIFY_CODE_EMAIL_TIMEOUT_MS,
        greetingTimeout: VERIFY_CODE_EMAIL_TIMEOUT_MS,
        socketTimeout: VERIFY_CODE_EMAIL_TIMEOUT_MS,
        auth: {
          user: 'mecci1999@163.com',
          pass: 'YEVimrR6xg6pNYKK',
        },
      });

      return await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          transporter.close();
          reject({ code: 500, message: '验证码发送超时，请稍后重试～' });
        }, VERIFY_CODE_EMAIL_TIMEOUT_MS + 1000);

        transporter.sendMail(params.options as any, (error, info) => {
          clearTimeout(timeout);
          transporter.close();

          if (error) {
            star.logger?.error('发送邮件失败', params, error);
            reject({ code: 500, message: '验证码发送失败，请稍后重试～', error });
            return;
          }

          star.logger?.info('邮件发送成功', info);
          resolve({ code: 200, message: '验证码已发送至邮箱，请注意查收～', info });
        });
      });
    } catch (error) {
      await star.cacher.delete(`verifyCode:${params.email};type:${params.type}`).catch(() => undefined);
      const message =
        typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
          ? error.message
          : '验证码发送失败，请稍后重试～';
      return { code: 500, message, error };
    }
  },
  // 检查并生成RSA密钥对 (已迁移到 AuthUtils)
  async checkAndGenerateRSA() {
    if (state) {
      return AuthUtils.checkAndGenerateRSA(state, star.logger);
    }
    // 兼容旧版本调用
    try {
      const existingKeys = await AuthUtils.getRSAKeys(state, star.logger);
      if (existingKeys?.publicKey && existingKeys?.privateKey) {
        star.logger?.info('RSA密钥对已存在，跳过生成', existingKeys.privateKey);
        return;
      }

      star.logger?.info('RSA密钥对不存在，开始生成...');
      const { publicKey, privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
      });

      const publicKeyBuffer = publicKey.export({ type: 'spki', format: 'pem' });
      const privateKeyBuffer = privateKey.export({ type: 'pkcs8', format: 'pem' });
      const publicKeyText = publicKeyBuffer.toString('utf-8');
      const privateKeyText = privateKeyBuffer.toString('utf-8');
      const data = { publicKey: publicKeyText, privateKey: privateKeyText };

      await saveOrUpdateConfigs([{ key: 'rsa', value: JSON.stringify(data) }]);
      star.logger?.info('RSA密钥对生成并保存成功');
    } catch (error) {
      star.logger?.error('检查或生成RSA密钥对时发生错误:', error);
    }
  },
});

export default authMethods;
