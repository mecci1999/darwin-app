export const APP_NAME = 'video';

export const KAFKA_CLIENT_ID = 'video-service';
export const KAFKA_GROUP_ID = 'video-group';
export const KAFKA_BROKERS = process.env.KAFKA_BROKERS || process.env.KAFKA_HOST || 'localhost:9092';
export const KAFKA_USER = process.env.KAFKA_USER || '';
export const KAFKA_PASSWORD = process.env.KAFKA_PASSWORD || '';

export const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
export const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
export const REDIS_PASSWORD = process.env.REDIS_PASSWORD || '';
export const REDIS_DB = parseInt(process.env.REDIS_DB || '2', 10);

export const VIDEO_UPSCALE_STORAGE_DIR =
  process.env.VIDEO_UPSCALE_STORAGE_DIR || '/tmp/starlight-video-upscale-cloud';
export const VIDEO_UPSCALE_BIN = process.env.VIDEO_UPSCALE_BIN || 'realesrgan-ncnn-vulkan';
export const VIDEO_FFMPEG_BIN = process.env.VIDEO_FFMPEG_BIN || 'ffmpeg';
export const VIDEO_UPSCALE_MODEL = process.env.VIDEO_UPSCALE_MODEL || 'realesrgan-x4plus';
export const VIDEO_UPSCALE_SCALE = parseInt(process.env.VIDEO_UPSCALE_SCALE || '4', 10);
export const VIDEO_UPSCALE_MAX_BASE64_BYTES = parseInt(
  process.env.VIDEO_UPSCALE_MAX_BASE64_BYTES || String(1024 * 1024 * 1024),
  10,
);
