import CryptoJS from 'crypto-js';

// 解密函数
export function decryptPassword(encryptedPassword: string, secretKey: string): string {
  const bytes = CryptoJS.AES.decrypt(encryptedPassword, secretKey);
  return bytes.toString(CryptoJS.enc.Utf8);
}
