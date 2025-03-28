/**
 * 用户扫码登录相关接口
 */
import { PASSWORD_SECRET_KEY, QR_CODE_EXPIRE } from 'config';
import crypto from 'crypto';
import { findEmailAuthByEmail, findEmailIsExist } from 'db/mysql/apis/auth';
import { RequestParamInvalidError } from 'error';
import { Context, Star } from 'node-universe';
import { GatewayResponse, IncomingRequest, Route } from 'typings';
import { ResponseCode } from 'typings/enum';
import { HttpResponseItem } from 'typings/response';
import { decryptPassword } from 'utils';
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
// 设备信息Redis前缀
const DEVICE_PREFIX = 'device:';

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
              },
            };

          // 生成唯一id
          const qrCodeId = uuidv4();

          // 记录客户端信息
          const clientInfo = {
            ip: (ctx.meta as any).req.ip,
            userAgent: (ctx.meta as any).req.userAgent,
            timestamp: Date.now(),
          };

          // 存储二维码状态和客户端信息至redis，有效时间为120秒
          await star.cacher.set(
            `${QR_CODE_PREFIX}${qrCodeId}:status`,
            QrCodeStatus.PENDING,
            QR_CODE_EXPIRE ? Number(QR_CODE_EXPIRE) : 120,
          );

          await star.cacher.set(
            `${QR_CODE_PREFIX}${qrCodeId}:client`,
            JSON.stringify(clientInfo),
            QR_CODE_EXPIRE ? Number(QR_CODE_EXPIRE) : 120,
          );

          // 记录操作日志
          star.logger?.info(`QR Code已生成: ${qrCodeId}`);

          return {
            status: 200,
            data: {
              content: {
                code: qrCodeId,
                expire: QR_CODE_EXPIRE ? Number(QR_CODE_EXPIRE) : 120,
              },
              message: '二维码生成成功～',
              code: ResponseCode.Success,
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

          // 获取二维码状态
          const status = await star.cacher.get(`${QR_CODE_PREFIX}${code}:status`);

          if (!status) {
            return {
              status: 200,
              data: {
                content: {
                  status: QrCodeStatus.EXPIRED,
                },
                message: '二维码已过期',
                code: ResponseCode.Success,
              },
            };
          }

          // 如果状态是已确认，返回登录信息
          if (status === QrCodeStatus.CONFIRMED) {
          }

          return {
            status: 200,
            data: {
              content: {
                code: qrCodeId,
                expire: QR_CODE_EXPIRE ? Number(QR_CODE_EXPIRE) : 120,
              },
              message: '二维码生成成功～',
              code: ResponseCode.Success,
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
            },
          };
        }
      },
    },
  };
}
