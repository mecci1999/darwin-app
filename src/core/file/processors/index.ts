/**
 * 图片处理器
 */

import { ProcessedImage, ProcessingProfile } from '../types';
import sharp from 'sharp';

export class ImageProcessor {
  /**
   * 处理图片
   */
  static async processImage(
    imageBuffer: Buffer,
    profile: ProcessingProfile
  ): Promise<{ main: ProcessedImage; thumbnail?: ProcessedImage }> {
    if (!profile.imageProcessing) {
      throw new Error('图片处理配置未定义');
    }

    const { resize, quality = 85, format = 'webp', thumbnail } = profile.imageProcessing;

    // 处理主图片
    let mainProcessor = sharp(imageBuffer);

    if (resize) {
      mainProcessor = mainProcessor.resize(resize.width, resize.height, {
        fit: resize.fit || 'cover',
        withoutEnlargement: true
      });
    }

    // 设置输出格式和质量
    switch (format) {
      case 'jpeg':
        mainProcessor = mainProcessor.jpeg({ quality });
        break;
      case 'png':
        mainProcessor = mainProcessor.png({ quality: Math.round(quality / 10) });
        break;
      case 'webp':
      default:
        mainProcessor = mainProcessor.webp({ quality });
        break;
    }

    const mainResult = await mainProcessor.toBuffer();
    const metadata = await sharp(mainResult).metadata();
    const mainImage: ProcessedImage = {
      buffer: mainResult,
      info: {
        width: metadata.width || 0,
        height: metadata.height || 0,
        format: metadata.format || 'unknown',
        size: mainResult.length
      }
    };

    // 处理缩略图
    let thumbnailImage: ProcessedImage | undefined;
    if (thumbnail) {
      const thumbnailProcessor = sharp(imageBuffer)
        .resize(thumbnail.width, thumbnail.height, {
          fit: 'cover',
          withoutEnlargement: true
        })
        .webp({ quality: thumbnail.quality || 80 });

      const thumbnailResult = await thumbnailProcessor.toBuffer();
      const thumbnailMetadata = await sharp(thumbnailResult).metadata();
      thumbnailImage = {
        buffer: thumbnailResult,
        info: {
          width: thumbnailMetadata.width || 0,
          height: thumbnailMetadata.height || 0,
          format: thumbnailMetadata.format || 'unknown',
          size: thumbnailResult.length
        }
      };
    }

    return {
      main: mainImage,
      thumbnail: thumbnailImage
    };
  }

  /**
   * 获取图片信息
   */
  static async getImageInfo(imageBuffer: Buffer): Promise<{
    width: number;
    height: number;
    format: string;
    size: number;
  }> {
    try {
      const metadata = await sharp(imageBuffer).metadata();
      return {
        width: metadata.width || 0,
        height: metadata.height || 0,
        format: metadata.format || 'unknown',
        size: imageBuffer.length
      };
    } catch (error) {
      throw new Error(`获取图片信息失败: ${error}`);
    }
  }

  /**
   * 检查是否为支持的图片格式
   */
  static isSupportedImageFormat(mimetype: string): boolean {
    const supportedFormats = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/tiff',
      'image/svg+xml'
    ];
    return supportedFormats.includes(mimetype);
  }
}