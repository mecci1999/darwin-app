import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, HttpStatusCode, Starlight } from 'typings';
import { VideoState } from '../types';
import { createVideoUpscaleTask, readTaskOutputAsDataUrl } from '../utils/video-upscale-worker';
import { instrumentServiceActions } from '../../metrics/utils/action-metrics';

const success = (content: any, message: string): HttpResponseItem => ({
  status: HttpStatusCode.OK,
  data: {
    content,
    message,
    code: HttpResponseCode.Success,
    success: true,
  },
});

const failure = (message: string, status = HttpStatusCode.BAD_REQUEST): HttpResponseItem => ({
  status,
  data: {
    content: null,
    message,
    code: HttpResponseCode.ServiceActionFaild,
    success: false,
  },
});

export default function videoActions(star: Starlight, state: VideoState) {
  return instrumentServiceActions(star, 'video', {
    'v1.upscale.tasks': {
      metadata: { auth: true, roles: ['admin', 'user'] },
      timeout: 0,
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const task = await createVideoUpscaleTask(state, {
            fileName: String(ctx.params.fileName || 'source.mp4'),
            fileBase64: String(ctx.params.fileBase64 || ''),
            model: ctx.params.model ? String(ctx.params.model) : undefined,
          });
          star.logger?.info('Video upscale task created', { id: task.id, fileName: task.fileName });
          return success(task, '云端 GPU 视频增强任务已创建');
        } catch (error: any) {
          return failure(error.message || '创建云端 GPU 任务失败');
        }
      },
    },

    'v1.upscale.task': {
      metadata: { auth: true, roles: ['admin', 'user'] },
      async handler(ctx: Context): Promise<HttpResponseItem> {
        const id = String(ctx.params.id || '');
        const task = state.tasks.get(id);
        if (!task) return failure('未找到云端 GPU 视频增强任务', HttpStatusCode.NOT_FOUND);
        return success(task, '云端 GPU 视频增强任务状态');
      },
    },

    'v1.upscale.download': {
      metadata: { auth: true, roles: ['admin', 'user'] },
      timeout: 0,
      async handler(ctx: Context): Promise<HttpResponseItem> {
        try {
          const id = String(ctx.params.id || '');
          const task = state.tasks.get(id);
          if (!task) return failure('未找到云端 GPU 视频增强任务', HttpStatusCode.NOT_FOUND);
          const dataUrl = await readTaskOutputAsDataUrl(task);
          return success({ dataUrl, fileName: `${task.fileName.replace(/\.[^.]+$/, '')}-4k-enhanced.mp4` }, '云端 4K 视频下载数据');
        } catch (error: any) {
          return failure(error.message || '读取云端 4K 视频失败');
        }
      },
    },
  });
}
