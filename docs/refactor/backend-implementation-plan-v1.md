# darwin-app 后端实施拆解与排期文档 v1

本文用于把以下后端设计内容转成可执行实施计划：

- `backend-api-contract-v1.md`
- 前端页面线框与组件需求中涉及的 read model / service contract

目标：在保留现有 Node-Universe + Kafka + MySQL + InfluxDB + Elasticsearch + Redis 架构前提下，渐进完成 darwin-app 的服务重构。

---

# 1. 总体实施原则

## 1.1 核心原则
1. 保留现有微服务边界，不做推倒式重写
2. 先统一 contract，再重构内部实现
3. 先补 read model，再推动前端替换旧页面
4. 先抽离公共命名与事件规范，再重构 service internals
5. 所有兼容逻辑应逐步从 gateway 挪出

## 1.2 交付原则
- 每个阶段必须能独立部署和回归
- 公共接口必须可同时服务旧前端和新前端迁移期
- 内部 action 命名必须逐步统一，不允许继续新增裸 action 风格
- 每个服务重构时都必须明确 public/internal/domain/repository/event 边界

---

# 2. 实施阶段总览

```text
Phase 0: 契约收敛与命名治理
Phase 1: Gateway 瘦身与公共模型统一
Phase 2: Catalog + Overview Read Model
Phase 3: Service Detail Read Model + Metrics 重组
Phase 4: Logs / Trace 查询与关联链路
Phase 5: Alert 服务独立化
Phase 6: Subscription / Billing / Ingestion 管理化
Phase 7: 收尾与旧契约下线
```

---

# 3. Phase 0：契约收敛与命名治理

## 3.1 目标
先停止“继续长歪”，把 action、event、response 的新旧风格统一起来。

## 3.2 任务包

### BE-0-1 公共响应模型统一
- 在 shared typings 层定义统一 success/error response shape
- 新增统一 pagination/meta 结构
- 后续新接口全部走统一格式

### BE-0-2 公共领域标识统一
统一以下字段：
- tenantId
- serviceId
- service
- appKey
- env
- region
- instanceId
- host
- traceId
- spanId
- timestamp
- tags

### BE-0-3 action naming 规范文件
建立 action 命名规范：
- public: `service.v1.resource.action`
- internal: `service.internal.action`

### BE-0-4 event naming 规范文件
建立事件命名规范：
- `domain.entity.event`

### BE-0-5 禁止继续新增混乱风格
明确禁止：
- 新增裸 action 名如 `subscription.getUserSubscription`
- 在 gateway 内新增业务兼容 hack

## 3.3 交付物
- contract 规范成文
- 新开发按统一命名执行

---

# 4. Phase 1：Gateway 瘦身与公共模型统一

## 4.1 目标
让 gateway 回到“transport 层”角色。

## 4.2 任务包

### BE-1-1 gateway 模块化整理
拆出：
- `transport/http`
- `transport/ws`
- `auth`
- `router`
- `response`

### BE-1-2 slash -> dot 路由逻辑集中
把路径转换、版本 fallback、action resolve 整理为独立 router utility。

### BE-1-3 清理 service-specific hack
包括但不限于：
- admin query 特判
- legacy services 路由 hack

### BE-1-4 auth middleware 明确化
- token 提取
- resolveToken 调用
- metadata.auth 控制
- error mapping

### BE-1-5 websocket transport 明确化
- 只负责推送，不承担业务聚合

## 4.3 验收标准
- gateway 不再新增领域逻辑
- 任何业务映射都可定位到 service 层
- 新接口不依赖 gateway 特判才能工作

---

# 5. Phase 2：Catalog + Overview Read Model

## 5.1 目标
先做前端最急需的读模型：Overview 与 Service Catalog。

## 5.2 任务包

### BE-2-1 Catalog 子域建立
可先放在 metrics 内部，后续独立：
- service metadata repository
- service identity resolver
- appKey → service 关系
- owner/team/tag/env/region 模型

### BE-2-2 Overview read model
新增接口：
- `/api/overview/v1/summary`
- `/api/overview/v1/trends`
- `/api/overview/v1/incidents`

### BE-2-3 Catalog API
新增接口：
- `/api/catalog/v1/services`
- `/api/catalog/v1/services/:serviceId`
- `/api/catalog/v1/services/:serviceId/quick-view`

### BE-2-4 读模型聚合器
不要让前端再自己把 metrics + alerts + service metadata 拼成 summary。

## 5.3 依赖
- metrics 当前 snapshot / stats / topology 数据
- subscription quota 数据
- 未来 alert 列表数据（前期可占位）

## 5.4 验收标准
- Overview 和 Service Catalog 可不依赖前端拼装逻辑直接消费
- service identity 字段统一可复用

---

# 6. Phase 3：Service Detail Read Model + Metrics 重组

## 6.1 目标
构建 service-first 的后端中心能力。

## 6.2 任务包

### BE-3-1 Service Detail Read Model
新增：
- `/api/service/v1/:serviceId/overview`
- `/api/service/v1/:serviceId/metrics`
- `/api/service/v1/:serviceId/topology`
- `/api/service/v1/:serviceId/runtime`

### BE-3-2 Metrics 服务内部重构
拆成子域：
- ingestion
- query
- realtime
- topology
- readmodel

### BE-3-3 Metrics action 重构
将现有 actions 整理为：
- `actions/public/*`
- `actions/internal/*`

### BE-3-4 topology 读模型统一
统一 service graph / instance graph / service subgraph 输出结构。

### BE-3-5 runtime 视图模型
把实例状态、appKey、ingest 状态统一成 service runtime read model。

## 6.3 验收标准
- Service Detail 页所需数据都有稳定 API
- metrics 查询和 read model 不再混在一起
- topology 输出稳定可供前端复用

---

# 7. Phase 4：Logs / Trace 查询与关联链路

## 7.1 目标
打通 investigate 主链路。

## 7.2 任务包

### BE-4-1 Logs search 重构
新增/规范化：
- `/api/logs/v1/search/execute`
- `/api/logs/v1/search/facets`
- `/api/logs/v1/patterns/list`
- `/api/logs/v1/exceptions/list`

### BE-4-2 Logs 子域拆分
- ingest
- search
- patterns
- exceptions
- export
- correlation

### BE-4-3 Trace 服务最小实现
新增 trace service 或 metrics/logs 临时子域承载，至少支持：
- trace search
- trace detail
- related logs
- service performance summary

### BE-4-4 correlation 契约
必须支持：
- traceId → logs
- serviceId → traces
- serviceId → logs
- exception cluster → logs/traces

## 7.3 验收标准
- 前端 logs/traces/exceptions 页可用统一接口工作
- 关联跳转不再依赖页面侧猜测字段

---

# 8. Phase 5：Alert 服务独立化

## 8.1 目标
把告警从“散在各处的状态”变成独立领域服务。

## 8.2 任务包

### BE-5-1 新建 alert 服务
职责：
- rules
- evaluator
- incidents
- notifications
- mute/silence

### BE-5-2 Alert API
实现：
- `/api/alerts/v1/incidents`
- `/api/alerts/v1/incidents/:id`
- `/api/alerts/v1/incidents/:id/ack`
- `/api/alerts/v1/incidents/:id/resolve`
- `/api/alerts/v1/rules`
- `/api/alerts/v1/notifications/*`

### BE-5-3 事件接入
接收来源：
- metrics anomaly
- log pattern spike
- trace latency spike
- ingest failure
- quota exceeded

### BE-5-4 incident read model
提供 alert inbox 直接消费的数据，不要让前端做 incident 拼装。

## 8.3 验收标准
- alert inbox 与 rule builder 都有后端真实支撑
- ack/resolve/mute 行为落库且可追踪

---

# 9. Phase 6：Subscription / Billing / Ingestion 管理化

## 9.1 目标
把 admin 类页面需要的数据稳定化。

## 9.2 任务包

### BE-6-1 Billing Read Model
规范：
- `/api/subscription/v1/current/detail`
- `/api/subscription/v1/usage/summary`
- `/api/subscription/v1/billing/history`

### BE-6-2 Quota 内部能力整理
明确 internal actions：
- `subscription.internal.checkQuota`
- `subscription.internal.consumeQuota`
- `subscription.internal.releaseQuota`

### BE-6-3 Ingestion Admin API
新增：
- `/api/admin/v1/ingestion/status`
- `/api/metrics/v1/appkey/list`
- `/api/metrics/v1/appkey/generate`
- `/api/metrics/v1/appkey/verify`

## 9.3 验收标准
- admin 页面可直接查看 quota / appKey / ingest 状态
- subscription 和 metrics 间接口清晰

---

# 10. Phase 7：收尾与旧契约下线

## 10.1 任务包
- 清理旧 action 命名
- 清理 gateway 兼容分支
- 下线旧 read model / 临时输出
- 补充文档与回归清单

## 10.2 下线候选
- 混乱命名 action
- 页面专属临时聚合接口
- 无人使用的 legacy route alias

## 10.3 验收标准
- 新前端主路径不再依赖旧契约
- 旧兼容逻辑可控下线

---

# 11. 后端任务拆分建议

## 11.1 建议 Track 划分

### Track A：Platform / Gateway / Contract
- response model
- action naming
- gateway router/auth/response

### Track B：Catalog + Overview
- catalog metadata
- overview read model
- service identity

### Track C：Metrics + Service Detail
- service overview
- metrics query
- topology
- runtime

### Track D：Logs + Trace
- logs search/facets/patterns/exceptions
- trace search/detail/correlation

### Track E：Alert + Admin
- alert service
- notifications
- billing / quota / ingestion status

---

# 12. 后端依赖关系

```text
Phase 0 -> Phase 1
Phase 0 -> Phase 2
Phase 1 + Phase 2 -> Phase 3
Phase 3 -> Phase 4
Phase 4 -> Phase 5
Phase 3 + Phase 5 -> Phase 6
All -> Phase 7
```

关键依赖：
- Overview 依赖 Catalog
- Service Detail 依赖 Metrics + Catalog
- Investigate 依赖 Logs/Trace
- Alerts 依赖 Metrics/Logs/Trace 事件输入
- Admin 依赖 Subscription + Metrics

---

# 13. 后端风险点

## 13.1 最大风险
- 继续在 action 中写复杂编排逻辑
- 新 contract 写了但旧接口仍被随意扩展
- gateway 再次承接领域兼容逻辑
- trace 服务边界模糊，最终又散回 metrics/logs

## 13.2 控制策略
- 新接口必须先写 contract 文档
- public/internal action 明确分开
- read model 与 raw query 分开
- trace 至少保证逻辑归属清晰

---

# 14. 里程碑建议

## M1
- Phase 0 + 1 完成
- contract 与 gateway 稳定

## M2
- Phase 2 完成
- overview / catalog 支撑新前端首页链路

## M3
- Phase 3 完成
- service detail 主路径可用

## M4
- Phase 4 完成
- investigate 能力闭环

## M5
- Phase 5 + 6 完成
- alerts/admin 完整可用

## M6
- Phase 7 完成
- 旧契约可控下线

---

# 15. 后端完成定义（DoD）

一个阶段完成，必须满足：

1. 对应 public API 契约已实现
2. 契约与文档一致
3. 不依赖 gateway hack 才能工作
4. 内部 action / repository / domain 角色明确
5. 至少有一条真实前端链路能消费该阶段输出
6. 兼容迁移策略清楚，可进入下一阶段
