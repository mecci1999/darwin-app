/**
 * Elasticsearch索引管理API
 */
import { esConnection } from '../index';

/**
 * 索引管理相关的数据库操作
 */

/**
 * 创建索引
 */
export async function createIndex(
  indexName: string,
  settings?: any,
  mappings?: any,
): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const client = await esConnection.getConnection();

    // 检查索引是否已存在
    const exists = await client.indices.exists({
      index: indexName,
    });

    if (exists) {
      return {
        success: true,
      };
    }

    // 创建索引
    await client.indices.create({
      index: indexName,
      body: {
        settings: settings || {},
        mappings: mappings || {},
      },
    });

    return {
      success: true,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 删除索引
 */
export async function deleteIndex(indexName: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const client = await esConnection.getConnection();

    // 检查索引是否存在
    const exists = await client.indices.exists({
      index: indexName,
    });

    if (!exists) {
      return { success: true };
    }

    // 删除索引
    await client.indices.delete({
      index: indexName,
    });

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 检查索引是否存在
 */
export async function indexExists(indexName: string): Promise<boolean> {
  try {
    const client = await esConnection.getConnection();
    return await client.indices.exists({ index: indexName });
  } catch (error) {
    return false;
  }
}

/**
 * 更新索引映射
 */
export async function updateIndexMapping(
  indexName: string,
  mappings: any,
): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const client = await esConnection.getConnection();

    await client.indices.putMapping({
      index: indexName,
      body: mappings,
    });

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 获取索引统计信息
 */
export async function getIndexStats(indexPattern: string): Promise<{
  indices: Array<{
    name: string;
    docCount: number;
    storeSize: string;
    health: string;
    status: string;
  }>;
}> {
  try {
    const client = await esConnection.getConnection();

    // 获取索引统计
    const stats = await client.indices.stats({
      index: indexPattern,
    });

    // 获取索引健康状态
    const health = await client.cluster.health({
      index: indexPattern,
      level: 'indices',
    });

    const indices = Object.keys(stats.indices || {}).map((indexName: string) => {
      const indexStats = stats.indices?.[indexName];
      const indexHealth = health.indices?.[indexName];

      return {
        name: indexName,
        docCount: indexStats?.total?.docs?.count || 0,
        storeSize: formatBytes(indexStats?.total?.store?.size_in_bytes || 0),
        health: indexHealth?.status || 'unknown',
        status: indexHealth?.status || 'unknown',
      };
    });

    return { indices };
  } catch (error) {
    throw error;
  }
}

/**
 * 优化索引
 */
export async function optimizeIndex(
  indexPattern: string,
  maxNumSegments: number = 1,
): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const client = await esConnection.getConnection();

    await client.indices.forcemerge({
      index: indexPattern,
      max_num_segments: maxNumSegments,
      wait_for_completion: true,
    });

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 创建索引模板
 */
export async function createIndexTemplate(
  templateName: string,
  indexPatterns: string[],
  settings?: any,
  mappings?: any,
  priority: number = 100,
): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const client = await esConnection.getConnection();

    await client.indices.putIndexTemplate({
      name: templateName,
      index_patterns: indexPatterns,
      priority,
      template: {
        settings: settings || {},
        mappings: mappings || {},
      },
    });

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 重建索引
 */
export async function reindexData(
  sourceIndex: string,
  targetIndex: string,
  query?: any,
  batchSize: number = 1000,
): Promise<{
  success: boolean;
  reindexed: number;
  error?: string;
}> {
  try {
    const client = await esConnection.getConnection();

    // 构建重建索引请求
    const reindexBody: any = {
      source: {
        index: sourceIndex,
        size: batchSize,
      },
      dest: {
        index: targetIndex,
      },
    };

    // 添加查询过滤
    if (query) {
      reindexBody.source.query = query;
    }

    // 执行重建索引
    const response = await client.reindex({
      ...reindexBody,
      timeout: '30m',
      wait_for_completion: true,
    });

    return {
      success: true,
      reindexed: response.total || 0,
    };
  } catch (error) {
    return {
      success: false,
      reindexed: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 格式化字节数
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
