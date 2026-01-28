# Darwin App 微服务监控系统架构文档

## 1. 系统概述

本系统是一个基于 **Node Universe** 框架构建的高性能、可扩展的分布式微服务监控系统（类似 Datadog）。系统采用事件驱动架构，专为 SaaS 场景设计，支持多租户、高并发指标采集、分布式追踪、日志分析及订阅管理。

## 2. 技术栈

- **核心框架**: [Node Universe](https://github.com/node-universe/node-universe) (Microservices Framework)
- **编程语言**: TypeScript / Node.js
- **通信层**: Apache Kafka (Event Bus / Transporter)
- **存储层**:
  - **MySQL**: 核心业务数据 (User, Auth, Subscription)
  - **Redis**: 缓存、会话管理、限流
  - **InfluxDB**: 时序指标数据 (Metrics)
  - **Elasticsearch**: 日志检索与分析 (Logs)
- **序列化**: NotePack

## 3. 微服务模块详解

系统主要由以下核心微服务组成：

### 3.1 网关服务 (Gateway)
- **路径**: `src/core/gateway`
- **职责**:
  - 统一 API 入口与请求分发 (`/api/:service/:version/:action`)
  - 全局限流 (Rate Limiting) 与安全防护
  - WebSocket 服务支持 (实时推送)
  - 请求前/后置处理钩子 (Authentication, Logging)
- **关键配置**:
  - Kafka Transporter (SASL Auth)
  - Redis Caching
  - IP 黑名单与访问控制

### 3.2 认证服务 (Auth)
- **路径**: `src/core/auth`
- **职责**:
  - 多模式登录：账号密码、扫码登录 (QR Code)、第三方登录
  - JWT Token 签发与验证
  - RSA 加密传输
  - 安全审计与暴力破解防护 (IP Blacklist)
- **特性**:
  - 独立数据库连接，保障高可用
  - 严格的慢查询阈值监控

### 3.3 用户服务 (User)
- **路径**: `src/core/user`
- **职责**:
  - 用户基础信息管理
  - 租户/组织架构管理
  - 权限控制

### 3.4 监控指标服务 (Metrics - Starlight App)
- **路径**: `src/apps/starlight/metrics`
- **职责**:
  - **指标采集**: 支持 Prometheus, StatsD, DataDog, OTLP 等格式
  - **数据存储**: InfluxDB (Flux 查询语言)
  - **数据处理**:
    - Kafka 消费者组 (`metrics-processor-group`)
    - 批量写入与缓冲机制
    - 多租户数据隔离 (`tenantId`)
  - **SaaS 特性**: 配额检查 (Quotas), 异常检测

### 3.5 日志服务 (Logs - Starlight App)
- **路径**: `src/apps/starlight/logs`
- **职责**:
  - **日志摄入**: JSON, Syslog, Text, Structured Logs
  - **存储检索**: Elasticsearch
  - **流式处理**: 实时日志流 (Streaming)
  - **配额管理**: 每日日志量限制、存储限制

### 3.6 订阅服务 (Subscription - Starlight App)
- **路径**: `src/apps/starlight/subscription`
- **职责**:
  - SaaS 订阅计划管理 (Free, Pro, Enterprise)
  - 计费与支付集成 (Stripe, PayPal)
  - 租户配额与限制控制 (Quotas)
  - 账单生成与处理

### 3.7 文件服务 (File)
- **路径**: `src/core/file`
- **职责**:
  - 文件上传、存储与管理
  - 静态资源服务

## 4. 基础设施架构

### 4.1 消息队列 (Kafka)
系统通过 Kafka 实现全异步解耦通信。主要 Topic 规划：
- `metrics-raw` / `metrics-processed`: 指标数据流
- `logs-raw` / `logs-processed`: 日志数据流
- `subscription-events`: 订阅变更事件
- `quota-warnings`: 配额预警
- `tenant-events`: 租户生命周期事件

### 4.2 数据流向
1. **数据采集**: Client/Agent -> Gateway -> Kafka (Raw Topics)
2. **数据处理**: Kafka -> Metrics/Logs Service (Processors) -> Batch Buffer
3. **数据存储**: Buffer -> InfluxDB/Elasticsearch
4. **数据查询**: Client -> Gateway -> Service -> DB (Flux/ES Query) -> Response

## 5. 部署与运行

- **环境依赖**: Node.js, Docker (Kafka, Redis, MySQL, InfluxDB, Elasticsearch)
- **启动方式**:
  - 开发环境: `npm run start:all` (并发启动核心服务)
  - 单独启动: `npm run start:metrics`, `npm run start:gateway` 等
- **配置管理**: `.env` 文件统一管理环境变量 (DB连接串, Kafka Auth 等)

## 6. 扩展性设计

- **插件化**: 监控与日志服务通过 `Events` 目录下的处理器进行扩展。
- **水平扩展**: 基于 Kafka 消费者组机制，可无缝增加 Metrics/Logs 服务实例以分摊流量。
- **SaaS 隔离**: 所有数据存储与处理均携带 `tenantId`，确保多租户数据安全。
