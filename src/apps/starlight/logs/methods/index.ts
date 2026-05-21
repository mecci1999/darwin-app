/**
 * 日志微服务方法集合
 * SaaS化日志管理系统的核心业务方法
 */

// 导出所有方法
export * from './log-ingestion';
export * from './log-stats';
export * from './log-export';
export * from './log-stream';
export * from './api-key-management';
export * from './quota-management';
export * from './log-processing';

// 从 log-search 模块导出
export {
  searchLogs,
  getSearchSuggestions,
  advancedSearchLogs,
  realtimeSearchLogs,
  stopRealtimeSearch,
  getFieldValues,
  saveSearchQuery,
  getSavedSearchQueries,
  buildSearchQuery,
} from './log-search';

// 从 elasticsearch-operations 模块导出（重命名以避免冲突）
export { searchLogs as esSearchLogs } from './elasticsearch-operations';

// 从 log-export 模块导出
export {
  exportLogs,
  performLogExport,
  getExportStatus,
  downloadExportFile,
  deleteExportFile,
  getExportHistory,
  cleanupExpiredExports,
} from './log-export';

// 以下文件暂未创建
// export * from './alert-management';
// export * from './dashboard-management';
