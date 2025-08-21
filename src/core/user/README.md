# User 微服务模块

## 概述

User微服务是Darwin App生态系统中的核心用户管理服务，负责处理用户的创建、更新、删除以及多应用访问控制。该服务支持多租户架构，为blog、photos、starlight等多个应用微服务提供统一的用户管理能力。权限和角色管理由独立的权限系统负责，通过userId进行关联。

## 架构特性

### 🏗️ 微服务架构
- **服务名称**: `user-service`
- **命名空间**: `darwin-app`
- **通信协议**: Kafka (异步消息传递)
- **缓存系统**: Redis
- **数据库**: MySQL
- **序列化**: NotePack

### 🔄 事件驱动设计
- 自定义EventHandler实现事件队列和批处理
- 支持用户生命周期事件发布
- 与其他微服务异步通信
- 事件容错和重试机制

### 🏢 多租户支持
- 租户隔离 (`tenantId`)
- 多应用访问控制 (`applicationIds`)


## 数据模型

### 用户表结构 (UserTable)

| 字段名 | 类型 | 描述 | 默认值 |
|--------|------|------|--------|
| userId | STRING(32) | 用户唯一标识 | 自动生成 |
| nickname | STRING(50) | 用户昵称 | - |
| avatar | TEXT | 用户头像URL | - |
| status | ENUM | 用户状态 | 'active' |
| source | STRING(20) | 注册来源 | 'web' |
| timezone | STRING(50) | 时区 | 'Asia/Shanghai' |
| locale | STRING(10) | 语言环境 | 'zh-CN' |
| lastActiveAt | DATE | 最后活跃时间 | - |
| meta | JSON | 元数据 | {} |
| devices | JSON | 设备信息 | [] |
| power | INTEGER | 用户权重 | 0 |
| **tenantId** | STRING(32) | 租户ID | - |
| **applicationIds** | JSON | 可访问应用列表 | [] |

| version | INTEGER | 版本号 | 1 |
| createdAt | DATE | 创建时间 | 当前时间 |
| updatedAt | DATE | 更新时间 | 当前时间 |
| deletedAt | DATE | 删除时间 | null |

### 数据库索引
- `idx_user_tenant_id`: 租户ID索引
- `idx_user_tenant_status`: 租户ID + 状态复合索引
- `idx_user_tenant_created`: 租户ID + 创建时间复合索引

## API 接口

### 👤 用户管理功能

#### 1. 创建用户
- **接口**: `v1.createUser`
- **方法**: POST
- **权限**: 需要认证
- **参数**:
  ```json
  {
    "nickname": "string",
    "avatar": "string",
    "source": "string",
    "tenantId": "string",
    "applicationIds": ["string"]
  }
  ```
- **响应**: 返回创建的用户信息
- **事件**: 发布 `user.created` 事件

#### 2. 更新用户信息
- **接口**: `v1.updateUser`
- **方法**: PUT
- **权限**: 需要认证
- **参数**:
  ```json
  {
    "userId": "string",
    "nickname": "string",
    "avatar": "string",
    "timezone": "string",
    "locale": "string",
    "meta": {}
  }
  ```
- **响应**: 返回更新后的用户信息
- **事件**: 发布 `user.updated` 事件

#### 3. 删除用户
- **接口**: `v1.deleteUser`
- **方法**: DELETE
- **权限**: 需要认证
- **参数**:
  ```json
  {
    "userId": "string",
    "reason": "string"
  }
  ```
- **响应**: 确认删除结果
- **事件**: 发布 `user.deleted` 事件

#### 4. 批量获取用户
- **接口**: `v1.batchGetUsers`
- **方法**: POST
- **权限**: 需要认证
- **参数**:
  ```json
  {
    "userIds": ["string"],
    "fields": ["string"]
  }
  ```
- **响应**: 返回用户信息列表
- **限制**: 最多100个用户ID

### 🏢 应用管理功能

#### 1. 添加应用访问权限
- **接口**: `v1.addApplicationAccess`
- **方法**: POST
- **权限**: 需要管理员权限
- **参数**:
  ```json
  {
    "userId": "string",
    "applicationIds": ["string"]
  }
  ```
- **响应**: 返回更新后的应用访问列表
- **事件**: 发布 `user.application.added` 事件

#### 2. 移除应用访问权限
- **接口**: `v1.removeApplicationAccess`
- **方法**: DELETE
- **权限**: 需要管理员权限
- **参数**:
  ```json
  {
    "userId": "string",
    "applicationIds": ["string"]
  }
  ```
- **响应**: 返回更新后的应用访问列表
- **事件**: 发布 `user.application.removed` 事件

#### 3. 获取用户应用列表
- **接口**: `v1.getUserApplications`
- **方法**: GET
- **权限**: 需要认证
- **参数**:
  ```json
  {
    "userId": "string"
  }
  ```
- **响应**: 返回用户可访问的应用列表

#### 4. 检查应用访问权限
- **接口**: `v1.checkApplicationAccess`
- **方法**: GET
- **权限**: 需要认证
- **参数**:
  ```json
  {
    "userId": "string",
    "applicationId": "string"
  }
  ```
- **响应**: 返回是否有访问权限

### 📊 用户活动功能

#### 1. 记录用户登录
- **接口**: `v1.recordUserLogin`
- **方法**: POST
- **权限**: 需要认证
- **参数**:
  ```json
  {
    "userId": "string",
    "deviceInfo": {
      "deviceId": "string",
      "deviceType": "string",
      "userAgent": "string",
      "ip": "string"
    }
  }
  ```
- **响应**: 确认登录记录结果
- **事件**: 发布 `user.login` 事件

#### 2. 记录用户登出
- **接口**: `v1.recordUserLogout`
- **方法**: POST
- **权限**: 需要认证
- **参数**:
  ```json
  {
    "userId": "string",
    "deviceId": "string",
    "reason": "string"
  }
  ```
- **响应**: 确认登出记录结果
- **事件**: 发布 `user.logout` 事件

## 事件系统

### 📡 事件处理器 (EventHandler)

用户服务使用自定义的EventHandler来管理事件发布，提供以下特性：

- **事件队列**: 缓冲事件，避免瞬时冲击
- **批处理**: 每秒处理最多10个事件
- **错误容错**: 单个事件失败不影响其他事件
- **统一格式**: 所有事件都有统一的数据结构

### 🔔 支持的事件类型

| 事件名称 | 触发时机 | 事件数据 |
|----------|----------|----------|
| `user.created` | 用户创建成功 | userId, userData, source |
| `user.updated` | 用户信息更新 | userId, updateData |
| `user.deleted` | 用户删除 | userId, reason |
| `user.login` | 用户登录 | userId, deviceInfo, loginTime |
| `user.logout` | 用户登出 | userId, logoutTime |

| `user.application.added` | 应用权限添加 | userId, applicationId |
| `user.application.removed` | 应用权限移除 | userId, applicationId |

## 错误码

| 错误码 | 描述 | HTTP状态码 |
|--------|------|------------|
| `Success` | 操作成功 | 200 |
| `ParamsError` | 参数错误 | 400 |
| `UserNotExist` | 用户不存在 | 404 |
| `ServiceActionFaild` | 服务操作失败 | 500 |

## 部署配置

### 环境变量

```bash
# Kafka配置
KAFKA_HOST=localhost:9092
KAFKA_USER=kafka_user
KAFKA_PASSWORD=K@fk@_S3cur3_P@ssw0rd_2024!$

# Redis配置
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=R3d1s_S3cur3_P@ssw0rd_2024!@#

# MySQL配置
DB_HOST=localhost
DB_PORT=3306
DB_NAME=darwin_app
DB_USER=root
DB_PASSWORD=your_password
```

### 服务启动

```bash
# 开发环境
npm run dev:user

# 生产环境
npm run start:user
```

## 监控和日志

- **日志级别**: info, warn, error
- **指标收集**: 启用Star框架指标
- **健康检查**: 数据库连接状态检查
- **事件队列监控**: 队列长度、处理速度统计

## 安全特性

- **参数验证**: 所有输入参数严格验证
- **权限控制**: 基于角色的访问控制
- **数据加密**: 敏感数据JSON存储
- **审计日志**: 关键操作事件记录
- **多租户隔离**: 租户级别数据隔离

## 扩展性

- **水平扩展**: 支持多实例部署
- **缓存策略**: Redis缓存热点数据
- **异步处理**: 事件驱动的异步通信
- **插件化**: 支持自定义事件处理器

---

**版本**: v1.0.0  
**最后更新**: 2024年  
**维护团队**: Darwin App Team