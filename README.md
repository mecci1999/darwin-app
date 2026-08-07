# Darwin App - 微服务应用

基于 Node-Universe 框架构建的现代化微服务架构应用，使用 TypeScript 开发。Node-Universe 是基于 Moleculer 微服务框架的二次开发版本，提供了更强大的功能和更好的开发体验。

## 🏗️ 架构设计

### 整体架构

Darwin App 采用微服务架构模式，将应用拆分为多个独立的服务单元，每个服务负责特定的业务功能。服务间通过 Kafka 消息队列进行异步通信，使用 Redis 作为分布式缓存，MySQL 作为主数据库，InfluxDB 作为时序数据库。

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Client Apps   │    │   Web Browser   │    │  Mobile Apps    │
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
          │                      │                      │
          └──────────────────────┼──────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │      API Gateway        │
                    │    (Load Balancer)      │
                    └────────────┬────────────┘
                                 │
        ┌────────────────────────┼─────────────────────────┐
        │                        │                         │
┌───────┴───────┐    ┌───────────┴───────────┐    ┌───────┴───────┐
│  Auth Service │    │   User Service        │    │Metrics Service│
│   (认证授权)   │    │   (用户管理)            │    │   (指标监控)   │
└───────┬───────┘    └───────────┬───────────┘    └───────┬───────┘
        │                        │                        │
        └────────────────────────┼────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │  Subscription Service   │
                    │     (订阅管理)            │
                    └────────────┬────────────┘
                                 │
        ┌────────────────────────┼─────────────────────────┐
        │                        │                         │
┌───────┴───────┐    ┌───────────┴───────────┐    ┌───────┴───────┐
│     MySQL     │    │       Redis           │    │    Kafka      │
│   (主数据库)    │    │    (分布式缓存)        │    │  (消息队列)     │
└───────────────┘    └───────────────────────┘    └───────────────┘
```

### 核心组件

#### 1. **API Gateway (网关服务)**
- **职责**: 统一入口、路由分发、负载均衡、限流、CORS处理
- **技术栈**: Node-Universe Gateway, WebSocket支持
- **特性**: 请求转发、监控指标、错误处理、IP黑名单

#### 2. **Auth Service (认证服务)**
- **职责**: 用户认证、JWT令牌管理、权限验证、密码加密
- **技术栈**: JWT, bcrypt, Redis缓存
- **特性**: 令牌刷新、登录状态管理、安全验证

#### 3. **User Service (用户服务)**
- **职责**: 用户信息管理、用户资料、统计数据收集
- **技术栈**: MySQL, Redis缓存, 事件驱动
- **特性**: 用户CRUD、缓存策略、事件发布

#### 4. **Metrics Service (指标服务)**
- **职责**: 数据收集、指标计算、配额管理、实时监控
- **技术栈**: InfluxDB, Kafka, Redis, 数据聚合
- **特性**: 时序数据存储、实时处理、配额检查

#### 5. **Subscription Service (订阅服务)**
- **职责**: 订阅管理、支付处理、计费系统、通知服务
- **技术栈**: 支付网关集成、订阅计划管理
- **特性**: 多种订阅计划、支付集成、使用量跟踪

### 数据流架构

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Request   │───▶│   Gateway   │───▶│   Service   │
└─────────────┘    └─────────────┘    └─────────────┘
                           │                   │
                           ▼                   ▼
                   ┌─────────────┐    ┌─────────────┐
                   │    Cache    │    │  Database   │
                   │   (Redis)   │    │  (MySQL)    │
                   └─────────────┘    └─────────────┘
                           │                   │
                           ▼                   ▼
                   ┌─────────────┐    ┌─────────────┐
                   │   Events    │    │   Metrics   │
                   │  (Kafka)    │    │ (InfluxDB)  │
                   └─────────────┘    └─────────────┘
```

### 技术栈

| 组件 | 技术选型 | 用途 |
|------|----------|------|
| **框架** | Node-Universe (Moleculer) | 微服务框架 |
| **语言** | TypeScript | 开发语言 |
| **数据库** | MySQL 8.0+ | 主数据库 |
| **时序数据库** | InfluxDB | 指标数据存储 |
| **缓存** | Redis 6.0+ | 分布式缓存 |
| **消息队列** | Apache Kafka | 事件流处理 |
| **监控** | Prometheus + Grafana | 系统监控 |
| **日志** | Pino | 结构化日志 |
| **容器化** | Docker + Docker Compose | 部署管理 |

## 📁 标准化目录结构

### 项目根目录

```
darwin-app/
├── .env.development          # 开发环境配置
├── .env.example             # 环境变量模板
├── .eslintrc.js             # ESLint 配置
├── .prettierrc              # Prettier 配置
├── README.md                # 项目文档
├── package.json             # 项目依赖
├── tsconfig.json            # TypeScript 配置
├── docker/                  # Docker 相关文件
│   ├── Dockerfile           # 应用镜像构建
│   ├── docker-compose.yml   # 服务编排
│   └── start.sh             # 启动脚本
├── ecosystem.config.js      # PM2 配置
└── src/                     # 源代码目录
    ├── auth/                # 认证服务
    ├── gateway/             # 网关服务
    ├── user/                # 用户服务
    ├── metrics/             # 指标服务
    ├── subscription/        # 订阅服务
    ├── common/              # 公共模块
    ├── config/              # 配置管理
    ├── db/                  # 数据库连接
    ├── typings/             # 类型定义
    └── utils/               # 工具函数
```

### 微服务标准结构

每个微服务都遵循统一的目录结构，确保代码的一致性和可维护性：

```
service-name/
├── index.ts                 # 服务主入口文件
├── constants/               # 配置常量
│   └── index.ts            # 导出所有常量
├── types/                   # TypeScript 类型定义
│   └── index.ts            # 导出所有类型
├── utils/                   # 工具类和处理器
│   ├── index.ts            # 工具类导出
│   ├── service-utils.ts    # 服务工具类
│   ├── cache-handler.ts    # 缓存处理器
│   ├── event-handler.ts    # 事件处理器
│   ├── validation-handler.ts # 验证处理器
│   └── stats-collector.ts  # 统计收集器
├── actions/                 # API 动作处理
│   ├── index.ts            # 动作导出
│   ├── create.ts           # 创建操作
│   ├── read.ts             # 查询操作
│   ├── update.ts           # 更新操作
│   └── delete.ts           # 删除操作
├── methods/                 # 服务方法 (可选)
│   └── index.ts            # 方法导出
└── events/                  # 事件处理 (可选)
    └── index.ts            # 事件导出
```

### 核心文件说明

#### 1. **index.ts (服务主文件)**
```typescript
// 标准结构包含:
- 导入依赖和工具类
- 全局状态管理
- 服务初始化函数
- 生命周期钩子 (created, started, stopped)
- 事件处理方法
- Star 实例配置
```

#### 2. **constants/index.ts (配置常量)**
```typescript
// 包含:
- 应用配置 (APP_NAME, VERSION)
- 数据库配置 (DB_CONFIG)
- Redis配置 (REDIS_CONFIG)
- Kafka配置 (KAFKA_CONFIG)
- 业务配置 (具体业务相关常量)
- 监控配置 (MONITORING_CONFIG)
```

#### 3. **types/index.ts (类型定义)**
```typescript
// 包含:
- 服务状态接口 (ServiceState)
- 业务数据接口 (具体业务实体)
- 请求参数接口 (RequestParams)
- 响应数据接口 (ResponseData)
- 事件数据接口 (EventData)
- 配置接口 (Config)
```

#### 4. **utils/ (工具类目录)**
- **service-utils.ts**: 核心业务工具类
- **cache-handler.ts**: 缓存管理和操作
- **event-handler.ts**: 事件发布和处理
- **validation-handler.ts**: 数据验证和清理
- **stats-collector.ts**: 统计数据收集

#### 5. **actions/ (API动作目录)**
- 每个文件对应一个或一组相关的API操作
- 统一的参数验证和错误处理
- 标准的响应格式

### 编码规范

#### 1. **命名规范**
- **文件名**: kebab-case (例: `user-utils.ts`)
- **类名**: PascalCase (例: `UserUtils`)
- **函数名**: camelCase (例: `getUserInfo`)
- **常量名**: UPPER_SNAKE_CASE (例: `MAX_RETRY_COUNT`)
- **接口名**: PascalCase (例: `UserInfo`)

#### 2. **导入顺序**
```typescript
// 1. Node.js 内置模块
// 2. 第三方库
// 3. 框架相关 (Node-Universe)
// 4. 项目内部模块 (按层级顺序)
// 5. 相对路径导入
```

#### 3. **错误处理**
- 统一的错误处理机制
- 结构化的错误日志
- 适当的错误码和消息

#### 4. **日志规范**
- 使用结构化日志 (Pino)
- 统一的日志级别 (debug, info, warn, error)
- 包含必要的上下文信息

## 🚀 快速开始

### 环境要求

- Node.js 16.0+
- Docker & Docker Compose
- MySQL 8.0+
- Redis 6.0+
- Apache Kafka 2.8+

### 安装依赖

```bash
# 安装项目依赖
npm install

# 或使用 yarn
yarn install
```

### 启动基础服务

```bash
# 启动 Docker 服务 (MySQL, Redis, Kafka, InfluxDB)
docker-compose up -d

# 等待服务启动完成
docker-compose ps
```

### 启动微服务

**重要**: 请按以下顺序启动服务

```bash
# 1. 首先启动网关服务
npm run start:gateway

# 2. 启动认证服务
npm run start:auth

# 3. 启动用户服务
npm run start:user

# 4. 启动指标服务
npm run start:metrics

# 5. 启动订阅服务
npm run start:subscription

# 6. 启动 Trails（也包含在 npm run start:all 的本地并发启动中）
npm run start:trails
```

### 开发模式

```bash
# 开发模式启动 (支持热重载)
npm run dev:gateway
npm run dev:auth
npm run dev:user
npm run dev:metrics
npm run dev:subscription
```

### 服务端口

| 服务 | 端口 | 描述 |
|------|------|------|
| Gateway | 3000 | API 网关 |
| Auth | 3001 | 认证服务 |
| User | 3002 | 用户服务 |
| Metrics | 3003 | 指标服务 |
| Subscription | 3004 | 订阅服务 |
| MySQL | 3306 | 数据库 |
| Redis | 6379 | 缓存 |
| Kafka | 9092 | 消息队列 |
| InfluxDB | 8086 | 时序数据库 |

## 📊 监控和运维

### 健康检查

```bash
# 检查所有服务状态
curl http://localhost:3000/api/health

# 检查特定服务
curl http://localhost:3000/api/auth/v1/health
curl http://localhost:3000/api/user/v1/health
curl http://localhost:3000/api/metrics/v1/health
curl http://localhost:3000/api/subscription/v1/health
```

### 监控指标

```bash
# Prometheus 指标
curl http://localhost:3000/metrics

# 服务指标
curl http://localhost:3001/metrics  # Auth
curl http://localhost:3002/metrics  # User
curl http://localhost:3003/metrics  # Metrics
curl http://localhost:3004/metrics  # Subscription
```

### 日志查看

```bash
# 查看服务日志
docker-compose logs -f gateway
docker-compose logs -f auth
docker-compose logs -f user
docker-compose logs -f metrics
docker-compose logs -f subscription
```

## 🔧 配置管理

### 环境变量

复制 `.env.example` 到 `.env.development` 并根据实际环境修改配置：

```bash
cp .env.example .env.development
```

主要配置项：

```bash
# 数据库配置
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=password
MYSQL_DATABASE=darwin_app

# Redis 配置
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Kafka 配置
KAFKA_BROKERS=localhost:9092

# InfluxDB 配置
INFLUXDB_URL=http://localhost:8086
INFLUXDB_TOKEN=your-token
INFLUXDB_ORG=darwin-app
INFLUXDB_BUCKET=metrics

# JWT 配置
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d

# 支付配置
ALIPAY_APP_ID=your-alipay-app-id
WECHAT_APP_ID=your-wechat-app-id
```

### Trails 本地耐久元数据

`start:trails` 可独立运行，`start:all` 也会以现有的本地 staggered 并发方式启动它。若要启用现有 Trails v2 的本地 MySQL 元数据仓储，请先应用所需的 Trails MySQL migration，再设置精确值：

```bash
TRAILS_DURABLE_PERSISTENCE_ENABLED=true
```

任何其他值均保持关闭。旧的 `TRAILS_DURABLE_CATEGORY_SYNC` 仅在新变量缺失时兼容；两者同时存在且启用值冲突时，服务保持关闭。关闭或初始化失败时，v2 耐久操作固定返回 503，绝不会回退到 v1 内存数据。现有作用域公开分类/catalog 元数据保持可用；该本地可操作性范围只包含已有 MySQL 私有元数据，公共媒体交付明确延期且不受支持，不得配置 `TRAILS_MEDIA_PUBLIC_DELIVERY_BASE`，没有公共媒体 catalog 或公共媒体 URL。公开作品集最多保留不透明的 `coverMediaId`，绝不解析或返回封面图片、衍生物、URL、尺寸、定位符、对象键或能力。COS 摄入/写入、预检、CDN、支付、下载、履约、邮件、评论、天气和行程效果均不启用。

## 🧪 测试

Darwin Trails 的本地发布门禁不启动 gateway（其正常启动需要 Kafka、Redis 和数据库）。它直接验证现有 action/config/repository seam：可信 gateway metadata、CORS、公开 owner 配置、v2 分类 action 和耐久分类 repository。

```bash
pnpm run test:local-release
```

这会串行运行上述 focused Jest 测试（包括受信 Photoshop 九 codec 私有暂存计划的契约和依赖边界）并执行 `pnpm run build`。该暂存计划是存储前、未注册、未发布的服务器私有数据，不能序列化、记录日志或作为 action 响应；真实 MySQL 耐久层契约仍是可选的 Docker 验证：`pnpm run test:trails:mysql`。

```bash
# 运行单元测试
npm test

# 运行集成测试
npm run test:integration

# 运行端到端测试
npm run test:e2e

# 测试覆盖率
npm run test:coverage
```

## 📦 部署

### Docker 部署

```bash
# 构建镜像
docker build -t darwin-app .

# 运行容器
docker run -d -p 3000:3000 darwin-app
```

### 生产环境部署

```bash
# 使用 PM2 部署
npm run build
pm2 start ecosystem.config.js

# 查看运行状态
pm2 status
pm2 logs
```

## 🤝 贡献指南

1. Fork 项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 打开 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 📞 联系方式

- 项目维护者: Darwin
- 邮箱: mecci1999@163.com
<!-- - 文档: [https://docs.darwin-app.com](https://docs.darwin-app.com) -->

---

**注意**: 在生产环境中部署前，请确保所有敏感信息（如数据库密码、API密钥等）都已正确配置，并遵循安全最佳实践。
