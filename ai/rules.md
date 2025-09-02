# AI 开发规则与条件

本文档定义了在使用 AI 辅助开发过程中需要遵循的规则、条件和最佳实践。

## 目录

- [项目架构规范](#项目架构规范)
- [代码规范](#代码规范)
- [微服务设计原则](#微服务设计原则)
- [数据库设计规范](#数据库设计规范)
- [API 设计规范](#api-设计规范)
- [错误处理规范](#错误处理规范)
- [安全规范](#安全规范)
- [测试规范](#测试规范)
- [文档规范](#文档规范)
- [AI 辅助开发指南](#ai-辅助开发指南)

## 项目架构规范

### 目录结构

```
src/
├── apps/           # 应用层
├── core/           # 核心微服务
│   ├── auth/       # 认证服务
│   ├── user/       # 用户服务
│   ├── file/       # 文件服务
│   └── gateway/    # 网关服务
├── db/             # 数据库层
├── config/         # 配置文件
├── typings/        # 类型定义
├── utils/          # 工具函数
└── error/          # 错误处理
```

### 微服务结构模版

每个微服务必须包含以下文件结构：

```
service/
├── index.ts        # 主入口文件
├── constants.ts    # 常量定义
├── actions/        # 微服务动作
├── methods/        # 微服务方法
├── events/         # 微服务事件定义
├── utils/          # 工具类
├── types/          # 类型定义
└── validators/     # 数据验证
```

## 代码规范

### TypeScript 规范

1. **严格类型检查**
   - 启用 `strict` 模式
   - 禁止使用 `any` 类型
   - 优先使用接口而非类型别名

2. **命名规范**
   - 文件名：kebab-case（如：`user-service.ts`）
   - 变量/函数：camelCase（如：`getUserInfo`）
   - 类/接口：PascalCase（如：`UserService`）
   - 常量：UPPER_SNAKE_CASE（如：`MAX_FILE_SIZE`）

3. **导入导出规范**
   ```typescript
   // 优先使用命名导入
   import { UserService } from './user-service';
   
   // 默认导出用于主要功能
   export default function createUserService() {}
   
   // 命名导出用于工具函数和类型
   export { UserType, validateUser };
   ```

### 代码组织

1. **单一职责原则**
   - 每个文件只负责一个功能
   - 函数长度不超过 50 行
   - 类的方法数量不超过 10 个

2. **依赖注入**
   - 使用构造函数注入依赖
   - 避免硬编码依赖关系

## 微服务设计原则

### 服务划分

1. **按业务领域划分**
   - 用户管理服务
   - 文件管理服务
   - 认证授权服务
   - 网关服务

2. **服务独立性**
   - 每个服务有独立的数据库
   - 服务间通过 API 通信
   - 避免共享数据库表

### 通信规范
1. **API 调用**
   - RESTful API 设计
   - 统一的响应格式
   - 超时和重试机制

### 微服务模版

```typescript
// 标准微服务入口文件模版
import { Star } from 'node-universe';
import { pinoLoggerOptions } from 'config';
import { DatabaseService } from 'db/mysql/index';
import { Starlight } from 'typings';
import serviceActions from './actions';
import { APP_NAME } from './constants';
import { EventHandler } from './utils';

async function initializeService() {
  const star = new Star({
    namespace: 'darwin-app',
    transporter: {
      type: 'KAFKA',
      // ... 配置
    },
    // ... 其他配置
  }) as Starlight;

  star.createService({
    name: APP_NAME,
    methods: {},
    actions: serviceActions(star),

    created() {
      // 初始化数据库连接
      const databaseService = new DatabaseService(star, APP_NAME);
      star.db = databaseService;
    },

    async started() {
      // 启动逻辑
      await star.db.simpleInitialize();
      const eventHandler = EventHandler.getInstance();
      eventHandler.initialize(star);
    },

    async stopped() {
      // 清理逻辑
      await star.db.cleanup();
    },
  });

  star.start();
}

initializeService().catch(console.error);
```

## 数据库设计规范

### 表设计

1. **命名规范**
   - 表名：snake_case（如：`user_profiles`）
   - 字段名：snake_case（如：`created_at`）
   - 主键：统一使用 `id`

2. **必备字段**
   ```sql
   CREATE TABLE example_table (
     id BIGINT PRIMARY KEY AUTO_INCREMENT,
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     version INT DEFAULT 1,
     is_deleted BOOLEAN DEFAULT FALSE
   );
   ```

3. **索引策略**
   - 为查询频繁的字段添加索引
   - 复合索引遵循最左前缀原则
   - 避免过多索引影响写入性能

## API 设计规范

### RESTful API

1. **URL 设计**
   ```
   GET    /api/v1/users          # 获取用户列表
   GET    /api/v1/users/:id      # 获取单个用户
   POST   /api/v1/users          # 创建用户
   PUT    /api/v1/users/:id      # 更新用户
   DELETE /api/v1/users/:id      # 删除用户
   ```

2. **响应格式**
   ```typescript
   interface ApiResponse<T> {
     status: number;
     data: {
       content: T | null;
       message: string;
       code: HttpResponseCode;
       success: boolean;
     };
   }
   ```

3. **错误处理**
   - 使用标准 HTTP 状态码
   - 提供详细的错误信息
   - 统一的错误响应格式

## 错误处理规范

### 错误分类

1. **业务错误**
   - 用户输入错误
   - 业务规则违反
   - 资源不存在

2. **系统错误**
   - 数据库连接失败
   - 网络超时
   - 内存不足

### 错误处理模式

```typescript
try {
  // 业务逻辑
  const result = await someOperation();
  return {
    status: 200,
    data: {
      content: result,
      message: '操作成功',
      code: HttpResponseCode.Success,
      success: true,
    },
  };
} catch (error) {
  star.logger?.error('操作失败:', error);
  
  return {
    status: 500,
    data: {
      content: null,
      message: error instanceof Error ? error.message : '操作失败',
      code: HttpResponseCode.ServiceActionFaild,
      success: false,
    },
  };
}
```

## 安全规范

### 认证授权

1. **JWT Token**
   - 使用 RS256 算法
   - 设置合理的过期时间
   - 实现 Token 刷新机制

2. **权限控制**
   - 基于角色的访问控制（RBAC）
   - 最小权限原则
   - 接口级权限验证

### 数据安全

1. **敏感数据**
   - 密码使用 bcrypt 加密
   - 个人信息脱敏处理
   - 避免在日志中记录敏感信息

2. **输入验证**
   - 所有用户输入必须验证
   - 防止 SQL 注入
   - XSS 攻击防护

## 测试规范

### 测试分层

1. **单元测试**
   - 覆盖率不低于 80%
   - 测试业务逻辑函数
   - Mock 外部依赖

2. **集成测试**
   - 测试服务间交互
   - 数据库操作测试
   - API 端到端测试

### 测试命名

```typescript
describe('UserService', () => {
  describe('createUser', () => {
    it('should create user successfully with valid data', async () => {
      // 测试逻辑
    });
    
    it('should throw error when email already exists', async () => {
      // 测试逻辑
    });
  });
});
```

## 文档规范

### 代码注释

1. **函数注释**
   ```typescript
   /**
    * 创建新用户
    * @param userData 用户数据
    * @returns 创建的用户信息
    * @throws {ValidationError} 当用户数据无效时
    */
   async function createUser(userData: CreateUserRequest): Promise<User> {
     // 实现逻辑
   }
   ```

2. **类注释**
   ```typescript
   /**
    * 用户服务类
    * 负责用户相关的业务逻辑处理
    */
   export class UserService {
     // 类实现
   }
   ```

### API 文档

- 使用 OpenAPI/Swagger 规范
- 包含请求/响应示例
- 详细的参数说明

## AI 辅助开发指南

### 代码生成原则

1. **遵循现有架构**
   - 参考现有微服务结构
   - 保持代码风格一致
   - 使用项目中的工具和库

2. **类型安全**
   - 生成完整的 TypeScript 类型
   - 避免使用 any 类型
   - 确保类型兼容性

3. **错误处理**
   - 包含完整的错误处理逻辑
   - 使用统一的错误响应格式
   - 记录适当的日志信息

### 代码审查要点

1. **功能完整性**
   - 是否实现了所有需求
   - 边界条件是否处理
   - 异常情况是否考虑

2. **性能考虑**
   - 数据库查询是否优化
   - 是否存在内存泄漏
   - 并发处理是否正确

3. **安全性**
   - 输入验证是否充分
   - 权限检查是否到位
   - 敏感信息是否保护

### 重构指导

1. **重构时机**
   - 代码重复度高
   - 函数过于复杂
   - 性能问题明显

2. **重构步骤**
   - 编写测试用例
   - 小步骤重构
   - 验证功能正确性

## 版本控制

### Git 规范

1. **提交信息格式**
   ```
   <type>(<scope>): <subject>
   
   <body>
   
   <footer>
   ```
   
   类型：
   - feat: 新功能
   - fix: 修复
   - docs: 文档
   - style: 格式
   - refactor: 重构
   - test: 测试
   - chore: 构建

2. **分支策略**
   - main: 主分支
   - develop: 开发分支
   - feature/*: 功能分支
   - hotfix/*: 热修复分支

## 部署规范

### 环境配置

1. **环境变量**
   - 敏感信息通过环境变量配置
   - 不同环境使用不同配置文件
   - 配置验证和默认值

2. **容器化**
   - 使用 Docker 容器化部署
   - 多阶段构建优化镜像大小
   - 健康检查配置

### 监控告警

1. **日志规范**
   - 结构化日志格式
   - 合适的日志级别
   - 关键操作必须记录

2. **指标监控**
   - 响应时间监控
   - 错误率监控
   - 资源使用监控

---

## 更新日志

- 2024-01-15: 初始版本创建
- 待完善: 根据项目发展持续更新

## 相关文档

本规范文档应与以下文档配合使用：
- [数据库设计与开发规范](./database-standards.md) - 数据库层设计规范、开发标准和最佳实践
- [Node-Universe 框架文档](./node-universe.md) - 微服务框架使用指南和最佳实践
- 项目架构文档
- API设计规范
- 部署运维手册

## 贡献指南

如需修改本文档，请：
1. 创建功能分支
2. 修改相关内容
3. 提交 Pull Request
4. 经过代码审查后合并

---

*本文档将随着项目的发展持续更新和完善。*