/**
 * 用户头像上传动作
 */

import { FileCategory } from 'core/file/types';
import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, Starlight } from 'typings';

export default function uploadAvatar(star: Starlight) {
  return {
    'v1.uploadAvatar': {
      metadata: {
        auth: true,
      },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const params = ctx.params;

          // 验证必需参数
          if (!params.file || !params.filename || !params.mimetype) {
            return {
              status: 400,
              data: {
                content: null,
                message: '缺少必需的文件参数',
                code: HttpResponseCode.ParamsError,
                success: false,
              },
            };
          }

          // 调用文件上传微服务
          const uploadResult = await star.call('file.v1.uploadFile', {
            file: params.file,
            filename: params.filename,
            mimetype: params.mimetype,
            category: FileCategory.AVATAR,
            userId: params.userId,
            metadata: {
              type: 'avatar',
              userId: params.userId,
            },
          });

          if (uploadResult.status !== 200 || !uploadResult.data.success) {
            return {
              status: uploadResult.status,
              data: {
                content: null,
                message: uploadResult.data.message || '文件上传失败',
                code: uploadResult.data.code || HttpResponseCode.ServiceActionFaild,
                success: false,
              },
            };
          }

          const fileInfo = uploadResult.data.content;

          // 获取当前用户信息
          const existingUser = await star.db.user.findUserByUserId(params.userId);
          if (!existingUser) {
            return {
              status: 404,
              data: {
                content: null,
                message: '用户不存在',
                code: HttpResponseCode.UserNotExist,
                success: false,
              },
            };
          }

          // 更新用户头像信息
          const updateData = {
            avatar: fileInfo.url,
            version: (existingUser.version || 0) + 1,
            lastActiveAt: new Date(),
          };

          await star.db.user.saveOrUpdateUsers([
            {
              userId: existingUser.userId,
              nickname: existingUser.nickname,
              avatar: updateData.avatar,
              status: existingUser.status,
              source: existingUser.source,
              power: existingUser.power,
              devices: existingUser.devices,
              timezone: existingUser.timezone,
              locale: existingUser.locale,
              lastActiveAt: updateData.lastActiveAt,
              version: updateData.version,
              tenantId: existingUser.tenantId,
              applicationIds: existingUser.applicationIds,
            },
          ]);

          try {
            await star.cacher?.delete?.(`user:profile:${params.userId}:v2`);
          } catch (cacheError) {
            // The avatar has already been stored successfully; cache refresh can recover on the next profile read.
            star.logger?.warn('用户头像缓存失效失败', { userId: params.userId, cacheError });
          }

          star.logger?.info(`用户头像上传成功: ${params.userId}`, {
            fileId: fileInfo.fileId,
            url: fileInfo.url,
          });

          return {
            status: 200,
            data: {
              message: '头像上传成功',
              content: {
                fileId: fileInfo.fileId,
                url: fileInfo.url,
                thumbnailUrl: fileInfo.thumbnailUrl,
              },
              code: HttpResponseCode.Success,
              success: true,
            },
          };
        } catch (error) {
          star.logger?.error('头像上传失败:', error);

          return {
            status: 500,
            data: {
              content: null,
              message: error instanceof Error ? error.message : '头像上传失败',
              code: HttpResponseCode.ServiceActionFaild,
              success: false,
            },
          };
        }
      },
    },
  };
}
