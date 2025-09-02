/**
 * 存储适配器
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { StorageAdapter } from '../types';

export class LocalStorageAdapter implements StorageAdapter {
  private basePath: string;
  private baseUrl: string;

  constructor(basePath: string = './uploads', baseUrl: string = '/uploads') {
    this.basePath = path.resolve(basePath);
    this.baseUrl = baseUrl;
    this.ensureDirectoryExists();
  }

  /**
   * 保存文件
   */
  async save(file: Buffer, filename: string, category?: string, userId?: string): Promise<string> {
    try {
      // 生成安全的文件名
      const safeFilename = this.generateSafeFilename(filename);
      const filePath = path.join(this.basePath, safeFilename);
      
      // 确保目录存在
      await this.ensureDirectoryExists(path.dirname(filePath));
      
      // 写入文件
      await fs.writeFile(filePath, file);
      
      // 如果有分类或用户ID，保存元数据文件
      if (category || userId) {
        const metadata = {
          category,
          userId,
          uploadedAt: new Date().toISOString(),
          originalFilename: filename
        };
        const metadataPath = filePath + '.meta.json';
        await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
      }
      
      return safeFilename;
    } catch (error) {
      throw new Error(`文件保存失败: ${error}`);
    }
  }

  /**
   * 删除文件
   */
  async delete(filename: string): Promise<boolean> {
    try {
      const filePath = path.join(this.basePath, filename);
      const metadataPath = filePath + '.meta.json';
      
      // 删除主文件
      await fs.unlink(filePath);
      
      // 删除元数据文件（如果存在）
      try {
        await fs.unlink(metadataPath);
      } catch {
        // 元数据文件不存在，忽略错误
      }
      
      return true;
    } catch (error) {
      console.error(`文件删除失败: ${error}`);
      return false;
    }
  }

  /**
   * 获取文件URL
   */
  getUrl(filename: string): string {
    return `${this.baseUrl}/${filename}`;
  }

  /**
   * 检查文件是否存在
   */
  async exists(filename: string): Promise<boolean> {
    try {
      const filePath = path.join(this.basePath, filename);
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取文件元数据
   */
  async getMetadata(filename: string): Promise<Record<string, any> | null> {
    try {
      const filePath = path.join(this.basePath, filename);
      const metadataPath = filePath + '.meta.json';
      const metadataContent = await fs.readFile(metadataPath, 'utf-8');
      return JSON.parse(metadataContent);
    } catch {
      return null;
    }
  }

  /**
   * 生成安全的文件名
   */
  private generateSafeFilename(originalFilename: string): string {
    // 获取文件扩展名
    const ext = path.extname(originalFilename);
    const nameWithoutExt = path.basename(originalFilename, ext);
    
    // 生成时间戳和随机字符串
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    
    // 清理文件名，只保留字母数字和一些安全字符
    const safeName = nameWithoutExt
      .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_')
      .substring(0, 50); // 限制长度
    
    return `${timestamp}_${random}_${safeName}${ext}`;
  }

  /**
   * 确保目录存在
   */
  private async ensureDirectoryExists(dirPath?: string): Promise<void> {
    const targetPath = dirPath || this.basePath;
    try {
      await fs.access(targetPath);
    } catch {
      await fs.mkdir(targetPath, { recursive: true });
    }
  }

  /**
   * 获取文件统计信息
   */
  async getFileStats(filename: string): Promise<{
    size: number;
    createdAt: Date;
    modifiedAt: Date;
  } | null> {
    try {
      const filePath = path.join(this.basePath, filename);
      const stats = await fs.stat(filePath);
      return {
        size: stats.size,
        createdAt: stats.birthtime,
        modifiedAt: stats.mtime
      };
    } catch {
      return null;
    }
  }

  /**
   * 清理过期文件
   */
  async cleanupExpiredFiles(maxAge: number = 30 * 24 * 60 * 60 * 1000): Promise<number> {
    try {
      const files = await fs.readdir(this.basePath);
      const now = Date.now();
      let deletedCount = 0;

      for (const file of files) {
        if (file.endsWith('.meta.json')) continue; // 跳过元数据文件
        
        const filePath = path.join(this.basePath, file);
        const stats = await fs.stat(filePath);
        
        if (now - stats.mtime.getTime() > maxAge) {
          await this.delete(file);
          deletedCount++;
        }
      }

      return deletedCount;
    } catch (error) {
      console.error(`清理过期文件失败: ${error}`);
      return 0;
    }
  }
}

// 导出默认实例
export const defaultStorage = new LocalStorageAdapter();