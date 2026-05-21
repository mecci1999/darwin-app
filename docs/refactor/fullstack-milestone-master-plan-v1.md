# StarLight × darwin-app 重构里程碑总控文档 v1

本文用于把以下文档统一到一个跨前后端的执行视图中：

## StarLight
- `frontend-page-wireframes-v1.md`
- `frontend-component-spec-v1.md`
- `frontend-implementation-plan-v1.md`

## darwin-app
- `backend-api-contract-v1.md`
- `backend-implementation-plan-v1.md`

目标：
1. 给出统一里程碑
2. 明确前后端依赖关系
3. 明确哪些阶段可并行、哪些必须串行
4. 规定“完成”定义与验收方式
5. 避免后续只从单边项目视角推进

---

# 1. 总体目标

重构后的 StarLight + darwin-app 必须形成一条完整主链路：

**Overview → Service Catalog → Service Detail → Topology / Metrics / Logs / Traces / Alerts → Admin**

并满足以下标准：

- 前端围绕统一设计系统与组件体系构建
- 后端围绕统一 contract / read model / internal action 构建
- 所有 drill-down 使用统一 service identity + time range + scope context
- 不再依赖页面自行拼装关键 read model
- 不再依赖 gateway hack 或 mock 逻辑来支撑主路径

---

# 2. 总体实施原则

## 2.1 基本原则
1. 先 contract，再页面
2. 先壳层，再业务页
3. 先主链路，再扩展链路
4. 先读模型，再细粒度 explorer
5. 任何阶段都不能破坏现有可运行能力

## 2.2 完成标记原则
后续所有阶段/模块，只有满足以下条件才允许标记为 **已完成**：

1. 功能已经实现
2. 已完成对应测试/验证
3. 验证结果通过
4. 文档状态同步更新

否则只能标记为：
- `进行中`
- `待验证`
- `已设计`
- `已实现未验证`

**禁止因为“代码写完了”就提前标记已完成。**

---

# 3. 统一里程碑总览

```text
Milestone 0: 重构基线与治理建立
Milestone 1: 共享底座（Design System + Contract + Gateway 基础治理）
Milestone 2: 主路径 V1（Overview / Catalog / Service Detail）
Milestone 3: 服务关系与实例可视化（Topology / Instance）
Milestone 4: 调查能力闭环（Metrics / Logs / Traces / Exceptions）
Milestone 5: 风险治理闭环（Alerts）
Milestone 6: Admin 闭环（Billing / Quota / Ingestion / Setup）
Milestone 7: 收尾与旧路径下线
```

---

# 4. 里程碑详解

---

# Milestone 0：重构基线与治理建立

## 目标
让前后端都进入“适合重构”的状态。

## StarLight 任务
- 目录预重组
- 路由 meta 抽离
- 标记旧页面/旧组件技术债
- 准备新 shared/domains 结构

## darwin-app 任务
- 响应模型统一
- action naming 规范成文
- event naming 规范成文
- service identity 字段统一

## 依赖关系
- 前后端可并行
- 这是所有后续阶段前置条件

## 验收标准
- 规范文档写清
- 新开发可以按新规范落地
- 未开始大规模页面/服务迁移

## 完成状态建议
- 完成后可标记：`已完成`
- 如果只完成文档未同步代码规范：`待验证`

---

# Milestone 1：共享底座

## 目标
建立重构的共用底座。

## StarLight 任务
- Token 扩展
- NaiveProvider 主题桥接重构
- 首批共享组件：
  - PageHeader
  - TimeRangeBar
  - ScopeBar
  - ResultTable
  - DetailDrawer
  - ServiceHealthBadge
  - ServiceIdentityCard
  - RedSummaryCard
- 图表主题统一
- 基础 composables 建立

## darwin-app 任务
- Gateway 瘦身第一阶段
- 路由/响应/auth 逻辑收口
- slash→dot 路由逻辑整理
- 去除新增业务 hack 的入口

## 依赖关系
- 前后端可并行
- 前端组件底座不依赖 read model
- gateway 治理不阻塞前端共享组件

## 验收标准
- StarLight 至少 2 个旧页面能局部复用新组件
- darwin-app 新接口可按统一 contract 输出
- dark/light 与基础交互不出明显破坏

## 风险
- 共享组件还没稳定就被业务页各自 fork
- gateway 继续承载业务兼容

---

# Milestone 2：主路径 V1

## 目标
完成最核心的产品主路径：
**Overview → Service Catalog → Service Detail**

## StarLight 任务
- 新 Overview 页
- 新 Service Catalog 页
- 新 Service Detail 页
- 新服务详情 tab 壳层
- 新路由接入

## darwin-app 任务
- Overview read model
- Catalog read model
- Service detail overview API
- Service identity resolver

## 依赖关系
- 前端页面实现依赖后端提供：
  - `/overview/v1/summary`
  - `/catalog/v1/services`
  - `/catalog/v1/services/:serviceId`
  - `/service/v1/:serviceId/overview`

## 可并行拆分
- FE 可先做页面骨架和适配器
- BE 可先做 read model API
- 最终联调在 milestone 后半段完成

## 验收标准
- 用户可从 overview 进入 catalog，再进入 service detail
- timeRange / scope 透传成功
- 主链路不依赖 mock
- 至少一条真实后端链路打通

## 完成定义
- 页面有真实接口支撑
- 手动验证主路径通过
- 无关键阻断 bug

---

# Milestone 3：服务关系与实例可视化

## 目标
把服务关系和实例维度接入主路径。

## StarLight 任务
- TopologyGraph 重构
- TopologySidePanel
- ServiceDetail 的 topology tab
- Instance Monitor 重构

## darwin-app 任务
- 全局 topology graph
- service subgraph
- instance graph
- service runtime API

## 依赖关系
- FE 依赖 topology / runtime API
- 可在 Milestone 2 的基础上推进

## 验收标准
- topology 节点 click 有 side panel
- topology 节点 double click 可进 service detail
- instance 页面按 service 可过滤
- topology 与 service detail 之间可相互跳转

---

# Milestone 4：调查能力闭环

## 目标
完成 investigate 主能力闭环。

## StarLight 任务
- Metrics Explorer
- Logs Explorer
- Trace Explorer
- Exception Analysis
- correlation drill-down

## darwin-app 任务
- metrics query 规范化
- logs search/facets/patterns/exceptions
- trace search/detail/related logs
- trace/log/service correlation contract

## 依赖关系
- FE investigate 页面依赖 BE explorer 型 API
- 这一阶段是前后端联动最重的阶段

## 验收标准
- service detail 可跳 logs/traces/metrics
- trace 能回 logs
- exception 能回 traces/logs
- investigate 页面不再自己拼核心结果结构

## 风险
- trace 服务边界不清导致方案回退
- logs/traces 关联字段不统一

---

# Milestone 5：风险治理闭环

## 目标
建立 alert 服务和前端 alert 使用闭环。

## StarLight 任务
- Alert Inbox
- Alert Rule Builder
- Notifications 页面

## darwin-app 任务
- alert service 独立化
- incidents / rules / notifications API
- evaluator 输入接入 metrics/logs/trace/quota/ingest

## 依赖关系
- 依赖前面 investigate 和 metrics/logs/trace 事件输入逐步稳定

## 验收标准
- incident 可 ack/resolve/mute
- alert 可跳回 service detail
- rule builder 有真实后端支撑

---

# Milestone 6：Admin 闭环

## 目标
完成 billing / quota / ingestion / setup 管理能力。

## StarLight 任务
- Billing 页面
- Ingestion Admin 页面
- Setup / Onboarding 收束

## darwin-app 任务
- current subscription detail
- usage summary
- billing history
- appKey list/generate/verify
- ingestion status API

## 验收标准
- appKey 与 ingest 状态可直接查看和验证
- billing/quota 页面有真实数据
- onboarding 不再是孤立入口

---

# Milestone 7：收尾与旧路径下线

## 目标
用新体系完全替换旧主路径。

## StarLight 任务
- 旧页面路由重定向/下线
- 删除重复组件
- 删除页面直连 mock
- 删除未使用的过渡组件

## darwin-app 任务
- 清理 legacy action
- 清理 gateway compatibility branch
- 下线旧 read model / 临时 API

## 验收标准
- 主用户路径只走新结构
- 不再依赖 legacy hack
- 文档、路由、接口一致

---

# 5. 前后端依赖图

```text
Milestone 0
  ├─ FE 基线治理
  └─ BE 契约治理

Milestone 1
  ├─ FE 设计系统/共享组件
  └─ BE gateway 基础治理

Milestone 2
  ├─ BE Overview/Catalog/ServiceDetail read model
  └─ FE Overview/Catalog/ServiceDetail 页面

Milestone 3
  ├─ BE topology/runtime API
  └─ FE Topology/Instance 页面

Milestone 4
  ├─ BE metrics/logs/trace explorer API
  └─ FE Metrics/Logs/Traces/Exceptions 页面

Milestone 5
  ├─ BE alert service
  └─ FE Alerts 页面

Milestone 6
  ├─ BE subscription/billing/ingestion admin API
  └─ FE Admin 页面

Milestone 7
  ├─ FE 下线路由与旧组件
  └─ BE 下线 legacy contract
```

---

# 6. 并行推进建议

## 可并行阶段

### 并行组 A
- FE Phase 1（共享组件）
- BE Phase 1（gateway/contract 治理）

### 并行组 B
- FE Overview / Catalog 页面骨架
- BE Overview / Catalog read model

### 并行组 C
- FE Topology 画布与 side panel 外壳
- BE topology graph / runtime API

### 并行组 D
- FE logs/traces explorer UI 框架
- BE logs/traces query API

## 不建议并行过深的阶段
- Alert FE 与 Alert BE 不能长期脱钩
- Admin 页面最好等 usage/appKey/ingest 契约稳定后再正式接入

---

# 7. 统一状态标记规范

后续推进时，每个模块都按以下状态之一标记：

- `未开始`
- `设计中`
- `开发中`
- `已实现未验证`
- `验证中`
- `已完成`
- `已废弃`

## “已完成”门槛
必须同时满足：
1. 功能已实现
2. 已完成测试/验证
3. 验证通过
4. 文档状态已同步

示例：
- 仅页面开发完，接口没联调 → `已实现未验证`
- 已联调，但还没做手动回归 → `验证中`
- 联调+手动验证+必要测试通过 → `已完成`

---

# 8. 联合验收清单

## 8.1 主链路验收
- Overview 打开成功
- 风险服务可跳 Service Detail
- Service Detail 可跳 Topology / Logs / Traces / Alerts

## 8.2 上下文验收
- timeRange 透传正确
- scope 透传正确
- serviceId / traceId / appKey 透传正确

## 8.3 数据验收
- Overview 不再前端拼 summary
- Service Detail 不再前端拼 overview model
- logs/traces/alerts 使用后端统一结果结构

## 8.4 视觉验收
- dark/light 可用
- 新页面使用统一组件体系
- 不出现大量新 hardcode 颜色/尺寸

## 8.5 旧路径治理验收
- 旧页面不再是主路径
- gateway 无新增 hack
- legacy contract 有清单可下线

---

# 9. 推荐推进顺序（实际执行）

如果进入真正开发，建议按下面顺序推进：

1. **Milestone 0 + 1**
2. **Milestone 2**（必须优先完成）
3. **Milestone 3**
4. **Milestone 4**
5. **Milestone 5**
6. **Milestone 6**
7. **Milestone 7**

原因：
- 没有 M2，就没有 service-first 主路径
- 没有 M4，产品无法完成真实排查闭环
- M5/M6 是治理与运营能力，优先级低于主排查链路

---

# 10. 当前文档使用方式

本总控文档是“总目录”。

## StarLight 实施时配合使用
- `frontend-page-wireframes-v1.md`
- `frontend-component-spec-v1.md`
- `frontend-implementation-plan-v1.md`

## darwin-app 实施时配合使用
- `backend-api-contract-v1.md`
- `backend-implementation-plan-v1.md`

## 推进时更新方式
每完成一部分：
1. 更新对应项目实施计划文档状态
2. 更新本总控文档里对应 milestone/module 状态
3. 只有测试/验证完成后，才能把状态更新为 `已完成`
