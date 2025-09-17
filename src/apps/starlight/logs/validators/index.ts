/**
 * 日志验证器统一导出
 * 提供hooks风格的验证器函数
 */

import { logsValidators } from './logs';

// 验证结果接口
interface ValidationResult<T = any> {
  valid: boolean;
  data?: T;
  errors: string[];
}

// 创建hooks风格的验证器函数
function validateIngest(data: any): ValidationResult {
  return logsValidators.validateLogIngest(data);
}

function validateBatchIngest(data: any): ValidationResult {
  return logsValidators.validateLogBatchIngest(data);
}

function validateSearch(data: any): ValidationResult {
  return logsValidators.validateLogSearch(data);
}

function validateStats(data: any): ValidationResult {
  return logsValidators.validateLogStats(data);
}

function validateStream(data: any): ValidationResult {
  return logsValidators.validateLogStream(data);
}

// 导出验证器对象
export const validators = {
  ingest: validateIngest,
  batchIngest: validateBatchIngest,
  search: validateSearch,
  stats: validateStats,
  stream: validateStream
};

// 导出原始验证器
export { logsValidators };

// 导出所有验证函数
export * from './logs';