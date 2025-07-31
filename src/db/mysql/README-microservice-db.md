# 微服务独立数据库连接架构

## 概述

新的数据库服务架构为每个微服务实例提供独立的数据库连接，替代了之前共享全局 `mainConnection` 的方式。这种设计提供了更好的隔离性、可维护性和可扩展性。

## 架构特点

### 🔗 独立连接
- 每个微服务实例拥有自己的数据库连接
- 连接之间完全隔离，互不影响
- 支持不同的连接配置（如慢查询阈值、日志级别等）

### 🏷️ 服务标识
- 每个数据库服务实例都有唯一的服务名称
- 便于日志追踪和问题定位
- 支持服务级别的监控和统计

### ⚡ 灵活初始化
- 支持完整初始化（包括IP黑名单、定时器等）
- 支持简单初始化（仅建立数据库连接）
- 可根据微服务需求选择合适的初始化方式

## 使用方法

### 方式一：使用 `createStarWithDatabase`

```typescript
import { createStarWithDatabase } from 'db/mysql/service';

// 创建带有数据库服务的 Star 实例
const star = createStarWithDatabase(config, 'auth-service');

// 初始化数据库
await star.db.initialize({}, {
  enableSlowQueryLog: true,
  slowQueryThreshold: 1000,
  enableIpBlacklist: false,
});

// 使用数据库API
const userExists = await star.db.auth.findEmailIsExist('test@example.com');

// 清理
await star.db.cleanup();
```

### 方式二：使用 `createMicroserviceDatabase`

```typescript
import { Star } from 'node-universe';
import { createMicroserviceDatabase } from 'db/mysql/service';

// 创建 Star 实例
const star = new Star(config);

// 为现有 Star 实例创建独立的数据库服务
const db = createMicroserviceDatabase(star, 'user-service');

// 简单初始化
await db.simpleInitialize();

// 使用数据库API
const userInfo = await db.user.findUserByUserId('user123');

// 清理
await db.cleanup();
```

### 方式三：扩展现有 Star 实例

```typescript
import { Star } from 'node-universe';
import { extendStarWithDatabase } from 'db/mysql/service';

// 现有的 Star 实例
const star = new Star(config);

// 扩展数据库服务
const starWithDB = extendStarWithDatabase(star, 'gateway-service');

// 使用扩展后的实例
await starWithDB.db.initialize({}, {
  enableIpBlacklist: true,
  enableIpSyncTimer: true,
});
```

## 配置选项

### DatabaseServiceConfig

```typescript
interface DatabaseServiceConfig {
  enableSlowQueryLog?: boolean;     // 启用慢查询日志，默认: true
  slowQueryThreshold?: number;      // 慢查询阈值(ms)，默认: 1000
  enableIpBlacklist?: boolean;      // 启用IP黑名单，默认: false
  enableIpSyncTimer?: boolean;      // 启用IP同步定时器，默认: false
}
```

### 初始化方式对比

| 方法 | 用途 | 包含功能 |
|------|------|----------|
| `initialize()` | 完整初始化 | 数据库连接 + IP黑名单 + 定时器等 |
| `simpleInitialize()` | 简单初始化 | 仅数据库连接 |

## 微服务集成示例

### 认证服务 (auth-service)

```typescript
// src/auth/index.ts
import { createStarWithDatabase } from 'db/mysql/service';

export async function createAuthService() {
  const star = createStarWithDatabase({
    port: 3001,
    name: 'auth-service'
  }, 'auth-service');
  
  await star.db.initialize({}, {
    enableSlowQueryLog: true,
    slowQueryThreshold: 1000,
  });
  
  return star;
}
```

### 用户服务 (user-service)

```typescript
// src/user/index.ts
import { createStarWithDatabase } from 'db/mysql/service';

export async function createUserService() {
  const star = createStarWithDatabase({
    port: 3002,
    name: 'user-service'
  }, 'user-service');
  
  await star.db.simpleInitialize();
  
  return star;
}
```

### 网关服务 (gateway-service)

```typescript
// src/gateway/index.ts
import { createStarWithDatabase } from 'db/mysql/service';

export async function createGatewayService() {
  const star = createStarWithDatabase({
    port: 3000,
    name: 'gateway-service'
  }, 'gateway-service');
  
  await star.db.initialize({}, {
    enableSlowQueryLog: true,
    slowQueryThreshold: 500,  // 网关对性能要求更高
    enableIpBlacklist: true,  // 网关需要IP黑名单功能
    enableIpSyncTimer: true,
  });
  
  return star;
}
```

## 数据库API访问

所有原有的数据库API都通过命名空间进行组织：

```typescript
// 认证相关
await star.db.auth.findEmailIsExist(email);
await star.db.auth.saveOrUpdateEmailAuth(data);
await star.db.auth.findEmailAuthByEmail(email);

// 用户相关
await star.db.user.findUserByUserId(userId);
await star.db.user.saveOrUpdateUsers(users);
await star.db.user.queryAllUsers();

// 配置相关
await star.db.config.getAllConfigList();
await star.db.config.saveOrUpdateConfigs(configs);

// 其他服务
await star.db.billing.*;
await star.db.payment.*;
await star.db.quota.*;
await star.db.subscription.*;
```

## 高级功能

### 获取原始连接

```typescript
const connection = star.db.getConnection();
if (connection) {
  // 执行原始SQL查询
  const results = await connection.query('SELECT * FROM users');
}
```

### 获取数据库模型

```typescript
const UserModel = await star.db.getModel('User');
if (UserModel) {
  const users = await UserModel.findAll();
}
```

### 连接状态检查

```typescript
if (star.db.initialized) {
  console.log('数据库已初始化');
} else {
  console.log('数据库未初始化');
}
```

## 日志和监控

每个微服务的数据库操作都会带有服务标识：

```
[auth-service] Database service initialized successfully
[user-service] Slow query detected: SELECT * FROM users, timing: 1200ms
[gateway-service] Database service cleaned up successfully
```

## 迁移指南

### 从旧架构迁移

**旧代码：**
```typescript
import { DatabaseInitializer } from 'db/mysql/initializer';
import mainConnection from 'db/mysql/connections/main';

// 初始化
await DatabaseInitializer.fullInitialize(logger, state);

// 使用
const model = await mainConnection.getModel('User');
```

**新代码：**
```typescript
import { createStarWithDatabase } from 'db/mysql/service';

// 初始化
const star = createStarWithDatabase(config, 'my-service');
await star.db.initialize(state);

// 使用
const model = await star.db.getModel('User');
```

## 最佳实践

1. **服务命名**：使用有意义的服务名称，如 `auth-service`、`user-service`
2. **初始化选择**：根据服务需求选择合适的初始化方式
3. **资源清理**：确保在服务关闭时调用 `cleanup()` 方法
4. **错误处理**：妥善处理数据库连接错误
5. **性能监控**：根据服务特点设置合适的慢查询阈值

## 故障排除

### 常见问题

1. **连接未初始化**
   ```
   Database connection [service-name] not initialized
   ```
   解决：确保在使用前调用 `initialize()` 或 `simpleInitialize()`

2. **重复初始化**
   ```
   Database service [service-name] already initialized
   ```
   解决：检查是否多次调用初始化方法

3. **连接泄漏**
   解决：确保在服务关闭时调用 `cleanup()` 方法

### 调试技巧

- 检查服务初始化状态：`star.db.initialized`
- 查看连接实例：`star.db.getConnection()`
- 启用详细日志：设置 `enableSlowQueryLog: true`