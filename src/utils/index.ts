import CryptoJS from 'crypto-js';

// 解密函数
export function decryptPassword(encryptedPassword: string, secretKey: string): string {
  const bytes = CryptoJS.AES.decrypt(encryptedPassword, secretKey);
  return bytes.toString(CryptoJS.enc.Utf8);
}

// 导出响应工具类
export { ResponseUtils } from './response-utils';
