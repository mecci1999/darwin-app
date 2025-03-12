import { verifyCodeOptions } from 'typings/auth';
import nodemailer from 'nodemailer';

/**
 * 验证微服务的方法
 */
const authMethod = (star: any) => {
  return {
    // 验证token是否有效
    resolveToken(ctx: any, route, req, res) {
      return new Promise((resolve, reject) => {});
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
              star.logger.info(`验证码存在缓存`);
              resolve({
                code: 200,
                message: '验证码已发送至您的邮箱，请留意。若没收到，请确认邮箱地址是否正确。',
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
