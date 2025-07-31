# 认证系统 (Authentication System)

基于 Node-Universe 框架的企业级认证系统，提供完整的身份验证、授权、审计和安全功能。

## 🚀 特性

### 核心功能
- **JWT Token 管理** - 支持 Access Token 和 Refresh Token
- **基于角色的访问控制 (RBAC)** - 灵活的权限管理系统
- **多层限流保护** - API 限流、登录限流、令牌桶算法
- **审计日志** - 完整的操作记录和安全事件追踪
- **中间件和钩子** - 基于 Node-Universe 的扩展机制
- **多因素认证 (MFA)** - 支持 TOTP、SMS、邮箱验证
- **OAuth 集成** - 支持 Google、GitHub 等第三方登录

### 安全特性
- **账户锁定策略** - 防止暴力破解
- **IP 白名单/黑名单** - 网络访问控制
- **会话管理** - 并发会话限制和超时控制
- **密码策略** - 强密码要求和历史密码检查
- **实时安全告警** - 异常行为检测和通知

## 📁 项目结构

```
src/auth/
├── actions/                 # 业务操作
│   ├── index.ts             # Actions 入口
│   ├── login.ts             # 登录操作
│   ├── logout.ts            # 登出操作
│   └── register.ts          # 注册操作
├── middlewares/             # 中间件
│   └── auth-middleware.ts   # 认证中间件
├── hooks/                   # 钩子
│   └── auth-hooks.ts        # 认证钩子
├── services/                # 核心服务
│   ├── token-service.ts     # Token 管理服务
│   ├── permission-service.ts # 权限管理服务
│   ├── rate-limit-service.ts # 限流服务
│   └── audit-service.ts     # 审计服务
├── config/                  # 配置
│   └── auth-config.ts       # 认证配置
├── errors/                  # 错误定义
│   └── index.ts             # 自定义错误类
├── examples/                # 使用示例
│   └── usage-example.ts     # 完整使用示例
├── types/                   # 类型定义
```

## 概述

认证服务已按照网关服务的模式进行了全面改造，实现了模块化、标准化和可维护性的提升。

## 改造内容

### 1. 目录结构优化

```
src/auth/
├── constants/          # 常量配置
│   └── index.ts       # 认证服务相关常量
├── types/             # 类型定义
│   └── index.ts       # 认证相关接口和类型
├── utils/             # 工具类
│   ├── auth-utils.ts  # 认证工具类
│   └── index.ts       # 工具类导出
├── actions/           # 动作处理
├── methods/           # 方法定义
└── index.ts           # 主服务文件
```

### 2. 新增文件说明

#### constants/index.ts
- **APP_NAME**: 应用名称
- **PORT**: 服务端口
- **RSA_CONFIG**: RSA密钥配置
- **DB_CONFIG**: 数据库配置
- **CACHE_CONFIG**: 缓存配置
- **MQ_CONFIG**: 消息队列配置
- **AUTH_CONFIG**: 认证相关配置（Token过期时间、邮箱配置等）

#### types/index.ts
- **AuthState**: 认证服务状态接口
- **LoginParams**: 登录参数接口
- **RegisterParams**: 注册参数接口
- **QRCodeParams**: 二维码参数接口
- **PasswordResetParams**: 密码重置参数接口
- **TokenRefreshParams**: Token刷新参数接口
- **VerificationCodeParams**: 验证码参数接口
- **RSAKeyConfig**: RSA密钥配置接口

#### utils/auth-utils.ts
认证服务专用工具类，包含以下方法：
- `generateRSAKeyPair()`: 生成RSA密钥对
- `validatePasswordStrength()`: 验证密码强度
- `checkLoginAttempts()`: 检查登录尝试次数
- `recordLoginAttempt()`: 记录登录尝试
- `generateVerificationCode()`: 生成验证码
- `storeVerificationCode()`: 存储验证码
- `generateQRCode()`: 生成二维码
- `storeQRCode()`: 存储二维码
- `cleanupExpiredData()`: 清理过期数据
- `checkAndGenerateRSA()`: 检查并生成RSA密钥对
- `createSuccessResponse()`: 创建成功响应
- `createErrorResponse()`: 创建错误响应

### 3. 主要改进

#### 3.1 使用公共DatabaseInitializer
- 统一的数据库初始化流程
- 标准化的错误处理
- 可配置的慢查询日志

#### 3.2 模块化配置管理
- 所有配置集中在 `constants/index.ts`
- 环境变量支持
- 类型安全的配置访问

#### 3.3 状态管理优化
- 引入 `AuthState` 接口
- 内存中缓存登录尝试、验证码等
- 定期清理过期数据

#### 3.4 工具类标准化
- 认证专用工具类 `AuthUtils`
- 向后兼容的方法迁移

#### 3.5 生命周期管理
- 标准化的服务启动流程
- 优雅的服务停止处理
- 资源清理和状态重置

### 4. 配置说明

#### 环境变量
```bash
# 认证服务配置
AUTH_PORT=3002
AUTH_TOKEN_EXPIRE_TIME=2h
AUTH_REFRESH_TOKEN_EXPIRE_TIME=7d
AUTH_VERIFICATION_CODE_EXPIRE_TIME=300
AUTH_MAX_LOGIN_ATTEMPTS=5
AUTH_LOGIN_ATTEMPT_WINDOW=900

# 邮箱配置
AUTH_EMAIL_SERVICE=163
AUTH_EMAIL_USER=your-email@163.com
AUTH_EMAIL_PASS=your-email-password

# RSA配置
AUTH_RSA_KEY_SIZE=2048
AUTH_RSA_ALGORITHM=RS256
```

### 5. 使用示例

#### 5.1 使用新的工具类
```typescript
// 创建成功响应
const response = AuthUtils.createSuccessResponse(data, '操作成功');

// 创建错误响应
const errorResponse = AuthUtils.createErrorResponse(
  '登录失败',
  HttpResponseCode.ERR_LOGIN_FAILED,
  401
);

// 检查登录尝试
const canAttempt = AuthUtils.checkLoginAttempts(state, userId);
```

#### 5.2 访问配置
```typescript
// 使用认证配置
const tokenExpireTime = AUTH_CONFIG.tokenExpireTime;
const maxAttempts = AUTH_CONFIG.maxLoginAttempts;
```

### 6. 迁移注意事项

1. **向后兼容**: 旧的方法调用仍然有效，但建议逐步迁移到新的工具类
2. **配置更新**: 需要更新环境变量配置
3. **依赖检查**: 确保所有依赖包已正确安装
4. **测试验证**: 建议进行全面的功能测试

### 7. 性能优化

- **内存缓存**: 登录尝试、验证码等数据使用内存缓存
- **定期清理**: 自动清理过期的缓存数据
- **连接池**: 使用数据库连接池提高性能
- **慢查询监控**: 可配置的慢查询日志记录

### 8. 安全增强

- **登录限制**: 防止暴力破解攻击
- **Token管理**: 安全的Token生成和验证
- **密码强度**: 可配置的密码强度验证
- **数据清理**: 定期清理敏感数据

## 总结

通过这次改造，认证服务实现了：
- ✅ 模块化架构
- ✅ 标准化配置
- ✅ 统一错误处理
- ✅ 性能优化
- ✅ 安全增强
- ✅ 向后兼容
- ✅ 可维护性提升

改造后的认证服务与网关服务保持了一致的架构模式，便于团队维护和扩展。