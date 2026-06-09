export type VideoUpscaleTaskStatus = 'queued' | 'running' | 'done' | 'error';

export interface VideoUpscaleTask {
  id: string;
  status: VideoUpscaleTaskStatus;
  progress: number;
  message: string;
  fileName: string;
  inputPath: string;
  outputPath: string;
  downloadUrl?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface VideoState {
  tasks: Map<string, VideoUpscaleTask>;
}
