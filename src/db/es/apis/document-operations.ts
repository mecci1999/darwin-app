/**
 * Elasticsearch文档操作API
 */
import { esConnection } from '../index';

/**
 * 文档操作相关的数据库操作
 */

/**
 * 批量索引文档
 */
export async function bulkIndexDocuments(
  documents: Array<{
    index: string;
    id?: string;
    document: any;
  }>,
  refresh: boolean = false,
  timeout: string = '30s',
): Promise<{
  success: boolean;
  indexed: number;
  failed: number;
  errors?: Array<{ id: string; error: string }>;
}> {
  try {
    const client = await esConnection.getConnection();

    if (documents.length === 0) {
      return {
        success: true,
        indexed: 0,
        failed: 0,
      };
    }

    // 构建批量操作
    const body: any[] = [];
    documents.forEach((doc) => {
      body.push({
        index: {
          _index: doc.index,
          _id: doc.id,
        },
      });
      body.push(doc.document);
    });

    // 执行批量索引
    const response = await client.bulk({
      body,
      refresh: refresh ? 'wait_for' : false,
      timeout,
    });

    // 分析结果
    let indexed = 0;
    let failed = 0;
    const errors: Array<{ id: string; error: string }> = [];

    if (response.items) {
      response.items.forEach((item: any, index: number) => {
        const operation = item.index || item.create;
        if (operation.error) {
          failed++;
          errors.push({
            id: documents[index].id || `doc_${index}`,
            error: operation.error.reason || 'Unknown error',
          });
        } else {
          indexed++;
        }
      });
    }

    return {
      success: true,
      indexed,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error) {
    return {
      success: false,
      indexed: 0,
      failed: documents.length,
      errors: [
        {
          id: 'bulk_operation',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      ],
    };
  }
}

/**
 * 索引单个文档
 */
export async function indexDocument(
  index: string,
  document: any,
  id?: string,
  refresh: boolean = false,
): Promise<{
  success: boolean;
  id?: string;
  error?: string;
}> {
  try {
    const client = await esConnection.getConnection();

    const params: any = {
      index,
      body: document,
      refresh: refresh ? 'wait_for' : false,
    };

    if (id) {
      params.id = id;
    }

    const response = await client.index(params);

    return {
      success: true,
      id: response._id,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 获取文档
 */
export async function getDocument(
  index: string,
  id: string,
): Promise<{
  found: boolean;
  document?: any;
  error?: string;
}> {
  try {
    const client = await esConnection.getConnection();

    const response = await client.get({
      index,
      id,
    });

    return {
      found: response.found,
      document: response.found ? response._source : undefined,
    };
  } catch (error: any) {
    if (error.statusCode === 404) {
      return {
        found: false,
      };
    }

    return {
      found: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 更新文档
 */
export async function updateDocument(
  index: string,
  id: string,
  document: any,
  refresh: boolean = false,
): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const client = await esConnection.getConnection();

    await client.update({
      index,
      id,
      body: {
        doc: document,
      },
      refresh: refresh ? 'wait_for' : false,
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
 * 删除文档
 */
export async function deleteDocument(
  index: string,
  id: string,
  refresh: boolean = false,
): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const client = await esConnection.getConnection();

    await client.delete({
      index,
      id,
      refresh: refresh ? 'wait_for' : false,
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
 * 按查询删除文档
 */
export async function deleteByQuery(
  index: string,
  query: any,
  timeout: string = '30s',
): Promise<{
  success: boolean;
  deleted: number;
  error?: string;
}> {
  try {
    const client = await esConnection.getConnection();

    const response = await client.deleteByQuery({
      index,
      body: {
        query,
      },
      timeout,
      refresh: true,
    });

    return {
      success: true,
      deleted: response.deleted || 0,
    };
  } catch (error) {
    return {
      success: false,
      deleted: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 批量更新文档
 */
export async function bulkUpdateDocuments(
  updates: Array<{
    index: string;
    id: string;
    document: any;
  }>,
  refresh: boolean = false,
  timeout: string = '30s',
): Promise<{
  success: boolean;
  updated: number;
  failed: number;
  errors?: Array<{ id: string; error: string }>;
}> {
  try {
    const client = await esConnection.getConnection();

    if (updates.length === 0) {
      return {
        success: true,
        updated: 0,
        failed: 0,
      };
    }

    // 构建批量操作
    const body: any[] = [];
    updates.forEach((update) => {
      body.push({
        update: {
          _index: update.index,
          _id: update.id,
        },
      });
      body.push({
        doc: update.document,
      });
    });

    // 执行批量更新
    const response = await client.bulk({
      body,
      refresh: refresh ? 'wait_for' : false,
      timeout,
    });

    // 分析结果
    let updated = 0;
    let failed = 0;
    const errors: Array<{ id: string; error: string }> = [];

    if (response.items) {
      response.items.forEach((item: any, index: number) => {
        const operation = item.update;
        if (operation.error) {
          failed++;
          errors.push({
            id: updates[index].id,
            error: operation.error.reason || 'Unknown error',
          });
        } else {
          updated++;
        }
      });
    }

    return {
      success: true,
      updated,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error) {
    return {
      success: false,
      updated: 0,
      failed: updates.length,
      errors: [
        {
          id: 'bulk_operation',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      ],
    };
  }
}
