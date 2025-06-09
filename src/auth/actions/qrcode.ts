/**
 * 用户扫码登录相关接口
 */
import { QR_CODE_EXPIRE } from 'config';
import { saveOrUpdateScanAuth } from 'db/mysql/apis/auth';
import { RequestParamInvalidError } from 'error';
import { Context, Star } from 'node-universe';
import { ResponseCode } from 'typings/enum';
import { HttpResponseItem } from 'typings/response';
import { v4 as uuidv4 } from 'uuid';

// 二维码状态枚举
enum QrCodeStatus {
  PENDING = 'PENDING', // 等待扫描
  SCANNED = 'SCANNED', // 已扫描
  CONFIRMED = 'CONFIRMED', // 已确认
  CANCELLED = 'CANCELLED', // 已取消
  EXPIRED = 'EXPIRED', // 已过期
}

// 二维码Redis前缀
const QR_CODE_PREFIX = 'qr_code:';
// 新增安全配置
const MAX_SCAN_ATTEMPTS = 5; // 同一IP最大尝试次数
const SCAN_ATTEMPT_WINDOW = 60 * 60; // 1小时窗口期(秒)

export default function qrcode(star: Star) {
  return {
    /**
     * 生成二维码
     */
    'v1.qrcode.getKey': {
      metadata: {
        auth: false,
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          if (!(ctx.meta as any).req.ip)
            return {
              status: 500,
              data: {
                content: null,
                message: `请求ip地址获取失败`,
                code: ResponseCode.ServiceActionFaild,
                success: false,
              },
            };

          // 安全检查：限制同一IP地址的生成速率
          const scanAttemptsKey = `scan_attempts:${(ctx.meta as any).req.ip}`;
          const currentAttempts = (await star.cacher.get(scanAttemptsKey)) || 0;

          if (currentAttempts >= MAX_SCAN_ATTEMPTS) {
            star.logger?.warn(`IP ${(ctx.meta as any).req.ip} 生成二维码次数超过限制`);
            return {
              status: 429,
              data: {
                content: null,
                message: '操作过于频繁，请稍后再试',
                code: ResponseCode.TooManyRequests,
                success: false,
              },
            };
          }

          // 生成唯一id
          const qrCodeId = uuidv4();

          // 记录客户端信息
          const clientInfo = {
            ip: (ctx.meta as any).req.ip,
            userAgent: (ctx.meta as any).req.userAgent,
            timestamp: Date.now(),
          };

          const expireTime = QR_CODE_EXPIRE ? Number(QR_CODE_EXPIRE) : 120;

          // 存储二维码状态和客户端信息至redis，有效时间为120秒
          await Promise.all([
            star.cacher.set(
              `${QR_CODE_PREFIX}${qrCodeId}:status`,
              QrCodeStatus.PENDING,
              expireTime,
            ),
            star.cacher.set(
              `${QR_CODE_PREFIX}${qrCodeId}:client`,
              JSON.stringify(clientInfo),
              expireTime,
            ),
            star.cacher.set(scanAttemptsKey, currentAttempts + 1, SCAN_ATTEMPT_WINDOW),
          ]);

          // 记录操作日志
          star.logger?.info(`QR Code已生成: ${qrCodeId}`, `IP: ${(ctx.meta as any).req.ip}`);

          return {
            status: 200,
            data: {
              content: {
                code: qrCodeId,
                expire: expireTime,
              },
              message: '二维码生成成功～',
              code: ResponseCode.Success,
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error(`生成二维码失败: ${error}`);
          return {
            status: 500,
            data: {
              content: null,
              message: '生成二维码失败，请重试～',
              code: ResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        }
      },
    },
    /**
     * 查询二维码状态（网页端采取轮询）
     */
    'v1.qrcode.status': {
      metadata: {
        auth: false,
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { code } = ctx.params;

          if (!code) {
            throw new RequestParamInvalidError();
          }

          if (!(ctx.meta as any).req.ip)
            return {
              status: 500,
              data: {
                content: null,
                message: `请求ip地址获取失败`,
                code: ResponseCode.ServiceActionFaild,
                success: false,
              },
            };

          // 获取二维码状态和客户端信息
          const [status, clientInfoStr] = await Promise.all([
            star.cacher.get(`${QR_CODE_PREFIX}${code}:status`),
            star.cacher.get(`${QR_CODE_PREFIX}${code}:client`),
          ]);

          if (!status) {
            return {
              status: 200,
              data: {
                content: {
                  status: QrCodeStatus.EXPIRED,
                },
                message: '二维码已过期',
                code: ResponseCode.Success,
                success: true,
              },
            };
          }

          // 安全检查：验证请求IP和User-Agent是否匹配
          if (clientInfoStr) {
            const clientInfo = JSON.parse(clientInfoStr);
            if (
              clientInfo.ip !== (ctx.meta as any).req.ip ||
              clientInfo.userAgent !== (ctx.meta as any).req.userAgent
            ) {
              star.logger?.warn(`二维码安全验证失败: IP或UA不匹配`);
              return {
                status: 403,
                data: {
                  content: null,
                  message: '安全验证失败',
                  code: ResponseCode.ServiceActionFaild,
                  success: false,
                },
              };
            }
          }

          // 如果状态是已确认，返回登录信息
          if (status === QrCodeStatus.CONFIRMED) {
            // 获取用户信息
            const userInfoStr = await star.cacher.get(`${QR_CODE_PREFIX}${code}:user`);
            if (userInfoStr) {
              const userInfo = JSON.parse(userInfoStr);

              // 生成token
              const token = await (this as any).generateToken({ userId: userInfo.userId });

              if (token) {
                // 设置cookies
                (ctx.meta as any).token = token;
              }

              // 清楚缓存
              await Promise.all([
                star.cacher.delete(`${QR_CODE_PREFIX}${code}:status`),
                star.cacher.delete(`${QR_CODE_PREFIX}${code}:client`),
                star.cacher.delete(`${QR_CODE_PREFIX}${code}:user`),
              ]);

              return {
                status: 200,
                data: {
                  content: {
                    status,
                    userInfo,
                  },
                  message: '登录成功',
                  code: ResponseCode.Success,
                  success: true,
                },
              };
            } else {
              return {
                status: 200,
                data: {
                  content: null,
                  message: '获取用户信息失败',
                  code: ResponseCode.ServiceActionFaild,
                  success: false,
                },
              };
            }
          }

          return {
            status: 200,
            data: {
              content: {
                status,
              },
              message: '获取二维码状态成功',
              code: ResponseCode.Success,
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error(`获取二维码状态失败: ${error}`);
          return {
            status: 500,
            data: {
              content: null,
              message: '获取二维码状态失败，请重试～',
              code: ResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        }
      },
    },
    /**
     * 移动端：扫描二维码
     */
    'v1.qrcode.scan': {
      metadata: {
        auth: true,
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { code } = ctx.params;
          const { userId } = (ctx.meta as any).user;

          if (!code) {
            throw new RequestParamInvalidError();
          }

          // 获取二维码状态
          const status = await star.cacher.get(`${QR_CODE_PREFIX}${code}:status`);

          if (!status || status !== QrCodeStatus.PENDING) {
            return {
              status: 200,
              data: {
                content: null,
                message: '二维码无效或已过期',
                code: ResponseCode.QrCodeExpired,
                success: false,
              },
            };
          }

          // 记录设备信息
          const deviceInfo = {
            deviceId: (ctx.meta as any).req.deviceId || 'unknown',
            deviceType: (ctx.meta as any).req.deviceType || 'unknown',
            timestamp: Date.now(),
          };

          // 更新二维码状态为已扫描、存储设备信息
          await Promise.all([
            star.cacher.set(
              `${QR_CODE_PREFIX}${code}:status`,
              QrCodeStatus.SCANNED,
              QR_CODE_EXPIRE ? Number(QR_CODE_EXPIRE) : 120,
            ),
            star.cacher.set(
              `${QR_CODE_PREFIX}${code}:device`,
              JSON.stringify(deviceInfo),
              QR_CODE_EXPIRE ? Number(QR_CODE_EXPIRE) : 120,
            ),
          ]);

          // 记录操作日志
          star.logger?.info(`QR Code已扫描: ${code} by user: ${userId}`);

          return {
            status: 200,
            data: {
              content: null,
              message: '扫描成功，请在手机上确认登录',
              code: ResponseCode.Success,
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error(`扫描二维码失败: ${error}`);
          return {
            status: 500,
            data: {
              content: null,
              message: '扫描失败，请重试～',
              code: ResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        }
      },
    },
    /**
     * 移动端：扫描二维码后确认登录
     */
    'v1.qrcode.confirm': {
      metadata: {
        auth: true, // 需要移动端用户已登录
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { code } = ctx.params;
          const { userId } = (ctx.meta as any).user;

          if (!code) {
            throw new RequestParamInvalidError();
          }

          // 获取二维码状态和客户端信息
          const [status, deviceInfoStr] = await Promise.all([
            star.cacher.get(`${QR_CODE_PREFIX}${code}:status`),
            star.cacher.get(`${QR_CODE_PREFIX}${code}:device`),
          ]);

          // 安全检查：验证设备信息
          if (deviceInfoStr) {
            const deviceInfo = JSON.parse(deviceInfoStr);
            if (
              deviceInfo.deviceId !== (ctx.meta as any).req.deviceType ||
              deviceInfo.deviceType !== (ctx.meta as any).req.deviceType
            ) {
              star.logger?.warn(`二维码扫码确认安全验证失败: 设备不匹配`);
              return {
                status: 403,
                data: {
                  content: null,
                  message: '安全验证失败',
                  code: ResponseCode.ServiceActionFaild,
                  success: false,
                },
              };
            }
          }

          if (!status || status !== QrCodeStatus.SCANNED) {
            return {
              status: 200,
              data: {
                content: null,
                message: '二维码状态错误或已过期',
                code: ResponseCode.QrCodeExpired,
                success: false,
              },
            };
          }

          // 修改二维码状态
          await Promise.all([
            star.cacher.set(
              `${QR_CODE_PREFIX}${code}:status`,
              QrCodeStatus.CONFIRMED,
              30, // 确认后状态保留30秒
            ),
            star.cacher.set(
              `${QR_CODE_PREFIX}${code}:user`,
              JSON.stringify({
                userId,
              }),
              30,
            ),
            star.cacher.delete(`${QR_CODE_PREFIX}${code}:device`),
            // 存储用户扫码登录信息
            saveOrUpdateScanAuth({
              userId,
              deviceInfo: deviceInfoStr,
            }),
          ]);

          // 记录操作日志
          star.logger?.info(`QR Code已确认: ${code} by user: ${userId}`);

          return {
            status: 200,
            data: {
              content: null,
              message: '确认登录成功',
              code: ResponseCode.Success,
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error(`确认登录失败: ${error}`);
          return {
            status: 500,
            data: {
              content: null,
              message: '确认登录失败，请重试～',
              code: ResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        }
      },
    },
    /**
     * 移动端：扫描二维码后取消登录
     */
    'v1.qrcode.cancel': {
      metadata: {
        auth: true, // 需要移动端用户已登录
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const { code } = ctx.params;
          const { userId } = (ctx.meta as any).user;

          if (!code) {
            throw new RequestParamInvalidError();
          }

          // 获取二维码状态和客户端信息
          const [status, deviceInfoStr] = await Promise.all([
            star.cacher.get(`${QR_CODE_PREFIX}${code}:status`),
            star.cacher.get(`${QR_CODE_PREFIX}${code}:device`),
          ]);

          // 安全检查：验证设备信息
          if (deviceInfoStr) {
            const deviceInfo = JSON.parse(deviceInfoStr);
            if (
              deviceInfo.deviceId !== (ctx.meta as any).req.deviceType ||
              deviceInfo.deviceType !== (ctx.meta as any).req.deviceType
            ) {
              star.logger?.warn(`二维码扫码取消安全验证失败: 设备不匹配`);
              return {
                status: 403,
                data: {
                  content: null,
                  message: '安全验证失败',
                  code: ResponseCode.ServiceActionFaild,
                  success: false,
                },
              };
            }
          }

          if (!status || status === QrCodeStatus.EXPIRED) {
            return {
              status: 200,
              data: {
                content: null,
                message: '二维码已过期',
                code: ResponseCode.QrCodeExpired,
                success: false,
              },
            };
          }

          // 修改二维码状态
          await Promise.all([
            star.cacher.set(
              `${QR_CODE_PREFIX}${code}:status`,
              QrCodeStatus.CANCELLED,
              30, // 确认后状态保留30秒
            ),
            star.cacher.delete(`${QR_CODE_PREFIX}${code}:device`),
          ]);

          // 记录操作日志
          star.logger?.info(`QR Code扫码后已取消: ${code} by user: ${userId}`);

          return {
            status: 200,
            data: {
              content: null,
              message: '取消登录成功',
              code: ResponseCode.Success,
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error(`取消登录失败: ${error}`);
          return {
            status: 500,
            data: {
              content: null,
              message: '取消登录失败，请重试～',
              code: ResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        }
      },
    },
  };
}
