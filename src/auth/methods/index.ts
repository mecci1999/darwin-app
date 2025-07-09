import { REFRESH_TOKEN_EXIPRE_TIME, TOKEN_EXIPRE_TIME } from 'config';
import { generateKeyPairSync } from 'crypto';
import { queryConfigs, saveOrUpdateConfigs } from 'db/mysql/apis/config';
import jwt from 'jsonwebtoken';
import { Star } from 'node-universe';
import nodemailer from 'nodemailer';
import { verifyCodeOptions } from 'typings/auth';
import { AUTH_CONFIG } from '../constants';
import { AuthState } from '../types';
import { AuthUtils } from '../utils';

/**
 * 验证微服务的方法
 */
const authMethod = (star: Star, state?: AuthState) => {
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
          expiresIn: AUTH_CONFIG.tokenExpireTime as any,
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
          expiresIn: AUTH_CONFIG.refreshTokenExpireTime as any,
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
      return new Promise(async (resolve, reject) => {
        try {
          // 创建邮箱发送对象
          const transporter = nodemailer.createTransport({
            service: AUTH_CONFIG.email.service,
            auth: {
              user: AUTH_CONFIG.email.user,
              pass: AUTH_CONFIG.email.pass,
            },
          });

          const cacheCode = await star.cacher.get(`verifyCode:${params.email};type:${params.type}`);

          // 获取redis缓存
          if (cacheCode) {
            // 存在缓存
            resolve({
              code: 200,
              message: '验证码已发送至您的邮箱，请留意。若没收到，请确认邮箱地址是否正确。',
            });
          } else {
            // 缓存不存在或者已过期，将邮箱作为redis的key存储验证码，并设置过期时间
            await star.cacher.set(
              `verifyCode:${params.email};type:${params.type}`,
              params.code,
              AUTH_CONFIG.verificationCodeExpireTime,
            );

            // 使用Promise包装sendMail方法
            transporter.sendMail(params.options as any, (error, info) => {
              if (error) {
                star.logger?.error('发送邮件失败', params, error);
                reject({ code: 500, message: '验证码发送失败，请稍后重试～', error });
              } else {
                star.logger?.info('邮件发送成功', info);
                resolve({ code: 200, message: '验证码已发送至邮箱，请注意查收～', info });
              }
            });
          }
        } catch (error) {
          reject({ code: 500, message: '验证码发送失败', error });
        }
      });
    },
    // 检查并生成RSA密钥对 (已迁移到 AuthUtils)
    async checkAndGenerateRSA() {
      if (state) {
        return AuthUtils.checkAndGenerateRSA(state, star.logger);
      } else {
        // 兼容旧版本调用
        try {
          const result = (await queryConfigs(['rsa'])) || [];
          if (result.length > 0) {
            const rsaData = JSON.parse(result[0].value);
            if (rsaData.publicKey && rsaData.privateKey) {
              star.logger?.info('RSA密钥对已存在，跳过生成');
              return;
            }
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
      }
    },
  };
};

export default authMethod;
