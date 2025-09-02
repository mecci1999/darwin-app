# 数据库设计与开发规范

本文档定义了项目中数据库层的设计规范、开发标准和最佳实践。

## 目录

- [数据库架构概述](#数据库架构概述)
- [微服务数据库设计](#微服务数据库设计)
- [数据模型规范](#数据模型规范)
- [数据库API规范](#数据库api规范)
- [连接管理规范](#连接管理规范)
- [性能优化规范](#性能优化规范)
- [安全规范](#安全规范)
- [监控与日志](#监控与日志)
- [迁移与版本控制](#迁移与版本控制)
- [最佳实践](#最佳实践)

## 数据库架构概述

### 支持的数据库类型

项目支持多种数据库类型：

```
src/db/
├── mysql/          # MySQL 关系型数据库
├── es/             # Elasticsearch 搜索引擎
└── sqlite/         # SQLite 轻量级数据库
```

### 架构特点

1. **微服务独立数据库**
   - 每个微服务拥有独立的数据库连接
   - 连接之间完全隔离，互不影响
   - 支持不同的连接配置

2. **多数据库支持**
   - MySQL：主要业务数据存储
   - Elasticsearch：全文搜索和日志存储
   - SQLite：轻量级本地存储

3. **统一接口设计**
   - 标准化的数据库操作接口
   - 一致的错误处理机制
   - 统一的连接管理

## 微服务数据库设计

### 服务独立性原则

1. **数据库隔离**
   ```typescript
   // 每个微服务有独立的数据库服务实例
   const authDB = createMicroserviceDatabase(star, 'auth-service');
   const userDB = createMicroserviceDatabase(star, 'user-service');
   const fileDB = createMicroserviceDatabase(star, 'file-service');
   ```

2. **服务标识**
   - 每个数据库服务实例都有唯一的服务名称
   - 便于日志追踪和问题定位
   - 支持服务级别的监控和统计

### 微服务数据库模版

```typescript
// 标准微服务数据库初始化模版
import { createMicroserviceDatabase } from 'db/mysql/service';
import { Star } from 'node-universe';

export async function initializeMicroserviceDB(star: Star, serviceName: string) {
  // 创建独立的数据库服务
  const db = createMicroserviceDatabase(star, serviceName);
  
  // 根据服务需求选择初始化方式
  if (serviceName === 'gateway-service') {
    // 网关服务需要完整功能
    await db.initialize({}, {
      enableSlowQueryLog: true,
      slowQueryThreshold: 500,
      enableIpBlacklist: true,
      enableIpSyncTimer: true,
    });
  } else {
    // 其他服务使用简单初始化
    await db.simpleInitialize();
  }
  
  return db;
}
```

### 初始化配置

```typescript
interface DatabaseServiceConfig {
  enableSlowQueryLog?: boolean;     // 启用慢查询日志，默认: true
  slowQueryThreshold?: number;      // 慢查询阈值(ms)，默认: 1000
  enableIpBlacklist?: boolean;      // 启用IP黑名单，默认: false
  enableIpSyncTimer?: boolean;      // 启用IP同步定时器，默认: false
}
```

## 数据模型规范

### 表设计规范

1. **命名规范**
   ```sql
   -- 表名：snake_case
   CREATE TABLE user_profiles (
     -- 字段名：snake_case
     user_id VARCHAR(255),
     created_at TIMESTAMP,
     updated_at TIMESTAMP
   );
   ```

2. **必备字段**
   ```sql
   CREATE TABLE standard_table (
     id BIGINT PRIMARY KEY AUTO_INCREMENT,
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     version INT DEFAULT 1,
     deleted_at TIMESTAMP NULL  -- 软删除支持
   );
   ```

3. **扩展字段设计**
   ```sql
   -- 支持多租户
   tenant_id VARCHAR(255),
   
   -- 元数据扩展
   meta JSON,
   
   -- 多应用支持
   application_ids JSON
   ```

### TypeScript 模型定义

```typescript
/**
 * 标准数据模型接口
 */
export interface IBaseTableAttributes {
  id?: number;
  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date;
  version?: number;
  // 多租户支持
  tenantId?: string;
  // 元数据扩展
  meta?: string;
}

/**
 * 用户表属性接口
 */
export interface IUserTableAttributes extends IBaseTableAttributes {
  userId: string;
  nickname?: string;
  avatar?: string;
  status: string;
  source: string;
  power?: number;
  devices?: string;
  timezone?: string;
  locale?: string;
  lastActiveAt?: Date;
  applicationIds?: string;
}

/**
 * Sequelize 模型类
 */
export class UserTable extends Model<IUserTableAttributes> implements IUserTableAttributes {
  public id!: number;
  public userId!: string;
  public nickname!: string | undefined;
  public avatar!: string | undefined;
  public status!: string;
  public source!: string;
  public power!: number | undefined;
  public devices!: string | undefined;
  public timezone!: string | undefined;
  public locale!: string | undefined;
  public lastActiveAt!: Date | undefined;
  public meta!: string | undefined;
  public version!: number;
  public tenantId!: string | undefined;
  public applicationIds!: string | undefined;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
  public deletedAt!: Date | undefined;
}
```

### 模型工厂函数

```typescript
export default function createUserModel(sequelize: Sequelize) {
  return sequelize.define<UserTable>(
    DataBaseTableNames.User,
    {
      id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
      },
      userId: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
        comment: '用户唯一标识',
      },
      nickname: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: '用户昵称',
      },
      // ... 其他字段定义
      version: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
        comment: '版本号，用于乐观锁',
      },
    },
    {
      tableName: 'users',
      timestamps: true,
      paranoid: true, // 启用软删除
      indexes: [
        {
          unique: true,
          fields: ['userId'],
        },
        {
          fields: ['status'],
        },
        {
          fields: ['tenantId'],
        },
      ],
    }
  );
}
```

## 数据库API规范

### API组织结构

```
src/db/mysql/apis/
├── auth.ts         # 认证相关操作
├── user.ts         # 用户相关操作
├── billing.ts      # 计费相关操作
├── config.ts       # 配置相关操作
└── ...
```

### API函数规范

1. **命名规范**
   ```typescript
   // 查询操作：find/query + 描述
   export async function findUserByUserId(userId: string): Promise<IUserTableAttributes | null>
   export async function queryAllUsers(): Promise<IUserTableAttributes[]>
   
   // 保存操作：save/create/update + 描述
   export async function saveOrUpdateUsers(users: IUserTableAttributes[]): Promise<IUserTableAttributes[]>
   export async function createUser(userData: IUserTableAttributes): Promise<IUserTableAttributes>
   
   // 删除操作：delete/remove + 描述
   export async function deleteUserByUserId(userId: string): Promise<boolean>
   ```

2. **函数实现模版**
   ```typescript
   /**
    * 根据用户ID查找用户
    * @param userId 用户ID
    * @returns 用户信息或null
    */
   export async function findUserByUserId(userId: string): Promise<IUserTableAttributes | null> {
     try {
       const model = await mainConnection.getModel<UserTable>(DataBaseTableNames.User);
       if (!model) {
         throw new Error('User model not found');
       }
       
       const user = await model.findOne({
         where: { userId },
         attributes: {
           exclude: ['deletedAt'] // 排除敏感字段
         }
       });
       
       return user ? user.toJSON() : null;
     } catch (error) {
       console.error('Error finding user by userId:', error);
       throw error;
     }
   }
   ```

3. **批量操作规范**
   ```typescript
   /**
    * 批量保存或更新用户
    * @param users 用户数据数组
    * @returns 处理后的用户数据
    */
   export async function saveOrUpdateUsers(users: IUserTableAttributes[]): Promise<IUserTableAttributes[]> {
     try {
       const model = await mainConnection.getModel<UserTable>(DataBaseTableNames.User);
       if (!model) {
         throw new Error('User model not found');
       }
       
       return await model.bulkCreate(users, {
         updateOnDuplicate: [
           'nickname',
           'avatar',
           'status',
           'lastActiveAt',
           'version',
         ],
         returning: true,
       });
     } catch (error) {
       console.error('Error saving or updating users:', error);
       throw error;
     }
   }
   ```

### 事务处理

```typescript
/**
 * 事务操作示例
 */
export async function transferUserData(fromUserId: string, toUserId: string) {
  const connection = await mainConnection.getConnection();
  if (!connection) {
    throw new Error('Database connection not available');
  }
  
  const transaction = await connection.transaction();
  
  try {
    // 执行多个相关操作
    await updateUserStatus(fromUserId, 'inactive', { transaction });
    await updateUserStatus(toUserId, 'active', { transaction });
    await transferUserAssets(fromUserId, toUserId, { transaction });
    
    // 提交事务
    await transaction.commit();
  } catch (error) {
    // 回滚事务
    await transaction.rollback();
    throw error;
  }
}
```

## 连接管理规范

### 连接创建方式

1. **方式一：使用 `createStarWithDatabase`**
   ```typescript
   import { createStarWithDatabase } from 'db/mysql/service';
   
   const star = createStarWithDatabase(config, 'service-name');
   await star.db.initialize({}, options);
   ```

2. **方式二：使用 `createMicroserviceDatabase`**
   ```typescript
   import { createMicroserviceDatabase } from 'db/mysql/service';
   
   const star = new Star(config);
   const db = createMicroserviceDatabase(star, 'service-name');
   await db.simpleInitialize();
   ```

3. **方式三：扩展现有实例**
   ```typescript
   import { extendStarWithDatabase } from 'db/mysql/service';
   
   const star = new Star(config);
   const starWithDB = extendStarWithDatabase(star, 'service-name');
   ```

### 连接配置

```typescript
// 不同服务的连接配置示例
const serviceConfigs = {
  'gateway-service': {
    enableSlowQueryLog: true,
    slowQueryThreshold: 500,  // 网关对性能要求更高
    enableIpBlacklist: true,
    enableIpSyncTimer: true,
  },
  'auth-service': {
    enableSlowQueryLog: true,
    slowQueryThreshold: 1000,
    enableIpBlacklist: false,
  },
  'user-service': {
    enableSlowQueryLog: true,
    slowQueryThreshold: 1500,
  },
};
```

### 连接生命周期管理

```typescript
// 微服务生命周期钩子中的数据库管理
star.createService({
  name: 'example-service',
  
  created() {
    // 创建数据库服务实例
    const databaseService = new DatabaseService(star, 'example-service');
    star.db = databaseService;
  },
  
  async started() {
    // 启动时初始化数据库连接
    await star.db.simpleInitialize();
    console.log('Database service started');
  },
  
  async stopped() {
    // 停止时清理数据库连接
    await star.db.cleanup();
    console.log('Database service stopped');
  },
});
```

## 性能优化规范

### 索引策略

1. **主键索引**
   ```sql
   -- 使用自增主键
   id BIGINT PRIMARY KEY AUTO_INCREMENT
   ```

2. **唯一索引**
   ```sql
   -- 业务唯一标识
   CREATE UNIQUE INDEX idx_user_id ON users(user_id);
   CREATE UNIQUE INDEX idx_email ON users(email);
   ```

3. **复合索引**
   ```sql
   -- 遵循最左前缀原则
   CREATE INDEX idx_tenant_status ON users(tenant_id, status);
   CREATE INDEX idx_created_status ON users(created_at, status);
   ```

4. **查询优化索引**
   ```sql
   -- 针对常用查询条件
   CREATE INDEX idx_last_active ON users(last_active_at);
   CREATE INDEX idx_source ON users(source);
   ```

### 查询优化

1. **分页查询**
   ```typescript
   export async function queryUsersPaginated(page: number, limit: number) {
     const offset = (page - 1) * limit;
     
     const model = await mainConnection.getModel<UserTable>(DataBaseTableNames.User);
     return await model.findAndCountAll({
       limit,
       offset,
       order: [['createdAt', 'DESC']],
       attributes: {
         exclude: ['deletedAt', 'meta'] // 排除大字段
       }
     });
   }
   ```

2. **条件查询优化**
   ```typescript
   export async function queryActiveUsers(tenantId?: string) {
     const whereClause: any = {
       status: 'active',
       deletedAt: null,
     };
     
     if (tenantId) {
       whereClause.tenantId = tenantId;
     }
     
     const model = await mainConnection.getModel<UserTable>(DataBaseTableNames.User);
     return await model.findAll({
       where: whereClause,
       attributes: ['userId', 'nickname', 'avatar'], // 只查询需要的字段
       raw: true, // 返回原始数据，提高性能
     });
   }
   ```

### 慢查询监控

```typescript
// 启用慢查询日志
const dbConfig = {
  enableSlowQueryLog: true,
  slowQueryThreshold: 1000, // 1秒
};

// 慢查询日志格式
// [service-name] Slow query detected: SELECT * FROM users WHERE ..., timing: 1200ms
```

## 安全规范

### 数据访问控制

1. **字段级安全**
   ```typescript
   // 排除敏感字段
   const safeUserAttributes = {
     exclude: ['password', 'salt', 'deletedAt', 'internalMeta']
   };
   
   export async function findPublicUserInfo(userId: string) {
     const model = await mainConnection.getModel<UserTable>(DataBaseTableNames.User);
     return await model.findOne({
       where: { userId },
       attributes: safeUserAttributes
     });
   }
   ```

2. **多租户隔离**
   ```typescript
   export async function findUsersByTenant(tenantId: string) {
     const model = await mainConnection.getModel<UserTable>(DataBaseTableNames.User);
     return await model.findAll({
       where: {
         tenantId,
         deletedAt: null,
       }
     });
   }
   ```

### SQL注入防护

```typescript
// 使用参数化查询
export async function findUsersByCustomQuery(conditions: any) {
  const model = await mainConnection.getModel<UserTable>(DataBaseTableNames.User);
  
  // 使用 Sequelize 的 where 条件，自动防护 SQL 注入
  return await model.findAll({
    where: conditions, // Sequelize 会自动转义
  });
}

// 避免原始 SQL 查询，如必须使用，确保参数化
export async function executeRawQuery(userId: string) {
  const connection = await mainConnection.getConnection();
  
  // 使用参数化查询
  const [results] = await connection.query(
    'SELECT * FROM users WHERE user_id = :userId',
    {
      replacements: { userId },
      type: QueryTypes.SELECT,
    }
  );
  
  return results;
}
```

## 监控与日志

### 日志规范

1. **操作日志**
   ```typescript
   export async function createUser(userData: IUserTableAttributes) {
     try {
       console.log(`[${serviceName}] Creating user:`, { userId: userData.userId });
       
       const model = await mainConnection.getModel<UserTable>(DataBaseTableNames.User);
       const user = await model.create(userData);
       
       console.log(`[${serviceName}] User created successfully:`, { userId: user.userId });
       return user;
     } catch (error) {
       console.error(`[${serviceName}] Failed to create user:`, {
         userId: userData.userId,
         error: error.message,
       });
       throw error;
     }
   }
   ```

2. **性能日志**
   ```typescript
   // 自动记录慢查询
   // [auth-service] Slow query detected: SELECT * FROM users, timing: 1200ms
   
   // 手动性能监控
   export async function monitoredQuery<T>(operation: () => Promise<T>, operationName: string): Promise<T> {
     const startTime = Date.now();
     
     try {
       const result = await operation();
       const duration = Date.now() - startTime;
       
       if (duration > 500) {
         console.warn(`[${serviceName}] Slow operation detected: ${operationName}, timing: ${duration}ms`);
       }
       
       return result;
     } catch (error) {
       const duration = Date.now() - startTime;
       console.error(`[${serviceName}] Operation failed: ${operationName}, timing: ${duration}ms, error:`, error);
       throw error;
     }
   }
   ```

### 健康检查

```typescript
/**
 * 数据库健康检查
 */
export async function checkDatabaseHealth() {
  try {
    const connection = await mainConnection.getConnection();
    if (!connection) {
      return { status: 'unhealthy', message: 'No database connection' };
    }
    
    // 执行简单查询测试连接
    await connection.query('SELECT 1');
    
    return {
      status: 'healthy',
      message: 'Database connection is working',
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      message: error.message,
      timestamp: new Date().toISOString(),
    };
  }
}
```

## 迁移与版本控制

### 数据库迁移

1. **迁移文件命名**
   ```
   migrations/
   ├── 20240115120000-create-users-table.js
   ├── 20240115130000-add-tenant-id-to-users.js
   └── 20240115140000-create-user-profiles-table.js
   ```

2. **迁移文件模版**
   ```javascript
   'use strict';
   
   module.exports = {
     async up(queryInterface, Sequelize) {
       await queryInterface.createTable('users', {
         id: {
           type: Sequelize.BIGINT,
           primaryKey: true,
           autoIncrement: true,
         },
         userId: {
           type: Sequelize.STRING(255),
           allowNull: false,
           unique: true,
         },
         // ... 其他字段
         createdAt: {
           type: Sequelize.DATE,
           allowNull: false,
           defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
         },
         updatedAt: {
           type: Sequelize.DATE,
           allowNull: false,
           defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'),
         },
       });
       
       // 添加索引
       await queryInterface.addIndex('users', ['userId'], {
         unique: true,
         name: 'idx_users_user_id',
       });
     },
     
     async down(queryInterface, Sequelize) {
       await queryInterface.dropTable('users');
     },
   };
   ```

### 版本兼容性

```typescript
// 模型版本控制
export interface IUserTableAttributesV1 {
  id?: number;
  userId: string;
  nickname?: string;
  // v1 字段
}

export interface IUserTableAttributesV2 extends IUserTableAttributesV1 {
  tenantId?: string; // v2 新增
  applicationIds?: string; // v2 新增
}

// 当前版本
export type IUserTableAttributes = IUserTableAttributesV2;
```

## 最佳实践

### 开发规范

1. **服务命名**
   - 使用有意义的服务名称：`auth-service`、`user-service`、`file-service`
   - 保持命名一致性和可读性

2. **初始化选择**
   ```typescript
   // 网关服务：需要完整功能
   await db.initialize({}, {
     enableIpBlacklist: true,
     enableIpSyncTimer: true,
   });
   
   // 业务服务：使用简单初始化
   await db.simpleInitialize();
   ```

3. **资源管理**
   ```typescript
   // 确保资源清理
   process.on('SIGTERM', async () => {
     await star.db.cleanup();
     process.exit(0);
   });
   ```

### 错误处理

```typescript
/**
 * 统一错误处理模式
 */
export async function safeDbOperation<T>(
  operation: () => Promise<T>,
  operationName: string
): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    console.error(`[${serviceName}] Database operation failed: ${operationName}`, {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    });
    
    // 根据错误类型决定是否重试或返回默认值
    if (error.name === 'SequelizeConnectionError') {
      // 连接错误，可能需要重试
      throw error;
    }
    
    // 其他错误返回 null
    return null;
  }
}
```

### 性能优化建议

1. **查询优化**
   - 只查询需要的字段
   - 使用适当的索引
   - 避免 N+1 查询问题
   - 合理使用分页

2. **连接管理**
   - 合理设置连接池大小
   - 及时释放连接资源
   - 监控连接使用情况

3. **缓存策略**
   - 对频繁查询的数据使用缓存
   - 设置合理的缓存过期时间
   - 注意缓存一致性

### 故障排除

1. **常见问题**
   ```
   Database connection [service-name] not initialized
   → 确保调用初始化方法
   
   Database service [service-name] already initialized
   → 避免重复初始化
   
   Connection timeout
   → 检查网络和数据库状态
   ```

2. **调试技巧**
   ```typescript
   // 检查连接状态
   console.log('DB initialized:', star.db.initialized);
   
   // 获取连接实例
   const connection = star.db.getConnection();
   console.log('Connection available:', !!connection);
   
   // 启用详细日志
   const config = {
     enableSlowQueryLog: true,
     slowQueryThreshold: 100, // 降低阈值用于调试
   };
   ```

---

## 更新日志

- 2024-01-15: 初始版本创建
- 待完善: 根据项目发展持续更新

## 贡献指南

如需修改本文档，请：
1. 参考现有的数据库实现
2. 遵循项目的代码规范
3. 更新相关的示例代码
4. 提交 Pull Request 进行审查

---

*本文档基于项目实际的数据库架构编写，将随着项目发展持续更新。*