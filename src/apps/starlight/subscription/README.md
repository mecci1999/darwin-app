# 订阅微服务 (Subscription Service)

订阅微服务负责处理用户订阅计划、支付、账单和配额管理等功能。基于 Node Universe 框架构建的分布式微服务，采用事件驱动架构，支持多租户，具备高可用性和可扩展性。

## 目录结构

```
subscription/
├── README.md           # 服务文档
├── DEPLOYMENT.md      # 部署指南
├── DEVELOPMENT.md     # 开发指南
├── index.ts           # 主服务文件
├── types/             # 类型定义
│   └── index.ts
├── actions/           # API 动作
│   ├── index.ts
│   ├── subscription.ts # 订阅相关API
│   ├── plans.ts       # 计划相关API
│   ├── payment.ts     # 支付相关API
│   ├── billing.ts     # 账单相关API
│   └── quota.ts       # 配额相关API
├── methods/           # 内部方法
│   └── index.ts
├── events/            # 事件处理
│   └── index.ts
└── validators/        # 参数验证
    └── index.ts
```

## 基础信息

- **服务名称**: subscription
- **版本**: 1.0.0
- **基础路径**: `/api/subscription`
- **认证方式**: Bearer Token (除特殊说明外，所有接口都需要认证)
- **API版本**: v1.x (使用 `v1.` 前缀)

## 核心功能

### 1. 订阅管理
- 创建订阅
- 获取当前订阅
- 更新订阅
- 取消订阅
- 订阅历史查询

### 2. 计划管理
- 获取所有可用计划
- 获取特定计划详情
- 计划定价计算

### 3. 支付处理
- 创建支付订单
- 支付状态查询
- 支付回调处理
- 退款处理

### 4. 账单管理
- 账单生成
- 账单查询
- 账单下载
- 发票管理

### 5. 配额管理
- 配额检查
- 使用量统计
- 配额限制管理

## 通用响应格式

```typescript
interface ApiResponse<T> {
  code: number;           // 响应码
  content: T | null;      // 响应数据
  message: string;        // 响应消息
  success: boolean;       // 是否成功
}
```

## 响应状态码

- `200` - 成功
- `201` - 创建成功
- `400` - 请求参数错误
- `401` - 未认证
- `403` - 权限不足
- `404` - 资源不存在
- `409` - 资源冲突
- `500` - 服务器内部错误

## API 接口概览

### 订阅管理 API

#### 获取当前订阅
- **接口**: `GET /v1/subscription/current`
- **描述**: 获取当前用户的活跃订阅信息

#### 创建订阅
- **接口**: `POST /v1/subscription/create`
- **描述**: 为用户创建新的订阅

#### 取消订阅
- **接口**: `POST /v1/subscription/cancel`
- **描述**: 取消用户的订阅

#### 订阅历史
- **接口**: `GET /v1/subscription/history`
- **描述**: 获取用户的订阅历史记录

### 计划管理 API

#### 获取所有计划
- **接口**: `GET /v1/plans/list`
- **描述**: 获取所有可用的订阅计划

#### 获取计划详情
- **接口**: `GET /v1/plans/get`
- **描述**: 获取特定订阅计划的详细信息

### 支付管理 API

#### 创建支付订单
- **接口**: `POST /v1/payment/createOrder`
- **描述**: 为订阅创建支付订单

#### 查询支付状态
- **接口**: `GET /v1/payment/queryOrder`
- **描述**: 查询支付订单状态

### 账单管理 API

#### 获取账单列表
- **接口**: `GET /v1/billing/list`
- **描述**: 获取用户的账单列表

#### 下载账单
- **接口**: `GET /v1/billing/downloadInvoice`
- **描述**: 下载指定账单的PDF文件

### 配额管理 API

#### 检查配额
- **接口**: `GET /v1/quota/check`
- **描述**: 检查用户的配额使用情况

#### 获取使用统计
- **接口**: `GET /v1/quota/status`
- **描述**: 获取用户的详细使用统计

> 📖 **详细API文档**: 请参考 [API.md](./API.md) 获取完整的接口文档，包括请求参数、响应示例和错误码说明。

## 事件系统

### 发布的事件
- `subscription.created` - 订阅创建
- `subscription.updated` - 订阅更新
- `subscription.cancelled` - 订阅取消
- `payment.succeeded` - 支付成功
- `payment.failed` - 支付失败
- `trial.started` - 试用开始
- `trial.ended` - 试用结束
- `quota.updated` - 配额更新
- `notification.send` - 发送通知

### 监听的事件
- `tenant.deleted` - 租户删除

## 系统架构

### 架构原则

1. **单一职责原则** - 专注于订阅相关的业务逻辑
2. **事件驱动架构** - 使用 Kafka 作为事件总线，异步处理业务流程
3. **多租户支持** - 数据隔离和安全，租户级别的配置管理
4. **可观测性** - 全链路日志追踪，业务指标监控

### 核心组件

#### 1. Actions (API接口层)
负责处理外部请求，提供RESTful API接口。
- 请求参数验证
- 权限检查
- 业务逻辑调用
- 响应格式化

#### 2. Methods (业务逻辑层)
封装核心业务逻辑，提供内部方法调用。
- 业务规则实现
- 数据库操作
- 外部服务调用
- 状态管理

#### 3. Events (事件处理层)
处理异步事件，实现服务间通信。
- 发布订阅相关事件
- 监听外部事件
- 保证最终一致性

#### 4. Validators (参数验证层)
提供统一的参数验证机制。
- 基础验证器
- 复合验证器
- 验证中间件

#### 5. Types (类型定义层)
定义服务内部使用的TypeScript类型。

## 数据模型

### SubscriptionPlan (订阅计划)
```typescript
interface SubscriptionPlan {
  id: string;
  name: string;
  displayName: string;
  price: number;
  currency: string;
  billingCycle: 'monthly' | 'yearly';
  features: string[];
  limitations: Record<string, number>;
  status: 'active' | 'inactive';
  createdAt: Date;
  updatedAt: Date;
}
```

### UserSubscription (用户订阅)
```typescript
interface UserSubscription {
  id: string;
  userId: string;
  planName: string;
  status: 'active' | 'cancelled' | 'expired' | 'trial';
  startedAt: Date;
  expiresAt?: Date;
  cancelledAt?: Date;
  autoRenew: boolean;
  metadata?: Record<string, any>;
}
```

### PaymentOrder (支付订单)
```typescript
interface PaymentOrder {
  id: string;
  userId: string;
  planName: string;
  amount: number;
  currency: string;
  status: 'pending' | 'paid' | 'failed' | 'cancelled';
  paymentMethod: string;
  expiresAt: Date;
  paidAt?: Date;
}
```

## 配置说明

### 环境变量
- `SUBSCRIPTION_REDIS_URL` - Redis连接地址
- `SUBSCRIPTION_KAFKA_BROKERS` - Kafka代理地址
- `PAYMENT_GATEWAY_*` - 支付网关配置
- `BILLING_*` - 账单相关配置
- `NODE_ENV` - 运行环境 (development/production)
- `DB_HOST` - 数据库主机地址
- `DB_PORT` - 数据库端口
- `DB_NAME` - 数据库名称

### 服务配置
```typescript
const settings = {
  multiTenant: true,
  plans: {
    cacheTTL: 3600,
    defaultCurrency: 'CNY'
  },
  billing: {
    gracePeriod: 7,
    reminderDays: [7, 3, 1]
  },
  processing: {
    batchSize: 100,
    retryAttempts: 3
  },
  quota: {
    checkInterval: 300,
    warningThreshold: 0.8
  }
};
```

### 缓存策略

**Redis 缓存设计**:
- `plan:{planName}` - 计划信息缓存 (TTL: 1小时)
- `subscription:{userId}` - 用户订阅缓存 (TTL: 30分钟)
- `quota:{userId}:{quotaType}` - 配额使用量缓存 (TTL: 5分钟)
- `usage:{userId}:{period}` - 使用统计缓存 (TTL: 1小时)

**缓存更新策略**:
- 写入时更新 (Write-through)
- 定期刷新 (Scheduled refresh)
- 事件驱动失效 (Event-driven invalidation)

## 部署说明

### 前置条件
1. 确保Redis和Kafka服务正常运行
2. 配置MySQL数据库连接
3. 设置支付网关配置
4. 配置环境变量

### 开发环境部署
```bash
# 安装依赖
npm install

# 启动开发服务
npm run dev

# 运行测试
npm test
```

### 生产环境部署
```bash
# 构建项目
npm run build

# 启动生产服务
npm start

# 使用PM2管理进程
pm2 start ecosystem.config.js
```

### Docker部署
```bash
# 构建镜像
docker build -t subscription-service .

# 运行容器
docker run -d \
  --name subscription \
  -p 3000:3000 \
  -e NODE_ENV=production \
  subscription-service
```

### Kubernetes部署
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: subscription-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: subscription
  template:
    spec:
      containers:
      - name: subscription
        image: subscription:v1.0.0
        ports:
        - containerPort: 3000
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
```

## 监控和日志

### 业务指标
- 订阅转化率
- 支付成功率
- 用户流失率
- 配额使用率
- API响应时间

### 技术指标
- 接口响应时间
- 错误率统计
- 并发连接数
- 资源使用率
- 缓存命中率

### 监控工具
- **Prometheus** - 指标收集
- **Grafana** - 可视化监控
- **ELK Stack** - 日志分析
- **Jaeger** - 链路追踪

### 告警规则
```yaml
alerts:
  - name: 支付成功率过低
    condition: payment_success_rate < 0.95
    duration: 5m
    severity: critical
    
  - name: API响应时间过长
    condition: api_response_time > 2s
    duration: 2m
    severity: warning
```

## 故障排查

### 常见问题

#### 1. 支付相关问题
- **支付失败**: 检查支付网关配置和网络连接
- **订单状态不同步**: 验证回调URL配置
- **重复支付**: 检查幂等性实现

#### 2. 订阅状态问题
- **订阅状态异常**: 查看事件处理日志
- **自动续费失败**: 检查支付方式有效性
- **降级/升级异常**: 验证计划变更逻辑

#### 3. 配额管理问题
- **配额计算错误**: 检查Redis缓存状态
- **配额重置失败**: 查看定时任务执行情况
- **使用量统计不准**: 验证事件上报机制

#### 4. 性能问题
- **接口响应慢**: 检查数据库查询和缓存命中率
- **内存泄漏**: 监控进程内存使用情况
- **连接池耗尽**: 调整数据库连接配置

### 调试工具

#### 日志查看
```bash
# 查看实时日志
tail -f logs/subscription.log

# 过滤错误日志
grep "ERROR" logs/subscription.log

# 查看特定用户日志
grep "userId:12345" logs/subscription.log
```

#### 性能分析
```bash
# CPU性能分析
node --prof app.js

# 内存使用分析
node --inspect app.js
```

### 紧急处理流程

1. **服务不可用**
   - 检查进程状态
   - 重启服务实例
   - 切换到备用实例

2. **数据不一致**
   - 停止写入操作
   - 数据备份和恢复
   - 手动数据修复

3. **支付异常**
   - 暂停自动扣费
   - 人工处理订单
   - 通知用户处理结果


### 测试策略
```bash
# 单元测试
npm run test:unit

# 集成测试
npm run test:integration

# 端到端测试
npm run test:e2e

# 测试覆盖率
npm run test:coverage
```

### API设计原则
- RESTful接口设计
- 统一的响应格式
- 适当的HTTP状态码
- 详细的错误信息
- 版本化管理

### 扩展开发

#### 添加新的订阅计划
1. 在数据库中添加计划配置
2. 更新计划验证逻辑
3. 添加相应的配额限制
4. 测试计划创建和订阅流程

#### 集成新的支付方式
1. 实现支付提供商接口
2. 添加支付方式配置
3. 更新支付验证逻辑
4. 测试支付和回调流程

#### 扩展配额类型
1. 定义新的配额类型
2. 实现配额计算逻辑
3. 添加配额验证
4. 更新监控指标
