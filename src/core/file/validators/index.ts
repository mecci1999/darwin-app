/**
 * 文件验证器
 */

import { FileCategory, ValidationResult } from '../types';
import { PROCESSING_PROFILES } from '../constants';

export class FileValidator {
  /**
   * 验证文件
   */
  static validate(
    file: Buffer,
    filename: string,
    mimetype: string,
    category: FileCategory
  ): ValidationResult {
    const errors: string[] = [];
    const profile = PROCESSING_PROFILES[category];

    // 检查文件大小
    if (file.length > profile.maxSize) {
      errors.push(`文件大小超过限制，最大允许 ${this.formatFileSize(profile.maxSize)}`);
    }

    // 检查MIME类型
    if (!profile.allowedMimeTypes.includes(mimetype)) {
      errors.push(`不支持的文件类型：${mimetype}`);
    }

    // 检查文件名
    if (!filename || filename.trim().length === 0) {
      errors.push('文件名不能为空');
    }

    // 检查文件扩展名
    const ext = this.getFileExtension(filename);
    if (!ext) {
      errors.push('文件必须有扩展名');
    }

    // 检查文件内容（简单的魔数检查）
    if (this.isImageMimeType(mimetype)) {
      if (!this.validateImageMagicNumber(file, mimetype)) {
        errors.push('文件内容与扩展名不匹配');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * 格式化文件大小
   */
  private static formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${Math.round(size * 100) / 100}${units[unitIndex]}`;
  }

  /**
   * 获取文件扩展名
   */
  private static getFileExtension(filename: string): string | null {
    const match = filename.match(/\.([^.]+)$/);
    return match ? match[1].toLowerCase() : null;
  }

  /**
   * 检查是否为图片MIME类型
   */
  private static isImageMimeType(mimetype: string): boolean {
    return mimetype.startsWith('image/');
  }

  /**
   * 验证图片魔数
   */
  private static validateImageMagicNumber(file: Buffer, mimetype: string): boolean {
    if (file.length < 4) return false;

    const header = file.subarray(0, 4);

    switch (mimetype) {
      case 'image/jpeg':
        return header[0] === 0xFF && header[1] === 0xD8;
      case 'image/png':
        return header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47;
      case 'image/webp':
        return file.length >= 12 && 
               file.subarray(0, 4).toString() === 'RIFF' && 
               file.subarray(8, 12).toString() === 'WEBP';
      case 'image/gif':
        return file.subarray(0, 3).toString() === 'GIF';
      default:
        return true; // 对于其他类型，暂时不验证
    }
  }
}