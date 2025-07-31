import CryptoJS from 'crypto-js';

// 解密函数
export function decryptPassword(encryptedPassword: string, secretKey: string): string {
  const bytes = CryptoJS.AES.decrypt(encryptedPassword, secretKey);
  return bytes.toString(CryptoJS.enc.Utf8);
}

// 导出所有工具函数
export * from './generateUserId';
export * from './getMilliseconds';
export * from './handlerActionSchema';
export * from './memory-store';
export * from './showPinoLogFile';
