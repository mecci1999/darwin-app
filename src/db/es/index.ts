import _esConnection from './connections/main';
import { ElasticsearchInitializer } from './initializer';
import { ElasticsearchConnectionManager } from './manager';

// 导出连接实例
export const esConnection = _esConnection;

// 导出管理器和初始化器
export { ElasticsearchConnectionManager, ElasticsearchInitializer };

// 导出所有API模块
export * from './apis/index-management';
export * from './apis/document-operations';
export * from './apis/search-operations';
export * from './apis/log-operations';
