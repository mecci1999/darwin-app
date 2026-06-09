import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';
import {
  VIDEO_FFMPEG_BIN,
  VIDEO_UPSCALE_BIN,
  VIDEO_UPSCALE_MAX_BASE64_BYTES,
  VIDEO_UPSCALE_MODEL,
  VIDEO_UPSCALE_SCALE,
  VIDEO_UPSCALE_STORAGE_DIR,
} from '../constants';
import { VideoState, VideoUpscaleTask } from '../types';

const ensureDir = (dir: string) => fs.promises.mkdir(dir, { recursive: true });

const sanitizeFileName = (name: string) => {
  const cleaned = path.basename(name || 'source.mp4').replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned || 'source.mp4';
};

const binaryExists = (binary: string) => {
  const paths = String(process.env.PATH || '').split(path.delimiter);
  return paths.some((dir) => {
    const candidate = path.join(dir, binary);
    return fs.existsSync(candidate) || fs.existsSync(`${candidate}.exe`);
  });
};

const runProcess = (
  command: string,
  args: string[],
  onLog?: (line: string) => void,
) => new Promise<void>((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    stderr += text;
    onLog?.(text);
  });

  child.on('error', reject);
  child.on('close', (code) => {
    if (code === 0) {
      resolve();
      return;
    }
    reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
  });
});

const updateTask = (
  state: VideoState,
  id: string,
  patch: Partial<VideoUpscaleTask>,
) => {
  const task = state.tasks.get(id);
  if (!task) return;
  state.tasks.set(id, {
    ...task,
    ...patch,
    updatedAt: new Date().toISOString(),
  });
};

export const createVideoUpscaleTask = async (
  state: VideoState,
  params: { fileName: string; fileBase64: string; model?: string },
) => {
  const fileName = sanitizeFileName(params.fileName);
  const fileBuffer = Buffer.from(String(params.fileBase64 || ''), 'base64');
  if (!fileBuffer.length) throw new Error('fileBase64 is required');
  if (fileBuffer.length > VIDEO_UPSCALE_MAX_BASE64_BYTES) throw new Error('video file is too large');

  const id = nanoid();
  const taskDir = path.join(VIDEO_UPSCALE_STORAGE_DIR, id);
  const inputPath = path.join(taskDir, fileName);
  const outputPath = path.join(taskDir, `${fileName.replace(/\.[^.]+$/, '')}-4k-enhanced.mp4`);
  const now = new Date().toISOString();
  await ensureDir(taskDir);
  await fs.promises.writeFile(inputPath, fileBuffer);

  const task: VideoUpscaleTask = {
    id,
    status: 'queued',
    progress: 0,
    message: '云端 GPU 任务已创建',
    fileName,
    inputPath,
    outputPath,
    createdAt: now,
    updatedAt: now,
  };
  state.tasks.set(id, task);

  void runVideoUpscaleTask(state, id, params.model || VIDEO_UPSCALE_MODEL);
  return task;
};

export const runVideoUpscaleTask = async (state: VideoState, id: string, model: string) => {
  const task = state.tasks.get(id);
  if (!task) return;
  const taskDir = path.dirname(task.inputPath);
  const framesDir = path.join(taskDir, 'frames');
  const enhancedDir = path.join(taskDir, 'enhanced');

  try {
    updateTask(state, id, { status: 'running', progress: 5, message: '检查云端视频增强运行时' });
    if (!binaryExists(VIDEO_FFMPEG_BIN)) throw new Error(`未检测到 ${VIDEO_FFMPEG_BIN}`);
    if (!binaryExists(VIDEO_UPSCALE_BIN)) throw new Error(`未检测到 ${VIDEO_UPSCALE_BIN}`);

    await ensureDir(framesDir);
    await ensureDir(enhancedDir);

    updateTask(state, id, { progress: 15, message: 'FFmpeg 正在拆分视频帧' });
    await runProcess(VIDEO_FFMPEG_BIN, [
      '-y',
      '-i', task.inputPath,
      '-vsync', '0',
      path.join(framesDir, 'frame_%08d.png'),
    ]);

    updateTask(state, id, { progress: 45, message: 'Real-ESRGAN 正在执行 4K AI 超分' });
    await runProcess(VIDEO_UPSCALE_BIN, [
      '-i', framesDir,
      '-o', enhancedDir,
      '-n', model,
      '-s', String(VIDEO_UPSCALE_SCALE),
    ]);

    updateTask(state, id, { progress: 82, message: 'FFmpeg 正在合成 4K 视频并保留音轨' });
    await runProcess(VIDEO_FFMPEG_BIN, [
      '-y',
      '-framerate', '30',
      '-i', path.join(enhancedDir, 'frame_%08d.png'),
      '-i', task.inputPath,
      '-map', '0:v:0',
      '-map', '1:a?',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-crf', '16',
      '-preset', 'slow',
      '-c:a', 'copy',
      task.outputPath,
    ]);

    updateTask(state, id, {
      status: 'done',
      progress: 100,
      message: '云端 GPU 4K 视频增强完成',
      downloadUrl: `/api/video/v1/upscale.download?id=${encodeURIComponent(id)}`,
      completedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    updateTask(state, id, {
      status: 'error',
      progress: 0,
      message: error.message || '云端 GPU 视频增强失败',
      error: error.message || String(error),
    });
  }
};

export const readTaskOutputAsDataUrl = async (task: VideoUpscaleTask) => {
  if (task.status !== 'done') throw new Error('task is not completed');
  const data = await fs.promises.readFile(task.outputPath);
  return `data:video/mp4;base64,${data.toString('base64')}`;
};
